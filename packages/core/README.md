# BucketDB

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![npm downloads](https://img.shields.io/npm/dm/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system. No database servers needed.

Each document is one JSON object in your bucket: `<dbPath>/<collection>/docs/<id>.json`. There is no index and no log; every write is a single storage request. On S3 and OSS, queries also keep a disposable snapshot, `<dbPath>/<collection>/_snapshot.v1.json`, so a query does not download every document ([storage format](https://github.com/holdbaby5483/bucket-db/blob/main/docs/STORAGE-FORMAT.md)).

> **0.6.0** is the last breaking release before 1.0 and settles the public types: `Collection` is a type only, returned documents are `Stored<T>`, `sort` keys are type-checked, and Node.js 22 is the minimum. Storage format, CLI and runtime behaviour are unchanged. Upgrading from 0.5: [MIGRATION-0.6.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.6.md); from 0.4: [MIGRATION-0.5.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md) first; from 0.3.x: [MIGRATION-0.4.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.4.md) before that.

## Installation

```bash
bun add @hold-baby/bucket-db
# or
npm install @hold-baby/bucket-db
```

Requires Node.js >= 22 or Bun. No runtime dependencies: the S3 / OSS client is built in.

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

// Update with optimistic locking (not available on OSS, see below)
const updated = await users.update(user.id, { age: 26 }, { etag: user._etag });

// Delete: one DELETE; no error if the document is already gone
await users.delete(user.id);

// Delete every match, one DELETE each (not atomic); returns how many
await users.deleteMany({ status: 'inactive' });
```

A database is a storage backend plus a key prefix. `BucketDB.connect(url?, options?)` builds both from a connection URL (below); `new BucketDB(adapter, dbPath, options?)` takes an adapter you constructed, for example to pass a credential provider. `dbPath` is the prefix (`'my-app'`, `'tenants/123'`; `''` for the bucket root). `db.collection<T>(name)` returns the same collection for the same name and writes nothing until the first insert. The only option is `logger` (see "Logger" below).

Collection names, document IDs and every `/`-separated segment of `dbPath` must be 1–255 letters, digits, `_`, `-` or `.`, not starting with `.`. Anything else throws `ValidationError`; names are never rewritten.

## Command line

The package includes `bucket-db`, for shells and CI jobs:

```bash
export BUCKET_DB_URL='s3://my-bucket/ci-data?region=us-east-1'   # credentials from AWS_* variables

npx @hold-baby/bucket-db doctor                                         # check what the bucket guarantees
echo '{"ms":1234,"ok":true}' | npx @hold-baby/bucket-db put runs run-42 # create or replace
npx @hold-baby/bucket-db find runs '{"ok":true}' --sort ms:desc --limit 5
npx @hold-baby/bucket-db export runs > runs.jsonl                       # backup; `import` restores
```

Commands, options, output format and exit codes: [CLI.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/CLI.md). Recipes for keeping CI data in a bucket with OIDC credentials: [examples/ci](https://github.com/holdbaby5483/bucket-db/tree/main/examples/ci).

## Connection URLs

`BucketDB.connect(url?)`, the CLI and the MCP server open a database from one URL, by default the `BUCKET_DB_URL` environment variable:

| URL | Backend | `dbPath` |
|---|---|---|
| `s3://bucket/prefix?region=…&endpoint=…&forcePathStyle=true&timeoutMs=…` | `S3Adapter` | `prefix` |
| `oss://bucket/prefix?region=…&endpoint=…&timeoutMs=…` | `OSSAdapter` | `prefix` |
| `file:///absolute/dir`, `file://./relative/dir` | `FileSystemAdapter` | `''` |
| `memory://prefix` | `MemoryStorageAdapter` | `prefix` |

Every query parameter is optional and falls back to the adapter's environment default; unknown parameters throw `ValidationError`. Credentials never go in the URL (a URL with `user:secret@` is refused); they come from the environment, as listed under "Storage adapters" below. Error messages never repeat the URL, so it is safe to log. Details: [API reference](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#connection-urls).

## Status and limitations

What each backend guarantees:

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| Single write is atomic | yes | yes | yes | yes |
| Create-if-absent (`insert`) | yes | yes (across processes) | yes | yes (non-versioned buckets only) |
| Conditional update (`etag`) | yes | single process only | yes | no — `UnsupportedError` |
| Concurrent partial updates all apply | yes | single process | yes | no (last writer wins) |

Multiple writer processes are supported for `insert`, `put` and `delete` on every backend, and for `update` on S3 (on Memory and FileSystem, within one process).

Main limits:

- **No transactions.** Each write touches one document; `deleteMany` is not atomic.
- **Small collections.** Designed for at most 10,000 documents and 10 MB of snapshot per collection, and a few writes per second. Past that, queries keep working but get slower.
- **Queries list the whole collection** and filter, sort and page in memory. Only a `{ id: '...' }` filter reads a single document.
- **Results are not a point-in-time snapshot**, and a deleted document's contents stay in the query snapshot until it is rewritten or `compact()` runs.

The full list, and the test behind each guarantee: [Guarantees and limits](https://github.com/holdbaby5483/bucket-db/blob/main/docs/GUARANTEES.md).

## Documents and `Stored<T>`

Every document extends `Document`:

```typescript
interface Document {
  id: string;          // generated UUID unless you choose it (put, insert with { id }); taken from the object key
  _etag?: string;      // version tag from the storage service, for optimistic locking; not stored in the body
  _createdAt?: string; // ISO 8601 timestamp
  _updatedAt?: string; // ISO 8601 timestamp
}
```

Every document a collection returns has the type `Stored<T>` = `T & { _etag: string }`, so `_etag` can be passed to `update` without `!`. `InsertDocument<T>` and `UpdateDocument<T>` (the input types of `insert` / `put` and `update`) omit the system fields, which are also dropped at runtime.

Everything is imported from `@hold-baby/bucket-db`: the `BucketDB` class, the four adapters, the error classes, and types such as `Collection` (a type only), `Document`, `Stored`, `QueryFilter`, `QueryOptions` and `SortSpec`. The full list is in the [API reference](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#exports).

## Operations and cost

| Operation | Requests |
|---|---|
| `insert(data, { id? })` | 1 conditional PUT |
| `put(id, data)` | 1 PUT |
| `findById(id)` | 1 GET |
| `find({ id: '...' })` | 1 GET |
| `find(filter)` on S3 / OSS | ⌈N / 1000⌉ LIST + 1 GET (snapshot), plus 1 GET per document changed since the snapshot (up to 16, in parallel) or, when more changed, those GETs and 1 PUT rewriting the snapshot |
| `find(filter)` on Memory / FileSystem | ⌈N / 1000⌉ LIST + N GET (16 in parallel) |
| `update(id, data, options?)` | 1 GET + 1 conditional PUT (repeated on conflict without `etag`, up to 5 retries) |
| `delete(id)` | 1 DELETE |
| `count()` | ⌈N / 1000⌉ LIST |
| `count(filter)` | same as `find(filter)` |
| `deleteMany(filter)` | same as `find(filter)`, plus 1 DELETE per match (16 in parallel) |
| `compact()` | S3 / OSS: ⌈N / 1000⌉ LIST + N GET + 1 PUT; nothing on Memory / FileSystem |

N = documents in the collection. Measured latencies at 100, 1,000 and 10,000 documents on OSS, S3 and FileSystem: [BENCHMARKS.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md).

**Queries.** Filters support `$eq` (or a plain value), `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in` and `$nin`, combined with AND; `$ne` and `$nin` match documents without the field, and comparisons between mismatched types do not match rather than throw ([semantics](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#semantics)). Without `sort`, `find` returns documents by `_createdAt`, then `id`, which keeps `offset` / `limit` pages stable.

**Updates.** With `etag`, `update` throws `ConcurrentUpdateError` if the document changed. Without `etag`, a write that collides with another writer is re-read and retried where the backend supports compare-and-swap (Memory, FileSystem within one process, S3), so concurrent partial updates all apply; on OSS the last writer wins. `put` replaces the whole document and resets `_createdAt`; `update` merges fields and keeps it.

**Query snapshot.** On S3 and OSS a query takes each listed document from `_snapshot.v1.json` when its etag matches and GETs the rest; the list is the authority, so a missing or stale snapshot costs speed, never correctness. `compact()` rebuilds it, for example after deleting data that must not linger ([storage format](https://github.com/holdbaby5483/bucket-db/blob/main/docs/STORAGE-FORMAT.md#snapshot-_snapshotv1json), [API](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#query-snapshot)).

**Logger.** Problems that do not fail the current call (a snapshot that could not be written or parsed, a collection past the 10,000-document / 10 MB envelope) go to `console.warn`. Pass `{ logger }` to `BucketDB.connect` or `new BucketDB` to route them elsewhere ([`Logger`](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#logger--logevent)).

**Errors.** All extend `BucketDBError`: `ValidationError` (invalid names, filters, options or URL; missing credentials), `DocumentNotFoundError` (`update` on a missing document), `DocumentExistsError` (`insert` with a taken `id`), `ConcurrentUpdateError`, `UnsupportedError` (`update` with `etag` on OSS) and `StorageError` (with `kind`, `key` and `status`). `findById` returns `null` only when the document does not exist. When each is thrown: [Error Classes](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#error-classes).

## Storage adapters

All four adapters are exported from `@hold-baby/bucket-db`. All options, retries and the `StorageAdapter` interface for custom backends: [Storage Adapters](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md#storage-adapters).

### MemoryStorageAdapter

```typescript
const db = new BucketDB(new MemoryStorageAdapter(), 'test-db'); // in-process, nothing persisted; for tests
```

### FileSystemAdapter

```typescript
const adapter = new FileSystemAdapter({ basePath: './data' }); // created on first write
```

Each object is a file under `basePath`, written to a temporary file and then linked or renamed into place, so a reader never sees a partial file. Create-if-absent works across processes; `etag` checks work within one process.

### S3Adapter

```typescript
const adapter = new S3Adapter({ bucket: 'my-bucket' }); // everything else from the environment
const minio = new S3Adapter({ bucket: 'my-bucket', region: 'us-east-1', endpoint: 'http://localhost:9000' });
```

| Option | Default |
|---|---|
| `region` | `AWS_REGION`, then `AWS_DEFAULT_REGION` |
| `endpoint` | `AWS_ENDPOINT_URL_S3`, then `AWS_ENDPOINT_URL`, then `https://s3.<region>.amazonaws.com` |
| `credentials` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` |
| `forcePathStyle` | `true` when the endpoint host is `localhost` or an IP address (IPv4, or IPv6 such as `[::1]`); otherwise virtual-hosted-style |
| `timeoutMs` | `10000` per attempt |

Any S3-compatible service can be used through `endpoint` (MinIO, Cloudflare R2, …), but only AWS S3 and Alibaba Cloud OSS are tested.

### OSSAdapter

```typescript
const adapter = new OSSAdapter({ bucket: 'my-bucket' }); // region and credentials from the environment
const explicit = new OSSAdapter({ bucket: 'my-bucket', region: 'cn-hangzhou' });
```

| Option | Default |
|---|---|
| `region` | `OSS_REGION`. Write `cn-hangzhou`; the 0.3 form `oss-cn-hangzhou` is also accepted |
| `endpoint` | `https://s3.oss-<region>.aliyuncs.com` (OSS's S3-compatible endpoint). `OSS_ENDPOINT` is not read |
| `credentials` | `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN`; when those are unset, `ALIBABA_CLOUD_ACCESS_KEY_ID`, `ALIBABA_CLOUD_ACCESS_KEY_SECRET`, `ALIBABA_CLOUD_SECURITY_TOKEN` (what `aliyun/configure-aliyun-credentials-action` exports after OIDC) |
| `timeoutMs` | `10000` per attempt |

OSS does not support conditional updates: `update` with `etag` throws `UnsupportedError`. `insert` relies on `x-oss-forbid-overwrite`, which OSS ignores on versioned buckets.

### Credentials

`credentials` is optional on both cloud adapters. Omitted, it is read from the environment variables above on the first request. It can also be an object `{ accessKeyId, secretAccessKey, sessionToken?, expiresAt? }` or an async function returning one; the function's result is cached and requested again 5 minutes before `expiresAt`. The built-in client does not read `~/.aws/credentials` or instance metadata. How to source, scope and rotate credentials: [credentials guide](https://github.com/holdbaby5483/bucket-db/blob/main/docs/security/credentials.md).

### Proxies

The S3 / OSS client uses the runtime's built-in `fetch`: Bun honours `HTTPS_PROXY` by default, Node only with `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` ([details](https://github.com/holdbaby5483/bucket-db/blob/main/docs/CLI.md#proxies)).

## Documentation

📚 https://bucket-db.pages.dev

- [API reference](https://github.com/holdbaby5483/bucket-db/blob/main/docs/API.md)
- [CLI reference](https://github.com/holdbaby5483/bucket-db/blob/main/docs/CLI.md) and [CI recipes](https://github.com/holdbaby5483/bucket-db/tree/main/examples/ci)
- [Guarantees and limits](https://github.com/holdbaby5483/bucket-db/blob/main/docs/GUARANTEES.md): what each backend guarantees and the test that checks it
- [Compatibility policy](https://github.com/holdbaby5483/bucket-db/blob/main/docs/COMPATIBILITY.md): what may change between releases from 1.0 on
- [Storage format](https://github.com/holdbaby5483/bucket-db/blob/main/docs/STORAGE-FORMAT.md): the keys and JSON BucketDB writes
- [Benchmarks](https://github.com/holdbaby5483/bucket-db/blob/main/docs/BENCHMARKS.md): requests and latency at 100 to 10,000 documents on OSS, S3 and FileSystem
- [Credentials](https://github.com/holdbaby5483/bucket-db/blob/main/docs/security/credentials.md): sourcing and rotating cloud credentials
- [Migrating from 0.5](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.6.md), [from 0.4](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.5.md) and [from 0.3](https://github.com/holdbaby5483/bucket-db/blob/main/docs/MIGRATION-0.4.md)

## License

MIT
