# BucketDB

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![npm downloads](https://img.shields.io/npm/dm/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system. No database servers needed.

## Status and limitations

BucketDB 0.3.x is early-stage software. Read this before storing data you care about.

- **Single writer only.** Use one writer process per collection. Multiple instances or processes writing to the same collection are not supported: WAL recovery in one instance can replay and clear another live instance's in-flight operations, and OSS conditional writes are not atomic.
  - **On OSS, one write at a time.** Concurrent writes are unsafe even from a single process: in a test on a real bucket, 20 concurrent `insert`s into a new collection all resolved but `find({})` returned only 16 (index entries silently lost), and 10 concurrent `update`s with the same `etag` all succeeded. Await each `insert` / `update` / `delete` before starting the next.
  - **On S3, FileSystem and Memory**, concurrent writes within one process are detected rather than lost, but under contention a write can reject with `StorageError` ("PreconditionFailed") after 3 index-shard attempts. A rejected `insert` / `update` may already have written the document; its WAL entry remains and may replay it into the index the next time a `Collection` is constructed.
- **The WAL provides no recovery guarantee.** It replays index entries only, never documents. A crash in the middle of a write can leave the index and the documents inconsistent — for example an index entry for a document that was never written, or a deleted document that `findById` still returns. Recovery runs in the background when a `Collection` is constructed and is not awaited.
- **OSS has no atomic conditional writes.** `OSSAdapter` emulates `ifMatch` / `ifNoneMatch` with a HEAD request followed by a PUT, so two concurrent writers — even in the same process — can both pass the check. `update` with `etag` on OSS does not prevent a concurrent overwrite, and concurrent index-shard writes can lose index entries. Use S3 if you need optimistic locking.
- **`findById` returns `null` on read failures.** It returns `null` for a missing document and currently also when the storage read fails (e.g. a network or permission error).
- **No scale benchmarks.** No document-count capacity has been measured. The cost model:
  - Each document is stored as `<dbPath>/<collection>/docs/<id>.json`.
  - A sharded index (default 16 shards, `index/shard-XX.json`) holds a full copy of every document.
  - A WAL (`wal/`) logs each write.
  - Every `insert` / `update` / `delete` rewrites one whole index shard.
  - Every `find` whose filter is not an `id` equality downloads all non-empty index shards — that is, a full copy of the collection. There is no query cache; every `find` reads storage.

**Retries:** `S3Adapter` uses the AWS SDK default retry (3 attempts), which covers 5xx, 429 (throttling) and network errors. `OSSAdapter` uses ali-oss `retryMax: 2`, which retries only network errors and timeouts — 5xx and 429 responses are **not** retried on OSS.

## Installation

```bash
bun add @hold-baby/bucket-db
# or
npm install @hold-baby/bucket-db
```

## Exports

```typescript
// Core classes
import { BucketDB, Collection } from '@hold-baby/bucket-db';

// Storage adapters
import {
  MemoryStorageAdapter,  // in-memory (testing)
  FileSystemAdapter,     // local file system (development)
  S3Adapter,             // AWS S3
  OSSAdapter,            // Alibaba Cloud OSS
} from '@hold-baby/bucket-db';

// Types
import type {
  Document,
  InsertDocument,
  UpdateDocument,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  StorageAdapter,
} from '@hold-baby/bucket-db';

// Error classes
import {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError,
} from '@hold-baby/bucket-db';
```

## Document Type

Every document stored in BucketDB has these system fields:

```typescript
interface Document {
  id: string;         // auto-generated UUID
  _etag?: string;     // version tag for optimistic locking
  _createdAt?: string; // ISO 8601 timestamp
  _updatedAt?: string; // ISO 8601 timestamp
}

// Extend Document to define your own schema
interface User extends Document {
  name: string;
  age: number;
  email: string;
}
```

`InsertDocument<T>` omits `id`, `_etag`, `_createdAt`, `_updatedAt` — pass only your fields when inserting.

`UpdateDocument<T>` is `Partial<Omit<T, 'id'>>` — all fields optional except `id` is excluded.

## Quick Start

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'my-app'
);

const users = db.collection<User>('users');

// Insert
const user = await users.insert({ name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });
// user.id, user._etag, user._createdAt are set automatically

// Find by ID
const found = await users.findById(user.id);

// Query
const activeUsers = await users.find({ status: 'active' });
const adults = await users.find({ age: { $gte: 18 } }, { limit: 10, offset: 0 });

// Update (with optimistic locking via etag — see the OSS limitation above)
const updated = await users.update(user.id, { age: 26 }, { etag: user._etag });

// Delete
await users.delete(user.id);
```

## Query Operators

```typescript
// Equality (shorthand)
await users.find({ status: 'active' });           // { status: { $eq: 'active' } }

// Comparison
await users.find({ age: { $gt: 18 } });
await users.find({ age: { $gte: 18 } });
await users.find({ age: { $lt: 65 } });
await users.find({ age: { $lte: 65 } });
await users.find({ status: { $ne: 'inactive' } });

// Array membership
await users.find({ status: { $in: ['active', 'pending'] } });
await users.find({ status: { $nin: ['banned', 'deleted'] } });

// Pagination
await users.find({}, { limit: 20, offset: 40 });
```

## Error Handling

```typescript
import {
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError,
} from '@hold-baby/bucket-db';

// findById returns null if not found (does NOT throw).
// It currently also returns null when the storage read fails.
const user = await users.findById('nonexistent-id');
if (!user) {
  // Document does not exist, or could not be read
}

try {
  await users.update(id, { age: 30 }, { etag: staleEtag });
} catch (err) {
  if (err instanceof ConcurrentUpdateError) {
    // Stale etag, or another writer changed the document during update — re-fetch and retry
  }
  if (err instanceof DocumentNotFoundError) {
    // Document does not exist
  }
}
```

| Error class | When thrown |
|---|---|
| `DocumentNotFoundError` | `update` / `delete` on a missing document (`findById` returns `null` instead) |
| `ConcurrentUpdateError` | `update` with a stale `etag`, or when another writer changes the document between `update`'s read and its write. `delete` takes no `etag` and never throws it. |
| `ValidationError` | Exported, but not thrown by the current version |
| `StorageError` | Underlying storage failure (S3, OSS, filesystem I/O), including index shard read failures other than "not found" |

### Collection names, document IDs and `dbPath`

Collection names and document IDs pass through a path sanitizer: `/` and `\` are replaced with `_`, and `..` is removed (so `a/b` is stored as `a_b`; names that sanitize to the same value share the same storage location). If the result is empty, contains characters other than letters, digits, `_`, `-` and `.`, is longer than 255 characters, or starts with `.`, a `PathValidationError` is thrown:

- Collection name: `db.collection()` throws synchronously.
- Document ID: `findById` catches the error and returns `null`; `update` / `delete` therefore treat the ID as missing and throw `DocumentNotFoundError`.

`dbPath` is not validated. BucketDB joins it with Node's `path.join`, which normalizes it (for example `./app/` becomes `app`). `FileSystemAdapter` throws `PathValidationError` for keys that contain `..` or resolve outside `basePath`.

`PathValidationError` is not exported and extends `Error`, not `BucketDBError` — `instanceof BucketDBError` does not catch it. Check `err.name === 'PathValidationError'` instead.

## Storage Adapters

### MemoryStorageAdapter (Testing)

```typescript
import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';

const db = new BucketDB(new MemoryStorageAdapter(), 'test-db');
```

### FileSystemAdapter (Development)

```typescript
import { FileSystemAdapter } from '@hold-baby/bucket-db';

const adapter = new FileSystemAdapter({ basePath: './data' });
```

### S3Adapter

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

### OSSAdapter

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

## BucketDB Options

```typescript
new BucketDB(adapter, dbPath, options?)
```

| Parameter | Type | Description |
|---|---|---|
| `adapter` | `StorageAdapter` | Storage backend |
| `dbPath` | `string` | Namespace for this database (e.g. `'my-app'`, `'tenant-123'`) |
| `options.defaultShardCount` | `number` | Default index shard count (default: `16`) |

## Collection Options

```typescript
db.collection<T>(name, options?)
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Collection name |
| `options.shardCount` | `number` | Override shard count for this collection |

## Features

- No database servers — uses S3 / OSS / local filesystem as backend
- Type-safe TypeScript API with full inference
- Optimistic locking via ETag on `update` (enforced by S3 conditional writes; emulated non-atomically on OSS)
- Sharded index (each shard holds a full copy of its documents)
- Unified API across all storage backends

## Documentation

📚 https://bucket-db.vercel.app

## License

MIT
