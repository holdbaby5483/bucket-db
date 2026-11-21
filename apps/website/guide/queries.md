# 查询语法

BucketDB 提供 8 种查询操作符：`$eq`、`$ne`、`$gt`、`$gte`、`$lt`、`$lte`、`$in`、`$nin`。查询在客户端内存中执行，执行方式见[查询如何执行](#查询如何执行)。

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

## 查询如何执行

BucketDB 没有索引。`find` 的执行过程是：

1. LIST 集合的 `docs/` 前缀（每 1000 个文档一次请求）
2. GET **每一个**文档（最多 16 个并行）
3. 在内存中过滤
4. 对过滤后的结果应用 `offset` / `limit`

例外：如果过滤条件中的 `id` 是一个普通字符串（`{ id: '...' }`），只读取这一个文档。

结果按存储键顺序返回，也就是按 `id` 顺序。自动生成的 ID 是随机 UUID，所以**不是插入顺序**。目前不支持 `sort`，需要排序时请在应用层对结果排序。

在 LIST 与 GET 之间被删除的文档会被跳过。

## 匹配规则

- 多个字段、同一字段的多个操作符之间都是 AND 关系
- 文档**没有**某个字段时，该字段上的任何条件都不匹配（包括 `$ne` 和 `$nin`）
- 等值比较使用严格相等（`===`），对象和数组不做深度比较
- `$in: []` 不匹配任何文档
- `$nin: []` 匹配所有拥有该字段的文档
- `$gt` / `$gte` / `$lt` / `$lte` 只比较 number 或 string，且文档值与操作数类型必须一致

## 查询校验

以下情况会抛出 `ValidationError`：

- 字段名为保留名称：`__proto__`、`constructor`、`prototype`、`toString`、`valueOf`、`hasOwnProperty`、`isPrototypeOf`、`propertyIsEnumerable`
- 未知操作符（如 `$regex`）
- `$in` / `$nin` 的操作数不是数组
- 比较操作符的类型不匹配（如文档中 `age` 是字符串而查询用数字），或比较的值不是 number / string；这一项在过滤到具体文档时才检查

```typescript
import { ValidationError } from '@hold-baby/bucket-db';

try {
  await collection.find({ status: { $in: 'active' } } as any);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('查询条件无效:', error.message);
  }
}
```

`{ id: 'bad/id' }` 这类不合法的 ID 不会报错，直接返回 `[]`。

## 查询最佳实践

### 1. 能按 ID 查就按 ID 查

只有 `id` 等值条件能避免读取整个集合；其他任何条件（包括空过滤）都会读取集合中的每个文档：

```typescript
// ✅ 1 次 GET
const user = await collection.findById('user-123');

// ✅ 只读取这一个文档
const users = await collection.find({ id: 'user-123' });

// ⚠️ LIST + 读取集合中的每个文档，再在内存中过滤
const active = await collection.find({ status: 'active' });
```

### 2. 条件越具体，返回越少，但读取量不变

无论条件选择性如何，非 `id` 查询都会读取全部文档。更具体的条件只减少返回给你的结果数量。

### 3. 分页减少返回量，不减少读取量

`offset` / `limit` 在过滤之后应用，所以分页不会减少存储读取：

```typescript
// 返回 100 条，但仍读取了集合中的所有文档
const page = await collection.find({}, { limit: 100, offset: 0 });
```

上面的迭代器模式每一页都会重新读取整个集合。需要遍历全部结果时，直接调用一次 `find` 更省请求。

### 4. 避免多余条件

`id` 等值已经唯一确定文档，其他条件不会减少读取量：

```typescript
// ✅ 好：只用必要条件
const users = await collection.find({ id: 'user-123' });

// ❌ 多余：id 已经唯一
const users = await collection.find({
  id: 'user-123',
  status: 'active',
  age: { $gte: 0 }
});
```

## 性能提示

- **按 ID 查找** - `findById` 或 `{ id: '...' }` 只读取一个文档；其他任何查询的成本都是 LIST + 读取集合中每个文档
- **集合规模** - BucketDB 适合小集合（数千个文档）；目前没有基准测试数据
- **缓存结果** - BucketDB 不缓存，每次 `find` 都读取存储；对频繁查询的结果可在应用层缓存

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
