# Changelog

All notable changes to BucketDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Comprehensive test suite (132 tests)
