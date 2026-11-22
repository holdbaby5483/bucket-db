# API 参考

BucketDB 0.6.1 完整的 API 文档,需要 Node.js 22+ 或 Bun。从旧版本升级请先阅读[升级指南](/guide/migration);各后端的保证及对应测试见[保证与限制](/guide/guarantees),存储布局见[存储格式](/guide/storage-format)。命令行工具 `bucket-db` 见[命令行(CLI)](/guide/cli)。

## 快速导航

- [BucketDB 类](./bucketdb) - 数据库主类
- [Collection 类](./collection) - 集合操作
- [存储适配器](./adapters) - 存储后端
- [类型定义](./types) - TypeScript 类型
- [错误类](./errors) - 错误处理

## 安装

```bash
bun add @hold-baby/bucket-db
```

## 基础用法

```typescript
import { BucketDB } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  email: string;
}

// 等价于 new BucketDB(new FileSystemAdapter({ basePath: './data' }), '')
const db = BucketDB.connect('file://./data');

const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const all = await users.find({});
```

## 核心类

### BucketDB

入口类:存储后端加上一个 key 前缀(`dbPath`,`''` 表示 bucket 根目录),可选的第三个参数 `{ logger }` 接收快照写入失败和超出容量范围的警告(默认 `console.warn`)。

`BucketDB.connect(url?, options?)` 用一个 URL 同步创建实例,省略 `url` 时读取 `BUCKET_DB_URL`:`s3://bucket/prefix?region=…`、`oss://bucket/prefix?region=…`、`file:///dir`、`memory://prefix`。路径部分成为 `dbPath`;凭证只从环境变量读取,URL 中包含凭证会被拒绝。

```typescript
const db = new BucketDB(adapter, dbPath, { logger });
const db2 = BucketDB.connect('s3://my-bucket/my-app?region=us-east-1', { logger });
const collection = db.collection<T>(name);
```

详见 [BucketDB API](./bucketdb)。

### Collection

集合类,提供 CRUD 操作,只能通过 `db.collection<T>(name)` 获取;`Collection` 只导出类型(`import type { Collection }`),没有公开的构造函数。返回的文档类型为 `Stored<T>`(`_etag` 一定有值)。每个文档是一个对象:`<dbPath>/<collection>/docs/<id>.json`;S3 / OSS 上每个集合还有一个可丢弃的查询快照 `<dbPath>/<collection>/_snapshot.v1.json`。

```typescript
await collection.insert(data);              // 1 次条件 PUT
await collection.insert(data, { id });      // 1 次条件 PUT;id 已存在抛 DocumentExistsError
await collection.put(id, data);             // 1 次无条件 PUT;创建或整体替换,可重复执行
await collection.findById(id);              // 1 次 GET;仅在文档不存在时返回 null
await collection.find(filter, options);     // LIST + 快照(S3/OSS)或读取全部文档(Memory/FileSystem),内存中过滤
await collection.find(filter, { sort: { age: -1 }, limit: 10 }); // 成本同上;默认按 _createdAt、id 升序
await collection.count();                   // 每 1000 个文档 1 次 LIST,不读取文档
await collection.count(filter);             // 成本同 find(filter)
await collection.update(id, data, options); // GET + 条件 PUT
await collection.delete(id);                // 1 次 DELETE;文档不存在也不报错
await collection.deleteMany(filter);        // find(filter) + 每个匹配 1 次 DELETE(16 个并发);非原子
await collection.compact();                 // S3/OSS:按当前文档重建快照;本地后端无操作
```

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储(测试)
- **FileSystemAdapter** - 本地文件系统
- **S3Adapter** - AWS S3 及 S3 兼容服务(内置客户端,无运行时依赖;区域、端点、凭证可从 `AWS_*` 环境变量读取;`remote: true`,查询使用快照)
- **OSSAdapter** - 阿里云 OSS,经 S3 兼容端点访问(区域、凭证可从 `OSS_*` 环境变量读取,凭证缺失时改读 `ALIBABA_CLOUD_*`;不支持条件更新;`remote: true`,查询使用快照)

S3 与 OSS 每个请求最多尝试 3 次,单次超时默认 10 秒,重试网络错误、超时、5xx、429、`SlowDown`、`RequestTimeout`。

详见 [存储适配器 API](./adapters)。

## 保证与限制

各后端在单次写入原子性、不存在才创建、条件更新和并发更新上的差异,以及全部已知限制(没有事务、每个集合的容量范围、查询成本、OSS 不支持条件更新等),统一列在[保证与限制](/guide/guarantees),每条保证都注明了对应的测试。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- `Document` - 文档基础类型
- `Stored<T>` - 集合返回的文档类型,`T & { _etag: string }`
- `QueryFilter<T>` - 查询过滤器
- `InsertDocument<T>` - 插入文档类型
- `UpdateDocument<T>` - 更新文档类型
- `InsertOptions` - `insert` 选项(`{ id }`)
- `QueryOptions<T>` - `find` 选项(`limit` / `offset` / `sort`)
- `SortSpec<T>` - `sort` 的类型:`T` 的字段加系统字段,未知字段编译报错
- `BucketDBOptions` / `Logger` / `LogEvent` - 日志回调
- `Collection<T>` - 集合类型(只导出类型)

详见 [类型定义](./types)。

## 错误处理

以下错误类都继承自 `BucketDBError`:

- `ValidationError` - 集合名、文档 ID、`dbPath`、查询条件或排序参数不合法;适配器参数不合法;缺少凭证;连接 URL 不合法(未知协议或参数、缺少 bucket、URL 含凭证,或未传 URL 且未设置 `BUCKET_DB_URL`)
- `DocumentExistsError` - `insert(data, { id })` 的 id 已存在
- `DocumentNotFoundError` - `update` 的文档不存在(`findById` 返回 `null`,`delete` 直接成功)
- `ConcurrentUpdateError` - `update` 的 `etag` 已过期、带 `etag` 时写入竞争失败,或不带 `etag` 时重试 5 次后仍冲突
- `UnsupportedError` - 后端不具备所需能力(OSS 上带 `etag` 的 `update`)
- `StorageError` - 底层存储失败,带 `kind`(`'not-found'` / `'conflict'` / `'transient'` / `'permanent'`)、`key`、`status`;S3 / OSS 上读取快照失败(不存在除外)也会让 `find` 抛出。快照写入失败不抛出,交给 `logger`

集合名、文档 ID 和 `dbPath` 的每一段须为 1-255 个字母、数字、`_`、`-` 或 `.`,且不能以 `.` 开头;不合规直接抛 `ValidationError`,不会改写。

详见 [错误类 API](./errors)。
