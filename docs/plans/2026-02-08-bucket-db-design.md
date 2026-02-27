# BucketDB 设计文档

**日期**: 2026-02-08
**版本**: v0.1.0 设计
**状态**: ✅ MVP 已完成 (Updated 2026-02-08)

---

## 📊 实现状态总览

### ✅ 已完成功能
- ✅ 完整的 TypeScript 类型系统
- ✅ 4 种存储适配器（Memory, FileSystem, S3, OSS）
- ✅ 分片索引系统（16 分片，可配置）
- ✅ 完整的 CRUD 操作
- ✅ 8 种查询操作符（$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin）
- ✅ 分页查询（limit, offset）
- ✅ ETag 乐观锁
- ✅ dbPath 多数据库支持
- ✅ 89 个自动化测试（全部通过）
- ✅ 3 个示例项目

### 📦 包结构
- `@bucket-db/core` - 核心引擎（已实现）
- `@bucket-db/types` - 类型定义（已实现）

### 📝 待办事项
- [ ] NPM 发布
- [ ] 性能基准测试文档
- [ ] API 完整文档
- [ ] Phase 2 功能（批量操作、更多操作符、排序等）

---

## 概述

BucketDB 是一个基于云对象存储（AWS S3 / 阿里云 OSS）的 TypeScript 文档数据库，提供简洁的 API 用于存储和查询 JSON 文档。

### 核心特性

- 🚀 使用云对象存储作为后端，无需自建数据库服务器
- 📦 类型安全的 TypeScript API，完整的类型推导
- 🔍 支持灵活的文档查询（等值查询和比较操作符）
- 🔒 基于 ETag 的乐观锁并发控制
- ☁️ 支持 AWS S3 和阿里云 OSS，统一 API
- 🎯 Collections 组织文档，每个 collection 有独立索引
- 📊 分片索引设计，支持扩展到数十万文档

## 整体架构

BucketDB 采用分层架构：

### 1. API 层
- `BucketDB` 主类：数据库实例初始化和配置
- `Collection<T>` 类：提供类型安全的 CRUD 和查询方法
- Query Builder：构建类型安全的查询条件

### 2. 存储抽象层
- `StorageAdapter` 接口：统一 S3 和 OSS 的接口差异
- `S3Adapter` 实现：使用 @aws-sdk/client-s3
- `OSSAdapter` 实现：使用 ali-oss SDK
- 提供统一的 get/put/delete/list 操作

### 3. 索引引擎
- `IndexManager`：协调索引的 CRUD 操作
- `IndexShard`：单个分片的读写和查询
- 索引策略：默认索引所有第一层字段，可配置

### 4. 事务协调器
- 使用 ETag 实现乐观锁
- 重试机制处理并发冲突
- 支持指数退避重试策略

## 数据组织

### 对象存储路径结构

```
{bucket-name}/
├── {dbPath}/                        # 数据库路径（如 "my-app-prod"）
│   ├── _db-meta.json               # 数据库级别元数据
│   ├── {collection-name}/
│   │   ├── meta.json               # collection 元数据
│   │   ├── docs/
│   │   │   ├── {docId1}.json      # 文档数据
│   │   │   ├── {docId2}.json
│   │   │   └── ...
│   │   └── index/
│   │       ├── shard-00.json      # 索引分片
│   │       ├── shard-01.json
│   │       └── ...
│   └── {another-collection}/
│       └── ...
└── {another-dbPath}/                # 另一个独立数据库
    └── ...
```

### Collection Meta（meta.json）

```json
{
  "name": "users",
  "version": 1,
  "indexShardCount": 16,
  "indexedFields": ["*"],
  "createdAt": "2026-02-08T00:00:00Z",
  "documentCount": 1523,
  "lastUpdated": "2026-02-08T01:00:00Z"
}
```

### 索引分片（shard-XX.json）

```json
{
  "shardId": "00",
  "documents": {
    "user-123": {
      "id": "user-123",
      "name": "张三",
      "age": 25,
      "status": "active",
      "_etag": "abc123...",
      "_updated": "2026-02-08T00:30:00Z"
    }
  }
}
```

- 分片选择：`shardId = hash(docId) % shardCount`
- 只存储索引字段，不存储完整文档
- 默认 16 个分片，可在创建 collection 时配置

### 多数据库支持

一个 bucket 可以包含多个独立数据库，通过 `dbPath` 区分：

**使用场景**：
- 多环境：`dev/`, `staging/`, `prod/`
- 多租户：`tenant-a/`, `tenant-b/`
- 多应用：`app1/`, `app2/`

## API 设计

### 初始化

```typescript
import { BucketDB } from '@bucket-db/core';

const db = new BucketDB({
  provider: 's3',              // 或 'oss'
  bucket: 'shared-storage',    // S3/OSS bucket 名称
  dbPath: 'my-app-prod',       // 数据库路径
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  },
  options: {
    defaultShardCount: 16,     // 可选
    retryAttempts: 3,          // 可选
    retryDelay: 100            // 可选
  }
});
```

### CRUD 操作

```typescript
interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

const users = db.collection<User>('users');

// 创建
const user = await users.insert({
  name: '张三',
  age: 25,
  email: 'zhang@example.com',
  status: 'active'
});
// 返回: { id: 'auto-generated-id', ...data, _etag: '...', _createdAt: '...', _updatedAt: '...' }

// 读取
const user = await users.findById('user-123');

// 更新（乐观锁）
await users.update('user-123', {
  age: 26
}, { etag: user._etag });

// 删除
await users.delete('user-123');
```

### 查询操作

```typescript
// 等值查询
const activeUsers = await users.find({ status: 'active' });

// 比较操作符
const adults = await users.find({
  age: { $gte: 18 }
});

// 多条件查询
const results = await users.find({
  status: 'active',
  age: { $gte: 18, $lt: 65 }
});

// 分页
const page1 = await users.find(
  { status: 'active' },
  { limit: 20, offset: 0 }
);
```

### 支持的查询操作符（v0.1.0）

- `$eq` - 等于（默认）
- `$ne` - 不等于
- `$gt`, `$gte` - 大于、大于等于
- `$lt`, `$lte` - 小于、小于等于
- `$in` - 在数组中
- `$nin` - 不在数组中

## 查询执行流程

1. **解析查询条件** - 将查询对象转换为内部查询计划
2. **确定需要扫描的分片** - 如果查询包含 id 可以直接定位分片，否则扫描所有分片
3. **并行读取索引分片** - 从 S3/OSS 并行获取相关分片
4. **内存过滤** - 在索引数据上应用查询条件，得到匹配的文档 ID 列表
5. **获取完整文档** - 并行从 `docs/` 目录获取匹配的文档
6. **应用分页** - 处理 limit 和 offset 参数
7. **返回结果**

### 写入流程

```typescript
await users.insert({ name: '张三', age: 25, status: 'active' });
```

内部执行步骤：
1. 生成 docId（UUID）
2. 计算分片：`shardId = hash(docId) % 16`
3. 写入文档到 `docs/{docId}.json`
4. 读取对应的索引分片 `index/shard-{shardId}.json`
5. 使用 ETag 做乐观锁，更新索引添加新文档条目
6. 写回索引分片
7. 更新 collection meta.json（文档计数等）

## 并发控制

### 乐观锁实现

使用 S3/OSS 的 ETag 机制实现乐观锁：

```typescript
async updateIndexShard(shardId: string, updater: Function) {
  let retries = 3;

  while (retries > 0) {
    // 1. 读取当前索引和 ETag
    const { data: shard, etag } = await storage.get(
      `${collection}/index/shard-${shardId}.json`
    );

    // 2. 应用更新
    const updated = updater(shard);

    // 3. 条件写入（ETag 必须匹配）
    try {
      await storage.put(
        `${collection}/index/shard-${shardId}.json`,
        updated,
        { ifMatch: etag }
      );
      return; // 成功
    } catch (err) {
      if (err.code === 'PreconditionFailed') {
        retries--;
        await sleep(100 * (4 - retries)); // 指数退避
        continue;
      }
      throw err;
    }
  }

  throw new ConcurrentUpdateError('索引更新冲突，请重试');
}
```

### 用户层面的并发处理

```typescript
try {
  await users.update('user-123', { age: 26 }, { etag: oldEtag });
} catch (err) {
  if (err instanceof ConcurrentUpdateError) {
    // 重新读取最新数据并重试
    const latest = await users.findById('user-123');
    await users.update('user-123', { age: 26 }, { etag: latest._etag });
  }
}
```

## 存储适配器

### StorageAdapter 接口

```typescript
interface StorageObject {
  data: any;
  etag: string;
  lastModified: Date;
}

interface PutOptions {
  ifMatch?: string;      // 乐观锁：仅当 ETag 匹配时写入
  ifNoneMatch?: string;  // 仅当不存在时写入
}

interface StorageAdapter {
  get(key: string): Promise<StorageObject>;
  put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
  batchGet(keys: string[]): Promise<Map<string, StorageObject>>;
}
```

### S3Adapter 实现

使用 `@aws-sdk/client-s3`，支持：
- If-Match header 实现乐观锁
- 并行批量读取
- 自定义 endpoint（支持 LocalStack）

### OSSAdapter 实现

使用 `ali-oss`，提供与 S3Adapter 相同的接口。

## TypeScript 类型系统

### 核心类型

```typescript
// 文档基础类型
export interface Document {
  id: string;
  _etag?: string;
  _createdAt?: string;
  _updatedAt?: string;
}

// 查询操作符
export type QueryOperator =
  | '$eq' | '$ne'
  | '$gt' | '$gte' | '$lt' | '$lte'
  | '$in' | '$nin';

export type QueryValue<T> =
  | T
  | { [K in QueryOperator]?: T | T[] };

export type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};

// Collection 接口
export interface ICollection<T extends Document> {
  insert(data: Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>): Promise<T>;
  findById(id: string): Promise<T | null>;
  find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]>;
  update(id: string, data: Partial<Omit<T, 'id'>>, options?: UpdateOptions): Promise<T>;
  delete(id: string): Promise<void>;
}
```

### 类型安全示例

```typescript
interface User extends Document {
  name: string;
  age: number;
  status: 'active' | 'inactive';
}

const users = db.collection<User>('users');

// ✅ 类型安全的插入
await users.insert({
  name: '张三',
  age: 25,
  status: 'active'
});

// ✅ 查询条件类型检查
await users.find({
  age: { $gte: 18 },      // ✅ 正确
  status: 'active'        // ✅ 正确
  // email: 123           // ❌ 类型错误
});

// ✅ 返回值类型推导
const user = await users.findById('123');  // user: User | null
```

## 项目结构（Monorepo）

使用 Bun workspaces 管理：

```
bucket-db/
├── packages/
│   ├── core/                       # 核心数据库引擎 (@bucket-db/core)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── core/              # BucketDB, Collection
│   │   │   ├── storage/           # 适配器
│   │   │   ├── index/             # 索引管理
│   │   │   ├── query/             # 查询引擎
│   │   │   ├── errors/
│   │   │   └── utils/
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── types/                      # 共享类型 (@bucket-db/types)
│   ├── client/                     # 客户端 SDK（未来）
│   └── cli/                        # CLI 工具（未来）
│
├── apps/
│   ├── docs/                       # 官网文档（未来）
│   └── playground/                 # 在线演练场（未来）
│
├── examples/
│   ├── basic-usage/
│   ├── todo-app/
│   └── blog-api/
│
├── docs/
│   └── plans/
│
├── package.json
└── bun.lock
```

## 性能优化

### 并行化操作

```typescript
// 查询时并行读取所有索引分片
async function queryIndex(filter: QueryFilter) {
  const shardCount = 16;
  const shardPromises = Array.from({ length: shardCount }, (_, i) =>
    readIndexShard(i)
  );

  const shards = await Promise.all(shardPromises);

  const matchedIds = shards.flatMap(shard =>
    filterDocuments(shard, filter)
  );

  return Promise.all(matchedIds.map(id => readDocument(id)));
}
```

### 批量操作优化

```typescript
// 批量插入
async insertBatch(documents: T[]): Promise<T[]> {
  const shardGroups = groupByShardId(documents);

  // 并行写入文档
  await Promise.all(
    documents.map(doc => writeDocument(doc))
  );

  // 批量更新索引
  await Promise.all(
    Object.entries(shardGroups).map(([shardId, docs]) =>
      updateIndexShardBatch(shardId, docs)
    )
  );
}
```

### 扩展性考虑

- 分片数量可配置（默认 16，可根据数据量调整）
- 索引字段选择（支持只索引特定字段）
- 未来支持分片自动分裂（v2.0+）
- 可选的 gzip 压缩（减少存储成本）

### 预估性能指标

假设 16 分片，每分片 1000 文档：

- **插入**：~200-500ms（1 次文档写入 + 1 次索引更新）
- **按 ID 查询**：~100-200ms（1 次索引读取 + 1 次文档读取）
- **全表查询**：~500-1500ms（16 次并行索引读取 + N 次文档读取）

## 测试策略

### 单元测试

使用 Bun 内置测试框架：

```typescript
import { describe, test, expect } from 'bun:test';

describe('Query Operators', () => {
  test('$gte operator', () => {
    expect(evaluateOperator(25, { $gte: 18 })).toBe(true);
    expect(evaluateOperator(15, { $gte: 18 })).toBe(false);
  });
});
```

### 集成测试

使用内存适配器模拟：

```typescript
describe('Collection Integration', () => {
  let db: BucketDB;

  beforeEach(() => {
    db = new BucketDB({
      adapter: new MemoryStorageAdapter()
    });
  });

  test('insert and find', async () => {
    const users = db.collection('users');
    await users.insert({ name: '张三', age: 25 });
    const results = await users.find({ name: '张三' });
    expect(results).toHaveLength(1);
  });
});
```

### E2E 测试

使用 LocalStack 或 Minio 模拟 S3 环境。

## NPM 发布

### 包命名

- `@bucket-db/core` - 核心引擎
- `@bucket-db/types` - 类型定义
- `@bucket-db/client` - 客户端 SDK（未来）
- `bucket-db-cli` - CLI 工具（未来）

### 版本管理

使用 Changesets 管理版本和 changelog：

```bash
# 记录变更
bunx changeset

# 版本升级
bunx changeset version

# 发布
bunx changeset publish
```

### 自动发布

GitHub Actions 自动化发布流程：
1. 开发新功能并提交代码
2. 运行 `bunx changeset` 记录变更
3. 推送到 main 分支
4. GitHub Actions 自动构建、测试、发布到 NPM
5. 自动创建 GitHub Release 和 changelog

## 开发路线图

### Phase 1 - MVP 核心功能（v0.1.0） ✅ **已完成**

**目标**：实现基本可用的文档数据库

- ✅ Monorepo 结构搭建（Bun workspaces）
- ✅ StorageAdapter 接口和实现
  - ✅ MemoryStorageAdapter（测试用）
  - ✅ FileSystemAdapter（本地开发）
  - ✅ S3Adapter（AWS 生产环境）
  - ✅ OSSAdapter（阿里云生产环境）
- ✅ 分片索引管理（默认 16 个分片，可配置）
- ✅ 文档 CRUD 操作（insert, findById, find, update, delete）
- ✅ 查询引擎（等值查询 + 比较操作符：$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin）
- ✅ 分页支持（limit, offset）
- ✅ 乐观锁并发控制（基于 ETag）
- ✅ 完整的 TypeScript 类型系统
- ✅ 单元测试和集成测试（89 个测试通过）
- ✅ 基础文档和示例
  - ✅ basic-usage 示例
  - ✅ local-storage 示例
  - ✅ dbpath-demo 示例（多数据库/多租户）
- ✅ dbPath 支持（多数据库/多租户隔离）
- ⏸️ NPM 发布配置（待发布）

**实现亮点**：
- FileSystemAdapter 允许完全在本地开发，无需云服务
- dbPath 功能实现多环境/多租户隔离
- 完整的 ETag 乐观锁实现，支持并发安全
- 89 个自动化测试保证代码质量

### Phase 2 - 增强功能（v0.2.0）

- 批量操作 API（insertBatch, updateBatch, deleteBatch）
- 更多查询操作符（$exists, $regex）
- 排序支持（sort）
- Count 聚合
- 性能优化（缓存、压缩）

### Phase 3 - 生态工具（v0.3.0+）

- CLI 工具（数据导入/导出、迁移）
- 在线文档网站
- 管理界面（可视化查看数据）
- 监控和日志

## 配置示例

### 基本配置

```typescript
const db = new BucketDB({
  provider: 's3',
  bucket: 'my-bucket',
  region: 'us-east-1',
  dbPath: 'production',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});
```

### 完整配置选项

```typescript
const db = new BucketDB({
  provider: 's3',
  bucket: 'my-bucket',
  region: 'us-east-1',
  dbPath: 'production',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  },
  options: {
    endpoint: 'http://localhost:4566',  // LocalStack
    defaultShardCount: 16,
    retryAttempts: 3,
    retryDelay: 100,
    compression: false,
    debug: false
  }
});
```

### 环境变量配置

```bash
BUCKET_DB_PROVIDER=s3
BUCKET_DB_BUCKET=my-bucket
BUCKET_DB_REGION=us-east-1
BUCKET_DB_PATH=production
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```

```typescript
const db = BucketDB.fromEnv();
```

## 错误处理

### 错误类型

```typescript
class BucketDBError extends Error {}

class DocumentNotFoundError extends BucketDBError {}

class ConcurrentUpdateError extends BucketDBError {
  // ETag 冲突且重试失败时抛出
}

class ValidationError extends BucketDBError {
  // 数据验证失败
}

class StorageError extends BucketDBError {
  // S3/OSS 底层错误
}
```

## 总结

BucketDB 是一个创新的文档数据库解决方案：

- **无需自建服务器**：利用云对象存储的高可用性和低成本
- **类型安全**：完整的 TypeScript 类型系统
- **可扩展**：Monorepo 结构，为生态工具预留空间
- **性能优化**：分片索引 + 并行查询
- **并发安全**：ETag 乐观锁
- **多云支持**：统一 API 支持 S3 和 OSS

第一版 MVP 将专注于核心功能，为未来扩展打好基础。
