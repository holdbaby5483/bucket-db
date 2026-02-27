# BucketDB API Reference

Complete API documentation for BucketDB v0.1.0.

## Table of Contents

- [Core Classes](#core-classes)
  - [BucketDB](#bucketdb)
  - [Collection](#collection)
- [Storage Adapters](#storage-adapters)
  - [MemoryStorageAdapter](#memorystorageadapter)
  - [FileSystemAdapter](#filesystemadapter)
  - [S3Adapter](#s3adapter)
  - [OSSAdapter](#ossadapter)
- [Type Definitions](#type-definitions)
- [Error Classes](#error-classes)
- [Query Operators](#query-operators)

---

## Core Classes

### BucketDB

Main database class for managing collections.

#### Constructor

```typescript
new BucketDB(
  adapter: StorageAdapter,
  dbPath: string,
  options?: BucketDBOptions
)
```

**Parameters:**
- `adapter` - Storage adapter instance (MemoryStorageAdapter, FileSystemAdapter, S3Adapter, or OSSAdapter)
- `dbPath` - Database path for isolation (e.g., 'my-app', 'tenant-123')
- `options` - Optional configuration
  - `defaultShardCount?: number` - Default number of shards for collections (default: 16)

**Example:**
```typescript
import { BucketDB, FileSystemAdapter } from '@bucket-db/core';

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'my-app',
  { defaultShardCount: 32 }
);
```

#### Methods

##### `collection<T>(name: string, options?: CollectionOptions): Collection<T>`

Get or create a collection with type-safe operations.

**Parameters:**
- `name` - Collection name
- `options` - Optional collection configuration
  - `shardCount?: number` - Number of shards (overrides default)

**Returns:** `Collection<T>` instance

**Example:**
```typescript
interface User extends Document {
  name: string;
  email: string;
}

const users = db.collection<User>('users');
```

---

### Collection<T>

Type-safe collection for CRUD operations.

#### Methods

##### `insert(data: InsertDocument<T>): Promise<T>`

Insert a new document.

**Parameters:**
- `data` - Document data (without `id`, `_etag`, `_createdAt`, `_updatedAt`)

**Returns:** Complete document with system fields

**Example:**
```typescript
const user = await users.insert({
  name: 'Alice',
  email: 'alice@example.com',
});
// Returns: { id: '...', name: 'Alice', email: '...', _etag: '...', _createdAt: '...', _updatedAt: '...' }
```

##### `findById(id: string): Promise<T | null>`

Find document by ID.

**Parameters:**
- `id` - Document ID

**Returns:** Document or `null` if not found

**Example:**
```typescript
const user = await users.findById('user-123');
if (user) {
  console.log(user.name);
}
```

##### `find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]>`

Query documents with filter.

**Parameters:**
- `filter` - Query filter object
- `options` - Query options
  - `limit?: number` - Maximum number of results
  - `offset?: number` - Number of results to skip

**Returns:** Array of matching documents

**Example:**
```typescript
// Simple equality
const active = await users.find({ status: 'active' });

// Comparison operators
const adults = await users.find({ age: { $gte: 18 } });

// Multiple conditions
const results = await users.find({
  status: 'active',
  age: { $gte: 18, $lt: 65 },
});

// Pagination
const page1 = await users.find({}, { limit: 10, offset: 0 });
const page2 = await users.find({}, { limit: 10, offset: 10 });
```

##### `update(id: string, data: UpdateDocument<T>, options?: UpdateOptions): Promise<T>`

Update existing document.

**Parameters:**
- `id` - Document ID
- `data` - Partial document update (cannot change `id`)
- `options` - Update options
  - `etag?: string` - ETag for optimistic locking

**Returns:** Updated document

**Throws:**
- `DocumentNotFoundError` - Document not found
- `ConcurrentUpdateError` - ETag mismatch (concurrent modification)

**Example:**
```typescript
// Simple update
const updated = await users.update('user-123', { age: 26 });

// With optimistic locking
const user = await users.findById('user-123');
const updated = await users.update(
  'user-123',
  { age: 26 },
  { etag: user._etag }
);
```

##### `delete(id: string): Promise<void>`

Delete document.

**Parameters:**
- `id` - Document ID

**Throws:**
- `DocumentNotFoundError` - Document not found

**Example:**
```typescript
await users.delete('user-123');
```

---

## Storage Adapters

### MemoryStorageAdapter

In-memory storage adapter for testing.

#### Constructor

```typescript
new MemoryStorageAdapter()
```

**Example:**
```typescript
import { MemoryStorageAdapter } from '@bucket-db/core';

const adapter = new MemoryStorageAdapter();
```

#### Additional Methods

##### `clear(): void`

Clear all stored data (testing utility).

---

### FileSystemAdapter

Local file system storage adapter.

#### Constructor

```typescript
new FileSystemAdapter(config: FileSystemAdapterConfig)
```

**Parameters:**
- `config.basePath` - Base directory path for storage

**Example:**
```typescript
import { FileSystemAdapter } from '@bucket-db/core';

const adapter = new FileSystemAdapter({
  basePath: './my-database',
});
```

**Storage Structure:**
```
basePath/
  dbPath/
    collectionName/
      docs/
        {id}.json         # Document files
      index/
        shard-00.json     # Index shards
        shard-01.json
        ...
```

---

### S3Adapter

AWS S3 storage adapter.

#### Constructor

```typescript
new S3Adapter(config: StorageAdapterConfig)
```

**Parameters:**
- `config.bucket` - S3 bucket name
- `config.region` - AWS region (e.g., 'us-east-1')
- `config.credentials` - AWS credentials
  - `accessKeyId` - AWS access key ID
  - `secretAccessKey` - AWS secret access key
- `config.endpoint?` - Optional custom endpoint (for LocalStack, MinIO, etc.)

**Example:**
```typescript
import { S3Adapter } from '@bucket-db/core';

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

---

### OSSAdapter

Alibaba Cloud OSS storage adapter.

#### Constructor

```typescript
new OSSAdapter(config: StorageAdapterConfig)
```

**Parameters:**
- `config.bucket` - OSS bucket name
- `config.region` - OSS region (e.g., 'oss-cn-hangzhou')
- `config.credentials` - OSS credentials
  - `accessKeyId` - OSS access key ID
  - `secretAccessKey` - OSS access key secret
- `config.endpoint?` - Optional custom endpoint

**Example:**
```typescript
import { OSSAdapter } from '@bucket-db/core';

const adapter = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'oss-cn-hangzhou',
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET!,
  },
});
```

---

## Type Definitions

### Document

Base document type with system fields.

```typescript
interface Document {
  id: string;
  _etag?: string;
  _createdAt?: string;
  _updatedAt?: string;
}
```

All collection documents must extend this interface.

### InsertDocument<T>

Type for inserting new documents (omits system fields).

```typescript
type InsertDocument<T extends Document> = Omit<
  T,
  'id' | '_etag' | '_createdAt' | '_updatedAt'
>;
```

### UpdateDocument<T>

Type for updating documents (partial update without id).

```typescript
type UpdateDocument<T extends Document> = Partial<Omit<T, 'id'>>;
```

### QueryFilter<T>

Query filter for type-safe queries.

```typescript
type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};
```

### QueryValue<T>

Query value can be direct value or operator object.

```typescript
type QueryValue<T> =
  | T
  | {
      $eq?: T;
      $ne?: T;
      $gt?: T;
      $gte?: T;
      $lt?: T;
      $lte?: T;
      $in?: T[];
      $nin?: T[];
    };
```

### QueryOptions

Query options for pagination.

```typescript
interface QueryOptions {
  limit?: number;
  offset?: number;
}
```

### UpdateOptions

Update options with optimistic locking.

```typescript
interface UpdateOptions {
  etag?: string;
}
```

---

## Error Classes

### BucketDBError

Base error class for all BucketDB errors.

```typescript
class BucketDBError extends Error {
  constructor(message: string);
}
```

### DocumentNotFoundError

Document not found error.

```typescript
class DocumentNotFoundError extends BucketDBError {
  constructor(id: string);
}
```

**Example:**
```typescript
try {
  await users.findById('non-existent');
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('Document not found');
  }
}
```

### ConcurrentUpdateError

Concurrent update conflict error (ETag mismatch).

```typescript
class ConcurrentUpdateError extends BucketDBError {
  constructor(message?: string);
}
```

**Example:**
```typescript
try {
  await users.update('user-123', { age: 26 }, { etag: 'old-etag' });
} catch (error) {
  if (error instanceof ConcurrentUpdateError) {
    console.log('Concurrent update conflict, retry');
  }
}
```

### ValidationError

Validation error.

```typescript
class ValidationError extends BucketDBError {
  constructor(message: string);
}
```

### StorageError

Storage operation error.

```typescript
class StorageError extends BucketDBError {
  constructor(message: string, cause?: Error);
  readonly cause?: Error;
}
```

---

## Query Operators

### Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal (default) | `{ age: { $eq: 25 } }` or `{ age: 25 }` |
| `$ne` | Not equal | `{ status: { $ne: 'deleted' } }` |
| `$gt` | Greater than | `{ age: { $gt: 18 } }` |
| `$gte` | Greater than or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ age: { $lt: 65 } }` |
| `$lte` | Less than or equal | `{ age: { $lte: 65 } }` |

### Array Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$in` | In array | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | Not in array | `{ status: { $nin: ['deleted', 'banned'] } }` |

### Combined Operators

Multiple operators can be combined (AND logic):

```typescript
// Age between 18 and 65
await users.find({
  age: { $gte: 18, $lt: 65 },
});

// Active users aged 18+
await users.find({
  status: 'active',
  age: { $gte: 18 },
});
```

---

## Advanced Patterns

### Multi-Database Isolation

Use different `dbPath` values for isolation:

```typescript
// Multi-tenant
const tenantA = new BucketDB(adapter, 'tenant-a');
const tenantB = new BucketDB(adapter, 'tenant-b');

// Multi-environment
const dev = new BucketDB(adapter, 'dev');
const prod = new BucketDB(adapter, 'prod');
```

### Optimistic Locking Pattern

```typescript
async function updateWithRetry(id: string, updateFn: (user: User) => Partial<User>) {
  let retries = 3;

  while (retries > 0) {
    try {
      const user = await users.findById(id);
      if (!user) throw new Error('User not found');

      const updates = updateFn(user);
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

### Pagination Pattern

```typescript
async function* paginateUsers(filter: QueryFilter<User>, pageSize = 10) {
  let offset = 0;

  while (true) {
    const page = await users.find(filter, { limit: pageSize, offset });
    if (page.length === 0) break;

    yield page;
    offset += page.length;

    if (page.length < pageSize) break;
  }
}

// Usage
for await (const page of paginateUsers({ status: 'active' })) {
  console.log(`Processing ${page.length} users`);
}
```

---

## Performance Tips

### Sharding Configuration

Choose shard count based on expected collection size:

```typescript
// Small collections (< 10K documents)
const small = db.collection('config', { shardCount: 4 });

// Medium collections (10K - 100K documents)
const medium = db.collection('users', { shardCount: 16 });

// Large collections (100K+ documents)
const large = db.collection('events', { shardCount: 64 });
```

### Query Optimization

- Use specific filters to reduce scanned documents
- Leverage pagination for large result sets
- Consider field selectivity when querying

### Storage Optimization

- FileSystemAdapter: Best for development and small deployments
- MemoryStorageAdapter: Best for testing only
- S3Adapter/OSSAdapter: Best for production with high availability needs

---

## Migration Guide

### From Other Databases

BucketDB is designed for:
- **Small to medium datasets** (< 1M documents per collection)
- **Read-heavy workloads** with occasional writes
- **Schema-flexible** document storage
- **Cloud-first** deployments without infrastructure

**Not suitable for:**
- High-frequency writes (> 100 writes/sec per collection)
- Complex joins or aggregations
- Strong consistency requirements across documents
- Real-time analytics

### Version Compatibility

BucketDB follows semantic versioning:
- **v0.1.x** - MVP features, API may change
- **v1.0.0** - Stable API, production-ready
- **v2.0.0+** - Breaking changes only in major versions
