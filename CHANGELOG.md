# Changelog

All notable changes to BucketDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-21

Adds the query snapshot: on S3 and OSS a `find` no longer downloads every document. Changes below are relative to 0.4.0-beta.0; upgrading from 0.3.x, read both entries and [docs/MIGRATION-0.4.md](docs/MIGRATION-0.4.md). 0.4.0 is published as `latest`.

### Added

- Query snapshot for remote backends. `S3Adapter`, `OSSAdapter` and custom adapters with `remote: true` keep `<dbPath>/<collection>/_snapshot.v1.json` next to `docs/`. `find` lists `docs/`, takes each document from the snapshot when its etag equals the listed one and GETs the rest. The list is the authority: a missing, corrupt, stale, foreign-version or concurrently overwritten snapshot changes only speed, never results. A query rewrites the snapshot when more than 16 documents had to be read individually (counting snapshot entries of deleted documents). Memory and FileSystem keep no snapshot. Format: [docs/STORAGE-FORMAT.md](docs/STORAGE-FORMAT.md).
- `collection.compact()`: rebuilds the snapshot from the current documents, removing the contents of deleted documents. No-op on local backends; throws on failure.
- `new BucketDB(adapter, dbPath, { logger })` and `Collection`'s optional fourth argument `{ logger }`. The logger (default `console.warn`) receives snapshot write failures (`error`), unparsable snapshots being rebuilt (`warn`) and envelope warnings (`warn`). New exports `BucketDBOptions`, `CollectionOptions`, `Logger`, `LogEvent`.
- `StorageAdapter.remote` (optional): `true` makes `Collection` keep the query snapshot. `S3Adapter` and `OSSAdapter` set it.
- Envelope warning: a collection with more than 10,000 documents or a snapshot over 10 MB logs one `warn` per `Collection` instance. Local backends check the document count.
- Benchmarks: `packages/core/bench/run.ts` and [docs/BENCHMARKS.md](docs/BENCHMARKS.md) with request counts and latency at 100, 1,000 and 10,000 documents on OSS, S3 and FileSystem.
- Docs: [docs/GUARANTEES.md](docs/GUARANTEES.md) (each guarantee with the test that checks it) and [docs/STORAGE-FORMAT.md](docs/STORAGE-FORMAT.md).

### Changed

- `find` on S3 / OSS costs ⌈N/1000⌉ LIST + 1 GET when the snapshot is current, plus one GET per document changed since it; when more than 16 changed, the query also rewrites the snapshot with one PUT (beta: ⌈N/1000⌉ LIST + N GET). Measured at 10,000 documents: 1.35 s on OSS and 3.2 s on S3 with a current snapshot; 34 s and 134 s without one (the beta's cost plus the snapshot GET and PUT). `{ id }` queries, writes, and `find` on Memory / FileSystem are unchanged.
- A failure to read the snapshot other than not-found (transient, permission) fails `find` with `StorageError`. A failure to write it does not fail `find`; it is logged, and after a 401 / 403 the collection stops trying, so read-only credentials work.
- Consistency is stated explicitly: every document `find` returns is a committed version, but the result set is not a point-in-time snapshot of the collection. Deleted documents' contents remain in the snapshot until it is rewritten or `compact()` runs.
- Installation: `npm install @hold-baby/bucket-db` (no `@next`).

## [0.4.0-beta.0] - 2026-11-21

Rewrites the storage core. Each document is one object, `<dbPath>/<collection>/docs/<id>.json`, with no index and no write-ahead log; every write is a single storage request. The S3 / OSS client is built in, and the package has no runtime dependencies. 0.4 reads 0.3 collections without conversion. See [docs/MIGRATION-0.4.md](docs/MIGRATION-0.4.md) for the upgrade steps.

### BREAKING

- `shardCount` and `defaultShardCount` are removed: `new BucketDB(adapter, dbPath)`, `db.collection(name)`.
- The query result cache is removed for good (it was already off in 0.3.2); every `find` reads storage.
- `delete` no longer throws `DocumentNotFoundError` for a missing document; it is idempotent.
- Invalid collection names, document IDs and `dbPath` segments throw `ValidationError` instead of being rewritten (`a/b` used to become `a_b`). Names must match `^[A-Za-z0-9_.-]{1,255}$` and not start with `.`. `PathValidationError` is removed.
- `findById` returns `null` only when the document does not exist; other storage failures throw `StorageError`.
- The `StorageAdapter` interface is replaced: bodies are bytes, adapters declare `capabilities`, `list` is paginated and returns etags, and `exists` / `listKeys` / `batchGet` are gone. Custom adapters must be rewritten.
- `StorageError` gains `kind` (`'not-found' | 'conflict' | 'transient' | 'permanent'`), `key` and `status`; its second constructor argument is now an options object `{ kind?, key?, status?, cause? }`.
- `S3Adapter` / `OSSAdapter` constructors: `region` and `credentials` are optional and default to the standard `AWS_*` / `OSS_*` environment variables. `OSSAdapter`'s `endpoint` is now OSS's S3-compatible endpoint (default `https://s3.oss-<region>.aliyuncs.com`), and `region` is written `cn-hangzhou` (`oss-cn-hangzhou` is still accepted).
- On OSS, `update` with `etag` throws `UnsupportedError`; OSS has no conditional update.
- `UpdateDocument<T>` excludes `_etag`, `_createdAt` and `_updatedAt` as well as `id`; `update` drops them at runtime.
- Exported types `StorageObject`, `PutOptions`, `StorageCredentials`, `StorageAdapterConfig`, `ICollection`, `CollectionMeta` and `IndexShard` are removed.
- Requires Node.js >= 20 or Bun.

### Added

- New exports: `UnsupportedError`, `Capabilities`, `Guarantee`, `WriteCondition`, `ObjectEntry`, `ListPage`, `ListOptions`, `S3AdapterOptions`, `OSSAdapterOptions`, `Credentials`, `CredentialProvider`, `FileSystemAdapterConfig`, `StorageErrorKind`, `StorageErrorOptions`.
- `credentials` accepts a `sessionToken`, or an async function; the function is called again 5 minutes before the `expiresAt` it returns.
- `S3Adapter` options `forcePathStyle` (automatic for IP and `localhost` endpoints) and `timeoutMs` (per attempt, default 10 s); `OSSAdapter` option `timeoutMs`.
- Multiple writer processes are supported for `insert` and `delete` on every backend and for `update` on S3. Tested with 4 processes × 25 inserts on FileSystem, S3 and OSS: all 100 documents visible.
- `update` without `etag` retries conflicting writes (up to 5 retries) on Memory, FileSystem (within one process) and S3, so concurrent partial updates all apply.

### Changed

- `insert` is one conditional PUT (6 requests in 0.3); `findById` one GET; `delete` one DELETE; `update` one GET plus one conditional PUT.
- `find` lists the collection (one LIST per 1000 documents) and reads every document, 16 in parallel; `{ id: '...' }` reads one document. Results are in key (document ID) order.
- S3 and OSS share one retry policy: up to 3 attempts on network errors, timeouts, 5xx, 429, `SlowDown` and `RequestTimeout`. OSS now retries 5xx and 429. A conditional write that sees a conflict after a transient failure checks whether its own earlier attempt succeeded instead of reporting a false conflict.
- `FileSystemAdapter` writes through a temporary file and `link()` / `rename()`; create-if-absent is atomic across processes. It no longer writes `.meta` files.
- Malformed filters (reserved field names such as `constructor`, unknown operators, non-array `$in` / `$nin`) throw `ValidationError`.
- A file under `docs/` that is not `<id>.json` holding a JSON object makes `find` throw `StorageError` naming the key; hidden files (starting with `.`) are ignored.
- MCP server: S3 / OSS region and credentials variables are optional and fall back to the standard `AWS_*` / `OSS_*` variables; `db_delete` succeeds for a missing document.

### Removed

- Dependencies `@aws-sdk/client-s3` and `ali-oss`.
- Index shards (`index/`), the write-ahead log (`wal/`) and `.meta` files. 0.4 ignores those left by 0.3; they can be deleted. 0.3 and 0.4 must not write the same collection concurrently, because 0.3 reads only its own index.

### Fixed

- Concurrent writes on OSS no longer lose documents: with no index there is nothing to lose (0.3.2 lost index entries under concurrent inserts).
- `update` with `etag` on OSS no longer appears to succeed while being unenforced; it throws `UnsupportedError`.

## [0.3.2] - 2026-11-21

Stops silent data loss in the index and stops the docs from over-promising. No API or storage format changes. 0.3.x remains suitable for a single writer only; see "Status and limitations" in the README.

### Fixed

- Concurrent inserts into a new collection no longer lose index entries on S3, FileSystem and Memory: the first write of an index shard is conditional (`ifNoneMatch: '*'`). OSS still emulates conditional writes with HEAD-then-PUT, so concurrent writes on OSS, even from one process, can still lose index entries; issue one write at a time there.
- An index shard read that fails for any reason other than "not found" now rejects the operation with `StorageError`. Previously it was treated as an empty shard and the following write dropped every entry in that shard.
- Retries now run. S3 uses the AWS SDK default retry strategy (3 attempts: 5xx, throttling, network errors). OSS sets ali-oss `retryMax: 2`, which retries network errors and timeouts only; 5xx and 429 responses are not retried. The custom retry wrappers never retried anything and are removed.
- `update` throws `ConcurrentUpdateError` when another writer changes the document between its read and its write; previously it threw `StorageError`. S3 `409 ConditionalRequestConflict` is recognised as a conflict alongside `412 PreconditionFailed`.

### Removed

- In-process query result cache. It returned stale results across instances for up to 5 minutes and handed out shared objects that callers could mutate. Every `find` now reads storage.

### Changed

- Documentation: removed "production" labels and million-document scale claims, corrected the error table and test count, and documented the limitations: single writer only, the WAL provides no recovery guarantee, OSS has no atomic conditional writes.
- Added the MIT `LICENSE` file, also shipped in the npm package.
- Publish workflow runs the test suite before publishing and no longer prints part of the npm token.
- Removed 32 compiled test files that inflated test counts, and untracked 18 files matched by `.gitignore`.

## [0.3.1] - 2026-04-12

### Added

- MCP (Model Context Protocol) server (`apps/mcp`) for AI tool integration
  - 5 tools: `db_insert`, `db_find_by_id`, `db_find`, `db_update`, `db_delete`
  - stdio transport, supports FileSystem / S3 / OSS adapters via env vars
- AI-friendly `llms.txt` bundled with npm package
- npm package metadata: description, homepage, bugs URL

### Fixed

- npm tarball now includes `dist/` directory (added `files` field)
- `publishConfig.registry` points to npmjs.org (not mirror)

## [0.3.0] - 2026-03-16

### Added

- Write-Ahead Log (WAL) for durability
- LRU cache implementation
- Path validator utility for safe dbPath/collection names

### Changed

- Enhanced shard manager, query evaluator, and storage adapters

## [0.2.0] - 2026-03-08

### Changed

- **BREAKING**: Merged `@hold-baby/bucket-db-types` into `@hold-baby/bucket-db`
  - All types are now exported directly from `@hold-baby/bucket-db`
  - No need to install `@hold-baby/bucket-db-types` separately
  - Simplified dependency tree and package management

### Migration Guide

If you were importing from both packages:

```typescript
// Before (v0.1.0)
import { BucketDB } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db-types';

// After (v0.2.0)
import { BucketDB } from '@hold-baby/bucket-db';
import type { Document } from '@hold-baby/bucket-db';
```

If you only used `@hold-baby/bucket-db`, no changes needed!

### Removed

- `@hold-baby/bucket-db-types` package (merged into core)

## [0.1.0] - 2026-03-07

### Added

- Initial release
- Core database engine with document operations (insert, find, update, delete)
- Memory, FileSystem, S3, and OSS storage adapters
- Query system with 8 operators ($eq, $ne, $gt, $gte, $lt, $lte, $in, $nin)
- Optimistic locking via ETag
- Sharded index design for scalability
- Multi-tenant isolation via dbPath
- Full TypeScript support with strict type safety
- Test suite
