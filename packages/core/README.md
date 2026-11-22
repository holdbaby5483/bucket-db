# BucketDB

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![npm downloads](https://img.shields.io/npm/dm/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system. No database servers needed.

Each document is one JSON object in your bucket: `<dbPath>/<collection>/docs/<id>.json`. There is no index and no log; every write is a single storage request. On S3 and OSS, queries also keep a disposable snapshot, `<dbPath>/<collection>/_snapshot.v1.json`, so a query does not download every document ([storage format](https://github.com/holdbaby5483/bucket-db/blob/main/docs/STORAGE-FORMAT.md)).

> **0.6.0** is the last breaking release before 1.0 and settles the public types: `Collection` is a type only (get collections from `db.collection(name)`), returned documents are `Stored<T>` with `_etag` always set, `sort` keys are type-checked, and Node.js 22 is the minimum. Storage format, CLI and runtime behaviour are unchanged. Upgrading from 0.5? Read [MIGRATION-0.6.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.6.md); from 0.4, [MIGRATION-0.5.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md) first; from 0.3.x, [MIGRATION-0.4.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.4.md) before that.

## Status and limitations

What each backend guarantees:

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| Single write is atomic | yes | yes | yes | yes |
| Create-if-absent (`insert`) | yes | yes (across processes) | yes | yes (non-versioned buckets only) |
| Conditional update (`etag`) | yes | single process only | yes | no — `UnsupportedError` |
| Concurrent partial updates all apply | yes | single process | yes | no (last writer wins) |

Multiple writer processes are supported for `insert` and `delete` on every backend, and for `update` on S3 (on Memory and FileSystem, within one process). In a test, 4 processes each inserting 25 documents left all 100 visible on FileSystem, S3 and OSS. [Guarantees and limits](https://github.com/holdbaby5483/bucket-db/blob/main/docs/GUARANTEES.md) names the test behind each row.

Remaining limits:

- **No transactions.** Each write touches one document. `deleteMany` deletes its matches one by one and is not atomic.
- **Envelope: at most 10,000 documents and 10 MB of snapshot per collection.** Past either, queries keep working but get slower, and the collection logs one warning. At 10,000 documents a `find` takes about 1.35 s on OSS and 3.2 s on S3, and about 0.5 s on a local FileSystem ([benchmarks](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md)). BucketDB is meant for small collections and a few writes per second.
- **Queries list the whole collection.** `find` lists every document key, then filters, sorts and pages in memory; `sort`, `limit` and `offset` do not reduce reads. On S3 / OSS document bodies come from the snapshot, plus a GET for each document changed since it was written; Memory and FileSystem read every file. Only a `{ id: '...' }` filter reads a single document, and only `count()` without a filter reads no documents.
- **Results are not a point-in-time snapshot.** Every returned document is a version that was committed, but documents written while a query runs may or may not be included.
- **The snapshot holds document contents.** A deleted document's contents stay in `_snapshot.v1.json` until the snapshot is rewritten or `compact()` runs. Call `compact()` after deleting privacy-sensitive data.
- **OSS has no conditional update.** `update` with `etag` throws `UnsupportedError`; concurrent `update`s without `etag` are last-writer-wins.
- **FileSystem conditional updates are single-process.** `etag` checks and the merging of concurrent `update`s hold only among writers in one process.
- **0.3.x and 0.4 or later must not write the same collection at the same time.** 0.3 reads only its own index and does not see later writes.

## Installation

```bash
bun add @hold-baby/bucket-db
# or
npm install @hold-baby/bucket-db
```

Requires Node.js >= 22 or Bun. No runtime dependencies: the S3 / OSS client is built in.

## Command line

The package includes `bucket-db`, for shells and CI jobs:

```bash
export BUCKET_DB_URL='s3://my-bucket/ci-data?region=us-east-1'   # credentials from AWS_* variables

npx @hold-baby/bucket-db doctor                                         # check what the bucket guarantees
echo '{"ms":1234,"ok":true}' | npx @hold-baby/bucket-db put runs run-42 # create or replace
npx @hold-baby/bucket-db get runs run-42 | jq .ms
npx @hold-baby/bucket-db find runs '{"ok":true}' --sort ms:desc --limit 5
npx @hold-baby/bucket-db count runs
npx @hold-baby/bucket-db export runs > runs.jsonl                       # backup; `import` restores
```

Commands: `get`, `put`, `find` (`--sort field[:desc]`, `--limit`, `--offset`), `count`, `delete`, `export`, `import`, `compact`, `doctor`. stdout is one JSON value per line, errors go to stderr; exit code 0 on success, 1 on error, 2 when `get` finds nothing. Full reference: [CLI.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/CLI.md). Recipes for keeping CI data in a bucket with OIDC credentials: [examples/ci](https://github.com/holdbaby5483/bucket-db/tree/main/examples/ci).

## Connection URLs

`BucketDB.connect(url?)`, the CLI and the MCP server open a database from one URL, by default the `BUCKET_DB_URL` environment variable:

| URL | Backend | `dbPath` |
|---|---|---|
| `s3://bucket/prefix?region=…&endpoint=…&forcePathStyle=true&timeoutMs=…` | `S3Adapter` | `prefix` |
| `oss://bucket/prefix?region=…&endpoint=…&timeoutMs=…` | `OSSAdapter` | `prefix` |
| `file:///absolute/dir`, `file://./relative/dir` | `FileSystemAdapter` | `''` |
| `memory://prefix` | `MemoryStorageAdapter` | `prefix` |

```typescript
const db = BucketDB.connect('s3://my-bucket/my-app?region=us-east-1');
const fromEnv = BucketDB.connect(); // BUCKET_DB_URL
```

Every query parameter is optional and falls back to the adapter's environment default; unknown parameters throw `ValidationError`. Credentials never go in the URL (a URL with `user:secret@` is refused) but come from `AWS_*`, `OSS_*` or `ALIBABA_CLOUD_*` variables (see [Storage Adapters](#storage-adapters)). Error messages never repeat the URL, so it is safe to log. `new BucketDB(adapter, dbPath)` remains available, for example to pass a credential provider.

## Exports

```typescript
// Core class
import { BucketDB } from '@hold-baby/bucket-db';
// Collection is a type only: get collections from db.collection(name)
import type { Collection } from '@hold-baby/bucket-db';

// Storage adapters
import {
  MemoryStorageAdapter,  // in-memory (tests)
  FileSystemAdapter,     // local file system
  S3Adapter,             // AWS S3 and S3-compatible services
  OSSAdapter,            // Alibaba Cloud OSS
} from '@hold-baby/bucket-db';

// Types
import type {
  BucketDBOptions,
  Logger,
  LogEvent,
  Document,
  Stored,
  InsertDocument,
  UpdateDocument,
  QueryOperator,
  QueryValue,
  QueryFilter,
  QueryOptions,
  SortSpec,
  InsertOptions,
  UpdateOptions,
  FileSystemAdapterConfig,
  S3AdapterOptions,
  OSSAdapterOptions,
  Credentials,
  CredentialProvider,
  // for custom adapters
  StorageAdapter,
  Capabilities,
  Guarantee,
  WriteCondition,
  ObjectEntry,
  ListPage,
  ListOptions,
  StorageErrorKind,
  StorageErrorOptions,
} from '@hold-baby/bucket-db';

// Error classes
import {
  BucketDBError,
  ValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  ConcurrentUpdateError,
  UnsupportedError,
  StorageError,
} from '@hold-baby/bucket-db';
```

## Document Type

Every document stored in BucketDB has these system fields:

```typescript
interface Document {
  id: string;          // generated UUID unless you choose it (put, insert with { id }); taken from the object key
  _etag?: string;      // version tag from the storage service, for optimistic locking
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

`InsertDocument<T>` and `UpdateDocument<T>` both omit `id`, `_etag`, `_createdAt` and `_updatedAt`; `UpdateDocument<T>` also makes every field optional. If system fields are passed at runtime anyway, `insert`, `put` and `update` drop them.

`_etag` is not stored in the document body: on every read, `id` comes from the object key and `_etag` from the storage service.

Every document a collection returns (`insert`, `put`, `findById`, `find`, `update`) has the type `Stored<T>` = `T & { _etag: string }`: `_etag` is always set, so it can be passed to `update` without `!`. `_createdAt` and `_updatedAt` stay optional, because a file placed in `docs/` by other means may lack them.

## Quick Start

```typescript
import { BucketDB } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

// Or s3://bucket/prefix?region=…, oss://…, memory://; new BucketDB(adapter, dbPath) also works
const db = BucketDB.connect('file://./data');

const users = db.collection<User>('users');

// Insert: one conditional PUT
const user = await users.insert({ name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });
// user.id, user._etag, user._createdAt, user._updatedAt are set automatically

// Find by ID: one GET; null if the document does not exist
const found = await users.findById(user.id);

// Query: filters in memory (on S3 / OSS, document bodies come from the query snapshot)
const activeUsers = await users.find({ status: 'active' });
const adults = await users.find({ age: { $gte: 18 } }, { sort: { age: -1 }, limit: 10 });
const total = await users.count();

// Create or replace under an ID you choose: one unconditional PUT, safe to repeat
await users.put('alice', { name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });

// Create only if the ID is free: throws DocumentExistsError otherwise
await users.insert({ name: 'Bob', age: 31, email: 'bob@example.com', status: 'active' }, { id: 'bob' });

// Update with optimistic locking (not available on OSS, see above)
const updated = await users.update(user.id, { age: 26 }, { etag: user._etag });

// Delete: one DELETE; no error if the document is already gone
await users.delete(user.id);

// Delete every match, one DELETE each (not atomic); returns how many
await users.deleteMany({ status: 'inactive' });
```

## Operations and cost

| Operation | Requests |
|---|---|
| `insert(data, { id? })` | 1 conditional PUT |
| `put(id, data)` | 1 PUT |
| `findById(id)` | 1 GET |
| `find({ id: '...' })` | 1 GET |
| `find(filter)` on S3 / OSS | ⌈N / 1000⌉ LIST + 1 GET (snapshot), plus 1 GET per document changed since the snapshot (up to 16, in parallel) or, when more changed, those GETs and 1 PUT rewriting the snapshot |
| `find(filter)` on Memory / FileSystem | ⌈N / 1000⌉ LIST + N GET (16 in parallel) |
| `update(id, data, options?)` | 1 GET + 1 conditional PUT (more on conflict, see below) |
| `delete(id)` | 1 DELETE |
| `count()` | ⌈N / 1000⌉ LIST |
| `count(filter)` | same as `find(filter)` |
| `deleteMany(filter)` | same as `find(filter)`, plus 1 DELETE per match (16 in parallel) |
| `compact()` | S3 / OSS: ⌈N / 1000⌉ LIST + N GET + 1 PUT; nothing on Memory / FileSystem |

N = documents in the collection. Measured latencies at 100, 1,000 and 10,000 documents are in [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md).

Without `sort`, `find` returns documents by `_createdAt`, then `id`: roughly creation order, and stable for paging. `sort: { field: 1 | -1 }` sorts by the given fields first; missing and `null` values sort last in either direction. Sort keys are typed as `SortSpec<T>`: the document's fields plus `id`, `_etag`, `_createdAt` and `_updatedAt`, so an unknown field is a compile error; a field set to `undefined` is ignored. `sort`, `offset` and `limit` apply after filtering, and `limit: 0` returns `[]`. There is no result cache: every `find` lists storage first.

`put` replaces the whole document and sets both timestamps to now (so it moves to the end of the default order); `update` merges fields and keeps `_createdAt`. `insert` with `{ id }` creates only if the ID is free; of several concurrent inserts with one ID, exactly one succeeds.

`update` merges `data` into the stored document:

- **With `etag`**: throws `ConcurrentUpdateError` if the document no longer has that etag, or if another writer changes it before the write lands. No retry.
- **Without `etag`**: on backends with compare-and-swap (Memory, FileSystem within one process, S3), a write that collides with another writer re-reads and retries (up to 5 retries), so concurrent partial updates all apply. On OSS the last writer wins.

## Query snapshot (S3 / OSS)

On remote backends (`S3Adapter`, `OSSAdapter`, custom adapters with `remote: true`), each collection keeps `<dbPath>/<collection>/_snapshot.v1.json`: a copy of every document with its etag. A `find`:

1. lists `docs/` (one request per 1,000 documents), which says which documents exist and their current etags;
2. GETs the snapshot and uses an entry only if its etag equals the listed one;
3. GETs every other listed document, 16 in parallel;
4. rewrites the snapshot (one unconditional PUT) when more than 16 documents had to be read individually, counting snapshot entries of deleted documents too.

The list is the authority. A missing, corrupt, stale or concurrently overwritten snapshot changes only how many requests a query makes, never its result; a missing or unparsable one is rebuilt. A transient or permission error while *reading* the snapshot fails the query with `StorageError`. A failed snapshot *write* does not fail the query; it is reported to the logger, and after a 401 / 403 (for example read-only credentials) the collection stops trying to write it.

Deleted documents' contents stay in the snapshot until it is rewritten. `compact()` rebuilds it from the current documents right away:

```typescript
await users.delete(id);
await users.compact(); // S3 / OSS: LIST + GET every document + 1 PUT; throws on failure. No-op on Memory / FileSystem.
```

Memory and FileSystem keep no snapshot; reading local files is cheap. Bucket lifecycle rules that expire objects under `docs/` act as a TTL: expired documents disappear from LIST and from results.

### Logger

Problems that do not fail the current call go to a logger, `console.warn` by default: a snapshot that could not be written (level `error`), a snapshot that could not be parsed and is rebuilt (`warn`), and a collection past the 10,000-document / 10 MB envelope (`warn`, once per collection).

```typescript
import type { LogEvent } from '@hold-baby/bucket-db';

const db = new BucketDB(adapter, 'my-app', {
  logger: (event: LogEvent) => myLogger[event.level](event.message, event.error),
});
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

// Sorting and pagination
await users.find({ status: 'active' }, { sort: { age: -1, name: 1 }, limit: 20, offset: 40 });
```

Conditions on several fields are combined with AND. A field missing from a document evaluates as `undefined`:

| Condition | Field missing | Value of another type (`'30'` vs `30`) |
|---|---|---|
| plain value, `$eq` | no match | no match |
| `$ne` | match | match |
| `$gt`, `$gte`, `$lt`, `$lte` | no match | no match |
| `$in` | no match | no match |
| `$nin` | match | match |

Range operators compare only numbers with numbers and strings with strings; anything else is no match, never an error. `$in: []` matches nothing and `$nin: []` excludes nothing. A malformed filter — an unknown operator, a non-array `$in` / `$nin` operand, or a reserved field name such as `constructor` or `__proto__` — throws `ValidationError` before any request, as do an invalid `sort` and a negative or fractional `limit` / `offset`.

## Error Handling

```typescript
import {
  DocumentNotFoundError,
  ConcurrentUpdateError,
  DocumentExistsError,
  UnsupportedError,
  ValidationError,
  StorageError,
} from '@hold-baby/bucket-db';

// findById returns null only when the document does not exist.
// Any other storage failure throws StorageError.
const user = await users.findById('nonexistent-id');
if (!user) {
  // Document does not exist
}

try {
  await users.update(id, { age: 30 }, { etag: staleEtag });
} catch (err) {
  if (err instanceof ConcurrentUpdateError) {
    // Stale etag, or another writer won the race — re-read and retry
  } else if (err instanceof DocumentNotFoundError) {
    // Document does not exist
  } else if (err instanceof UnsupportedError) {
    // The backend cannot enforce an etag (OSS)
  } else if (err instanceof StorageError) {
    console.error(err.kind, err.key, err.status);
  }
}
```

| Error class | When thrown |
|---|---|
| `ValidationError` | Invalid collection name, document ID, `dbPath`, filter, `sort`, `limit` or `offset`; invalid or missing connection URL; invalid adapter options; missing credentials |
| `DocumentNotFoundError` | `update` on a missing document |
| `DocumentExistsError` | `insert` with an `id` that is already taken |
| `ConcurrentUpdateError` | `update` with a stale `etag`, or a write that lost a race (with `etag`, or after 5 retries without) |
| `UnsupportedError` | The backend lacks the needed capability: `update` with `etag` on OSS |
| `StorageError` | Storage failure. `kind` is `'not-found'`, `'conflict'`, `'transient'` (still failing after retries) or `'permanent'`; `key` is the object key, `status` the HTTP status |

All of them extend `BucketDBError`.

A file under `docs/` that is not a JSON object, or whose name is not `<id>.json`, makes `find` throw `StorageError` with that file's `key`. Files whose name starts with `.` (for example `.DS_Store`) are ignored.

### Collection names, document IDs and `dbPath`

Collection names, document IDs and every `/`-separated segment of `dbPath` must be 1–255 letters, digits, `_`, `-` or `.`, and must not start with `.`. Anything else throws `ValidationError`; names are never rewritten.

- `new BucketDB(adapter, dbPath)` and `db.collection(name)` throw synchronously.
- `findById` / `update` / `delete` reject with `ValidationError` for an invalid ID.
- `dbPath` may contain `/` (`'apps/tenant-1'`); `''` stores collections at the bucket root.

## Storage Adapters

### MemoryStorageAdapter

In-process, nothing persisted. For tests.

```typescript
import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db';

const db = new BucketDB(new MemoryStorageAdapter(), 'test-db');
```

### FileSystemAdapter

```typescript
import { FileSystemAdapter } from '@hold-baby/bucket-db';

const adapter = new FileSystemAdapter({ basePath: './data' });
```

Each object is a file under `basePath`. Writes go to a temporary file that is then linked (create) or renamed (replace) into place, so a reader never sees a partial file. Create-if-absent works across processes; `etag` checks work within one process.

### S3Adapter

```typescript
import { S3Adapter } from '@hold-baby/bucket-db';

// Region, endpoint and credentials from AWS_* environment variables
const adapter = new S3Adapter({ bucket: 'my-bucket' });

// Or explicitly
const explicit = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MY_KEY_ID!,
    secretAccessKey: process.env.MY_SECRET!,
  },
});
```

| Option | Default |
|---|---|
| `bucket` | required |
| `region` | `AWS_REGION`, then `AWS_DEFAULT_REGION` |
| `endpoint` | `AWS_ENDPOINT_URL_S3`, then `AWS_ENDPOINT_URL`, then `https://s3.<region>.amazonaws.com` |
| `credentials` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` |
| `forcePathStyle` | `true` when the endpoint host is an IP address or `localhost` |
| `timeoutMs` | `10000` (per attempt) |

Any S3-compatible service can be used through `endpoint` (MinIO, Cloudflare R2, …), but only AWS S3 and Alibaba Cloud OSS are tested.

### OSSAdapter

```typescript
import { OSSAdapter } from '@hold-baby/bucket-db';

// Region and credentials from OSS_* environment variables
const adapter = new OSSAdapter({ bucket: 'my-bucket' });

// Or explicitly
const explicit = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou',
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET!,
  },
});
```

| Option | Default |
|---|---|
| `bucket` | required |
| `region` | `OSS_REGION`. Write `cn-hangzhou`; the 0.3 form `oss-cn-hangzhou` is also accepted |
| `endpoint` | `https://s3.oss-<region>.aliyuncs.com` (OSS's S3-compatible endpoint). `OSS_ENDPOINT` is not read |
| `credentials` | `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN`; if unset, `ALIBABA_CLOUD_ACCESS_KEY_ID`, `ALIBABA_CLOUD_ACCESS_KEY_SECRET`, `ALIBABA_CLOUD_SECURITY_TOKEN` (what `aliyun/configure-aliyun-credentials-action` exports after OIDC) |
| `timeoutMs` | `10000` (per attempt) |

New OSS users in mainland China may have to access buckets through a custom domain, passed as `endpoint`. S3-compatible access through a custom domain has not been verified.

OSS does not support conditional updates: `update` with `etag` throws `UnsupportedError`. `insert` relies on `x-oss-forbid-overwrite`, which OSS ignores on versioned buckets.

### Credentials

`credentials` is either an object or an async function:

```typescript
interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: Date;
}
type CredentialProvider = () => Promise<Credentials>;

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: async () => {
    const sts = await fetchTemporaryCredentials(); // your code
    return {
      accessKeyId: sts.accessKeyId,
      secretAccessKey: sts.secretAccessKey,
      sessionToken: sts.sessionToken,
      expiresAt: new Date(sts.expiration),
    };
  },
});
```

The function's result is cached; it is called again 5 minutes before `expiresAt` (never, if `expiresAt` is absent). A failed call is not cached. Without the option, missing environment variables throw `ValidationError` on the first request.

### Retries

`S3Adapter` and `OSSAdapter` make up to 3 attempts per request, with jittered exponential backoff, on network errors, timeouts, 5xx, 429, `SlowDown` and `RequestTimeout`. Other 4xx responses are not retried. A failure that persists becomes `StorageError` with `kind: 'transient'`. If a conditional write hits a conflict after a transient failure, the adapter reads the object back and compares it with what it wrote, so an earlier attempt that did succeed is not reported as a conflict.

### Proxies

The S3 / OSS client uses the runtime's built-in `fetch`, so proxy support is the runtime's. Measured against real S3 through a CONNECT proxy:

- **Bun** (1.4.2) honours `HTTPS_PROXY` by default.
- **Node** (22.23.5, 24.22.3) by default ignores `HTTP_PROXY` / `HTTPS_PROXY` and connects directly. Set `NODE_USE_ENV_PROXY=1` (Node 22.21.0+ / 24.0.0+) or pass `--use-env-proxy` (Node 22.21.0+ / 24.5.0+) to send requests through the proxy; Node marks this "Stability 1.1 – Active development".

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy:3128 npx -y @hold-baby/bucket-db count items
```

`NO_PROXY` handling has not been tested.

## BucketDB

```typescript
new BucketDB(adapter: StorageAdapter, dbPath: string, options?: BucketDBOptions)
BucketDB.connect(url?: string, options?: BucketDBOptions): BucketDB // see Connection URLs; default BUCKET_DB_URL
db.collection<T extends Document>(name: string): Collection<T> // Collection is exported as a type only

interface BucketDBOptions {
  logger?: Logger; // default: console.warn
}
type Logger = (event: LogEvent) => void;
interface LogEvent {
  level: 'warn' | 'error';
  message: string;
  error?: unknown;
}
```

| Parameter | Description |
|---|---|
| `adapter` | Storage backend |
| `dbPath` | Key prefix for this database (e.g. `'my-app'`, `'tenants/123'`); `''` for the bucket root |
| `options.logger` | Receives snapshot write failures and envelope warnings; see [Logger](#logger) |
| `name` | Collection name; the same name returns the same `Collection` instance |

A custom `StorageAdapter` can set `readonly remote = true` to get the query snapshot; the built-in `S3Adapter` and `OSSAdapter` do.

## Upgrading

**From 0.5.** The storage format and runtime behaviour are unchanged; the types changed. `Collection` is a type only (`new Collection(...)` and `CollectionOptions` are gone; set the logger on `BucketDB`), returned documents are `Stored<T>`, `sort` keys must be fields of the document type or system fields, and Node.js 22 or later is required. Details: [MIGRATION-0.6.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.6.md).

**From 0.4.** The storage format is unchanged. Queries changed: `$ne` / `$nin` now match documents without the field, range comparisons between mismatched types no longer throw, `find` without `sort` orders by `_createdAt` then `id`, and `limit: 0` returns `[]`. The MCP server is configured by `BUCKET_DB_URL`. Details: [MIGRATION-0.5.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md).

**From 0.3.x.**

0.4 reads 0.3 collections as they are: `docs/<id>.json` is unchanged. Besides `docs/`, 0.4 reads only its own `_snapshot.v1.json` (S3 / OSS), so the index and log directories 0.3 kept next to `docs/`, and 0.3's `*.meta` files, are ignored and can be deleted. On S3 / OSS, queries create a `_snapshot.v1.json` next to `docs/` in the collections they read (once more than 16 documents had to be fetched); with read-only credentials it is simply not written. Stop every 0.3 writer before 0.4 starts writing. The API changes are listed in the [migration guide](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.4.md) and the [changelog](https://github.com/holdbaby5483/bucket-db/blob/main/CHANGELOG.md).

## Documentation

📚 https://bucket-db.pages.dev

- [API reference](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md)
- [CLI reference](https://github.com/holdbaby5483/bucket-db/blob/main/docs/CLI.md) and [CI recipes](https://github.com/holdbaby5483/bucket-db/tree/main/examples/ci)
- [Guarantees and limits](https://github.com/holdbaby5483/bucket-db/blob/main/docs/GUARANTEES.md): what each backend guarantees and the test that checks it
- [Storage format](https://github.com/holdbaby5483/bucket-db/blob/main/docs/STORAGE-FORMAT.md): the keys and JSON BucketDB writes
- [Benchmarks](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md): requests and latency at 100 to 10,000 documents on OSS, S3 and FileSystem
- [Migrating from 0.5](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.6.md), [from 0.4](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md) and [from 0.3](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.4.md)

## License

MIT
