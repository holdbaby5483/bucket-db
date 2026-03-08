# Changelog

All notable changes to BucketDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-08

### Changed

- **BREAKING**: Merged `@hold-baby/bucket-db-types` into `@hold-baby/bucket-db-core`
  - All types are now exported directly from `@hold-baby/bucket-db-core`
  - No need to install `@hold-baby/bucket-db-types` separately
  - Simplified dependency tree and package management

### Migration Guide

If you were importing from both packages:

```typescript
// Before (v0.1.0)
import { BucketDB } from '@hold-baby/bucket-db-core';
import type { Document } from '@hold-baby/bucket-db-types';

// After (v0.2.0)
import { BucketDB } from '@hold-baby/bucket-db-core';
import type { Document } from '@hold-baby/bucket-db-core';
```

If you only used `@hold-baby/bucket-db-core`, no changes needed!

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
