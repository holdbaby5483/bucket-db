# BucketDB API Reference

Complete API documentation for BucketDB v0.4.0. Upgrading from 0.3.x: see [MIGRATION-0.4.md](./MIGRATION-0.4.md). Related: [GUARANTEES.md](./GUARANTEES.md) (what each backend guarantees, and the tests), [STORAGE-FORMAT.md](./STORAGE-FORMAT.md) (keys and JSON written), [BENCHMARKS.md](./BENCHMARKS.md) (measured requests and latency).

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
  - [Custom adapters](#custom-adapters)
- [Type Definitions](#type-definitions)
- [Error Classes](#error-classes)
- [Query Operators](#query-operators)
- [Performance and Cost Model](#performance-and-cost-model)
  - [Query snapshot](#query-snapshot)

---

## Status and Limitations

0.4.0 stores each document as one object, `<dbPath>/<collection>/docs/<id>.json`, and makes every write a single storage request. On S3 and OSS each collection also keeps a disposable query snapshot, `<dbPath>/<collection>/_snapshot.v1.json` (see [Query snapshot](#query-snapshot)). What each backend guarantees:

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| Single write is atomic | yes | yes | yes | yes |
| Create-if-absent (`insert`) | yes | yes (across processes) | yes | yes (non-versioned buckets only) |
| Conditional update (`etag`) | yes | single process only | yes | no — `UnsupportedError` |
| Concurrent partial updates all apply | yes | single process | yes | no (last writer wins) |

Multiple writer processes are supported for `insert` and `delete` on every backend, and for `update` on S3 (on Memory and FileSystem, within one process). In a test, 4 processes each inserting 25 documents left all 100 visible on FileSystem, S3 and OSS. [GUARANTEES.md](./GUARANTEES.md) names the test behind each guarantee.

Remaining limits:

1. **No transactions.** Each write touches one document.
2. **Envelope: at most 10,000 documents and 10 MB of snapshot per collection.** Past either, queries keep working but get slower, and the collection logs one warning. Measured at 10,000 documents: a `find` takes 1.35 s on OSS, 3.2 s on S3 and about 0.5 s on FileSystem ([BENCHMARKS.md](./BENCHMARKS.md)). See [Performance and Cost Model](#performance-and-cost-model).
3. **Queries list the whole collection.** `find` filters in memory; `limit` and `offset` do not reduce reads. Only a `{ id: '...' }` filter reads a single document.
4. **Results are not a point-in-time snapshot.** Every returned document is a version that was committed, but documents written while a query runs may or may not be included.
5. **The snapshot holds document contents.** A deleted document's contents remain in the snapshot until it is rewritten or [`compact()`](#compact-promisevoid) runs.
6. **OSS has no conditional update.** `update` with `etag` throws `UnsupportedError`; concurrent `update`s without `etag` are last-writer-wins.
7. **FileSystem conditional updates are single-process.** `etag` checks and the merging of concurrent `update`s hold only among writers in one process.
8. **0.3.x and 0.4 must not write the same collection concurrently.** 0.3 reads only its own index and does not see 0.4 writes.

---

## Core Classes

### BucketDB

Entry point: a storage backend plus a key prefix.

#### Constructor

```typescript
new BucketDB(adapter: StorageAdapter, dbPath: string, options?: BucketDBOptions)

interface BucketDBOptions {
  /** Receives snapshot write failures and envelope warnings. Default: console.warn. */
  logger?: Logger;
}
```

**Parameters:**
- `adapter` - Storage adapter instance (`MemoryStorageAdapter`, `FileSystemAdapter`, `S3Adapter`, `OSSAdapter`, or your own `StorageAdapter`)
- `dbPath` - Key prefix for this database (e.g. `'my-app'`, `'tenants/123'`). Each `/`-separated segment must be 1–255 letters, digits, `_`, `-` or `.`, not starting with `.`. `''` stores collections at the bucket root.
- `options.logger` - Receives problems that do not fail the current call (`LogEvent`, see Type Definitions): a snapshot that could not be written (`error`), a snapshot that could not be parsed and is being rebuilt (`warn`), a collection past the envelope (`warn`, once per collection). Default: writes `[bucket-db] <message>` to `console.warn`. Passed to every collection of this `BucketDB`.

**Throws:**
- `ValidationError` (synchronously) - `dbPath` is invalid

**Example:**
```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db';

const db = new BucketDB(new FileSystemAdapter({ basePath: './data' }), 'my-app');

// Route BucketDB's warnings into your own logger
const logged = new BucketDB(adapter, 'my-app', {
  logger: ({ level, message, error }) => myLogger[level](message, error),
});
```

#### Methods

##### `collection<T extends Document>(name: string): Collection<T>`

Get a collection with type-safe operations. Nothing is written until the first `insert`.

**Parameters:**
- `name` - Collection name: 1–255 letters, digits, `_`, `-` or `.`, not starting with `.`

**Returns:** `Collection<T>` instance. Repeated calls with the same `name` on the same `BucketDB` instance return the same `Collection`.

**Throws:**
- `ValidationError` (synchronously) - The name is invalid. Names are never rewritten.

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

Type-safe collection for CRUD operations. Each document is stored as `<dbPath>/<collection>/docs/<id>.json`; the body is the document without `_etag`. On read, `id` comes from the object key and `_etag` from the storage service, whatever the body says, so a JSON object file placed at `docs/<id>.json` by other means is a document too. On remote backends (S3, OSS, custom adapters with `remote: true`) the collection also keeps a query snapshot, `<dbPath>/<collection>/_snapshot.v1.json`. The full format is in [STORAGE-FORMAT.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/STORAGE-FORMAT.md).

Document IDs passed to `findById`, `update` and `delete` follow the same rules as collection names; an invalid ID rejects with `ValidationError`.

Get collections through `db.collection(name)`. The class is also exported; its constructor is `new Collection<T>(adapter, dbPath, name, options?: CollectionOptions)` with `CollectionOptions = { logger?: Logger }`, the same option `BucketDB` passes on.

#### Methods

##### `insert(data: InsertDocument<T>): Promise<T>`

Insert a new document with a generated UUID. One conditional PUT (create-if-absent).

**Parameters:**
- `data` - Document data. `id`, `_etag`, `_createdAt` and `_updatedAt` are excluded by the type and dropped at runtime.

**Returns:** Complete document with system fields

**Example:**
```typescript
const user = await users.insert({
  name: 'Alice',
  email: 'alice@example.com',
});
// Returns: { id: '...', name: 'Alice', email: '...', _createdAt: '...', _updatedAt: '...', _etag: '...' }
```

##### `findById(id: string): Promise<T | null>`

Find a document by ID. One GET.

**Parameters:**
- `id` - Document ID

**Returns:** The document, or `null` if it does not exist.

**Throws:**
- `ValidationError` - `id` is invalid
- `StorageError` - Any other storage failure (network, permissions, a body that is not a JSON object)

**Example:**
```typescript
const user = await users.findById('user-123');
if (user) {
  console.log(user.name);
}
```

##### `find(filter?: QueryFilter<T>, options?: QueryOptions): Promise<T[]>`

Query documents with a filter.

**Parameters:**
- `filter` - Query filter object (default `{}`, all documents)
- `options` - Query options
  - `limit?: number` - Maximum number of results
  - `offset?: number` - Number of matching results to skip

**Returns:** Array of matching documents in key order, which is document-ID order (not insertion order). `offset` / `limit` apply after filtering.

**Cost:** A filter whose `id` is a plain string (`{ id: '...' }`) reads that one document (1 GET). Any other filter lists `docs/` (one LIST per 1000 documents) and filters in memory; how document bodies are read depends on the backend:

- **S3 / OSS** (`remote: true`): one GET of the snapshot; each listed document whose etag matches its snapshot entry is taken from the snapshot, every other one is read with a GET (16 in parallel). When more than 16 documents had to be read individually, counting snapshot entries of deleted documents too, the query rewrites the snapshot with one PUT. A warm query is therefore ⌈N/1000⌉ LIST + 1 GET.
- **Memory / FileSystem**: every document is read (16 GETs in parallel). No snapshot.

The list is the authority: the snapshot never adds, removes or changes a document in the result, whether it is missing, corrupt, stale, from another format version or overwritten by a concurrent writer. Every returned document is a committed version, but the result is not a point-in-time snapshot of the collection. There is no result cache. Measured latencies: [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md).

**Throws:**
- `ValidationError` - Malformed filter: unknown operator, non-array `$in` / `$nin` operand, reserved field name (`constructor`, `__proto__`, `prototype`, `toString`, …), or a comparison between different types
- `StorageError` - Storage failure, or a file under `docs/` that is not `<id>.json` holding a JSON object (`error.key` names it). Files whose name starts with `.` are ignored; a document deleted between the LIST and its GET is skipped. On S3 / OSS, failing to *read* the snapshot for any reason other than its absence (a transient error, a permission error) also throws; the query does not fall back to reading every document. Failing to *write* the snapshot does not throw: it is reported to the logger (level `error`), and after a 401 / 403 the collection stops writing it.

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

Merge `data` into the stored document. GET, then a conditional PUT. `_updatedAt` is set to the current time; `id`, `_etag`, `_createdAt` and `_updatedAt` in `data` are excluded by the type and dropped at runtime.

**Parameters:**
- `id` - Document ID
- `data` - Fields to change
- `options` - Update options
  - `etag?: string` - Only update if the document still has this etag (optimistic locking)

**Behaviour:**
- **With `etag`**: throws `ConcurrentUpdateError` if the stored etag differs, or if another writer changes the document before the PUT lands. No retry.
- **Without `etag`**, on backends with compare-and-swap (Memory, FileSystem within one process, S3): a PUT that collides with another writer re-reads the document and retries, up to 5 retries with jittered backoff, so concurrent partial updates all apply. After that it throws `ConcurrentUpdateError`.
- **Without `etag` on OSS**: plain PUT; the last writer wins.

**Returns:** Updated document

**Throws:**
- `DocumentNotFoundError` - Document does not exist
- `ConcurrentUpdateError` - `etag` is stale, the write lost a race, or retries were exhausted
- `UnsupportedError` - `etag` was given and the backend cannot enforce it (OSS); no request is sent
- `ValidationError` - `id` is invalid
- `StorageError` - Other storage failure

**Example:**
```typescript
// Simple update
const updated = await users.update('user-123', { age: 26 });

// With optimistic locking
const user = await users.findById('user-123');
if (user) {
  await users.update('user-123', { age: user.age + 1 }, { etag: user._etag });
}
```

##### `delete(id: string): Promise<void>`

Delete a document. One DELETE. Deleting a document that does not exist is not an error.

**Parameters:**
- `id` - Document ID

**Throws:**
- `ValidationError` - `id` is invalid
- `StorageError` - Storage failure

**Example:**
```typescript
await users.delete('user-123');
```

##### `compact(): Promise<void>`

Rebuild the query snapshot from the documents as they are now. On S3 / OSS: lists `docs/`, GETs every document (16 in parallel) and writes the snapshot with one PUT. No-op on Memory and FileSystem, which keep no snapshot.

A query only rewrites the snapshot when more than 16 entries are out of date, so the contents of a few deleted documents can stay in it indefinitely. Call `compact()` after deleting data that must not linger, or to warm the snapshot ahead of the first query.

**Throws:**
- `StorageError` - Storage failure, including a failed snapshot write (unlike `find`, which only logs it), or a file under `docs/` that is not `<id>.json` holding a JSON object

**Example:**
```typescript
await users.delete('user-123');
await users.compact(); // user-123's contents are gone from _snapshot.v1.json
```

---

## Storage Adapters

All adapters implement the `StorageAdapter` interface. They declare which write conditions they can enforce through `capabilities`, which decides what `Collection` can guarantee, and whether they are `remote`, which decides whether queries keep a snapshot:

| Adapter | `createIfAbsent` | `compareAndSwap` | `remote` (query snapshot) | Retries |
|---------|------------------|------------------|---------------------------|---------|
| `MemoryStorageAdapter` | `atomic` | `atomic` | no | none needed |
| `FileSystemAdapter` | `atomic` (`link()`, across processes) | `single-process` | no | none |
| `S3Adapter` | `atomic` | `atomic` | yes | 3 attempts |
| `OSSAdapter` | `atomic` (`x-oss-forbid-overwrite`; not enforced on versioned buckets) | `none` | yes | 3 attempts |

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| Single write is atomic | yes | yes | yes | yes |
| Create-if-absent (`insert`) | yes | yes (across processes) | yes | yes (non-versioned buckets only) |
| Conditional update (`etag`) | yes | single process only | yes | no — `UnsupportedError` |
| Concurrent partial updates all apply | yes | single process | yes | no (last writer wins) |

**Retries (`S3Adapter`, `OSSAdapter`):** up to 3 attempts per request with full-jitter exponential backoff, on network errors, timeouts (`timeoutMs` per attempt, default 10 s), 500 / 502 / 503 / 504, 429, `SlowDown` and `RequestTimeout`. Other 4xx responses are not retried and become `StorageError` with `kind: 'permanent'`; a retryable failure that persists becomes `kind: 'transient'`. If a conditional write receives a conflict after a transient failure, the adapter reads the object back and compares the bytes, so an earlier attempt that actually succeeded is not reported as a conflict.

### MemoryStorageAdapter

In-process storage for tests and local development. Nothing is persisted.

#### Constructor

```typescript
new MemoryStorageAdapter()
```

**Example:**
```typescript
import { MemoryStorageAdapter } from '@hold-baby/bucket-db';

const adapter = new MemoryStorageAdapter();
```

---

### FileSystemAdapter

Stores each object as a file under `basePath`.

#### Constructor

```typescript
new FileSystemAdapter(config: FileSystemAdapterConfig)

interface FileSystemAdapterConfig {
  basePath: string; // created on first write
}
```

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
        {id}.json            # One file per document
```

Every write first goes to a temporary file (`{id}.json.<uuid>.tmp`), which is then linked into place (create, atomic across processes) or renamed over the old file (replace). Readers never see a partial file. The etag is derived from the file's inode, modification time and size. `etag` checks are serialized by a lock inside the process, so they hold only among writers in one process. Temporary files and 0.3's `*.meta` files are never treated as documents.

See [FileSystemAdapter.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/FileSystemAdapter.md) for details.

---

### S3Adapter

Amazon S3, or any service speaking the S3 protocol (MinIO, Cloudflare R2, …). Only AWS S3 and Alibaba Cloud OSS are tested. Uses a built-in client (SigV4 signing); no AWS SDK.

#### Constructor

```typescript
new S3Adapter(options: S3AdapterOptions)

interface S3AdapterOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials?: Credentials | CredentialProvider;
  forcePathStyle?: boolean;
  timeoutMs?: number;
}
```

**Parameters:**
- `bucket` - Bucket name (required)
- `region?` - Default: `AWS_REGION`, then `AWS_DEFAULT_REGION`. Missing region throws `ValidationError`.
- `endpoint?` - Default: `AWS_ENDPOINT_URL_S3`, then `AWS_ENDPOINT_URL`, then `https://s3.<region>.amazonaws.com`
- `credentials?` - Default: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. See [Credentials](#credentials).
- `forcePathStyle?` - Default: `true` when the endpoint host is an IP address or `localhost`, otherwise virtual-hosted-style
- `timeoutMs?` - Per-attempt timeout; default `10000`

**Example:**
```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

// Everything from the environment
const adapter = new S3Adapter({ bucket: 'my-bucket' });

// Explicit
const minio = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  endpoint: 'http://localhost:9000', // path-style chosen automatically
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
});
```

---

### OSSAdapter

Alibaba Cloud OSS through its S3-compatible endpoint. Uses the same built-in client as `S3Adapter`; no OSS SDK.

> **No conditional update.** OSS does not support `If-Match` writes, so `capabilities.compareAndSwap` is `'none'`: `update` with `etag` throws `UnsupportedError` without sending a request, and concurrent `update`s without `etag` are last-writer-wins. `insert` uses `x-oss-forbid-overwrite`, which OSS does not enforce on versioned buckets.

#### Constructor

```typescript
new OSSAdapter(options: OSSAdapterOptions)

interface OSSAdapterOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials?: Credentials | CredentialProvider;
  timeoutMs?: number;
}
```

**Parameters:**
- `bucket` - Bucket name (required)
- `region?` - e.g. `'cn-hangzhou'` (the 0.3 form `'oss-cn-hangzhou'` is also accepted). Default: `OSS_REGION`. Missing region throws `ValidationError`.
- `endpoint?` - S3-compatible endpoint. Default: `https://s3.oss-<region>.aliyuncs.com`. `OSS_ENDPOINT` is not read.
- `credentials?` - Default: `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN`. See [Credentials](#credentials).
- `timeoutMs?` - Per-attempt timeout; default `10000`

New OSS users in mainland China may have to access buckets through a custom domain, passed as `endpoint`. S3-compatible access through a custom domain has not been verified.

**Example:**
```typescript
import { OSSAdapter } from '@hold-baby/bucket-db';

// Region and credentials from OSS_* environment variables
const adapter = new OSSAdapter({ bucket: 'my-bucket' });

// Explicit
const explicit = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou',
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET!,
  },
});
```

---

### Credentials

`S3Adapter` and `OSSAdapter` accept credentials as an object or as an async function:

```typescript
interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** When a provider returns this, the provider is called again 5 minutes before it. */
  expiresAt?: Date;
}

type CredentialProvider = () => Promise<Credentials>;
```

A provider's result is cached and requested again 5 minutes before `expiresAt`; without `expiresAt` it is called once. A failed call is not cached; the next request calls the provider again. When the option is omitted, credentials are read from the environment on the first request, and missing variables throw `ValidationError` then.

```typescript
const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const sts = await assumeRole(); // your code
    return {
      accessKeyId: sts.accessKeyId,
      secretAccessKey: sts.secretAccessKey,
      sessionToken: sts.sessionToken,
      expiresAt: new Date(sts.expiration),
    };
  },
});
```

---

### Custom adapters

Implement `StorageAdapter` to use another backend. Keys use `/` as separator; bodies are bytes.

```typescript
type Guarantee = 'atomic' | 'single-process' | 'none';

interface Capabilities {
  readonly createIfAbsent: Guarantee; // put(key, body, { ifNoneMatch: '*' })
  readonly compareAndSwap: Guarantee; // put(key, body, { ifMatch })
}

type WriteCondition = { ifNoneMatch: '*' } | { ifMatch: string };

interface ObjectEntry {
  key: string;
  etag: string; // unquoted; equals the etag get / put report for the same version
}

interface ListPage {
  entries: ObjectEntry[]; // lexicographic key order
  cursor?: string;        // present when another page follows
}

interface ListOptions {
  cursor?: string;
  limit?: number; // default and maximum 1000
}

interface StorageAdapter {
  readonly capabilities: Capabilities;
  /** True when every read is a network round trip; Collection then keeps a query snapshot. */
  readonly remote?: boolean;
  get(key: string): Promise<{ body: Uint8Array; etag: string }>;
  put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  list(prefix: string, options?: ListOptions): Promise<ListPage>;
}
```

Error contract (`StorageError` with `kind`):

- `get` of a missing key: `not-found`
- `put` whose condition fails: `conflict`; `ifMatch` on a missing key: `not-found`
- `put` with a condition whose capability is `'none'`: throw `UnsupportedError` without a request
- `delete` of a missing key: no error
- a retryable failure that persisted: `transient`; anything else: `permanent`

`Collection` uses `{ ifNoneMatch: '*' }` for `insert` unless `createIfAbsent` is `'none'`, and `{ ifMatch }` for `update` unless `compareAndSwap` is `'none'`. `MemoryStorageAdapter` (`packages/core/src/storage/memory.ts`) is a complete reference implementation in about 50 lines.

**`remote`:** set `readonly remote = true` when each request is a network round trip (as `S3Adapter` and `OSSAdapter` do). `find` then keeps `<dbPath>/<collection>/_snapshot.v1.json` and GETs only the documents whose listed etag differs from the snapshot's, and `compact()` rebuilds it. This relies on the etag contract above: `list` must report, for every key, the same etag `get` returns for the current version, and must reflect completed writes and deletes immediately. Leave `remote` unset (or `false`) for local backends; every `find` then reads every document and `compact()` does nothing.

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

All collection documents must extend this interface. `id` comes from the object key and `_etag` from the storage service; neither is stored in the document body.

### InsertDocument<T>

Type for inserting new documents (omits system fields).

```typescript
type InsertDocument<T extends Document> = Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>;
```

### UpdateDocument<T>

Type for updating documents: a partial document without system fields.

```typescript
type UpdateDocument<T extends Document> = Partial<Omit<T, 'id' | '_etag' | '_createdAt' | '_updatedAt'>>;
```

### QueryFilter<T>

Query filter for type-safe queries.

```typescript
type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};
```

### QueryValue<T>

Query value can be a direct value or an operator object.

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

### QueryOperator

```typescript
type QueryOperator = '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte' | '$in' | '$nin';
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
  /** Only update if the document still has this etag. */
  etag?: string;
}
```

### BucketDBOptions / CollectionOptions

```typescript
interface BucketDBOptions {
  /** Receives snapshot write failures and envelope warnings. Default: console.warn. */
  logger?: Logger;
}

interface CollectionOptions {
  logger?: Logger;
}
```

`BucketDBOptions` is the third argument of `new BucketDB`; `BucketDB` passes its `logger` to every collection as `CollectionOptions`.

### Logger / LogEvent

Receives problems that do not fail the current call.

```typescript
interface LogEvent {
  level: 'warn' | 'error';
  message: string;
  error?: unknown;
}

type Logger = (event: LogEvent) => void;
```

| Event | `level` |
|---|---|
| A query could not write the snapshot (`error` holds the `StorageError`). After a 401 / 403 the collection stops trying. | `error` |
| The snapshot is not valid JSON or not a version-1 snapshot; it is rebuilt | `warn` |
| The collection is past the envelope (more than 10,000 documents, or a snapshot over 10 MB); logged once per `Collection` instance. Local backends check the document count only. | `warn` |

The default logger writes `[bucket-db] <message>` (and `error`, if any) to `console.warn`.

### Adapter types

`FileSystemAdapterConfig`, `S3AdapterOptions`, `OSSAdapterOptions`, `Credentials` and `CredentialProvider` are described with the storage adapters. `StorageAdapter`, `Capabilities`, `Guarantee`, `WriteCondition`, `ObjectEntry`, `ListPage` and `ListOptions` are described under "Custom adapters" in the storage adapters section.

---

## Error Classes

| Error class | When thrown |
|-------------|-------------|
| `ValidationError` | Invalid collection name, document ID, `dbPath` or filter; invalid adapter options (missing bucket or region, bad endpoint); missing credentials. |
| `DocumentNotFoundError` | `update` on a missing document. `findById` returns `null` and `delete` succeeds instead. |
| `ConcurrentUpdateError` | `update` with a stale `etag`, a write that lost a race while an `etag` was given, or an `update` without `etag` that still conflicted after 5 retries. |
| `UnsupportedError` | The operation needs a capability the backend lacks: `update` with `etag` on OSS. |
| `StorageError` | Storage failure. `kind`, `key` and `status` describe it. |

### BucketDBError

Base class of every error BucketDB throws.

```typescript
class BucketDBError extends Error {
  constructor(message: string, options?: { cause?: unknown });
}
```

### ValidationError

Invalid input. Collection names, document IDs and `dbPath` segments must be 1–255 letters, digits, `_`, `-` or `.`, not starting with `.`; they are rejected, never rewritten. Malformed filters (unknown operators, non-array `$in` / `$nin` operands, reserved field names such as `constructor` or `__proto__`, comparison of different types) are rejected too.

```typescript
class ValidationError extends BucketDBError {}
```

**Example:**
```typescript
try {
  db.collection('users/archive');
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.message);
  }
}
```

### DocumentNotFoundError

Thrown by `update` when the document does not exist.

```typescript
class DocumentNotFoundError extends BucketDBError {
  constructor(id: string);
}
```

### ConcurrentUpdateError

Thrown by `update` when the supplied `etag` is stale, when another writer changes the document between the read and the conditional write while an `etag` was given, or when an `update` without `etag` keeps conflicting after 5 retries.

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
    console.log('Document changed; re-read and retry');
  }
}
```

### UnsupportedError

The operation needs a capability the storage backend does not provide. In 0.4.0 this is `update` with `etag` on `OSSAdapter`.

```typescript
class UnsupportedError extends BucketDBError {}
```

### StorageError

A storage backend failure.

```typescript
type StorageErrorKind = 'not-found' | 'conflict' | 'transient' | 'permanent';

interface StorageErrorOptions {
  kind?: StorageErrorKind; // default 'permanent'
  key?: string;
  status?: number;         // HTTP status, for HTTP backends
  cause?: unknown;
}

class StorageError extends BucketDBError {
  readonly kind: StorageErrorKind;
  readonly key?: string;
  readonly status?: number;
  constructor(message: string, options?: StorageErrorOptions);
}
```

- `not-found`: the object does not exist
- `conflict`: a write condition (`ifNoneMatch` / `ifMatch`) was not met
- `transient`: a retryable failure that persisted after retries
- `permanent`: anything else (permissions, malformed data, …)

`findById` turns `not-found` into `null`; every other `StorageError` propagates. `find` also throws `StorageError` (with `key`) for a file under `docs/` that is not `<id>.json` holding a JSON object, and, on S3 / OSS, when reading the query snapshot fails for a reason other than `not-found`. A failed snapshot write is not thrown by `find` (it goes to the logger), but is thrown by `compact()`.

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

`$gt` / `$gte` / `$lt` / `$lte` compare numbers or strings; comparing values of different types throws `ValidationError`.

### Array Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$in` | In array | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | Not in array | `{ status: { $nin: ['deleted', 'banned'] } }` |

The operand must be an array. `$in: []` matches nothing; `$nin: []` matches every document that has the field.

### Combined Operators

Multiple operators and fields are combined with AND. A document without the field never matches a condition on it.

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
const tenantA = new BucketDB(adapter, 'tenants/a');
const tenantB = new BucketDB(adapter, 'tenants/b');

// Multi-environment
const dev = new BucketDB(adapter, 'dev');
const prod = new BucketDB(adapter, 'prod');
```

### Optimistic Locking Pattern

For a read-modify-write where the new value depends on the old one, pass the `etag` and retry on conflict. Not available on OSS (`UnsupportedError`); on FileSystem it protects only against writers in the same process.

```typescript
async function updateWithRetry(id: string, updateFn: (user: User) => UpdateDocument<User>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await users.findById(id);
    if (!user) throw new DocumentNotFoundError(id);
    try {
      return await users.update(id, updateFn(user), { etag: user._etag });
    } catch (error) {
      if (!(error instanceof ConcurrentUpdateError)) throw error;
    }
  }
  throw new ConcurrentUpdateError(`Gave up updating ${id}`);
}
```

Partial updates that do not depend on the current value need no `etag`: without it, `update` already retries conflicting writes on Memory, FileSystem (one process) and S3.

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
```

Every page lists the whole collection again (and on Memory / FileSystem reads every document again); if you need every page, one `find` without `limit` is cheaper.

---

## Performance and Cost Model

Requests per operation (N = documents in the collection):

| Operation | Requests |
|---|---|
| `insert` | 1 conditional PUT |
| `findById` | 1 GET |
| `find({ id: '...' })` | 1 GET |
| `find(filter)`, S3 / OSS, snapshot current | ⌈N / 1000⌉ LIST + 1 GET |
| `find(filter)`, S3 / OSS, k documents new or changed since the snapshot | ⌈N / 1000⌉ LIST + 1 GET + k GET (16 in parallel); if k plus the snapshot entries of deleted documents exceeds 16, also 1 PUT rewriting the snapshot |
| `find(filter)`, S3 / OSS, no usable snapshot | ⌈N / 1000⌉ LIST + 1 GET + N GET + 1 PUT (when N > 16) |
| `find(filter)`, Memory / FileSystem | ⌈N / 1000⌉ LIST + N GET, 16 in parallel |
| `update` | 1 GET + 1 PUT (conditional where supported); a conflict without `etag` repeats both, up to 5 more times |
| `delete` | 1 DELETE |
| `compact()` | S3 / OSS: ⌈N / 1000⌉ LIST + N GET + 1 PUT; Memory / FileSystem: none |

Measured with `packages/core/bench/run.ts`, documents of about 450 bytes, from a client about 45 ms from the OSS bucket and 200 ms from the S3 bucket (`ap-southeast-2`). Full tables and method: [BENCHMARKS.md](./BENCHMARKS.md).

| Documents | `find`, OSS | `find`, S3 | `find`, FileSystem | `find` without snapshot, OSS | `find` without snapshot, S3 | Snapshot size |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0.11 s | 0.45 s | 5 ms | 0.55 s | 2.2 s | 55 kB |
| 1,000 | 0.27 s | 1.0 s | ~40 ms | 3.5 s | 14 s | 524 kB |
| 10,000 | 1.35 s | 3.2 s | ~0.5 s | 34 s | 134 s | 5.2 MB |

- Remote query latency is about one round trip per 1,000 documents listed plus the snapshot download. The filter, `limit` and `offset` do not change it.
- Writes and `findById` are one request each (`update` two), so their latency is one or two round trips at any collection size.
- There is no result cache: every `find` lists storage first.

**Envelope.** BucketDB is designed for at most 10,000 documents and a 10 MB snapshot per collection, and a few writes per second. Past either limit, queries keep working but keep getting slower, and the collection logs one `warn` through the logger (once per `Collection` instance; local backends check the document count only).

### Query snapshot

On remote backends (`S3Adapter`, `OSSAdapter`, custom adapters with `remote: true`) each collection keeps `<dbPath>/<collection>/_snapshot.v1.json`, a copy of every document body with the etag it had. Format and reader rules: [STORAGE-FORMAT.md](./STORAGE-FORMAT.md).

- **The list is the authority.** A snapshot entry is used only if its etag equals the one LIST reports; entries of deleted documents and unknown IDs are ignored. A missing, corrupt, stale, foreign-version or concurrently overwritten snapshot changes only how many GETs a query makes, never its result.
- **Rebuilt, not trusted.** A missing or unparsable snapshot is rebuilt by the next query (an unparsable one is logged as `warn`). A transient or permission error while reading it fails the query instead of silently reading every document.
- **Rewrite threshold: 16.** Up to 16 changed documents cost one extra parallel round of GETs per query and leave the snapshot alone. Beyond that the query rewrites it (one unconditional PUT) and the next query is back to ⌈N / 1000⌉ LIST + 1 GET.
- **Write failures cost only speed.** A failed snapshot write is logged (`error`) and the query still returns. After a 401 / 403, for example with read-only credentials, the collection stops trying.
- **Consistency.** Every returned document is a committed version, but the result set is not a point-in-time snapshot of the collection: documents written while the query runs may or may not appear.
- **Deleted contents linger.** A deleted document's body stays in the snapshot until the snapshot is rewritten. Call `compact()` to remove it right away, for example after deleting personal data.
- **Lifecycle rules work as a TTL.** Objects that a bucket lifecycle rule expires under `docs/` disappear from LIST, and therefore from results.

### Choosing an Adapter

- `MemoryStorageAdapter`: tests only; nothing is persisted.
- `FileSystemAdapter`: one machine with a local disk. Inserts and deletes from several processes are safe; `etag` updates only within one process.
- `S3Adapter`: cloud storage with every guarantee in the table, including `etag` optimistic locking across processes.
- `OSSAdapter`: Alibaba Cloud OSS; no conditional update.

---

## Migration Guide

### From 0.3.x

See [MIGRATION-0.4.md](./MIGRATION-0.4.md). Data written by 0.3 is read as-is; the API changes are listed there with before/after code.

### From Other Databases

BucketDB fits:
- **Small collections** (up to 10,000 documents and 10 MB per collection; see [Performance and Cost Model](#performance-and-cost-model))
- **Low write rates** (a few writes per second)
- **Schema-flexible** document storage
- **Deployments that already use object storage** and want to avoid running a database server

**Not suitable for:**
- Large collections or selective queries over many documents (there are no indexes; every query lists the whole collection)
- Write-heavy workloads
- Multi-document transactions or strong consistency across documents
- Complex joins or aggregations
- Real-time analytics

### Version Compatibility

BucketDB follows semantic versioning:
- **v0.x** - Early-stage; API may change between minor versions
- **v1.0.0** - Stable API
- **v2.0.0+** - Breaking changes only in major versions
