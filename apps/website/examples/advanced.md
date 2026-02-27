# 高级模式示例

展示 BucketDB 的高级特性和使用模式。

## 乐观锁模式

### 基础用法

使用 ETag 防止并发更新冲突：

```typescript
import { BucketDB, FileSystemAdapter, ConcurrentUpdateError } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

interface Account extends Document {
  balance: number;
  owner: string;
}

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'banking'
);
const accounts = db.collection<Account>('accounts');

async function transfer(fromId: string, toId: string, amount: number) {
  const from = await accounts.findById(fromId);
  const to = await accounts.findById(toId);

  if (!from || !to) throw new Error('Account not found');
  if (from.balance < amount) throw new Error('Insufficient balance');

  try {
    // 使用 ETag 确保账户未被其他操作修改
    await accounts.update(
      fromId,
      { balance: from.balance - amount },
      { etag: from._etag }
    );

    await accounts.update(
      toId,
      { balance: to.balance + amount },
      { etag: to._etag }
    );

    console.log('Transfer completed');
  } catch (error) {
    if (error instanceof ConcurrentUpdateError) {
      console.log('Concurrent modification detected, please retry');
      throw error;
    }
    throw error;
  }
}
```

### 自动重试模式

```typescript
async function updateWithRetry<T extends Document>(
  collection: any,
  id: string,
  updateFn: (doc: T) => Partial<T>,
  maxRetries: number = 3
): Promise<T> {
  let retries = maxRetries;

  while (retries > 0) {
    const doc = await collection.findById(id);
    if (!doc) throw new Error('Document not found');

    try {
      const updates = updateFn(doc);
      return await collection.update(id, updates, { etag: doc._etag });
    } catch (error) {
      if (error instanceof ConcurrentUpdateError && retries > 1) {
        retries--;
        // 指数退避
        await new Promise(resolve =>
          setTimeout(resolve, 100 * (maxRetries - retries + 1))
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error('Update failed after retries');
}

// 使用
await updateWithRetry(
  accounts,
  'account-123',
  (account) => ({ balance: account.balance + 100 })
);
```

## 分页模式

### 基础分页

```typescript
interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

async function paginate<T extends Document>(
  collection: any,
  filter: any,
  page: number,
  pageSize: number
): Promise<PaginatedResult<T>> {
  const offset = (page - 1) * pageSize;
  const data = await collection.find(filter, { limit: pageSize + 1, offset });

  const hasMore = data.length > pageSize;
  const results = hasMore ? data.slice(0, pageSize) : data;

  return {
    data: results,
    page,
    pageSize,
    total: -1,  // BucketDB 不支持 count，返回 -1
    hasMore
  };
}

// 使用
const result = await paginate(users, { status: 'active' }, 1, 20);
console.log(`Page ${result.page}: ${result.data.length} items`);
console.log(`Has more: ${result.hasMore}`);
```

### 迭代器模式

```typescript
async function* paginateAll<T extends Document>(
  collection: any,
  filter: any,
  pageSize: number = 100
): AsyncGenerator<T[], void, unknown> {
  let offset = 0;

  while (true) {
    const batch = await collection.find(filter, { limit: pageSize, offset });
    if (batch.length === 0) break;

    yield batch;
    offset += batch.length;

    if (batch.length < pageSize) break;
  }
}

// 使用
for await (const batch of paginateAll(users, { status: 'active' }, 50)) {
  console.log(`Processing ${batch.length} users`);
  for (const user of batch) {
    // 处理每个用户
  }
}
```

### 游标式分页

```typescript
interface Cursor {
  lastId: string;
  offset: number;
}

async function paginateWithCursor<T extends Document>(
  collection: any,
  filter: any,
  cursor: Cursor | null,
  limit: number
) {
  const offset = cursor?.offset || 0;
  const data = await collection.find(filter, { limit: limit + 1, offset });

  const hasMore = data.length > limit;
  const results = hasMore ? data.slice(0, limit) : data;

  const nextCursor = hasMore
    ? { lastId: results[results.length - 1].id, offset: offset + limit }
    : null;

  return {
    data: results,
    nextCursor
  };
}

// 使用
let cursor = null;
while (true) {
  const result = await paginateWithCursor(users, {}, cursor, 20);
  console.log(`Fetched ${result.data.length} users`);

  if (!result.nextCursor) break;
  cursor = result.nextCursor;
}
```

## 多租户模式

### 租户隔离

```typescript
class TenantDB {
  private adapters = new Map<string, any>();

  getDB(tenantId: string): BucketDB {
    if (!this.adapters.has(tenantId)) {
      const adapter = new FileSystemAdapter({
        basePath: './data'
      });
      const db = new BucketDB(adapter, `tenant-${tenantId}`);
      this.adapters.set(tenantId, db);
    }
    return this.adapters.get(tenantId)!;
  }
}

const tenantDB = new TenantDB();

// 租户 A 的数据
const dbA = tenantDB.getDB('tenant-a');
const usersA = dbA.collection<User>('users');
await usersA.insert({ name: 'Alice', email: 'alice@a.com' });

// 租户 B 的数据（完全隔离）
const dbB = tenantDB.getDB('tenant-b');
const usersB = dbB.collection<User>('users');
await usersB.insert({ name: 'Bob', email: 'bob@b.com' });
```

### 租户上下文

```typescript
class TenantContext {
  private static currentTenant: string | null = null;

  static setTenant(tenantId: string) {
    this.currentTenant = tenantId;
  }

  static getTenant(): string {
    if (!this.currentTenant) {
      throw new Error('No tenant context set');
    }
    return this.currentTenant;
  }

  static clear() {
    this.currentTenant = null;
  }
}

// Express 中间件
function tenantMiddleware(req: any, res: any, next: any) {
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) {
    return res.status(400).json({ error: 'Missing tenant ID' });
  }

  TenantContext.setTenant(tenantId as string);
  next();
  TenantContext.clear();
}

// 使用
app.use(tenantMiddleware);

app.get('/users', async (req, res) => {
  const tenantId = TenantContext.getTenant();
  const db = tenantDB.getDB(tenantId);
  const users = await db.collection<User>('users').find({});
  res.json(users);
});
```

## 缓存模式

### 内存缓存层

```typescript
class CachedCollection<T extends Document> {
  private cache = new Map<string, { data: T; expiry: number }>();
  private ttl: number;

  constructor(
    private collection: any,
    ttl: number = 60000  // 默认 60 秒
  ) {
    this.ttl = ttl;
  }

  async findById(id: string): Promise<T | null> {
    const cached = this.cache.get(id);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const doc = await this.collection.findById(id);
    if (doc) {
      this.cache.set(id, {
        data: doc,
        expiry: Date.now() + this.ttl
      });
    }

    return doc;
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const updated = await this.collection.update(id, data);
    this.cache.delete(id);  // 清除缓存
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.collection.delete(id);
    this.cache.delete(id);
  }
}

// 使用
const cachedUsers = new CachedCollection(
  db.collection<User>('users'),
  30000  // 30 秒缓存
);

const user = await cachedUsers.findById('user-123');  // 从数据库
const user2 = await cachedUsers.findById('user-123'); // 从缓存
```

## 批量操作模式

### 批量插入

```typescript
async function batchInsert<T extends Document>(
  collection: any,
  items: Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>[],
  batchSize: number = 10
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => collection.insert(item))
    );
    results.push(...batchResults);
  }

  return results;
}

// 使用
const newUsers = [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' },
  // ... 100+ 用户
];

const inserted = await batchInsert(users, newUsers, 20);
console.log(`Inserted ${inserted.length} users`);
```

### 批量更新

```typescript
async function batchUpdate<T extends Document>(
  collection: any,
  updates: Array<{ id: string; data: Partial<T> }>,
  batchSize: number = 10
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(({ id, data }) => collection.update(id, data))
    );
    results.push(...batchResults);
  }

  return results;
}
```

## 软删除模式

```typescript
interface SoftDeletable extends Document {
  deletedAt?: string;
  deleted?: boolean;
}

class SoftDeleteCollection<T extends SoftDeletable> {
  constructor(private collection: any) {}

  async find(filter: any): Promise<T[]> {
    const results = await this.collection.find({
      ...filter,
      deleted: { $ne: true }
    });
    return results;
  }

  async softDelete(id: string): Promise<T> {
    return await this.collection.update(id, {
      deleted: true,
      deletedAt: new Date().toISOString()
    });
  }

  async restore(id: string): Promise<T> {
    return await this.collection.update(id, {
      deleted: false,
      deletedAt: undefined
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.collection.delete(id);
  }

  async findDeleted(): Promise<T[]> {
    return await this.collection.find({ deleted: true });
  }
}

// 使用
const softDeleteUsers = new SoftDeleteCollection(
  db.collection<User & SoftDeletable>('users')
);

await softDeleteUsers.softDelete('user-123');  // 软删除
const active = await softDeleteUsers.find({});  // 不包含已删除
await softDeleteUsers.restore('user-123');      // 恢复
```

## 审计日志模式

```typescript
interface AuditLog extends Document {
  entity: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  changes: any;
  userId: string;
  timestamp: string;
}

class AuditedCollection<T extends Document> {
  constructor(
    private collection: any,
    private auditLog: any,
    private userId: string
  ) {}

  async insert(data: any): Promise<T> {
    const doc = await this.collection.insert(data);

    await this.auditLog.insert({
      entity: this.collection.name,
      entityId: doc.id,
      action: 'create',
      changes: data,
      userId: this.userId,
      timestamp: new Date().toISOString()
    });

    return doc;
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const before = await this.collection.findById(id);
    const after = await this.collection.update(id, data);

    await this.auditLog.insert({
      entity: this.collection.name,
      entityId: id,
      action: 'update',
      changes: { before, after },
      userId: this.userId,
      timestamp: new Date().toISOString()
    });

    return after;
  }
}
```

## 下一步

- [基础用法](./basic-usage) - 基础 CRUD 操作
- [生产部署](./production) - S3/OSS 配置
- [API 参考](/api/) - 完整 API 文档
