# 快速开始

5 分钟学会使用 BucketDB 进行文档存储和查询。

## 安装

```bash
bun add @hold-baby/bucket-db-core
```

详见[安装指南](./installation)了解更多安装方式。

## 第一个应用

### 1. 定义文档类型

```typescript
import type { Document } from '@hold-baby/bucket-db-core';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}
```

所有文档都必须继承 `Document` 接口,它包含系统字段：
- `id` - 自动生成的唯一标识
- `_etag` - ETag 用于乐观锁
- `_createdAt` - 创建时间
- `_updatedAt` - 最后更新时间

### 2. 创建数据库实例

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './my-database' }),
  'my-app'
);
```

参数说明：
- **第一个参数** - 存储适配器（这里使用本地文件系统）
- **第二个参数** - 数据库路径（用于隔离不同环境/租户）

### 3. 获取集合

```typescript
const users = db.collection<User>('users');
```

集合类似于传统数据库的表,用于组织同类文档。

### 4. 插入文档

```typescript
const alice = await users.insert({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com',
  status: 'active'
});

console.log(alice);
// {
//   id: 'a1b2c3d4-...',
//   name: 'Alice',
//   age: 25,
//   email: 'alice@example.com',
//   status: 'active',
//   _etag: 'etag-...',
//   _createdAt: '2026-02-28T10:00:00.000Z',
//   _updatedAt: '2026-02-28T10:00:00.000Z'
// }
```

系统字段会自动添加到返回的文档中。

### 5. 查询文档

```typescript
// 按 ID 查找
const user = await users.findById(alice.id);

// 等值查询
const activeUsers = await users.find({ status: 'active' });

// 比较查询
const adults = await users.find({ age: { $gte: 18 } });

// 组合查询
const results = await users.find({
  status: 'active',
  age: { $gte: 18, $lt: 65 }
});

// 分页查询
const page1 = await users.find({}, { limit: 10, offset: 0 });
const page2 = await users.find({}, { limit: 10, offset: 10 });
```

详见[查询语法](./queries)了解所有操作符。

### 6. 更新文档

```typescript
// 简单更新
const updated = await users.update(alice.id, {
  age: 26
});

// 使用乐观锁
const updated = await users.update(
  alice.id,
  { age: 26 },
  { etag: alice._etag }
);
```

更新操作是部分更新,只修改指定的字段。

### 7. 删除文档

```typescript
await users.delete(alice.id);
```

## 完整示例

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';
import type { Document } from '@hold-baby/bucket-db-core';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // 1. 创建数据库
  const db = new BucketDB(
    new FileSystemAdapter({ basePath: './my-database' }),
    'my-app'
  );

  // 2. 获取集合
  const users = db.collection<User>('users');

  // 3. 插入文档
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active'
  });

  const bob = await users.insert({
    name: 'Bob',
    age: 30,
    email: 'bob@example.com',
    status: 'active'
  });

  // 4. 查询文档
  const activeUsers = await users.find({ status: 'active' });
  console.log(`Active users: ${activeUsers.length}`);

  const adults = await users.find({ age: { $gte: 25 } });
  console.log(`Adults (25+): ${adults.length}`);

  // 5. 更新文档
  await users.update(alice.id, { age: 26 });
  console.log('Updated Alice');

  // 6. 删除文档
  await users.delete(bob.id);
  console.log('Deleted Bob');

  // 7. 最终查询
  const finalUsers = await users.find({});
  console.log(`Final user count: ${finalUsers.length}`);
}

main().catch(console.error);
```

## 下一步

- [安装指南](./installation) - 详细的安装和配置说明
- [核心概念](./concepts) - 理解数据库、集合、文档等概念
- [查询语法](./queries) - 所有查询操作符详解
- [API 参考](/api/) - 完整的 API 文档
