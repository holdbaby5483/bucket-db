# Changelog

All notable changes to BucketDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
