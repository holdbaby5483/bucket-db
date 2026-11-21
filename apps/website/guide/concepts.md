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
const stagingDB = new BucketDB(adapter, 'staging');

// 多租户
const tenant1DB = new BucketDB(adapter, 'tenant-001');
const tenant2DB = new BucketDB(adapter, 'tenant-002');
```

`dbPath` 可以包含多级（如 `'apps/tenant-001'`），按 `/` 分隔的每一段都必须符合[命名规则](#命名规则)；空字符串 `''` 表示 bucket 根目录。不合法的 `dbPath` 会让 `new BucketDB(...)` 同步抛出 `ValidationError`。

## 集合（Collection）

集合是文档的容器，类似于传统数据库的表。

```typescript
const users = db.collection<User>('users');
```

**特性**：
- **类型安全** - 泛型参数提供完整的类型推断
- **单例模式** - 同一个 `BucketDB` 实例中，同名集合返回同一 `Collection` 实例
- **无额外文件** - 集合只是 `docs/` 目录下的一组文档对象，没有索引或元数据文件

`db.collection(name)` 只接受集合名一个参数，没有其他配置项。

## 命名规则

集合名、文档 ID 以及 `dbPath` 的每一段都必须匹配 `^[A-Za-z0-9_.-]{1,255}$`，且不能以 `.` 开头。不合法的名字**不会被改写**，而是抛出 `ValidationError`：

- `new BucketDB(adapter, dbPath)` 和 `db.collection(name)` 同步抛出
- `findById` / `update` / `delete` 遇到不合法的 ID 时返回被拒绝的 Promise
- `find({ id: 'bad/id' })` 返回 `[]`

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
type InsertDocument<T extends Document> = Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>;

// 更新时：用户字段全部可选，系统字段不可更新
type UpdateDocument<T extends Document> = Partial<Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>>;
```

运行时 `insert` 和 `update` 也会剥离传入的系统字段。`id` 由 BucketDB 生成（UUID），`update` 会把 `_updatedAt` 设为当前时间并保留 `_createdAt`。

读取文档时，`id` 取自对象 key，`_etag` 取自存储返回的 ETag（`_etag` 不保存在文档内容中），与文档 JSON 中写了什么无关。

## 存储适配器（StorageAdapter）

存储适配器是对底层存储的抽象，提供统一的 API。

**可用适配器**：

| 适配器 | 用途 | 条件写入 | 重试 | 成本 |
|--------|------|----------|------|------|
| MemoryStorageAdapter | 测试、本地开发 | 进程内原子 | 无 | 免费 |
| FileSystemAdapter | 单机本地磁盘 | `insert` 跨进程原子；条件更新仅单进程 | 无 | 免费 |
| S3Adapter | AWS S3 及 S3 兼容服务 | 服务端原子条件写入 | 最多尝试 3 次 | 按用量 |
| OSSAdapter | 阿里云 OSS | `insert` 原子（仅限未开启版本控制的 bucket）；不支持条件更新 | 最多尝试 3 次 | 按用量 |

**选择建议**：
- **测试** - MemoryStorageAdapter
- **单机本地数据** - FileSystemAdapter
- **云存储** - S3Adapter 或 OSSAdapter（根据云平台）；如果依赖 `etag` 乐观锁，或多个进程会并发更新同一文档，请使用 S3Adapter

S3 与 OSS 的重试覆盖网络错误、超时、5xx（500/502/503/504）、429、`SlowDown`、`RequestTimeout`，使用全抖动指数退避；其他 4xx 不重试。重试后仍失败的可重试错误以 `StorageError`（`kind: 'transient'`）抛出。

详见 [存储适配器 API](/api/adapters)。

## 数据组织

每个文档存为一个对象：

```
{dbPath}/
  {collectionName}/
    docs/
      {id}.json           # 文档文件
```

**示例**：

```
my-app/
  users/
    docs/
      0b6c1f3e-...-uuid.json
      7d2a9c41-...-uuid.json
```

没有索引、没有日志、没有元数据文件，也没有查询缓存。手动放到 `docs/<id>.json` 的 JSON 文件也会被当作文档读取。

`docs/` 下以 `.` 开头的隐藏文件（如 `.DS_Store`）会被忽略；FileSystemAdapter 还会忽略自己的 `*.tmp` 临时文件和 0.3 遗留的 `*.meta` 文件。其他不是 `<合法 ID>.json` 或内容不是 JSON 对象的文件会让 `find` 抛出 `StorageError`，`error.key` 指出是哪个对象。

## 操作成本

| 操作 | 存储请求 |
|------|----------|
| `insert` | 1 次条件 PUT（不存在才创建） |
| `findById` | 1 次 GET |
| `update` | 1 次 GET + 1 次条件 PUT |
| `delete` | 1 次 DELETE（幂等，文档不存在也不报错） |
| `find({ id: '...' })` | 1 次 GET（`id` 为普通字符串时） |
| 其他 `find` | LIST `docs/`（每 1000 个文档 1 次请求）+ GET **每一个**文档（并发 16 个） |

`find` 在内存中过滤，然后应用 `offset` / `limit`。结果按 key 顺序（即 ID 顺序）返回；ID 是随机 UUID，因此**不是**插入顺序。目前没有 `sort`。在 LIST 与 GET 之间被删除的文档会被跳过。

`findById` 只在文档不存在时返回 `null`；其他存储错误（网络、权限等）会抛出 `StorageError`。

## 乐观锁（Optimistic Locking）

基于 ETag 的乐观锁机制，用于检测 `update` 的并发冲突。

**带 `etag` 的更新**：
1. 读取文档时获取 `_etag`
2. 更新时传入 `{ etag }`
3. 如果 ETag 不匹配，或在读取与写入之间文档被其他写入者修改，抛出 `ConcurrentUpdateError`，不会自动重试

**不带 `etag` 的更新**：在支持比较并交换的后端（Memory、单进程内的 FileSystem、S3）上，`update` 读取、合并后条件写入；遇到冲突会重新读取并重试（最多重试 5 次，带抖动退避），因此并发修改不同字段的局部更新都会生效。重试用尽时抛出 `ConcurrentUpdateError`。在 OSS 上是普通 PUT，后写覆盖。

::: warning OSS 不支持条件更新
在 `OSSAdapter` 上调用带 `etag` 的 `update` 会直接抛出 `UnsupportedError`，不会发送任何请求。需要乐观锁请使用 S3。
:::

`delete` 没有 `etag` 参数，不会抛出 `ConcurrentUpdateError`。

**使用示例**：

```typescript
import { ConcurrentUpdateError } from '@hold-baby/bucket-db';

const user = await users.findById('user-123');

if (user) {
  try {
    await users.update('user-123', { age: 26 }, { etag: user._etag });
  } catch (error) {
    if (error instanceof ConcurrentUpdateError) {
      console.log('并发更新冲突，请重新读取后再试');
    }
  }
}
```

**重试模式**（需要基于最新数据计算新值时）：

```typescript
async function incrementAge(id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await users.findById(id);
    if (!user) throw new Error('User not found');

    try {
      return await users.update(id, { age: user.age + 1 }, { etag: user._etag });
    } catch (error) {
      if (!(error instanceof ConcurrentUpdateError)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Too many conflicts');
}
```

详见[错误处理](./error-handling)。

## 保证与限制

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| 单次写入原子 | 是 | 是 | 是 | 是 |
| 不存在才创建（`insert`） | 是 | 是（跨进程） | 是 | 是（仅限未开启版本控制的 bucket） |
| 条件更新（`etag`） | 是 | 仅单进程 | 是 | 否，抛 `UnsupportedError` |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否（后写覆盖） |

所有后端都支持多个写入进程并发执行 `insert` / `delete`；S3 上还支持多个进程并发 `update`（Memory、FileSystem 限单进程内）。实测 4 个进程各插入 25 个文档，在 FileSystem、S3 和 OSS 上全部 100 个文档可见。

当前版本（0.4.0-beta.0）的其他限制：

1. **没有事务** - 每次写入只涉及一个文档。
2. **没有基准测试** - 计划在 0.4.0 提供，目前不承诺容量数字。除 `{ id }` 外的每次 `find` 都会列出并读取集合中的每个文档，适合小型集合（数千个文档）和每秒少量写入。
3. **OSS 不支持条件更新** - 带 `etag` 的 `update` 抛出 `UnsupportedError`；不带 `etag` 的并发更新后写覆盖。
4. **FileSystem** - 条件更新和并发更新合并只在单个进程内有效。
5. **不能与 0.3.x 同时写入** - 0.3.x 只读取自己的索引，看不到 0.4 的写入；同一集合不能由 0.3.x 和 0.4 客户端同时写入。详见[升级指南](./migration)。
6. **beta** - 0.4.0 正式版之前 API 仍可能调整（暂无 `sort`、`count`、自定义 ID）。

## 下一步

- [查询语法](./queries) - 学习所有查询操作符
- [错误处理](./error-handling) - 处理常见错误场景
- [API 参考](/api/) - 完整的 API 文档
