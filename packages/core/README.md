# BucketDB

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![npm downloads](https://img.shields.io/npm/dm/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system. No database servers needed.

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
  S3Adapter,             // AWS S3 (production)
  OSSAdapter,            // Alibaba Cloud OSS (production)
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

// Update (with optimistic locking via etag)
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

try {
  const user = await users.findById('nonexistent-id');
} catch (err) {
  if (err instanceof DocumentNotFoundError) {
    // Document does not exist
  }
}

try {
  await users.update(id, { age: 30 }, { etag: staleEtag });
} catch (err) {
  if (err instanceof ConcurrentUpdateError) {
    // Another write happened — re-fetch and retry
  }
}
```

| Error class | When thrown |
|---|---|
| `DocumentNotFoundError` | `findById` or `update`/`delete` on a missing document |
| `ConcurrentUpdateError` | `update`/`delete` with a stale `etag` |
| `ValidationError` | Invalid input (e.g. missing required fields) |
| `StorageError` | Underlying storage failure (S3, OSS, filesystem I/O) |

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

### S3Adapter (Production)

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

### OSSAdapter (Production)

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
- Optimistic locking via ETag
- Sharded index design for scale
- Unified API across all storage backends

## Documentation

📚 https://bucket-db.vercel.app

## License

MIT
