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

`limit: 0` 返回 `[]`。`limit` / `offset` 为负数或小数时抛出 `ValidationError`，不会发出任何存储请求。不传 `sort` 时默认顺序（`_createdAt`、再 `id`）是稳定的，分页结果不会因为再次查询而错乱。

## 排序

`sort` 按顺序列出字段，`1` 为升序，`-1` 为降序：

```typescript
// 最新的 10 条
const latest = await collection.find({}, { sort: { _createdAt: -1 }, limit: 10 });

// 先按 status 升序，再按 age 降序
const users = await collection.find(
  { age: { $gte: 18 } },
  { sort: { status: 1, age: -1 } }
);
```

- `sort` 的类型是 `SortSpec<T>`：键只能是文档类型 `T` 的字段以及 `id`、`_etag`、`_createdAt`、`_updatedAt`，拼错或未声明的字段在编译时报错（0.6 起）。单独声明选项时写 `QueryOptions<User>`。值为 `undefined` 的字段会被忽略。
- 不传 `sort` 时按 `_createdAt` 升序、再按 `id` 升序，大致是插入顺序。
- 给定字段都相同时，回退到 `_createdAt`、`id`（升序），除非这两个字段已出现在 `sort` 中。
- 字段缺失或为 `null` 的文档无论升序还是降序都排在最后；没有 `_createdAt` 的文档（由其他工具写入）在默认顺序中排在最后。
- 类型不同的值按 布尔 < 数字 < 字符串 < 其他（对象和数组按 JSON 文本比较）排列。
- `put` 会重置 `_createdAt`，被替换的文档移到默认顺序的末尾。
- 方向不是 `1` / `-1`，或字段为保留名称（`__proto__`、`constructor` 等）时抛出 `ValidationError`，不会发出任何存储请求。
- 排序在内存中进行，与 `offset` / `limit` 一样不会减少读取。

## 计数

```typescript
// 不传条件：只 LIST 集合，不读取文档
const total = await collection.count();

// 传入条件：成本与 find(filter) 相同
const active = await collection.count({ status: 'active' });
```

## 查询如何执行

BucketDB 没有索引。`find` 的执行过程取决于后端。

**S3 / OSS**（以及 `remote: true` 的自定义适配器）：

1. LIST 集合的 `docs/` 前缀（每 1000 个文档一次请求），得到每个文档的 etag
2. GET 集合的查询快照 `_snapshot.v1.json`
3. 快照条目的 etag 与 LIST 一致时直接使用；其余文档（新增、修改过的）逐个 GET（最多 16 个并行）
4. 在内存中过滤
5. 对过滤后的结果应用 `sort` / `offset` / `limit`

逐个读取的文档加上快照中已删除文档的条目超过 16 个时，查询会顺带重写快照。LIST 始终是权威来源，快照缺失或过期只影响速度，不影响结果。详见[核心概念 - 快照](./concepts#快照)。

**Memory / FileSystem**：列出 `docs/`，读取**每一个**文件（最多 16 个并行），然后在内存中过滤并应用 `sort` / `offset` / `limit`。

例外：如果过滤条件中的 `id` 是一个普通字符串（`{ id: '...' }`），只读取这一个文档。

结果默认按 `_createdAt` 升序、再按 `id` 升序返回，见[排序](#排序)。

在 LIST 与 GET 之间被删除的文档会被跳过。

## 匹配规则

- 多个字段、同一字段的多个操作符之间都是 AND 关系
- 文档缺少某个字段时，该字段的值按 `undefined` 处理
- 等值比较使用严格相等（`===`），对象和数组不做深度比较
- 类型不同不会报错，只是不匹配（`$ne` / `$nin` 除外，它们匹配）

| 条件 | 字段缺失 | 值的类型不同（如 `"30"` 与 `30`） |
|------|----------|-----------------------------------|
| 普通值 / `$eq` | 不匹配 | 不匹配（严格 `===`） |
| `$ne` | 匹配 | 匹配 |
| `$gt` `$gte` `$lt` `$lte` | 不匹配 | 不匹配 |
| `$in` | 不匹配 | 不匹配，除非严格相等 |
| `$nin` | 匹配 | 匹配 |

- `$gt` / `$gte` / `$lt` / `$lte` 只在 number 与 number、string 与 string 之间比较；其他情况（布尔、`null`、对象、类型不同）都是不匹配，不会报错
- `$in: []` 不匹配任何文档；`$nin: []` 不排除任何文档，同一字段上的其他操作符照常生效
- `{ field: null }` 只匹配该字段为 `null` 的文档，不匹配缺少该字段的文档；`{ field: { $ne: null } }` 也会匹配缺少该字段的文档（`undefined !== null`）
- 没有 `$exists`；需要要求字段存在时，请在代码中过滤

## 查询校验

以下情况会在发出任何存储请求之前抛出 `ValidationError`：

- 字段名为保留名称：`__proto__`、`constructor`、`prototype`、`toString`、`valueOf`、`hasOwnProperty`、`isPrototypeOf`、`propertyIsEnumerable`
- 未知操作符（如 `$regex`）
- `$in` / `$nin` 的操作数不是数组
- `limit` / `offset` 为负数或小数
- `sort` 的方向不是 `1` / `-1`，或字段为保留名称

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

只有 `id` 等值条件能在所有后端上只读取一个文档；其他任何条件（包括空过滤）都要处理集合中的每个文档：

```typescript
// ✅ 1 次 GET
const user = await collection.findById('user-123');

// ✅ 只读取这一个文档
const users = await collection.find({ id: 'user-123' });

// ⚠️ S3/OSS：LIST + 快照 + 变化的文档；Memory/FileSystem：读取每个文件。再在内存中过滤
const active = await collection.find({ status: 'active' });
```

### 2. 条件越具体，返回越少，但读取量不变

无论条件选择性如何，非 `id` 查询的读取量都一样。更具体的条件只减少返回给你的结果数量。

### 3. 分页减少返回量，不减少读取量

`sort` / `offset` / `limit` 在过滤之后应用，所以分页不会减少存储读取：

```typescript
// 返回 100 条，但读取量与不分页时相同
const page = await collection.find({}, { limit: 100, offset: 0 });
```

上面的迭代器模式每一页都会重新执行一次完整查询（S3/OSS 上每页都要 LIST + GET 快照）。需要遍历全部结果时，直接调用一次 `find` 更省请求。

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

- **按 ID 查找** - `findById` 或 `{ id: '...' }` 在所有后端上都只读取一个文档
- **S3/OSS** - 热查询为 ⌈N/1000⌉ 次 LIST + 1 次快照 GET，加上自快照以来每个变化文档 1 次 GET；变化超过 16 个时还会用 1 次 PUT 重写快照
- **Memory/FileSystem** - 每次 `find` 读取每个文件
- **集合规模** - 超出容量范围后查询仍可用但更慢，并通过 `logger` 记录一次警告；范围见[保证与限制](./guarantees#限制)，实测耗时见 [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)
- **缓存结果** - BucketDB 不缓存查询结果，每次 `find` 都会先 LIST 存储；对频繁查询的结果可在应用层缓存

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
