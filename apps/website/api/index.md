# API 参考

BucketDB 完整的 API 文档。

## 快速导航

- [BucketDB 类](./bucketdb) - 数据库主类
- [Collection 类](./collection) - 集合操作
- [存储适配器](./adapters) - 存储后端
- [类型定义](./types) - TypeScript 类型
- [错误类](./errors) - 错误处理

## 安装

```bash
bun add @hold-baby/bucket-db-core
```

## 基础用法

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';
import type { Document } from '@hold-baby/bucket-db-core';

interface User extends Document {
  name: string;
  email: string;
}

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'my-app'
);

const users = db.collection<User>('users');

await users.insert({ name: 'Alice', email: 'alice@example.com' });
const all = await users.find({});
```

## 核心类

### BucketDB

主数据库类,管理集合和配置。

```typescript
const db = new BucketDB(adapter, dbPath, options);
const collection = db.collection<T>(name, options);
```

详见 [BucketDB API](./bucketdb)。

### Collection

集合类,提供 CRUD 操作。

```typescript
await collection.insert(data);
await collection.findById(id);
await collection.find(filter, options);
await collection.update(id, data, options);
await collection.delete(id);
```

详见 [Collection API](./collection)。

## 存储适配器

- **MemoryStorageAdapter** - 内存存储(测试)
- **FileSystemAdapter** - 文件系统(本地开发)
- **S3Adapter** - AWS S3(生产)
- **OSSAdapter** - 阿里云 OSS(生产)

详见 [存储适配器 API](./adapters)。

## 类型系统

BucketDB 提供完整的 TypeScript 类型:

- `Document` - 文档基础类型
- `QueryFilter<T>` - 查询过滤器
- `InsertDocument<T>` - 插入文档类型
- `UpdateDocument<T>` - 更新文档类型

详见 [类型定义](./types)。

## 错误处理

所有错误继承自 `BucketDBError`:

- `DocumentNotFoundError` - 文档不存在
- `ConcurrentUpdateError` - 并发更新冲突
- `ValidationError` - 验证失败
- `StorageError` - 存储错误

详见 [错误类 API](./errors)。
