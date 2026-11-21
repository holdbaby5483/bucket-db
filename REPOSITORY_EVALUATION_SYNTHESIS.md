# BucketDB 综合评价

评价对象：`a037e77`（2026-04-13），核心包 `@hold-baby/bucket-db@0.3.1`。
依据：独立代码审阅与故障/并发探针实测，再与 `REPOSITORY_EVALUATION.md`（GPT 评价）逐条核对。

证据标注：**复现** = 本次实际运行得到；**代码** = 阅读源码确认；**推断** = 未运行验证；**GPT** = 仅 GPT 报告声明，本次未复核。

## 1. 结论

BucketDB 是一个定位清楚、接口小、配套齐全的早期原型，核心约 2,000 行。它目前不能承载任何不允许丢数据的场景。

GPT 评价的总体判断成立，我核对过的每一条关键发现都能复现。但它低估了一点：索引丢失不需要故障注入。对一个新集合做 50 个并发 `insert`，50 个全部成功返回，`find({})` 只能查到 16 条。这是单进程、内存 adapter、无任何错误的正常路径。

路线上我与 GPT 有一处实质分歧：不建议在现有模型上重做 WAL。WAL 存在的唯一原因是文档和索引是两个没有原子提交的对象，而索引本身是文档的完整副本、可以重建。先定存储模型，WAL 很可能直接删掉（见第 6 节）。

## 2. 评分

评分是主观量化，用于对齐两份评价的差异，不是测量值。

| 维度 | GPT | 本次 | 综合 | 差异原因 |
|---|---:|---:|---:|---|
| 产品定位 | 7 | 7 | 7 | 一致 |
| 模块接口 | 6 | 5 | 5.5 | `StorageAdapter` 是好 seam，但契约缺错误分类、能力声明、凭证 provider，是多数 P0/P1 的根因 |
| 数据正确性 | 3 | 2 | 2 | 无故障的并发插入即丢索引 |
| 测试质量 | 4 | 3 | 3.5 | S3 adapter 从未在 CI 中对真实或模拟后端运行；v0.3.0 新增的恢复、缓存、路径校验没有专门测试 |
| 工程化 | 5 | 5 | 5 | 一致 |
| 文档质量 | 6 | 5 | 5.5 | 量大，但 production、规模、错误表、测试数四处与实现不符 |
| **综合** | **4.5** | **4** | **4** | |

## 3. 两份评价的关系

### 3.1 GPT 的发现中已独立确认的

| GPT 条目 | 本次结果 |
|---|---|
| 4.1 分片读取失败被当作空分片 | **复现**：分片内 5 条，注入一次读失败后再插入，可见数变为 1；文档对象仍有 6 个 |
| 4.2 WAL 只重放索引 | **复现**：写文档前崩溃，恢复后索引 1 条、文档 0 个、WAL 已清空 |
| 4.3 OSS HEAD 后无条件 PUT | **代码**确认（`oss-adapter.ts:88-103`）；并发 mock 未自行复现 |
| 4.4 错误被吞成“没找到” | **代码**确认 |
| 4.5 自定义重试是死代码 | **复现**：503 下 `client.send` 只被调用 1 次；SDK 重试又被 `maxAttempts: 1` 关闭 |
| 4.6 索引存完整文档副本 | **复现**：201 条文档时索引体积是文档总体积的 1.22 倍 |
| 4.7 `shardCount` 未持久化 | **复现**：见 3.2 的修正 |
| 测试数被生成文件放大 | **复现**：无凭证 132 pass / 22 skip（18 文件）；仅 `.test.ts` 为 72 pass / 17 skip（10 文件） |
| 行覆盖率 83.41%，S3 9.77%，OSS 8.48% | **复现**，数字一致 |
| npm 包 79 文件 / 29.4 kB，无 `LICENSE` | **复现** |
| 发布 workflow 打印 token 前四位 | **代码**确认（`publish.yml:53`） |

未复核的 GPT 声明：全仓构建（含 VitePress）通过、基础示例运行通过。本次只跑了 core 和 mcp 的 `tsc --noEmit`，均通过。

### 3.2 需要修正的 GPT 表述

1. **“`shardCount` 是未记录的持久化格式”不准确。** `apps/website/guide/concepts.md:121` 写了“分片数量创建后不可修改”。问题是代码不校验，不是文档没写。
2. **“FileSystem adapter 有相同的并发窗口”只对跨进程成立。** 该 adapter 全程同步 I/O，单进程内检查和写入之间没有让出点。
3. **“后端不支持原子条件写就 fail closed”对 OSS 过于悲观。** 阿里云官方文档确认 `PutObject` 不支持 `If-Match` / `If-None-Match`，但支持 `x-oss-forbid-overwrite: true`，即原子的“不存在才创建”（已存在返回 409 `FileAlreadyExists`）。只依赖 put-if-absent 的提交协议在 S3、OSS、本地文件系统上都能原子实现。限制：该 header 在开启或暂停版本控制的 bucket 上无效。
   - <https://www.alibabacloud.com/help/en/oss/user-guide/0017-00000245>
   - <https://help.aliyun.com/en/oss/developer-reference/putobject>
4. **路线顺序。** GPT 把“重做 WAL”排在“修正索引模型”之前，见第 6 节。

### 3.3 GPT 遗漏的问题

| 级别 | 问题 | 证据 |
|---|---|---|
| P0 | 首次写分片是无条件覆盖，并发插入新集合丢索引 | **复现** |
| P0 | WAL 恢复会重放其他存活实例正在进行的操作，并清掉对方的 WAL 条目 | **复现** |
| P1 | 真实的并发更新冲突抛 `StorageError`，不是 `ConcurrentUpdateError` | **复现** |
| P1 | 索引和文档是两份真相：过滤在索引副本上算，返回的是重新读取的文档 | **复现** |
| P1 | 凭证只接受静态 AK/SK，不支持 session token 和默认凭证链 | **代码** |
| P1 | 一条类型不符的文档会让整个范围查询抛错 | **复现** |
| P1 | 缓存返回值与缓存共享引用，调用方修改会污染缓存；缓存不可配置、不可关闭 | **复现** |
| P1 | 路径清洗静默改写而不是拒绝，不同集合名映射到同一路径 | **复现** |
| P2 | 分片 metadata 的“优化”让查询 GET 数翻倍，且自身有竞态 | **复现** / **推断** |
| P2 | 两个云 SDK 是硬依赖并在入口静态导入；SDK 版本下限早于 S3 条件写 | **代码** / **推断** |
| P2 | 发布 workflow 发布前不跑测试 | **代码** |

各项细节见第 4 节。

## 4. 问题清单（合并后）

### P0：会丢数据或破坏一致性

**4.1 首次写分片无条件覆盖**（`shard-manager.ts:34-56`）

分片不存在时 `readShard` 返回 `etag: undefined`，`writeShard` 随即做无条件 PUT。多个写入者同时创建同一分片时后写覆盖先写。

复现：新集合、16 分片、`Promise.all` 50 个 `insert`。50 个全部 resolve，`docs/` 下 50 个对象，`find({})` 返回 16 条，正好每个分片只留下最后一个写入者。分片已存在时走 `ifMatch` 加重试，同样 50 并发全部可见。修复方式是首次写入带 `ifNoneMatch: '*'`。

**4.2 分片读取失败被当作空分片**（`shard-manager.ts:34-48`）

同 GPT 4.1。任何读错误都返回空分片，接着无条件写回，分片里原有条目全部消失。与 4.1 是同一处代码的两个触发条件。

**4.3 WAL 不提供它声称的保证**（`collection.ts:61-87`、`wal.ts`）

- 恢复只修索引，不修文档。写文档前崩溃：恢复后索引里有条目、文档不存在、WAL 已清空。**复现**
- `delete` 在删文档前崩溃：恢复只删索引，之后 `findById` 能查到该文档，`find` 查不到。**复现**
- 恢复无法区分“已崩溃”和“进行中”。第二个实例构造 `Collection` 时，重放了第一个实例尚未写完文档的 insert，先建了索引条目并清掉对方的 WAL。**复现**
- WAL 以 `documentId` 为键，同一文档的并发操作互相覆盖条目。**代码**
- 恢复在构造函数里启动且不等待，失败只打印 `console.error`。**代码**

每次写入为此多付 2 个请求。

**4.4 OSS 乐观锁非原子**（`oss-adapter.ts:88-103`）

同 GPT 4.3。OSS 上文档更新、分片冲突重试、`ifNoneMatch` 三者都没有实际保护。

### P1：错误语义、规模、可用性

**4.5 错误被吞没或类型错误**

- `findById`、`readShard`、`readShardMetadata`、`batchGet`、`WAL.listPending` 捕获所有异常。网络或权限错误表现为“文档不存在”或查询结果静默变少。**代码**
- `update` 在读后写前被其他写入者抢先时，抛出 `StorageError: PreconditionFailed: ETag mismatch`。README 承诺的是 `ConcurrentUpdateError`。**复现**
- 冲突判断靠 `error.message.includes('PreconditionFailed')` 字符串匹配。**代码**
- `PathValidationError` 未导出，也不继承 `BucketDBError`；`ValidationError` 导出但从未抛出。**代码**

**4.6 重试是死代码**（`s3-adapter.ts:57-74`、`oss-adapter.ts:47-64`）

同 GPT 4.5。两个 adapter 结构相同；S3 侧已复现，OSS 侧为**代码**确认。

**4.7 请求数与规模**

| 操作（16 分片，201 条文档） | 请求数 |
|---|---:|
| `insert` | 6（1 GET + 4 PUT + 1 DELETE） |
| `find` 命中 1 条 | 33（32 GET + 1 次 `batchGet`） |

- 每次写入重写整个分片，成本随分片大小线性增长；非 `id` 查询要下载全部分片，等于下载整个数据集。
- `find` 先读 16 个 metadata 再读 16 个分片。只要分片非空，这个“优化”就让 GET 数翻倍。metadata 是无条件写，且与分片不是原子写入；删除和插入交错时 `docCount` 可能停在 0，使非空分片被查询跳过。**推断**
- `listKeys` 无分页：S3 单页 1000，`ali-oss` 默认 100（见其 README）。
- S3 请求超时硬编码 3 秒，不可配置。大分片会先撞上它。**推断**
- 文档写的是“百万级以下”（`docs/API.md:636`、`apps/website/index.md:88`），并给出 100K+ 文档用 64 分片的建议。按当前模型，1 KB 文档、10 万条、64 分片时每次插入要重写约 1.5 MB，每次非 `id` 查询要下载约 100 MB。**推断**

**4.8 `shardCount` 不校验**

用 4 分片写入 20 条，换 16 分片打开并更新其中 10 条为 `i = -1`。之后 `find({ i: { $gte: 0 } })` 返回的结果里有 8 条实际值是 `-1`：旧分片里的陈旧副本仍参与过滤。**复现**

**4.9 索引与文档双真相**

过滤条件在索引里的文档副本上求值，返回的却是从 `docs/` 重新读取的对象。两者不一致时，结果可以不满足查询条件（4.8 的复现即是）。文档写入和索引写入是两个独立请求，同一文档的并发更新没有顺序保证，索引可以长期停在旧版本。**推断**

**4.10 查询缓存**（`collection.ts:59`、`lru-cache.ts`）

- 实例 B 写入后，实例 A 的相同查询仍返回旧结果，最长 5 分钟。**复现**
- `find` 返回的数组就是缓存里的对象，调用方修改后下次查询读到被改过的值。**复现**
- 容量 100、TTL 5 分钟写死在构造函数里，无法关闭。

对一个以共享对象存储为后端、面向多实例和 serverless 的库，默认开启进程内结果缓存是错误的默认值。

**4.11 凭证模型**（`types/storage.ts:33-46`）

`credentials` 必填，只有 `accessKeyId` 和 `secretAccessKey`。没有 session token，也不能省略以使用默认凭证链。Lambda、ECS、EKS 上的 IAM Role 和 OSS 的 STS 临时凭证都用不了，只能下发长期密钥。这与“云原生、无服务器”的定位直接冲突。

**4.12 查询语义**（`query/evaluator.ts`）

- 范围操作符遇到类型不符直接抛错。集合里有一条 `age: null`，`find({ age: { $gt: 18 } })` 整个失败。**复现**
- `$ne` / `$nin` 不匹配缺失字段：3 条文档中 2 条的 `age` 不是 30，`{ age: { $ne: 30 } }` 只返回 1 条。**复现**
- `limit: 0` 被忽略，返回全部。**复现**
- 没有排序，`offset` / `limit` 的分页顺序未定义。
- `validateFilter` 对每条文档执行一次。

**4.13 路径清洗静默改写**（`utils/path-validator.ts:21-50`）

`'a/b'` 被改写成 `'a_b'`，`'x..y'` 被改写成 `'xy'`，与同名集合共用存储路径；`BucketDB` 的实例缓存却按原始名区分。**复现**。应当拒绝而不是改写。另外对象 key 用 Node 的 `path.join` / `path.resolve` 拼接，Windows 上会产生反斜杠。**推断**

### P2：打包、适配器细节、仓库卫生

- **依赖。** `@aws-sdk/client-s3` 和 `ali-oss` 都是硬依赖，并在 `index.ts` 静态导入。只用文件系统的用户也要安装和加载两个 SDK。没有子路径导出，没有 `engines`。
- **SDK 下限。** `^3.490.0` 早于 S3 条件写上线（`If-None-Match` 2024-08-20，`If-Match` 2024-11-25）。锁在旧版本的使用方，`IfMatch` 参数会被静默丢弃。**推断**
  - <https://aws.amazon.com/about-aws/whats-new/2024/08/amazon-s3-conditional-writes/>
  - <https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-s3-functionality-conditional-writes>
- **FileSystem adapter。** 同步 I/O 阻塞事件循环；`.meta` 文件里存了一份完整数据，磁盘占用翻倍；临时文件名固定为 `.tmp`；注释写的“两个文件同时原子可见”不成立，是两次独立 rename。
- **文档体污染。** `update` 把读取时附加的 `_etag` 合并后写回文档体；`UpdateDocument` 允许覆盖 `_createdAt`。
- **生成文件入库。** `packages/core/tests` 下 32 个编译产物。本地有 `.env` 时，过时的 `oss-adapter.test.js` 会用硬编码的 `test-bucket` 请求真实 OSS，`bun test` 结果是 145 pass / 8 skip / 1 fail。
- **已忽略但被跟踪。** `local-db-data/`（12 个示例数据文件）和 `.claude/settings.local.json` 都在 `.gitignore` 里，却已提交。后者未发现密钥。
- **发布流程。** 打 tag 即发布，之前不跑测试；打印 token 前缀；使用官方已不再维护的 `actions/create-release@v1`。
- **CI。** 没有 S3 集成 job，也没有 LocalStack 或 MinIO；Bun 版本用 `latest`；不在 Node 上验证，而 README 给了 `npm install` 用法。
- **文档与实现不符。** README 错误表写 `delete` 会因过期 etag 抛 `ConcurrentUpdateError`，`delete` 没有 etag 参数；changelog 的“132 tests”是放大后的数字；`CollectionMeta` 导出但无实现；`index.ts:11` 的注释仍指向已删除的 `@bucket-db/types`。
- 无 `LICENSE` 文件，无 lint 和 format 配置。

## 5. 做得好的地方

- **Seam 选得对。** `StorageAdapter` 六个方法、四个真实实现，上层完全不感知后端。后续所有修复都可以收敛在这个接口的契约上。
- **对外接口小。** 五个方法，类型推断可用，上手成本低。
- **OSS 集成测试是真的。** 13 个用例对真实 bucket 运行并通过（本地带凭证实测），fork PR 不注入 secrets。
- **有安全意识。** 路径穿越检查、操作符白名单、保留字段名过滤都在，方向正确，问题在实现细节。
- **配套完整。** npm 包、MCP server、文档站、示例、changelog、`llms.txt`、发布流水线。
- **体量小。** 核心约 2,000 行，重做存储核心的成本低。这是最大的有利条件。

## 6. 路线建议

### 阶段 0：止血

不改架构，逐条对应上面的复现。

1. `readShard` 只在明确 NotFound 时返回空分片，其余错误抛出。
2. 首次写分片带 `ifNoneMatch: '*'`。
3. 删除自定义重试，恢复 SDK 默认重试。
4. 存储冲突用错误类型表达，`update` 中转成 `ConcurrentUpdateError`。
5. 查询缓存默认关闭、可配置，返回副本。
6. 删除 32 个生成测试文件和 `local-db-data/`，发布前跑测试，去掉 token 打印，补 `LICENSE`。
7. README 和文档站去掉 production 标注和百万级表述，写明当前只支持单写入者。

### 阶段 1：先定存储模型

这是与 GPT 路线的分歧点。GPT 的顺序是适配器契约、重做 WAL、持久化 metadata、修正索引模型。问题在于第二步的产物会被第四步推翻。

建议在两个模型里选一个：

- **A：文档为唯一真相，索引为可重建的派生物。** 写路径是条件写文档，然后尽力更新索引。提供 `rebuildIndex()` 和一致性校验。删掉 WAL。崩溃后最坏情况是索引滞后，可检测、可修复，不会出现“索引有而文档无”。
- **B：manifest 或日志式提交。** 只依赖 put-if-absent，在 S3（`If-None-Match: *`）、OSS（`x-oss-forbid-overwrite`）、本地文件系统上都能原子实现，可以支持多写入者和更大规模。实现量明显更大。

推荐 A。它与当前体量和“小数据、读多写少、无服务器”的定位匹配，并且直接消除 4.1 到 4.3、4.8、4.9 这一整类问题。规模承诺按实测结果重写。B 留到有真实多写入者需求时再做。

### 阶段 2：契约与生命周期

- `StorageAdapter`：错误分类（NotFound / Conflict / Transient）、能力声明、分页、`batchGet` 并发上限和显式的部分失败。
- 凭证接受 provider 或可省略，支持 session token。
- 持久化 collection metadata（格式版本、`shardCount`），打开时校验。
- 提供 `await db.open()`，去掉构造函数里的后台任务。

### 阶段 3：测试

- 写一个包装 `MemoryStorageAdapter` 的故障注入 adapter。本文全部复现都只用了这一种手段，足以变成回归测试。
- S3 adapter 用 LocalStack 或 MinIO 进 CI。
- 加 Node 版本矩阵。

### 阶段 4：打包与语义

- 云 SDK 改为可选 peer 依赖，按子路径导出 adapter，抬高 SDK 版本下限。
- 明确查询语义：类型不符、缺失字段、`limit: 0`、排序。
- 路径组件非法时拒绝。

## 7. 是否值得继续

值得，前提是收窄范围。定位有真实需求，seam 正确，代码量小。

仓库 2026-02-08 首次提交，2026-04-13 之后没有新提交，71 个提交集中在两个月内。0.3.0 一次加入了 WAL、缓存、路径校验三项机制，都没有配套的故障测试，三项也都出现在上面的问题清单里。下一步应当是减法：删掉 WAL 和默认缓存，把文档承诺降到实测能支撑的水平，再用故障注入测试守住它。

## 附：本次验证方法

| 验证项 | 结果 |
|---|---|
| `bun test`（无凭证） | 132 pass / 22 skip / 0 fail，18 文件 |
| `bun test`（本地 `.env` 含 OSS 凭证） | 145 pass / 8 skip / 1 fail |
| 仅 `.test.ts`（无凭证） | 72 pass / 17 skip，10 文件 |
| 仅 `.test.ts`（含 OSS 凭证） | 85 pass / 4 skip |
| 行覆盖率（仅 `.test.ts`，无凭证） | 83.41%；S3 9.77%；OSS 8.48%；`collection.ts:71-83`（WAL 重放回调）未执行 |
| `tsc --noEmit`（core、mcp） | 通过 |
| `npm pack --dry-run` | 79 文件，29.4 kB，不含 `LICENSE` |

探针全部基于 `MemoryStorageAdapter`，通过替换其 `get` / `put` / `delete` 注入失败或暂停，另有一项替换 `S3Adapter` 内部 `client.send` 以计数。探针脚本为一次性文件，已删除，未改动仓库内任何已有文件。

未覆盖：真实 S3、跨进程并发、Windows 路径行为、VitePress 构建、MCP server 运行。标注为**推断**的条目都需要在修复前先写出复现。
