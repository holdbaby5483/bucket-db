# 高级模式示例

展示 BucketDB 的高级特性和使用模式。

## 乐观锁模式

### 基础用法

使用 ETag 检测 `update` 的并发冲突：

::: warning 注意
- BucketDB 没有事务：下面两次 `update` 是独立的写入，第二次失败时第一次不会回滚。
- 条件更新（`etag`）在 Memory、S3 上可用；FileSystem 仅在单进程内有效；OSS 不支持，传入 `etag` 会抛出 `UnsupportedError`。
:::

```typescript
import { BucketDB, FileSystemAdapter, ConcurrentUpdateError } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

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

不传 `etag` 时，`update` 在支持条件写入的后端（Memory、单进程内的 FileSystem、S3）上已经会自动"读取 → 合并 → 条件写入"，冲突时重试最多 5 次，适合只修改部分字段的场景。只有当新值依赖旧值（如余额加减）时，才需要自己用 `etag` 做读-改-写循环：

```typescript
async function updateWithRetry<T extends Document>(
  collection: Collection<T>,
  id: string,
  updateFn: (doc: T) => UpdateDocument<T>,
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

在 OSS 上这个函数会在第一次 `update` 时抛出 `UnsupportedError`。上面的片段需要导入：

```typescript
import type { Collection, UpdateDocument } from '@hold-baby/bucket-db';
```

## 分页模式

::: tip 分页成本
`offset` / `limit` 在读取并过滤全部文档之后才应用：除 `{ id: '...' }` 外，每次 `find` 都会列出并读取集合中的所有文档，翻到第几页请求数都一样。结果按 ID（随机 UUID）排序，不是插入顺序；目前不支持 `sort` 和 `count`。BucketDB 面向小集合（数千条文档）。
:::

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

每个租户使用不同的 `dbPath`，数据位于 `<dbPath>/<collection>/docs/` 下，互不可见。`dbPath` 的每一段都必须匹配 `^[A-Za-z0-9_.-]{1,255}$` 且不能以 `.` 开头，否则 `new BucketDB(...)` 同步抛出 `ValidationError`（不会被自动改写），所以请先校验租户 ID。

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';

class TenantDB {
  private adapter = new FileSystemAdapter({ basePath: './data' });
  private dbs = new Map<string, BucketDB>();

  getDB(tenantId: string): BucketDB {
    let db = this.dbs.get(tenantId);
    if (!db) {
      // 例如 tenants/tenant-a → ./data/tenants/tenant-a/users/docs/...
      db = new BucketDB(this.adapter, `tenants/${tenantId}`);
      this.dbs.set(tenantId, db);
    }
    return db;
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

### 应用侧内存缓存层

BucketDB 本身不缓存查询结果，每次调用都会访问存储。如有需要，可以在应用里自行包一层缓存（注意：多实例部署时各实例缓存互不感知）：

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

::: warning 并发写入
所有后端都支持并发 `insert` / `delete`。并发 `update`（不带 `etag`）在 Memory、S3 以及单进程内的 FileSystem 上会自动合并重试；在 OSS 上后写覆盖。没有事务：一批写入中途失败时，已完成的写入不会回滚。
:::

### 批量插入

```typescript
async function batchInsert<T extends Document>(
  collection: Collection<T>,
  items: InsertDocument<T>[],
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
  collection: Collection<T>,
  updates: Array<{ id: string; data: UpdateDocument<T> }>,
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
    private collection: Collection<T>,
    private entity: string,
    private auditLog: Collection<AuditLog>,
    private userId: string
  ) {}

  async insert(data: InsertDocument<T>): Promise<T> {
    const doc = await this.collection.insert(data);

    await this.auditLog.insert({
      entity: this.entity,
      entityId: doc.id,
      action: 'create',
      changes: data,
      userId: this.userId,
      timestamp: new Date().toISOString()
    });

    return doc;
  }

  async update(id: string, data: UpdateDocument<T>): Promise<T> {
    const before = await this.collection.findById(id);
    const after = await this.collection.update(id, data);

    await this.auditLog.insert({
      entity: this.entity,
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

批量和审计示例使用的类型：`import type { Collection, InsertDocument, UpdateDocument } from '@hold-baby/bucket-db';`

## 下一步

- [基础用法](./basic-usage) - 基础 CRUD 操作
- [S3 / OSS 云存储](./production) - S3/OSS 配置
- [API 参考](/api/) - 完整 API 文档
