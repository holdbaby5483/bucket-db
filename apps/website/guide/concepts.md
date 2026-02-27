# 核心概念

理解 BucketDB 的核心概念，帮助你更好地使用它。

## 数据库（BucketDB）

数据库是顶层容器，通过 `dbPath` 参数实现数据隔离。

```typescript
const db = new BucketDB(adapter, 'my-app');
```

**用途**：
- **多环境隔离** - 开发、测试、生产环境使用不同的 dbPath
- **多租户隔离** - 每个租户使用独立的 dbPath
- **逻辑分组** - 按业务逻辑分组数据

**示例**：

```typescript
// 多环境
const devDB = new BucketDB(adapter, 'dev');
const prodDB = new BucketDB(adapter, 'prod');

// 多租户
const tenant1DB = new BucketDB(adapter, 'tenant-001');
const tenant2DB = new BucketDB(adapter, 'tenant-002');
```

## 集合（Collection）

集合是文档的容器，类似于传统数据库的表。

```typescript
const users = db.collection<User>('users');
```

**特性**：
- **类型安全** - 泛型参数提供完整的类型推断
- **独立索引** - 每个集合有自己的索引分片
- **单例模式** - 同一 dbPath 下同名集合返回同一实例

**配置**：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 自定义分片数量（默认 16）
});
```

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
type InsertDocument<T> = Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>;

// 更新时：所有字段可选，除了 id
type UpdateDocument<T> = Partial<Omit<T, 'id'>>;
```

## 存储适配器（StorageAdapter）

存储适配器是对底层存储的抽象，提供统一的 API。

**可用适配器**：

| 适配器 | 用途 | 性能 | 成本 |
|--------|------|------|------|
| MemoryStorageAdapter | 测试、开发 | 极快 | 免费 |
| FileSystemAdapter | 本地开发、小规模部署 | 快 | 免费 |
| S3Adapter | AWS 生产环境 | 中等 | 按用量 |
| OSSAdapter | 阿里云生产环境 | 中等 | 按用量 |

**选择建议**：
- **开发/测试** - FileSystemAdapter 或 MemoryStorageAdapter
- **生产环境** - S3Adapter 或 OSSAdapter（根据云平台）
- **小规模部署** - FileSystemAdapter（配合 VPS）

详见 [存储适配器 API](/api/adapters)。

## 索引分片（Index Sharding）

BucketDB 使用分片索引提升查询性能。

**工作原理**：
1. 根据文档 ID 的哈希值分配分片
2. 每个分片独立存储，减少单文件大小
3. 查询时并行扫描所有分片

**配置分片数量**：

```typescript
const users = db.collection<User>('users', {
  shardCount: 32  // 默认 16
});
```

**选择策略**：
- **< 10K 文档** - 4-8 个分片
- **10K-100K 文档** - 16-32 个分片
- **> 100K 文档** - 32-64 个分片

**注意**：分片数量创建后不可修改。

## 乐观锁（Optimistic Locking）

基于 ETag 的乐观锁机制，防止并发更新冲突。

**工作原理**：
1. 读取文档时获取 `_etag`
2. 更新时传入 `_etag`
3. 如果 ETag 不匹配，抛出 `ConcurrentUpdateError`

**使用示例**：

```typescript
const user = await users.findById('user-123');

try {
  await users.update('user-123', { age: 26 }, { etag: user._etag });
} catch (error) {
  if (error instanceof ConcurrentUpdateError) {
    console.log('并发更新冲突，请重试');
  }
}
```

**重试模式**：

```typescript
async function updateWithRetry(id: string, updates: Partial<User>) {
  let retries = 3;

  while (retries > 0) {
    const user = await users.findById(id);
    if (!user) throw new Error('User not found');

    try {
      return await users.update(id, updates, { etag: user._etag });
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && retries > 1) {
        retries--;
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      throw error;
    }
  }
}
```

详见[错误处理](./error-handling)。

## 数据组织

BucketDB 在存储中的组织结构：

```
{dbPath}/
  {collectionName}/
    docs/
      {id}.json           # 文档文件
    index/
      shard-00.json       # 索引分片
      shard-01.json
      ...
```

**示例**：

```
my-app/
  users/
    docs/
      a1b2c3d4-...-uuid.json
      e5f6g7h8-...-uuid.json
    index/
      shard-00.json
      shard-01.json
      ...
      shard-15.json
```

## 下一步

- [查询语法](./queries) - 学习所有查询操作符
- [错误处理](./error-handling) - 处理常见错误场景
- [API 参考](/api/) - 完整的 API 文档
