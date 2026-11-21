# API 参考

BucketDB 0.4.0-beta.0 完整的 API 文档。从 0.3.x 升级请先阅读[升级指南](/guide/migration)。

## 快速导航

- [BucketDB 类](./bucketdb) - 数据库主类
- [Collection 类](./collection) - 集合操作
- [存储适配器](./adapters) - 存储后端
- [类型定义](./types) - TypeScript 类型
- [错误类](./errors) - 错误处理

## 安装

```bash
bun add @hold-baby/bucket-db@next
```

## 基础用法

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

const db = new BucketDB(new FileSystemAdapter({ basePath: './data' }), 'my-app');

const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const all = await users.find({});
```

## 核心类

### BucketDB

入口类:存储后端加上一个 key 前缀(`dbPath`,`''` 表示 bucket 根目录)。

```typescript
const db = new BucketDB(adapter, dbPath);
const collection = db.collection<T>(name);
```

详见 [BucketDB API](./bucketdb)。

### Collection

集合类,提供 CRUD 操作。每个文档是一个对象:`<dbPath>/<collection>/docs/<id>.json`。

```typescript
await collection.insert(data);              // 1 次条件 PUT
await collection.findById(id);              // 1 次 GET;仅在文档不存在时返回 null
await collection.find(filter, options);     // LIST + 读取全部文档,内存中过滤
await collection.update(id, data, options); // GET + 条件 PUT
await collection.delete(id);                // 1 次 DELETE;文档不存在也不报错
```

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储(测试)
- **FileSystemAdapter** - 本地文件系统
- **S3Adapter** - AWS S3 及 S3 兼容服务(内置客户端,无运行时依赖;区域、端点、凭证可从 `AWS_*` 环境变量读取)
- **OSSAdapter** - 阿里云 OSS,经 S3 兼容端点访问(区域、凭证可从 `OSS_*` 环境变量读取;不支持条件更新)

S3 与 OSS 每个请求最多尝试 3 次,单次超时默认 10 秒,重试网络错误、超时、5xx、429、`SlowDown`、`RequestTimeout`。

详见 [存储适配器 API](./adapters)。

## 各后端保证

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| 单次写入原子 | 是 | 是 | 是 | 是 |
| 不存在才创建(`insert`) | 是 | 是(跨进程) | 是 | 是(仅限未开启版本控制的 bucket) |
| 条件更新(`etag`) | 是 | 仅单进程 | 是 | 否,抛 `UnsupportedError` |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否(后写覆盖) |

所有后端都支持多个进程并发 `insert` / `delete`;`update` 的多进程并发仅 S3 支持(Memory、FileSystem 限单进程内)。

## 使用限制

1. **没有事务** - 每次写入只涉及一个文档。
2. **每次 `find` 都读取全部文档** - 只有 `{ id: '...' }` 查询只读一个文档。尚无基准测试(计划在 0.4.0 提供),不承诺任何容量;适用于小集合(数千个文档)、每秒几次写入。
3. **OSS 不支持条件更新** - 带 `etag` 的 `update` 抛 `UnsupportedError`;不带 `etag` 的并发 `update` 后写覆盖。
4. **FileSystem 的条件更新仅限单进程** - `etag` 校验和并发更新合并只在同一进程内成立。
5. **0.3.x 与 0.4 不能同时写同一个集合** - 0.3 只读自己的索引,看不到 0.4 的写入。
6. **Beta** - 0.4.0 正式版之前 API 仍可能调整。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- `Document` - 文档基础类型
- `QueryFilter<T>` - 查询过滤器
- `InsertDocument<T>` - 插入文档类型
- `UpdateDocument<T>` - 更新文档类型

详见 [类型定义](./types)。

## 错误处理

以下错误类都继承自 `BucketDBError`:

- `ValidationError` - 集合名、文档 ID、`dbPath` 或查询条件不合法;适配器参数不合法;缺少凭证
- `DocumentNotFoundError` - `update` 的文档不存在(`findById` 返回 `null`,`delete` 直接成功)
- `ConcurrentUpdateError` - `update` 的 `etag` 已过期、带 `etag` 时写入竞争失败,或不带 `etag` 时重试 5 次后仍冲突
- `UnsupportedError` - 后端不具备所需能力(OSS 上带 `etag` 的 `update`)
- `StorageError` - 底层存储失败,带 `kind`(`'not-found'` / `'conflict'` / `'transient'` / `'permanent'`)、`key`、`status`

集合名、文档 ID 和 `dbPath` 的每一段须为 1-255 个字母、数字、`_`、`-` 或 `.`,且不能以 `.` 开头;不合规直接抛 `ValidationError`,不会改写。

详见 [错误类 API](./errors)。
