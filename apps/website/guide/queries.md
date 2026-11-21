# 查询语法

BucketDB 提供 8 种查询操作符，支持灵活的文档查询。

## 基础查询

### 等值查询

最简单的查询方式，直接指定字段值：

```typescript
// 查找所有 status 为 'active' 的用户
const users = await collection.find({ status: 'active' });

// 多字段等值查询（AND 逻辑）
const users = await collection.find({
  status: 'active',
  role: 'admin'
});
```

等价于：

```typescript
const users = await collection.find({
  status: { $eq: 'active' },
  role: { $eq: 'admin' }
});
```

## 比较操作符

### $eq - 等于

```typescript
const users = await collection.find({ age: { $eq: 25 } });
```

### $ne - 不等于

```typescript
// 查找所有非删除状态的用户
const users = await collection.find({ status: { $ne: 'deleted' } });
```

### $gt - 大于

```typescript
// 查找年龄大于 18 的用户
const users = await collection.find({ age: { $gt: 18 } });
```

### $gte - 大于等于

```typescript
// 查找年龄 >= 18 的用户
const users = await collection.find({ age: { $gte: 18 } });
```

### $lt - 小于

```typescript
// 查找年龄小于 65 的用户
const users = await collection.find({ age: { $lt: 65 } });
```

### $lte - 小于等于

```typescript
// 查找年龄 <= 65 的用户
const users = await collection.find({ age: { $lte: 65 } });
```

## 数组操作符

### $in - 在数组中

```typescript
// 查找状态为 active 或 pending 的用户
const users = await collection.find({
  status: { $in: ['active', 'pending'] }
});
```

### $nin - 不在数组中

```typescript
// 查找状态不是 deleted 或 banned 的用户
const users = await collection.find({
  status: { $nin: ['deleted', 'banned'] }
});
```

## 组合查询

### 多个操作符（AND 逻辑）

同一字段可以使用多个操作符：

```typescript
// 查找年龄在 18-65 之间的用户
const users = await collection.find({
  age: { $gte: 18, $lt: 65 }
});
```

### 多个字段（AND 逻辑）

不同字段的条件会自动组合：

```typescript
// 查找活跃的成年用户
const users = await collection.find({
  status: 'active',
  age: { $gte: 18 }
});

// 复杂组合
const users = await collection.find({
  status: { $in: ['active', 'pending'] },
  age: { $gte: 18, $lt: 65 },
  role: { $ne: 'guest' }
});
```

## 分页查询

使用 `limit` 和 `offset` 实现分页：

```typescript
// 第一页：前 10 条
const page1 = await collection.find({}, { limit: 10, offset: 0 });

// 第二页：第 11-20 条
const page2 = await collection.find({}, { limit: 10, offset: 10 });

// 第三页：第 21-30 条
const page3 = await collection.find({}, { limit: 10, offset: 20 });
```

**分页辅助函数**：

```typescript
async function getPage(
  filter: QueryFilter<User>,
  page: number,
  pageSize: number = 10
) {
  return await collection.find(filter, {
    limit: pageSize,
    offset: (page - 1) * pageSize
  });
}

// 使用
const page1 = await getPage({ status: 'active' }, 1, 20);
const page2 = await getPage({ status: 'active' }, 2, 20);
```

**迭代器模式**：

```typescript
async function* paginateAll(
  filter: QueryFilter<User>,
  pageSize: number = 100
) {
  let offset = 0;

  while (true) {
    const page = await collection.find(filter, { limit: pageSize, offset });
    if (page.length === 0) break;

    yield page;
    offset += page.length;

    if (page.length < pageSize) break;  // 最后一页
  }
}

// 使用
for await (const page of paginateAll({ status: 'active' })) {
  console.log(`Processing ${page.length} users`);
  // 处理当前页
}
```

## 查询最佳实践

### 1. 能按 ID 查就按 ID 查

只有 `id` 等值条件能缩小索引读取范围；其他任何条件（包括空过滤）都会下载所有非空索引分片，再在内存中过滤：

```typescript
// ✅ 只读取一个文档
const user = await collection.findById('user-123');

// ✅ 只读取一个索引分片
const users = await collection.find({ id: 'user-123' });

// ⚠️ 下载整个索引（每个文档的完整副本），再在内存中过滤
const active = await collection.find({ status: 'active' });
```

### 2. 具体条件减少的是读取的文档数

过滤（并应用 `offset` / `limit`）后，BucketDB 会读取每个匹配的文档文件。更具体的条件能减少这一步读取的文档数量，但不会减少索引下载量：

```typescript
// 匹配的文档少，后续读取的文档文件也少
const user = await collection.find({ email: 'alice@example.com' });

// 匹配的文档多，后续需要读取更多文档文件
const users = await collection.find({ status: 'active' });
```

### 3. 合理使用分页

大结果集必须使用分页：

```typescript
// ✅ 好：分页获取
const page = await collection.find({}, { limit: 100, offset: 0 });

// ❌ 差：一次获取所有（可能数万条）
const all = await collection.find({});
```

### 4. 避免过度过滤

`id` 等值已经唯一确定文档，其他条件不会带来额外收益：

```typescript
// ✅ 好：只用必要条件
const users = await collection.find({ id: 'user-123' });

// ❌ 差：id 已经唯一，其他条件多余
const users = await collection.find({
  id: 'user-123',
  status: 'active',  // 多余
  age: { $gte: 0 }   // 多余
});
```

## 性能提示

- **按 ID 查找** - `findById` 或 `{ id: '...' }` 只读取一个文档或一个分片；其他任何过滤条件都会下载所有非空索引分片（每个文档的完整副本），与条件的选择性无关
- **分页** - `limit` / `offset` 能减少过滤后读取的文档数量，但索引仍会被完整下载
- **分片数量** - 分片数量影响单次写入重写的分片大小，不影响查询下载的总数据量（见[核心概念](./concepts)中的"索引分片"）
- **缓存结果** - BucketDB 没有查询缓存，每次 `find` 都读取存储；对频繁查询的结果可在应用层缓存

## 类型安全

TypeScript 会自动推断查询类型：

```typescript
interface User extends Document {
  name: string;
  age: number;
  status: 'active' | 'inactive';
}

const users = db.collection<User>('users');

// ✅ 类型安全：字段和值都会被检查
await users.find({ status: 'active' });

// ❌ 编译错误：字段不存在
await users.find({ foo: 'bar' });

// ❌ 编译错误：值类型不匹配
await users.find({ status: 'invalid' });

// ✅ 类型推断：操作符值类型正确
await users.find({ age: { $gte: 18 } });

// ❌ 编译错误：操作符值类型错误
await users.find({ age: { $gte: 'eighteen' } });
```

## 下一步

- [错误处理](./error-handling) - 处理查询错误
- [API 参考 - Collection](/api/collection) - 完整的 Collection API
- [示例 - 高级模式](/examples/advanced) - 复杂查询示例
