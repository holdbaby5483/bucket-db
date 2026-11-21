# 核心概念

理解 BucketDB 的核心概念，帮助你更好地使用它。

## 数据库（BucketDB）

数据库是顶层容器，通过 `dbPath` 参数实现数据隔离。

```typescript
const db = new BucketDB(adapter, 'my-app');
```

**用途**：
- **多环境隔离** - 开发、测试、线上环境使用不同的 dbPath
- **多租户隔离** - 每个租户使用独立的 dbPath
- **逻辑分组** - 按业务逻辑分组数据

**示例**：

```typescript
// 多环境
const devDB = new BucketDB(adapter, 'dev');
const prodDB = new BucketDB(adapter, 'prod');

// 多租户
const tenant1DB = new BucketDB(adapter, 'tenant-001');
const tenant2DB = new BucketDB(adapter, 'tenant-002');
```

## 集合（Collection）

集合是文档的容器，类似于传统数据库的表。

```typescript
const users = db.collection<User>('users');
```

**特性**：
- **类型安全** - 泛型参数提供完整的类型推断
- **独立索引** - 每个集合有自己的索引分片
- **单例模式** - 同一个 `BucketDB` 实例中，同名集合返回同一实例（不同的 `BucketDB` 实例会得到不同的 `Collection`，同时写入同一集合属于多写入者，不受支持）

**集合名规则**：集合名会先经过路径清洗：`/` 和 `\` 被替换为 `_`，`..` 被删除（因此 `a/b` 实际存储为 `a_b`，清洗后相同的名字共享同一存储位置）。清洗结果为空、包含字母/数字/`_`/`-`/`.` 以外的字符、超过 255 个字符或以 `.` 开头时，`db.collection()` 会同步抛出 `PathValidationError`（该错误未导出，且继承自 `Error` 而非 `BucketDBError`）。文档 ID 按同样规则清洗；非法 ID 会被当作不存在处理。`dbPath` 不做校验，BucketDB 用 Node 的 `path.join` 拼接它，会被规范化（例如 `./app/` 变成 `app`）。

**配置**：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 自定义分片数量（默认 16）
});
```

## 文档（Document）

文档是数据的基本单元，包含用户数据和系统字段。

```typescript
interface User extends Document {
  name: string;
  age: number;
  email: string;
}
```

**系统字段**：
- `id: string` - 唯一标识符（UUID v4）
- `_etag?: string` - ETag，用于乐观锁
- `_createdAt?: string` - 创建时间（ISO 8601）
- `_updatedAt?: string` - 更新时间（ISO 8601）

**类型变换**：

```typescript
// 插入时：省略系统字段
type InsertDocument<T> = Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>;

// 更新时：所有字段可选，除了 id
type UpdateDocument<T> = Partial<Omit<T, 'id'>>;
```

## 存储适配器（StorageAdapter）

存储适配器是对底层存储的抽象，提供统一的 API。

**可用适配器**：

| 适配器 | 用途 | 条件写入 | 重试 | 成本 |
|--------|------|----------|------|------|
| MemoryStorageAdapter | 测试 | 进程内检查 | 无 | 免费 |
| FileSystemAdapter | 单机本地磁盘 | 进程内检查 | 无 | 免费 |
| S3Adapter | AWS S3 云存储 | 原生原子条件写入 | SDK 默认重试，最多尝试 3 次，覆盖 5xx/429/网络错误 | 按用量 |
| OSSAdapter | 阿里云 OSS 云存储 | HEAD + PUT 模拟，**非原子**；即使同一进程内也须逐个写入 | 仅网络错误和超时，5xx/429 不重试 | 按用量 |

**选择建议**：
- **测试** - MemoryStorageAdapter
- **单机本地数据** - FileSystemAdapter
- **云存储** - S3Adapter 或 OSSAdapter（根据云平台）；如果依赖 `etag` 乐观锁，请使用 S3Adapter
- 无论哪种适配器，每个集合都只能有一个写入进程

详见 [存储适配器 API](/api/adapters)。

## 索引分片（Index Sharding）

BucketDB 使用分片索引组织集合中的文档。

**工作原理**：
1. 根据文档 ID 的哈希值分配分片
2. 每个分片保存其中文档的**完整副本**
3. `id` 等值查询只读取一个分片；其他查询并行下载所有非空分片，在内存中过滤

**配置分片数量**：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 默认 16
});
```

**成本模型**：
- 每次 `insert` / `update` / `delete` 都会重写一整个索引分片。分片越多，单个分片越小，单次写入重写的数据越少。
- 每次非 `id` 条件的 `find` 都会下载所有非空分片，即整个集合的完整副本；分片数量不会改变下载的总数据量。
- 没有查询缓存，每次 `find` 都读取存储。
- 目前没有规模基准测试，不承诺任何文档数量上限。

**注意**：分片数量创建后不可修改。

## 乐观锁（Optimistic Locking）

基于 ETag 的乐观锁机制，用于检测 `update` 的并发冲突。

::: warning OSS 不是原子的
`OSSAdapter` 用"先 HEAD 再 PUT"模拟条件写入，两个并发写入者（即使在同一进程内）可能同时通过检查，因此在 OSS 上带 `etag` 的 `update` 无法阻止并发覆盖。在 OSS 上请逐个等待写入完成；需要乐观锁请使用 S3。
:::

**工作原理**：
1. 读取文档时获取 `_etag`
2. 更新时传入 `_etag`
3. 如果 ETag 不匹配，或在 `update` 读取与写入之间文档被其他写入者修改，抛出 `ConcurrentUpdateError`

`delete` 没有 `etag` 参数，不会抛出 `ConcurrentUpdateError`。

**使用示例**：

```typescript
const user = await users.findById('user-123');

try {
  await users.update('user-123', { age: 26 }, { etag: user._etag });
} catch (error) {
  if (error instanceof ConcurrentUpdateError) {
    console.log('并发更新冲突，请重试');
  }
}
```

**重试模式**：

```typescript
async function updateWithRetry(id: string, updates: Partial<User>) {
  let retries = 3;

  while (retries > 0) {
    const user = await users.findById(id);
    if (!user) throw new Error('User not found');

    try {
      return await users.update(id, updates, { etag: user._etag });
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && retries > 1) {
        retries--;
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      throw error;
    }
  }
}
```

详见[错误处理](./error-handling)。

## 数据组织

BucketDB 在存储中的组织结构：

```
{dbPath}/
  {collectionName}/
    docs/
      {id}.json           # 文档文件
    index/
      shard-00.json       # 索引分片（含文档完整副本）
      shard-01.json
      ...
    wal/
      {id}.wal.json       # 预写日志（WAL）条目
```

**示例**：

```
my-app/
  users/
    docs/
      a1b2c3d4-...-uuid.json
      e5f6g7h8-...-uuid.json
    index/
      shard-00.json
      shard-01.json
      ...
      shard-15.json
    wal/
```

## 使用限制

当前版本（0.3.x）存在以下限制，使用前请确认是否可以接受：

1. **仅支持单写入者** - 每个集合只使用一个写入进程。不支持多个实例/进程写入同一集合：一个实例的 WAL 恢复可能重放并清除另一个运行中实例的未完成操作，且 OSS 的条件写入不是原子的。
   - **OSS 上一次只能有一个写入** - 即使在同一进程内，OSS 上的并发写入也不安全：在真实 bucket 上测试，向新集合并发 20 次 `insert` 全部成功返回，但 `find({})` 只返回 16 条（索引条目被静默丢失）；用同一 `etag` 并发 10 次 `update` 全部成功。请等待每次 `insert` / `update` / `delete` 完成后再发起下一次。
   - **S3、FileSystem、Memory 上**，同一进程内的并发写入会被检测到而不会丢失，但竞争激烈时，写入可能在索引分片尝试 3 次后以 `StorageError`（"PreconditionFailed"）失败。被拒绝的 `insert` / `update` 可能已写入文档；其 WAL 条目会保留，并可能在下次构造 `Collection` 时被重放进索引。
2. **WAL 不提供恢复保证** - WAL 只重放索引条目，从不重放文档。写入中途崩溃可能导致索引与文档不一致（例如索引中存在从未写入的文档，或已删除的文档仍能被 `findById` 读到）。恢复在构造 `Collection` 时于后台运行，且不会被等待。
3. **OSS 没有原子条件写入** - `OSSAdapter` 用"先 HEAD 再 PUT"模拟 `ifMatch` / `ifNoneMatch`，两个并发写入者（即使在同一进程内）可能同时通过检查；在 OSS 上带 `etag` 的 `update` 无法阻止并发覆盖，并发写入还可能丢失索引条目。需要乐观锁请使用 S3。
4. **`findById` 读取失败时返回 `null`** - 文档不存在时返回 `null`，目前存储读取失败（如网络、权限错误）时也返回 `null`。
5. **没有规模基准测试** - 不承诺文档数量上限，请按上文"索引分片"一节的成本模型评估：每次写入重写一整个索引分片；每次非 `id` 条件的 `find` 下载整个索引（含每个文档的完整副本）。

**重试**：`S3Adapter` 使用 AWS SDK 默认重试（最多尝试 3 次，覆盖 5xx、429 和网络错误）；`OSSAdapter` 使用 ali-oss `retryMax: 2`，只重试网络错误和超时，5xx 与 429 不重试。

## 下一步

- [查询语法](./queries) - 学习所有查询操作符
- [错误处理](./error-handling) - 处理常见错误场景
- [API 参考](/api/) - 完整的 API 文档
