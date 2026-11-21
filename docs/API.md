# BucketDB API Reference

Complete API documentation for BucketDB v0.3.2.

## Table of Contents

- [Status and Limitations](#status-and-limitations)
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
- [Performance and Cost Model](#performance-and-cost-model)

---

## Status and Limitations

BucketDB 0.3.x is early-stage software. These limitations apply to the current version:

1. **Single writer only.** Use one writer process per collection. Multiple instances or processes writing to the same collection are not supported: WAL recovery in one instance can replay and clear another live instance's in-flight operations, and OSS conditional writes are not atomic.
   - **On OSS, one write at a time.** Concurrent writes are unsafe even from a single process: in a test on a real bucket, 20 concurrent `insert`s into a new collection all resolved but `find({})` returned only 16 (index entries silently lost), and 10 concurrent `update`s with the same `etag` all succeeded. Await each `insert` / `update` / `delete` before starting the next.
   - **On S3, FileSystem and Memory**, concurrent writes within one process are detected rather than lost, but under contention a write can reject with `StorageError` ("PreconditionFailed") after 3 index-shard attempts. A rejected `insert` / `update` may already have written the document; its WAL entry remains and may replay it into the index the next time a `Collection` is constructed.
2. **The WAL provides no recovery guarantee.** It replays index entries only, never documents. A crash in the middle of a write can leave the index and the documents inconsistent — for example an index entry for a document that was never written, or a deleted document that `findById` still returns. Recovery runs in the background when a `Collection` is constructed and is not awaited.
3. **OSS has no atomic conditional writes.** `OSSAdapter` emulates `ifMatch` / `ifNoneMatch` with a HEAD request followed by a PUT, so two concurrent writers — even in the same process — can both pass the check. `update` with `etag` on OSS does not prevent a concurrent overwrite, and concurrent index-shard writes can lose index entries. Use S3 if you need optimistic locking.
4. **`findById` returns `null` on read failures.** It returns `null` for a missing document and currently also when the storage read fails (e.g. a network or permission error).
5. **No scale benchmarks.** No document-count capacity has been measured. See [Performance and Cost Model](#performance-and-cost-model) for what each operation costs.

**Retries:** `S3Adapter` uses the AWS SDK default retry (3 attempts), covering 5xx, 429 (throttling) and network errors. `OSSAdapter` uses ali-oss `retryMax: 2`, which retries only network errors and timeouts; 5xx and 429 responses are not retried on OSS.

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
- `dbPath` - Database path for isolation (e.g., 'my-app', 'tenant-123'), used as the storage key prefix. It is not validated; BucketDB joins it with Node's `path.join`, which normalizes it (for example `./app/` becomes `app`). `FileSystemAdapter` throws `PathValidationError` for keys that contain `..` or resolve outside `basePath`.
- `options` - Optional configuration
  - `defaultShardCount?: number` - Default number of shards for collections (default: 16)

**Example:**
```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';

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

**Returns:** `Collection<T>` instance. Repeated calls with the same `name` on the same `BucketDB` instance return the same `Collection`.

**Throws:**
- `PathValidationError` (synchronously) - The name is invalid after sanitizing. The sanitizer replaces `/` and `\` with `_` and removes `..` (so `a/b` is stored as `a_b`; names that sanitize to the same value share the same storage location). The result must be non-empty, contain only letters, digits, `_`, `-` and `.`, be at most 255 characters, and not start with `.`. See [Error Classes](#error-classes).

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

> **Single writer only:** use one writer process per collection. On OSS, also issue one write at a time within that process (await each `insert` / `update` / `delete`); concurrent OSS writes can silently lose index entries. On S3, FileSystem and Memory, concurrent in-process writes can reject with `StorageError` ("PreconditionFailed") under contention, after the document may already have been written. See [Status and Limitations](#status-and-limitations).

Storage layout of a collection: each document is `<dbPath>/<collection>/docs/<id>.json`; a sharded index (`index/shard-XX.json`, default 16 shards) holds a full copy of every document; a WAL (`wal/`) logs each write. When a `Collection` is constructed it starts WAL recovery in the background (not awaited); recovery replays index entries only, never documents.

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

**Returns:** Document, or `null` if not found. Currently it also returns `null` when the storage read fails (e.g. a network or permission error), and when `id` is not a valid path component (see `collection()` for the rules; IDs are sanitized the same way).

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

**Cost:** A filter that is an `id` equality reads one index shard. Any other filter downloads all non-empty index shards (a full copy of every document), evaluates the filter in memory, then reads the matching documents after applying `offset` / `limit`. Results are not cached; every call reads storage.

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
  - `etag?: string` - ETag for optimistic locking. On OSS this check is not atomic and does not prevent a concurrent overwrite.

**Returns:** Updated document

**Throws:**
- `DocumentNotFoundError` - Document not found (including an `id` that is not a valid path component)
- `ConcurrentUpdateError` - `etag` is stale, or another writer changed the document between `update`'s read and its write
- `StorageError` - Underlying storage failure

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

Delete document. There is no `etag` parameter, so `delete` never throws `ConcurrentUpdateError`.

**Parameters:**
- `id` - Document ID

**Throws:**
- `DocumentNotFoundError` - Document not found (including an `id` that is not a valid path component)
- `StorageError` - Underlying storage failure

**Example:**
```typescript
await users.delete('user-123');
```

---

## Storage Adapters

All adapters implement the same `StorageAdapter` interface, but their consistency and retry behavior differ:

| Adapter | Conditional writes (`ifMatch` / `ifNoneMatch`) | Retries |
|---------|------------------------------------------------|---------|
| `MemoryStorageAdapter` | Checked in-process | None (in memory) |
| `FileSystemAdapter` | Checked in-process (read metadata, then write) | None |
| `S3Adapter` | Native S3 conditional requests | AWS SDK default: 3 attempts, covering 5xx, 429 and network errors |
| `OSSAdapter` | **Emulated, not atomic**: HEAD then PUT; two concurrent writers (even in one process) can both pass the check | ali-oss `retryMax: 2`: network errors and timeouts only; 5xx and 429 are **not** retried |

Regardless of adapter, use one writer process per collection; multi-writer access is not supported. On OSS, issue one write at a time even within that process. On the other adapters, concurrent in-process writes are detected, but under contention a write can reject with `StorageError` ("PreconditionFailed") after 3 index-shard attempts; a rejected `insert` / `update` may already have written the document, and its WAL entry may replay it into the index when a `Collection` is next constructed.

### MemoryStorageAdapter

In-memory storage adapter for testing.

#### Constructor

```typescript
new MemoryStorageAdapter()
```

**Example:**
```typescript
import { MemoryStorageAdapter } from '@hold-baby/bucket-db';

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
import { FileSystemAdapter } from '@hold-baby/bucket-db';

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
        {id}.json            # Document files
        {id}.json.meta       # ETag metadata
      index/
        shard-00.json        # Index shards (full copy of each document)
        shard-00.meta.json   # Shard metadata (document count)
        ...
      wal/
        {id}.wal.json        # Write-ahead log entries for in-flight writes
```

---

### S3Adapter

AWS S3 storage adapter. Conditional writes use native S3 conditional requests, so `update` with `etag` is enforced atomically. Requests use the AWS SDK default retry (3 attempts; 5xx, 429 and network errors).

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
import { S3Adapter } from '@hold-baby/bucket-db';

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

> **Not atomic — one write at a time:** OSS conditional writes are emulated with a HEAD request followed by a PUT, so two concurrent writers — even in the same process — can both pass the check. `update` with `etag` does not prevent a concurrent overwrite on OSS, and concurrent writes can silently lose index entries (in a test on a real bucket, 20 concurrent `insert`s into a new collection all resolved but `find({})` returned 16 documents). Await each `insert` / `update` / `delete` before starting the next. Use S3 if you need optimistic locking.
>
> **Retries:** ali-oss `retryMax: 2` retries only network errors and timeouts; 5xx and 429 responses are not retried.

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
import { OSSAdapter } from '@hold-baby/bucket-db';

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

| Error class | When thrown |
|-------------|-------------|
| `DocumentNotFoundError` | `update` / `delete` on a missing document. `findById` returns `null` instead of throwing. |
| `ConcurrentUpdateError` | `update` with a stale `etag`, or when another writer changes the document between `update`'s read and its write. `delete` has no `etag` parameter and never throws it. |
| `ValidationError` | Exported, but not thrown by the current version. |
| `StorageError` | Underlying storage failure (S3, OSS, filesystem I/O), including index shard read errors other than "not found". |

### BucketDBError

Base error class for the BucketDB errors listed above.

```typescript
class BucketDBError extends Error {
  constructor(message: string);
}
```

### DocumentNotFoundError

Thrown by `update` and `delete` when the document does not exist (this includes an `id` that is not a valid path component). `findById` does not throw it; it returns `null`.

```typescript
class DocumentNotFoundError extends BucketDBError {
  constructor(id: string);
}
```

**Example:**
```typescript
try {
  await users.delete('non-existent');
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log('Document not found');
  }
}
```

### ConcurrentUpdateError

Thrown by `update` when the supplied `etag` is stale, or when another writer modifies the document between `update`'s read and its write. `delete` never throws it.

On OSS the conditional write is emulated (HEAD then PUT) and is not atomic, so a concurrent overwrite can happen without this error being thrown — even within one process (in a test on a real bucket, 10 concurrent `update`s with the same `etag` all succeeded). On OSS, issue one write at a time.

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

Exported, but not thrown by the current version.

```typescript
class ValidationError extends BucketDBError {
  constructor(message: string);
}
```

### StorageError

Underlying storage failure (S3, OSS, filesystem I/O). Index shard read errors other than "not found" propagate as `StorageError`. `findById` does not throw it: a failed read currently returns `null`.

```typescript
class StorageError extends BucketDBError {
  constructor(message: string, cause?: Error);
  readonly cause?: Error;
}
```

### PathValidationError (not exported)

Thrown when a collection name, document ID, or storage key is not a safe path component. It is **not exported** and extends `Error`, **not** `BucketDBError`, so `instanceof BucketDBError` does not catch it; check `error.name === 'PathValidationError'`.

- **Collection names** and **document IDs** are sanitized first: `/` and `\` become `_`, and `..` is removed (so `a/b` is stored as `a_b`). The result must be non-empty, contain only letters, digits, `_`, `-` and `.`, be at most 255 characters, and not start with `.`.
- Invalid collection name: `db.collection()` throws synchronously.
- Invalid document ID: `findById` catches the error and returns `null`; `update` / `delete` throw `DocumentNotFoundError`.
- `dbPath` is not validated. BucketDB joins it with Node's `path.join`, which normalizes it (for example `./app/` becomes `app`). `FileSystemAdapter` throws `PathValidationError` for keys that contain `..` or resolve outside `basePath`.

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

On OSS the `etag` check is not atomic, so this pattern does not prevent a concurrent overwrite there. Use S3 if you rely on it.

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

## Performance and Cost Model

No scale benchmarks exist, and no document-count capacity is claimed. Estimate cost from how the storage layout works:

- Each document is stored as `<dbPath>/<collection>/docs/<id>.json`.
- A sharded index (default 16 shards, `index/shard-XX.json`) holds a **full copy of every document**, so the index is roughly as large as the collection itself.
- A WAL (`wal/`) logs each write.
- Every `insert` / `update` / `delete` writes the document (or deletes it), writes and clears a WAL entry, and **rewrites one whole index shard**. Write cost grows with shard size.
- Every `find` whose filter is not an `id` equality **downloads all non-empty index shards**, evaluates the filter in memory, then fetches the matching documents (after `offset` / `limit`). Read cost grows with collection size, regardless of how selective the filter is.
- A `find` with an `id` equality reads one shard; `findById` reads one document file.
- There is no query cache: every `find` reads storage.

### Sharding Configuration

`shardCount` (default 16) splits the index. More shards make each write rewrite a smaller shard; a non-`id` query still downloads every non-empty shard, so the total bytes read do not change. Documents are assigned to shards by hashing the ID with the configured count, so do not change `shardCount` for an existing collection.

```typescript
const events = db.collection('events', { shardCount: 64 });
```

### Query Tips

- Look up by ID (`findById` or `{ id: '...' }`) when you can; it avoids downloading the whole index.
- Use `limit` / `offset` to bound how many documents are fetched after filtering (the index is still downloaded in full).
- Cache results in your application if you query the same data repeatedly; BucketDB does not.

### Choosing an Adapter

- MemoryStorageAdapter: tests only; nothing is persisted.
- FileSystemAdapter: a single machine with local disk.
- S3Adapter: cloud storage with atomic conditional writes; use it if you rely on `etag` optimistic locking.
- OSSAdapter: cloud storage on Alibaba Cloud; conditional writes are not atomic (issue one write at a time) and 5xx / 429 responses are not retried.

All adapters require a single writer process per collection.

---

## Migration Guide

### From Other Databases

BucketDB fits:
- **Read-mostly workloads** with occasional writes from a single writer process
- **Datasets where downloading the whole index per query is acceptable** (see [Performance and Cost Model](#performance-and-cost-model))
- **Schema-flexible** document storage
- **Deployments that already use object storage** and want to avoid running a database server

**Not suitable for:**
- Multiple processes or instances writing to the same collection
- Write-heavy workloads (every write rewrites a whole index shard)
- Workloads that require crash-consistent recovery (the WAL replays index entries only)
- Complex joins or aggregations
- Strong consistency requirements across documents (no transactions)
- Real-time analytics

### Version Compatibility

BucketDB follows semantic versioning:
- **v0.x** - Early-stage; API may change between minor versions
- **v1.0.0** - Stable API
- **v2.0.0+** - Breaking changes only in major versions
