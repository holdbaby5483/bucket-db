# BucketDB 仓库评价报告

## 1. 结论

BucketDB 是一个方向清晰、接口简洁的早期项目，但当前更接近“可演示的数据库原型”，不适合作为生产数据库使用。

基本 CRUD 和单进程 happy path 工作正常；主要风险集中在数据库最重要的部分：故障恢复、并发控制、错误语义和数据完整性。其中存在已复现的数据丢失路径。

适用场景：

- 学习和技术验证
- 内存或本地文件存储的功能演示
- 低并发、允许数据丢失的非关键场景

当前不适用场景：

- 生产业务数据
- 多实例并发访问
- 依赖严格乐观锁的写入
- 需要可靠故障恢复的服务
- 大规模集合或高吞吐查询

## 2. 评分

| 维度 | 评分 | 评价 |
|---|---:|---|
| 产品定位 | 7/10 | “对象存储上的轻量文档数据库”定位明确，使用门槛低 |
| 模块接口 | 6/10 | `Collection` 接口小，`StorageAdapter` 是真实且有价值的 seam |
| 数据正确性 | 3/10 | WAL、分片读取和 OSS 乐观锁存在关键语义缺陷 |
| 测试质量 | 4/10 | happy path 较全，但缺故障注入、恢复和并发测试，测试数被生成文件放大 |
| 工程化 | 5/10 | 构建、CI、发布和文档站齐全；缺 lint、质量闸门和许可证文件 |
| 文档质量 | 6/10 | 文档丰富，但对 durability、scale、production readiness 的承诺偏高 |
| **综合** | **4.5/10** | **有潜力的原型，需要一次可靠性重构才能进入生产候选阶段** |

## 3. 做得好的地方

### 3.1 主模块结构容易理解

核心路径清楚：

```text
BucketDB
  -> Collection
    -> WAL / ShardManager / LRUCache
      -> StorageAdapter
        -> Memory / FileSystem / S3 / OSS
```

`StorageAdapter` 有四个实际 adapter，不是假想抽象。调用方通过六个方法获得多后端支持，具备不错的模块深度和替换能力。

### 3.2 对外接口较小

`ICollection` 只暴露：

- `insert`
- `findById`
- `find`
- `update`
- `delete`

对使用者友好，TypeScript 类型推断、查询操作符和 ETag 更新方式也容易上手。

### 3.3 已具备基础安全意识

当前已有：

- 路径穿越保护：`packages/core/src/utils/path-validator.ts`
- 查询字段和操作符白名单：`packages/core/src/query/evaluator.ts`
- fork PR 不注入 OSS secrets
- 存储 adapter 隔离
- 条件写入接口

方向正确，主要问题在于语义实现还不完整。

### 3.4 项目配套较完整

当前已有：

- npm 包
- MCP server
- VitePress 文档站
- 示例项目
- CI 和 npm 发布工作流
- changelog
- `llms.txt`

`npm pack --dry-run` 成功，产物为 29.4 kB，包含构建后的 JavaScript、类型声明、README 和 `llms.txt`。

## 4. 关键问题

### 4.1 P0：分片读取临时失败会导致索引数据被覆盖

位置：`packages/core/src/index/shard-manager.ts:34-48`

`readShard()` 捕获所有错误，统一当作“分片不存在”处理：

```ts
try {
  return await adapter.get(path);
} catch {
  return { shard: emptyShard, etag: undefined };
}
```

正常故障场景：

1. 分片已有文档 A。
2. 新增文档 B 时，读取分片遇到一次网络超时。
3. 超时被解释成“分片为空”。
4. 系统写入只包含 B 的新分片。
5. 文档 A 从索引中消失。

通过故障注入得到的结果：

```json
{"a": null, "b": {"id": "b", "value": 2}}
```

S3、OSS 临时失败是正常运行条件，因此这不是边缘问题。

决策：必须优先修复。存储层需要明确的 `NotFound` 错误类型。只有确认对象不存在时才能返回空分片；网络、认证、限流和解析错误必须向上传播。

### 4.2 P0：WAL 没有提供文档写入的 durability

位置：

- `packages/core/src/core/collection.ts:61-87`
- `packages/core/src/core/wal.ts:83-104`

当前操作顺序：

1. 写 WAL。
2. 写文档。
3. 更新索引。
4. 清理 WAL。

恢复逻辑却只重放索引：

```ts
case 'insert':
case 'update':
  await shardManager.addDocument(entry.documentData);
```

如果进程在写 WAL 后、写文档前崩溃：

- 恢复过程只把文档加入索引；
- 实际文档仍不存在；
- WAL 被清除；
- 插入操作永久丢失。

通过故障注入得到的结果：

```json
{"walPending": 0, "document": null, "queryCount": 0}
```

另外，恢复过程在 `Collection` 构造函数中异步启动且不等待：

```ts
this.recoverFromWAL().catch(...)
```

调用方可以在恢复完成前立即查询或写入，与恢复过程发生竞态。

决策：重新定义恢复协议。建议提供显式异步初始化接口，例如 `await db.open()`，并按操作进行幂等重放：

- insert/update：恢复文档，再恢复索引；
- delete：删除文档，再移除索引；
- 恢复完成前不开放 Collection 操作。

### 4.3 P0：OSS 乐观锁不是原子的

位置：`packages/core/src/storage/oss-adapter.ts:88-103`

当前实现是：

```text
HEAD 检查 ETag
  -> 无条件 PUT
```

两个并发写入者可以同时通过检查，然后依次覆盖对象。后写入者不会收到 `PreconditionFailed`。

这会直接破坏：

- `Collection.update()` 的文档乐观锁；
- `ShardManager` 的冲突重试；
- `ifNoneMatch` 的“仅不存在时创建”。

已通过可控并发 mock 复现：竞争写入 `v2` 后，过期的 `ifMatch: v1` 仍成功写成 `v3`。

决策：adapter 必须提供真实的原子条件写入。如果某个后端不支持，应明确报告 `UnsupportedConditionalWrite`，不能用非原子的预检查伪装支持。

FileSystem adapter 的“检查后写入”也有相同的并发窗口，而且两个 `renameSync` 不能保证数据文件和 metadata 文件同时原子可见。

### 4.4 P1：错误被大量转换成“没找到”或“部分结果”

典型位置：

- `Collection.findById()`：`packages/core/src/core/collection.ts:136-144`
- `ShardManager.readShard()`：`packages/core/src/index/shard-manager.ts:34-48`
- `batchGet()`：FileSystem、S3、OSS adapter 均捕获所有异常并忽略
- `WAL.listPending()`：`packages/core/src/core/wal.ts:63-80`

可能后果：

- OSS 权限错误表现为“文档不存在”；
- S3 网络错误让查询静默少返回部分数据；
- WAL 列举失败表现为“没有待恢复操作”；
- 损坏的 JSON 被静默跳过。

对于数据库，明确失败优于错误地返回空结果。

建议将存储错误至少分成：

- `StorageNotFoundError`
- `StorageConflictError`
- `StorageTransientError`
- `StorageCorruptionError`
- `StoragePermissionError`

如果 `batchGet` 允许部分成功，返回值必须显式携带每个失败项，不能只返回一个缺少失败对象的 `Map`。

### 4.5 P1：自定义重试实际上没有执行

位置：`packages/core/src/storage/s3-adapter.ts:57-71`

内部方法先把 SDK 错误包装成 `StorageError`，外层 `withRetry()` 再检查：

```ts
error.name
error.$metadata
error.code
```

这些字段已经被包装掉，因此无法识别 503、限流或超时。

使用 503 mock 验证，实际调用次数为：

```json
{"attempts": 1}
```

代码虽然声明最多重试三次，但实际只调用一次。S3 SDK 自带重试又被 `maxAttempts: 1` 禁用，因此没有其他保护层。

建议二选一：

1. 直接使用 SDK 重试策略；或
2. 在包装错误之前执行重试，并保留结构化错误字段。

不要同时维护两套重试机制。

### 4.6 P1：当前分片模型难以支撑文档宣称的规模

`IndexShard.documents` 保存完整文档副本，而不是轻量索引：

```ts
documents: Record<string, any>
```

每次写入需要：

1. 读取整个分片对象；
2. 修改一个文档；
3. 重写整个分片；
4. 重写 metadata；
5. 单独写文档对象和 WAL。

查询又会：

1. 下载所有非空分片；
2. 扫描分片内的完整文档；
3. 提取 ID；
4. 对每个结果再次发起对象读取。

因此：

- 每次写入成本随单个分片大小增长；
- 普通字段查询仍是全表扫描；
- 没有 `limit` 时，`batchGet()` 会通过 `Promise.all` 发出无上限并发请求；
- 缓存只在当前进程内失效，多实例写入后其他实例最多读到 5 分钟旧数据；
- S3/OSS `listKeys()` 没处理 continuation token，超过服务端单页上限后会静默截断。

文档建议单集合支持少于一百万条文档，但当前数据结构和 I/O 模型无法可靠支撑这一承诺。

### 4.7 P1：`shardCount` 是未记录的持久化格式

文档允许：

```ts
db.collection('users', { shardCount: 16 })
```

但 shardCount 没有写入存储。`CollectionMeta` 类型虽然存在，却没有任何实现使用它。

如果两个进程或两个版本使用不同的 shardCount：

- 同一个 ID 会映射到不同分片；
- 查询、更新和删除可能找不到原记录；
- 索引会逐步分裂。

这是调用方必须知道、但接口没有表达的隐藏不变量。应在创建 collection 时持久化 metadata，并拒绝用不一致的配置打开已有 collection。

## 5. 测试与工程化评价

### 5.1 实测结果

| 验证项 | 结果 |
|---|---|
| 全仓构建 | 通过：Core、MCP、VitePress 全部成功 |
| 基础示例 | 通过：插入、查询、更新、删除均成功 |
| 默认测试命令 | 132 pass / 22 skip / 0 fail |
| 仅 TypeScript 源测试 | 72 pass / 17 skip / 0 fail |
| 行覆盖率 | 83.41% |
| S3 adapter 行覆盖率 | 9.77% |
| OSS adapter 行覆盖率 | 8.48% |
| npm 打包 | 通过：79 files，29.4 kB |
| 工作区 | clean |

### 5.2 测试数量存在水分

`packages/core/tests` 中提交了 32 个生成文件：

- `.test.js`
- `.d.ts`
- `.js.map`
- `.d.ts.map`

Bun 同时执行 `.test.ts` 和生成的 `.test.js`，所以默认显示 18 个测试文件，而实际源测试只有 10 个文件。

Changelog 宣称“132 tests”，但仅运行 TypeScript 源文件时是：

- 72 pass
- 17 skip
- 10 files

建议删除所有测试生成物，并在 `.gitignore` 中阻止它们再次进入仓库。

### 5.3 缺少真正重要的测试

当前测试主要覆盖 happy path，缺少：

- WAL 在每个写入阶段崩溃后的恢复；
- 存储读取超时、权限错误和损坏 JSON；
- 两个实例并发更新同一文档或分片；
- 多实例缓存一致性；
- shardCount 配置不一致；
- S3/OSS 分页；
- 大结果集的并发限制；
- FileSystem 写入过程中断；
- MCP 工具测试。

当前覆盖率数字较高，但没有覆盖数据库最重要的故障模型。

## 6. 文档和仓库卫生

需要调整的地方：

- `S3Adapter`、`OSSAdapter` 被标为 production，但可靠性条件尚未满足。
- changelog 宣称 WAL 提供 durability，但实测 WAL 会清除尚未完成的写入。
- README 说 `delete` 支持 stale etag，实际 `delete()` 没有 etag 参数。
- `ValidationError` 被公开导出并写入文档，但生产代码没有使用。
- `CollectionMeta` 被公开导出但没有对应实现。
- 没有 lint、format、coverage threshold 或静态质量脚本。
- 仓库和 npm 包中没有 `LICENSE` 文件，只有 `package.json` 中的 `"license": "MIT"`。
- 发布 workflow 会打印 npm token 前四位，没有必要，建议删除。
- CI 使用 `bun-version: latest`，且 `bun install` 未使用冻结锁文件模式，可复现性偏弱。
- OSS 集成 job 在凭据缺失时仍会以 `1 pass / 13 skip / 0 fail` 成功，应增加凭据预检。

## 7. 建议路线

按以下顺序处理，避免在错误的存储语义上继续增加功能。

### 第一阶段：重新定义 StorageAdapter 契约

- 类型化 NotFound、Conflict、Transient、Corruption。
- adapter 声明能力。
- 不支持原子条件写入时失败关闭。
- 明确 `batchGet` 的部分失败语义。
- 修复重试层级和错误结构。

### 第二阶段：重做 WAL 和初始化生命周期

- 提供 `await db.open()` 或异步工厂。
- 重放完整操作，不只修复索引。
- 恢复完成前禁止业务操作。
- 为每个崩溃点增加故障注入测试。

### 第三阶段：持久化 collection metadata

- 持久化 shardCount、格式版本和创建时间。
- 打开 collection 时验证配置兼容性。
- 为格式升级提供明确迁移路径。

### 第四阶段：修正索引和查询模型

- 索引只存查询所需字段或 ID。
- 对对象读取设置并发上限。
- 支持 S3/OSS continuation token。
- 明确定义缓存和跨实例一致性。
- 重新验证规模承诺。

### 第五阶段：清理工程质量

- 删除生成测试文件。
- 增加 lint、format、覆盖率及故障测试闸门。
- 补充 `LICENSE`。
- OSS 集成测试缺少凭据时直接失败。
- 固定 Bun 版本并使用冻结锁文件安装。
- 下调文档中的 production 和 scale 承诺，直到可靠性验证完成。

## 8. 最终判断

BucketDB 的产品方向和外部接口值得保留，`StorageAdapter` seam、简洁 CRUD 接口、文档和工具配套构成了良好基础。

当前不应继续优先增加查询操作符、adapter 或上层功能。下一阶段应集中解决：

1. 存储错误语义；
2. WAL 恢复正确性；
3. 原子条件写入；
4. collection 持久化元数据；
5. 并发和故障测试。

完成前三项之前，该项目只能用于学习、演示和允许数据丢失的低并发场景；不应承载生产数据。
