# 基础用法示例

完整的 CRUD 操作示例，展示 BucketDB 0.4 的基本功能。

## 完整代码

```typescript
import { BucketDB, MemoryStorageAdapter, ConcurrentUpdateError } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

// 1. 定义文档类型
interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // 2. 创建数据库实例（使用内存存储）
  const db = new BucketDB(new MemoryStorageAdapter(), 'my-app');

  // 3. 获取集合
  const users = db.collection<User>('users');

  console.log('=== 插入文档 ===');

  // 4. 插入文档
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active'
  });
  console.log('Inserted Alice:', alice.id);

  const bob = await users.insert({
    name: 'Bob',
    age: 30,
    email: 'bob@example.com',
    status: 'active'
  });
  console.log('Inserted Bob:', bob.id);

  const charlie = await users.insert({
    name: 'Charlie',
    age: 35,
    email: 'charlie@example.com',
    status: 'inactive'
  });
  console.log('Inserted Charlie:', charlie.id);

  console.log('\n=== 按 ID 查找 ===');

  // 5. 按 ID 查找
  const foundAlice = await users.findById(alice.id);
  console.log('Found:', foundAlice?.name);

  console.log('\n=== 等值查询 ===');

  // 6. 等值查询
  const activeUsers = await users.find({ status: 'active' });
  console.log('Active users:', activeUsers.map(u => u.name));

  console.log('\n=== 比较查询 ===');

  // 7. 比较查询
  const adults = await users.find({ age: { $gte: 25 } });
  console.log('Adults (25+):', adults.map(u => u.name));

  console.log('\n=== 组合查询 ===');

  // 8. 组合查询
  const results = await users.find({
    status: 'active',
    age: { $gte: 25, $lt: 35 }
  });
  console.log('Active adults (25-34):', results.map(u => u.name));

  console.log('\n=== 分页查询 ===');

  // 9. 分页查询
  const page1 = await users.find({}, { limit: 2, offset: 0 });
  const page2 = await users.find({}, { limit: 2, offset: 2 });
  console.log('Page 1:', page1.map(u => u.name));
  console.log('Page 2:', page2.map(u => u.name));

  console.log('\n=== 更新文档 ===');

  // 10. 更新文档
  const updatedAlice = await users.update(alice.id, { age: 26 });
  console.log('Updated Alice age:', updatedAlice.age);

  console.log('\n=== 乐观锁更新 ===');

  // 11. 使用乐观锁更新
  const current = await users.findById(bob.id);
  if (current) {
    try {
      await users.update(
        bob.id,
        { age: 31 },
        { etag: current._etag }
      );
      console.log('Updated Bob with optimistic locking');
    } catch (error) {
      if (error instanceof ConcurrentUpdateError) {
        console.log('Concurrent update detected');
      } else {
        throw error;
      }
    }
  }

  console.log('\n=== 删除文档 ===');

  // 12. 删除文档（幂等：文档不存在也不会报错）
  await users.delete(charlie.id);
  console.log('Deleted Charlie');

  console.log('\n=== 最终统计 ===');

  // 13. 最终查询
  const allUsers = await users.find({});
  console.log('Total users:', allUsers.length);
  console.log('Remaining users:', allUsers.map(u => u.name));
}

main().catch(console.error);
```

## 运行结果

ID 是随机 UUID；`find` 结果按 ID（存储键）排序，而不是插入顺序，因此数组顺序和分页内容每次运行可能不同。下面是一次可能的输出：

```
=== 插入文档 ===
Inserted Alice: a1b2c3d4-e5f6-...
Inserted Bob: f7g8h9i0-j1k2-...
Inserted Charlie: l3m4n5o6-p7q8-...

=== 按 ID 查找 ===
Found: Alice

=== 等值查询 ===
Active users: [ 'Alice', 'Bob' ]

=== 比较查询 ===
Adults (25+): [ 'Alice', 'Bob', 'Charlie' ]

=== 组合查询 ===
Active adults (25-34): [ 'Alice', 'Bob' ]

=== 分页查询 ===
Page 1: [ 'Alice', 'Bob' ]
Page 2: [ 'Charlie' ]

=== 更新文档 ===
Updated Alice age: 26

=== 乐观锁更新 ===
Updated Bob with optimistic locking

=== 删除文档 ===
Deleted Charlie

=== 最终统计 ===
Total users: 2
Remaining users: [ 'Alice', 'Bob' ]
```

## 要点说明

### 1. 文档类型定义

所有文档必须继承 `Document` 接口：

```typescript
interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}
```

系统字段（`id`, `_etag`, `_createdAt`, `_updatedAt`）会自动添加。

### 2. 插入数据

插入时省略系统字段：

```typescript
await users.insert({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com',
  status: 'active'
});
```

### 3. 查询操作符

支持 8 种操作符：

```typescript
// $gte: 大于等于
{ age: { $gte: 25 } }

// $lt: 小于
{ age: { $lt: 35 } }

// 组合
{ age: { $gte: 25, $lt: 35 } }
```

### 4. 乐观锁

使用 ETag 防止并发更新冲突，ETag 不匹配时抛出 `ConcurrentUpdateError`：

```typescript
await users.update(id, updates, { etag: current._etag });
```

Memory、S3 支持条件更新；FileSystem 仅在单进程内有效；OSS 不支持，传入 `etag` 会抛出 `UnsupportedError`。不传 `etag` 时，在支持条件写入的后端上 `update` 会自动重试合并，并发更新不同字段都会生效。

### 5. 查询成本

除 `{ id: '...' }` 外，每次 `find` 都会列出并读取集合中的全部文档，再在内存中过滤和分页。BucketDB 面向小集合（数千条文档）和低写入频率的场景。

## 下一步

- [本地存储示例](./local-storage) - 持久化存储
- [S3 / OSS 云存储示例](./production) - S3/OSS 配置
- [高级模式示例](./advanced) - 更多高级用法
