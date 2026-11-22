# 升级指南

## 从 0.5 升级到 0.6

0.6.0 是 1.0 之前最后一个包含不兼容变更的版本，只收紧公开类型并提高 Node.js 最低版本。**存储格式、命令行、连接字符串、MCP 服务器和运行时行为都没有变化**，0.5 和 0.6 可以读写同一个集合。完整说明见 [MIGRATION-0.6.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.6.md)。

```bash
npm install @hold-baby/bucket-db@0.6.0
```

**受影响的代码**：调用 `new Collection(...)`、导入 `CollectionOptions` 或把 `Collection` 当作值使用（`instanceof`）的代码；按文档类型中未声明的字段排序的代码；运行在 Node.js 20 上的应用和 CI。只使用 `BucketDB`、`db.collection<T>(name)` 和带类型文档的代码无需修改。

### `Collection` 只导出类型

`Collection` 改为 `export type` 导出，只能用于类型标注，不能 `new`，也不能用于 `instanceof`。集合只能通过 `db.collection(name)` 获取。`CollectionOptions` 不再导出，`logger` 在 `BucketDB` 上设置，对它的所有集合生效。

```typescript
// 0.5
import { Collection } from '@hold-baby/bucket-db';
const users = new Collection<User>(adapter, 'my-app', 'users', { logger });

// 0.6
import { BucketDB } from '@hold-baby/bucket-db';
import type { Collection } from '@hold-baby/bucket-db';
const db = new BucketDB(adapter, 'my-app', { logger }); // 或 BucketDB.connect(url, { logger })
const users: Collection<User> = db.collection<User>('users');
```

### 返回的文档类型为 `Stored<T>`

`insert`、`put`、`findById`、`find`、`update` 返回 `Stored<T>` = `T & { _etag: string }`（新导出的类型）。`_etag` 一定有值，不再需要非空断言；`_createdAt` / `_updatedAt` 仍是可选的，因为手工放进 `docs/` 的文件可能没有。

```typescript
// 0.5
if (user) await users.update(id, { age: 31 }, { etag: user._etag! });

// 0.6
if (user) await users.update(id, { age: 31 }, { etag: user._etag });
```

`Stored<T>` 可以赋给 `T`，原有的 `const user: User = await users.insert(...)` 照常编译。不再编译的是把普通的 `T` 放进需要 `Stored<T>` 的位置，例如向 `find` 返回的数组里 `push` 手工构造的对象；这类数组请标注为 `T[]`。

### `sort` 的字段做类型检查

`QueryOptions` 带上文档类型：`QueryOptions<T = Document>`，`sort` 的类型是 `SortSpec<T>`（新导出的类型），键只能是 `T` 的字段加上 `id`、`_etag`、`_createdAt`、`_updatedAt`，值为 `1` 或 `-1`。拼错或未声明的字段在编译时报错。

```typescript
// 0.5：能编译，但 createdAt 不是字段，所有文档都按"缺失"排序
// 0.6：编译错误，应使用系统字段 _createdAt
await users.find({}, { sort: { createdAt: -1 } });

// 单独声明选项时带上文档类型
const options: QueryOptions<User> = { sort: { age: -1 }, limit: 10 };
```

不带类型参数的 `db.collection('users')` 是 `Collection<Document>`，只能按系统字段排序；请声明文档类型 `db.collection<User>('users')`。

运行时，值为 `undefined` 的 `sort` 字段现在被忽略（0.5 抛 `ValidationError`），所以可以写 `{ sort: { age: descending ? -1 : undefined } }`。`1` / `-1` 以外的其他值仍然抛错。

### Node.js 22 及以上

`engines.node` 改为 `>=22`，CI 测试 Node 22 和 24（以及 Bun）。Node 20 已于 2026-04-30 停止维护，不再测试；在 Node 20 上安装时 npm 会给出 `EBADENGINE` 警告（开启 `engine-strict` 时直接拒绝）。请同时升级应用、CI 任务以及运行 `npx @hold-baby/bucket-db` 的环境。

## 从 0.4 升级到 0.5

0.5.0 新增了连接字符串（`BucketDB.connect()` / `BUCKET_DB_URL`）、`put`、带 `id` 的 `insert`、`sort`、`count`、`deleteMany` 和[命令行工具](/guide/cli)。**存储格式没有变化**，不需要转换数据，0.4 和 0.5 可以读写同一个集合。不兼容变更如下，完整说明和代码对照见 [MIGRATION-0.5.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md)。

| 项目 | 0.4 | 0.5 及以后 |
|------|-----|------------|
| 类型不同的比较（如文档中 `age` 为 `"30"`，查询 `{ age: { $gt: 18 } }`） | 抛 `ValidationError` | 不匹配，不报错 |
| `$ne` / `$nin` 与缺少该字段的文档 | 不匹配 | 匹配（需要字段存在时在代码中过滤） |
| `$nin: []` | 跳过同一字段上的其他操作符（缺陷） | 不排除任何文档，其他操作符照常生效 |
| `find` 的默认顺序 | 按 key（文档 ID）顺序 | 按 `_createdAt` 升序、再按 `id` 升序；需要其他顺序时传 `sort` |
| `limit: 0` | 被忽略，返回全部 | 返回 `[]`；需要全部时省略 `limit` |
| 负数或小数的 `limit` / `offset` | 接受 | 抛 `ValidationError` |
| MCP 服务器配置 | `BUCKET_DB_ADAPTER`、`BUCKET_DB_S3_*` 等多个变量 | 只用 `BUCKET_DB_URL`，凭证来自 `AWS_*` / `OSS_*`，见 [MCP 集成](/guide/mcp#从-0-1-配置迁移) |

匹配规则的完整说明见[查询语法 · 匹配规则](/guide/queries#匹配规则)。

## 从 0.3 升级到 0.4

0.4.0 重写了存储核心：每个文档一个对象，不再有索引和日志文件，零运行时依赖，内置 S3 客户端。文档数据格式没有变化，0.4 及以后的版本可以直接读取 0.3 的集合；但部分 API 有不兼容变更，自定义存储适配器需要重写。完整说明和代码对照见 [MIGRATION-0.4.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.4.md)。

| 项目 | 0.3.x | 0.4 及以后 |
|------|-------|------------|
| 存储布局 | 文档 + 索引分片 + 日志 | `docs/<id>.json`；S3/OSS 另有 `_snapshot.v1.json` |
| 运行时依赖 | AWS SDK、ali-oss | 无 |
| 分片配置 | `new BucketDB(adapter, dbPath, { defaultShardCount })`、`db.collection(name, { shardCount })` | 移除：`BucketDB` 的第三个参数只接受 `{ logger }`，`db.collection()` 没有第二个参数 |
| `delete` 不存在的文档 | 抛 `DocumentNotFoundError` | 不报错（幂等）；`update` 不存在的文档仍抛 `DocumentNotFoundError` |
| 不合法的名字 | 被改写（`a/b` → `a_b`，`'./app/'` → `app`）或抛 `PathValidationError` | 抛 `ValidationError`，不改写；请使用存储中实际的目录名 |
| `findById` 存储读取失败 | 返回 `null` | 抛 `StorageError`（仅文档不存在时返回 `null`） |
| `StorageError` | `new StorageError(message, cause)` | `new StorageError(message, { kind, key, status, cause })` |
| 适配器构造参数 | `region`、`credentials` 必填 | 可选，回退到环境变量（见[安装指南](/guide/installation#云存储配置)） |
| OSS `region` / `endpoint` | `oss-cn-hangzhou` / OSS 原生 endpoint | `cn-hangzhou`（旧写法仍被接受）/ OSS 的 S3 兼容 endpoint，不再读取 `OSS_ENDPOINT` |
| OSS 带 `etag` 的 `update` | 非原子模拟 | 抛 `UnsupportedError` |
| `UpdateDocument<T>` | 可包含 `_etag`、`_createdAt`、`_updatedAt` | 排除所有系统字段 |
| `StorageAdapter` 接口 | `get/put/delete/exists/listKeys/batchGet` | `capabilities` + `get/put/delete/list`（字节、分页），见 [存储适配器 · Custom adapters](/api/adapters#custom-adapters) |
| 类型导出 | `StorageObject`、`PutOptions`、`StorageCredentials`、`StorageAdapterConfig`、`ICollection`、`CollectionMeta`、`IndexShard` | 以上全部移除；新增 `UnsupportedError`、`Credentials`、`S3AdapterOptions`、`OSSAdapterOptions` 等 |

### 迁移已有的 0.3 集合

不需要转换数据。

1. **停止所有 0.3 写入进程**。0.3 只读取自己的索引，看不到后续版本的写入，不能与 0.4 及以后的版本同时写入同一集合。
2. 升级到 `@hold-baby/bucket-db@0.6.0`，按上面三节修改代码。
3. 启动新客户端。
4. （可选）删除 0.3 遗留的 `index/`、`wal/` 目录和 `docs/*.meta` 文件。新版本会忽略它们，删除只是为了节省存储空间。

新版本直接列出 `docs/`，不再读取 0.3 的索引：0.3 索引里没有登记的文档文件（例如写完文档后失败的 `insert`）现在会出现在 `find` 结果中。如果这一点对你重要，升级后执行一次 `find({})` 检查。在 S3/OSS 上，查询会在集合里创建可随时删除的 `_snapshot.v1.json`，见[存储格式](./storage-format)。

## 下一步

- [核心概念](/guide/concepts) - 存储布局、操作成本与各后端的保证
- [安装指南](/guide/installation) - S3 / OSS 环境变量配置
- [错误处理](/guide/error-handling) - 错误类型说明
