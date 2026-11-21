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
- **无额外文件** - 集合是 `docs/` 目录下的一组文档对象，没有索引或元数据文件；S3/OSS 上另有一个可随时删除的查询快照（见[快照](#快照)）

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

运行时 `insert`、`put` 和 `update` 也会剥离传入的系统字段。`insert` 不指定 ID 时由 BucketDB 生成 `id`（UUID），`update` 会把 `_updatedAt` 设为当前时间并保留 `_createdAt`。

### put 与 insert

已知 ID 时（例如运行编号、commit sha），有两种写法：

| | `insert(data, { id })` | `put(id, data)` |
|---|---|---|
| 请求 | 1 次条件 PUT（不存在才创建） | 1 次无条件 PUT |
| ID 已存在 | 抛出 `DocumentExistsError` | 替换整个文档 |
| 重复执行 | 第二次抛错；并发时恰好一个成功 | 结果相同（幂等） |
| 时间戳 | `_createdAt` = `_updatedAt` = 现在 | 都设为现在（不读取旧文档，`_createdAt` 被重置） |

`put` 写入后，`data` 中没有的字段不再存在。重试或重新运行需要覆盖而不是重复写入时用 `put`；只能创建一次时用 `insert(data, { id })`。不合法的 ID 抛出 `ValidationError`。在 `capabilities.createIfAbsent` 为 `'none'` 的自定义后端上，带 `id` 的 `insert` 抛出 `UnsupportedError`（内置适配器都支持）。

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
    _snapshot.v1.json     # 仅 S3/OSS：查询快照
```

**示例**：

```
my-app/
  users/
    docs/
      0b6c1f3e-...-uuid.json
      7d2a9c41-...-uuid.json
    _snapshot.v1.json
```

没有索引、没有日志、没有元数据文件，也没有查询结果缓存。S3/OSS 上的 `_snapshot.v1.json` 位于 `docs/` 旁边，只用于加速查询，可以随时删除（见[快照](#快照)）；Memory 和 FileSystem 不写快照。手动放到 `docs/<id>.json` 的 JSON 文件也会被当作文档读取。完整规则见[存储格式](./storage-format)。

`docs/` 下以 `.` 开头的隐藏文件（如 `.DS_Store`）会被忽略；FileSystemAdapter 还会忽略自己的 `*.tmp` 临时文件和 0.3 遗留的 `*.meta` 文件。其他不是 `<合法 ID>.json` 或内容不是 JSON 对象的文件会让 `find` 抛出 `StorageError`，`error.key` 指出是哪个对象。

## 操作成本

| 操作 | 存储请求 |
|------|----------|
| `insert` | 1 次条件 PUT（不存在才创建） |
| `insert(data, { id })` | 1 次条件 PUT |
| `put(id, data)` | 1 次 PUT |
| `findById` | 1 次 GET |
| `update` | 1 次 GET + 1 次条件 PUT |
| `delete` | 1 次 DELETE（幂等，文档不存在也不报错） |
| `deleteMany(filter)` | `find(filter)` + 每个匹配文档 1 次 DELETE（并发 16 个） |
| `count()` | LIST `docs/`（每 1000 个文档 1 次请求），不读取文档 |
| `count(filter)` | 与 `find(filter)` 相同 |
| `find({ id: '...' })` | 1 次 GET（`id` 为普通字符串时） |
| `find`（S3/OSS，热） | LIST `docs/`（每 1000 个文档 1 次请求）+ 1 次快照 GET + 自快照以来每个变化文档 1 次 GET；变化超过 16 个时再加 1 次快照 PUT |
| `find`（Memory/FileSystem） | 列出 `docs/` + 读取**每一个**文件（并发 16 个） |
| `compact()` | S3/OSS：LIST + GET 每个文档 + 1 次快照 PUT；本地后端无操作 |

`find` 在内存中过滤，然后应用 `sort` / `offset` / `limit`（不会减少读取）。不传 `sort` 时结果按 `_createdAt` 升序、再按 `id` 升序返回——顺序稳定，适合分页，大致是插入顺序。传入 `sort` 时按给定字段排序，相同时同样回退到 `_createdAt`、`id`。没有 `_createdAt` 的文档（由其他工具写入）排在最后；`put` 会重置 `_createdAt`，被替换的文档移到默认顺序的末尾。详见[查询语法](./queries#排序)。在 LIST 与 GET 之间被删除的文档会被跳过。

`count(filter?)` 返回匹配的文档数；不传条件时只列出集合，不读取文档。

`deleteMany(filter)` 先执行 `find(filter)`，再逐个删除匹配的文档（并发 16 个），返回匹配数量。它**不是原子的**：中途失败时已完成的删除不会恢复，调用期间写入的文档可能保留。

实测耗时（见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)）：OSS 热 `find` 在 100 / 1,000 / 10,000 个文档时为 0.11 / 0.27 / 1.35 秒；S3（ap-southeast-2，测试客户端 RTT 约 200 ms）为 0.45 / 1.0 / 3.2 秒；10,000 个文档没有快照的冷查询 OSS 34 秒、S3 134 秒。FileSystem 在 10,000 个文档时每次 `find` 约 0.5 秒。

`findById` 只在文档不存在时返回 `null`；其他存储错误（网络、权限等）会抛出 `StorageError`。

## 快照

在 S3、OSS 以及声明了 `remote: true` 的自定义适配器上，每个集合保留一个快照对象 `<dbPath>/<collection>/_snapshot.v1.json`，里面是每个文档的 etag 和内容。Memory 和 FileSystem 没有快照，每次 `find` 都读取每个文件。

**`find` 的执行过程**（S3/OSS）：

1. LIST `docs/`（每 1000 个文档 1 次请求），得到当前的文档和 etag
2. GET 快照
3. 只有快照条目的 etag 与 LIST 得到的 etag 相同时才使用该条目；其余文档逐个 GET（并发 16 个）

LIST 是权威来源：快照缺失、损坏、过期、版本不同或被并发覆盖，只影响速度，不影响结果。快照不存在或无法解析时会被重建（无法解析时通过 `logger` 记录一条 `warn`）；读取快照时遇到暂时性错误或权限错误，查询失败并抛出 `StorageError`。

**何时重写**：当查询逐个读取的文档数加上快照中已删除文档的条目数超过 16 时，查询会重写快照（无条件 PUT）。不超过 16 个变化时，这些文档在每次查询中都会被逐个 GET，直到下一次重写。

**写入失败**：快照写入失败只会记录日志（`error` 级别），不会让查询失败。遇到 401/403（例如只读凭证）后，该 `Collection` 实例不再尝试写入，查询照常工作。

**`compact()`**：`await collection.compact()` 用所有当前文档重建快照（LIST + GET 每个文档 + 1 次 PUT），并移除已删除文档的内容。本地后端上不做任何事。失败时抛出错误。

::: warning 已删除文档的内容
快照包含完整的文档内容。已删除文档的内容会留在快照中，直到快照被重写或执行 `compact()`。删除隐私敏感数据后请调用 `compact()`。
:::

**容量范围**：每个集合最多 10,000 个文档、10 MB 快照（10,000 个约 450 字节的文档快照约 5.2 MB）。超出后查询仍可用但更慢，每个 `Collection` 实例记录一次 `warn`；本地后端只检查文档数。

**一致性级别**：返回的每个文档都是某个已提交的版本，但整个结果集不是集合在某一时刻的快照。

bucket 的生命周期规则可以让文档过期；过期的文档会从 LIST 中消失，因此也不会出现在结果中。

### 日志（`logger`）

快照写入失败、快照无法解析和超出容量范围都通过 `logger` 报告，不会抛出。默认写到 `console.warn`，可以在创建数据库时替换：

```typescript
import { BucketDB } from '@hold-baby/bucket-db';
import type { LogEvent } from '@hold-baby/bucket-db';

const db = new BucketDB(adapter, 'my-app', {
  logger: (event: LogEvent) => {
    // event.level: 'warn' | 'error'
    console.error(`[bucket-db] ${event.level}: ${event.message}`, event.error ?? '');
  }
});
```

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

详见[保证与限制](./guarantees)（每条保证都注明了对应的测试）。

当前版本（0.5.0）的其他限制：

1. **没有事务** - 每次写入只涉及一个文档。
2. **容量范围** - 每个集合最多 10,000 个文档、10 MB 快照；超出后查询仍可用但更慢，并记录一次警告。S3/OSS 上热 `find` 为 LIST + 1 次快照 GET + 变化文档的 GET；Memory/FileSystem 上每次 `find` 读取每个文件。实测数据见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)。
3. **OSS 不支持条件更新** - 带 `etag` 的 `update` 抛出 `UnsupportedError`；不带 `etag` 的并发更新后写覆盖。
4. **FileSystem** - 条件更新和并发更新合并只在单个进程内有效。
5. **不能与 0.3.x 同时写入** - 0.3.x 只读取自己的索引，看不到 0.4 的写入；同一集合不能由 0.3.x 和 0.4 客户端同时写入。详见[升级指南](./migration)。
6. **快照包含文档内容** - 已删除文档的内容在快照重写或 `compact()` 之前仍保留。
7. **结果不是某一时刻的快照** - 每个文档都是已提交的版本，但结果集整体不是时间点一致的。
8. **deleteMany 不是原子的** - 中途失败时已完成的删除不会恢复。

## 下一步

- [查询语法](./queries) - 学习所有查询操作符
- [错误处理](./error-handling) - 处理常见错误场景
- [API 参考](/api/) - 完整的 API 文档
