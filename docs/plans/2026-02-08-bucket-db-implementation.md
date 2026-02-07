# BucketDB v0.1.0 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript document database using cloud object storage (S3/OSS) with type-safe CRUD operations and query capabilities.

**Architecture:** Layered design with storage adapters (S3/OSS), sharded index management, optimistic locking via ETag, and type-safe Collection API.

**Tech Stack:** TypeScript, Bun (runtime + workspaces), @aws-sdk/client-s3, ali-oss, Bun test framework

---

## Task 1: Project Setup - Monorepo Structure

**Files:**
- Create: `/package.json`
- Create: `/bunfig.toml`
- Create: `/tsconfig.json`
- Create: `/.gitignore`
- Create: `/packages/core/package.json`
- Create: `/packages/core/tsconfig.json`
- Create: `/packages/types/package.json`
- Create: `/packages/types/tsconfig.json`

**Step 1: Create root package.json with Bun workspaces**

```json
{
  "name": "bucket-db",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*",
    "examples/*"
  ],
  "scripts": {
    "test": "bun test",
    "build": "bun run --filter='@bucket-db/*' build",
    "dev": "bun run --filter='@bucket-db/core' dev"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.3"
  }
}
```

**Step 2: Create bunfig.toml for Bun configuration**

```toml
[install]
peer = true

[test]
preload = []
```

**Step 3: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "incremental": true
  },
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local
*.tsbuildinfo
coverage/
.bun/
```

**Step 5: Create packages/types/package.json**

```json
{
  "name": "@bucket-db/types",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun --sourcemap",
    "dev": "bun build ./src/index.ts --outdir ./dist --target bun --watch"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.3"
  }
}
```

**Step 6: Create packages/types/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 7: Create packages/core/package.json**

```json
{
  "name": "@bucket-db/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun --sourcemap",
    "dev": "bun build ./src/index.ts --outdir ./dist --target bun --watch",
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "dependencies": {
    "@bucket-db/types": "workspace:*",
    "@aws-sdk/client-s3": "^3.490.0",
    "ali-oss": "^6.18.1"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.3.3"
  }
}
```

**Step 8: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"],
  "references": [
    { "path": "../types" }
  ]
}
```

**Step 9: Install dependencies**

Run: `bun install`
Expected: Dependencies installed successfully

**Step 10: Verify workspace setup**

Run: `bun pm ls`
Expected: Shows @bucket-db/core and @bucket-db/types workspaces

**Step 11: Commit**

```bash
git add .
git commit -m "chore: initialize monorepo with Bun workspaces"
```

---

## Task 2: Core Type Definitions

**Files:**
- Create: `/packages/types/src/index.ts`
- Create: `/packages/types/src/document.ts`
- Create: `/packages/types/src/query.ts`
- Create: `/packages/types/src/storage.ts`
- Create: `/packages/types/src/collection.ts`
- Create: `/packages/types/src/errors.ts`

**Step 1: Create document.ts with base Document type**

```typescript
/**
 * Base document type with system fields
 */
export interface Document {
  id: string;
  _etag?: string;
  _createdAt?: string;
  _updatedAt?: string;
}

/**
 * Type for inserting new documents (omits system fields)
 */
export type InsertDocument<T extends Document> = Omit<
  T,
  'id' | '_etag' | '_createdAt' | '_updatedAt'
>;

/**
 * Type for updating documents (partial update without id)
 */
export type UpdateDocument<T extends Document> = Partial<Omit<T, 'id'>>;
```

**Step 2: Create query.ts with query operators**

```typescript
/**
 * Supported query operators
 */
export type QueryOperator =
  | '$eq'
  | '$ne'
  | '$gt'
  | '$gte'
  | '$lt'
  | '$lte'
  | '$in'
  | '$nin';

/**
 * Query value can be direct value or operator object
 */
export type QueryValue<T> =
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

/**
 * Query filter for type-safe queries
 */
export type QueryFilter<T> = {
  [K in keyof T]?: QueryValue<T[K]>;
};

/**
 * Query options for pagination and sorting
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
}

/**
 * Update options with optimistic locking
 */
export interface UpdateOptions {
  etag?: string;
}
```

**Step 3: Create storage.ts with adapter interfaces**

```typescript
/**
 * Storage object returned by adapter
 */
export interface StorageObject {
  data: any;
  etag: string;
  lastModified: Date;
}

/**
 * Put options for conditional writes
 */
export interface PutOptions {
  ifMatch?: string;
  ifNoneMatch?: string;
}

/**
 * Storage adapter interface (abstraction for S3/OSS)
 */
export interface StorageAdapter {
  get(key: string): Promise<StorageObject>;
  put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
  batchGet(keys: string[]): Promise<Map<string, StorageObject>>;
}

/**
 * Storage credentials
 */
export interface StorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Storage adapter configuration
 */
export interface StorageAdapterConfig {
  bucket: string;
  region: string;
  credentials: StorageCredentials;
  endpoint?: string;
}
```

**Step 4: Create collection.ts with Collection interface**

```typescript
import type { Document, InsertDocument, UpdateDocument } from './document.js';
import type { QueryFilter, QueryOptions, UpdateOptions } from './query.js';

/**
 * Collection interface for type-safe CRUD operations
 */
export interface ICollection<T extends Document> {
  insert(data: InsertDocument<T>): Promise<T>;
  findById(id: string): Promise<T | null>;
  find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]>;
  update(id: string, data: UpdateDocument<T>, options?: UpdateOptions): Promise<T>;
  delete(id: string): Promise<void>;
}

/**
 * Collection metadata
 */
export interface CollectionMeta {
  name: string;
  version: number;
  indexShardCount: number;
  indexedFields: string[];
  createdAt: string;
  documentCount: number;
  lastUpdated: string;
}

/**
 * Index shard structure
 */
export interface IndexShard {
  shardId: string;
  documents: Record<string, any>;
}
```

**Step 5: Create errors.ts with error classes**

```typescript
/**
 * Base error class for BucketDB
 */
export class BucketDBError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BucketDBError';
  }
}

/**
 * Document not found error
 */
export class DocumentNotFoundError extends BucketDBError {
  constructor(id: string) {
    super(`Document not found: ${id}`);
    this.name = 'DocumentNotFoundError';
  }
}

/**
 * Concurrent update conflict error
 */
export class ConcurrentUpdateError extends BucketDBError {
  constructor(message: string = 'Concurrent update conflict, please retry') {
    super(message);
    this.name = 'ConcurrentUpdateError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends BucketDBError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Storage error
 */
export class StorageError extends BucketDBError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'StorageError';
  }
}
```

**Step 6: Create index.ts to export all types**

```typescript
// Document types
export type { Document, InsertDocument, UpdateDocument } from './document.js';

// Query types
export type {
  QueryOperator,
  QueryValue,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
} from './query.js';

// Storage types
export type {
  StorageObject,
  PutOptions,
  StorageAdapter,
  StorageCredentials,
  StorageAdapterConfig,
} from './storage.js';

// Collection types
export type {
  ICollection,
  CollectionMeta,
  IndexShard,
} from './collection.js';

// Error classes
export {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError,
} from './errors.js';
```

**Step 7: Build types package**

Run: `cd packages/types && bun run build`
Expected: Build successful, dist/ directory created with .js and .d.ts files

**Step 8: Commit**

```bash
git add packages/types/
git commit -m "feat: add core type definitions and interfaces"
```

---

## Task 3: Memory Storage Adapter (for testing)

**Files:**
- Create: `/packages/core/src/storage/memory-adapter.ts`
- Create: `/packages/core/tests/storage/memory-adapter.test.ts`

**Step 1: Write failing test for MemoryStorageAdapter**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import { StorageError } from '@bucket-db/types';

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
  });

  test('put and get object', async () => {
    const data = { name: 'test', value: 123 };
    const { etag } = await adapter.put('key1', data);

    expect(etag).toBeDefined();

    const result = await adapter.get('key1');
    expect(result.data).toEqual(data);
    expect(result.etag).toBe(etag);
    expect(result.lastModified).toBeInstanceOf(Date);
  });

  test('get non-existent key throws error', async () => {
    await expect(adapter.get('missing')).rejects.toThrow(StorageError);
  });

  test('exists returns true for existing key', async () => {
    await adapter.put('key1', { test: true });
    expect(await adapter.exists('key1')).toBe(true);
  });

  test('exists returns false for non-existent key', async () => {
    expect(await adapter.exists('missing')).toBe(false);
  });

  test('delete removes object', async () => {
    await adapter.put('key1', { test: true });
    await adapter.delete('key1');
    expect(await adapter.exists('key1')).toBe(false);
  });

  test('put with ifMatch fails when etag does not match', async () => {
    await adapter.put('key1', { version: 1 });
    await expect(
      adapter.put('key1', { version: 2 }, { ifMatch: 'wrong-etag' })
    ).rejects.toThrow('PreconditionFailed');
  });

  test('put with ifMatch succeeds when etag matches', async () => {
    const { etag: etag1 } = await adapter.put('key1', { version: 1 });
    const { etag: etag2 } = await adapter.put('key1', { version: 2 }, { ifMatch: etag1 });

    expect(etag2).toBeDefined();
    expect(etag2).not.toBe(etag1);

    const result = await adapter.get('key1');
    expect(result.data).toEqual({ version: 2 });
  });

  test('listKeys returns keys with prefix', async () => {
    await adapter.put('users/1', { id: 1 });
    await adapter.put('users/2', { id: 2 });
    await adapter.put('posts/1', { id: 1 });

    const keys = await adapter.listKeys('users/');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('users/1');
    expect(keys).toContain('users/2');
  });

  test('batchGet returns multiple objects', async () => {
    await adapter.put('key1', { value: 1 });
    await adapter.put('key2', { value: 2 });
    await adapter.put('key3', { value: 3 });

    const results = await adapter.batchGet(['key1', 'key2', 'missing']);

    expect(results.size).toBe(2);
    expect(results.get('key1')?.data).toEqual({ value: 1 });
    expect(results.get('key2')?.data).toEqual({ value: 2 });
    expect(results.has('missing')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test storage/memory-adapter.test.ts`
Expected: FAIL - MemoryStorageAdapter not found

**Step 3: Implement MemoryStorageAdapter**

```typescript
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
} from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';

interface StorageEntry {
  data: any;
  etag: string;
  lastModified: Date;
}

/**
 * In-memory storage adapter for testing
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private storage = new Map<string, StorageEntry>();
  private etagCounter = 0;

  private generateETag(): string {
    return `etag-${++this.etagCounter}-${Date.now()}`;
  }

  async get(key: string): Promise<StorageObject> {
    const entry = this.storage.get(key);
    if (!entry) {
      throw new StorageError(`Object not found: ${key}`);
    }
    return {
      data: JSON.parse(JSON.stringify(entry.data)), // Deep clone
      etag: entry.etag,
      lastModified: entry.lastModified,
    };
  }

  async put(
    key: string,
    data: any,
    options?: PutOptions
  ): Promise<{ etag: string }> {
    const existing = this.storage.get(key);

    // Check ifMatch condition
    if (options?.ifMatch) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new StorageError('PreconditionFailed: ETag mismatch');
      }
    }

    // Check ifNoneMatch condition
    if (options?.ifNoneMatch && existing) {
      throw new StorageError('PreconditionFailed: Object already exists');
    }

    const etag = this.generateETag();
    this.storage.set(key, {
      data: JSON.parse(JSON.stringify(data)), // Deep clone
      etag,
      lastModified: new Date(),
    });

    return { etag };
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for (const key of this.storage.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys.sort();
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    const results = new Map<string, StorageObject>();
    for (const key of keys) {
      const entry = this.storage.get(key);
      if (entry) {
        results.set(key, {
          data: JSON.parse(JSON.stringify(entry.data)),
          etag: entry.etag,
          lastModified: entry.lastModified,
        });
      }
    }
    return results;
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.storage.clear();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test storage/memory-adapter.test.ts`
Expected: PASS - All tests passing

**Step 5: Commit**

```bash
git add packages/core/src/storage/memory-adapter.ts packages/core/tests/storage/memory-adapter.test.ts
git commit -m "feat: implement MemoryStorageAdapter for testing"
```

---

## Task 4: Query Evaluation Engine

**Files:**
- Create: `/packages/core/src/query/evaluator.ts`
- Create: `/packages/core/tests/query/evaluator.test.ts`

**Step 1: Write failing test for query evaluator**

```typescript
import { describe, test, expect } from 'bun:test';
import { evaluateFilter, evaluateOperator } from '../../src/query/evaluator';

describe('Query Evaluator', () => {
  describe('evaluateOperator', () => {
    test('$eq operator', () => {
      expect(evaluateOperator(25, { $eq: 25 })).toBe(true);
      expect(evaluateOperator(25, { $eq: 30 })).toBe(false);
      expect(evaluateOperator('hello', { $eq: 'hello' })).toBe(true);
    });

    test('$ne operator', () => {
      expect(evaluateOperator(25, { $ne: 30 })).toBe(true);
      expect(evaluateOperator(25, { $ne: 25 })).toBe(false);
    });

    test('$gt operator', () => {
      expect(evaluateOperator(30, { $gt: 25 })).toBe(true);
      expect(evaluateOperator(25, { $gt: 25 })).toBe(false);
      expect(evaluateOperator(20, { $gt: 25 })).toBe(false);
    });

    test('$gte operator', () => {
      expect(evaluateOperator(30, { $gte: 25 })).toBe(true);
      expect(evaluateOperator(25, { $gte: 25 })).toBe(true);
      expect(evaluateOperator(20, { $gte: 25 })).toBe(false);
    });

    test('$lt operator', () => {
      expect(evaluateOperator(20, { $lt: 25 })).toBe(true);
      expect(evaluateOperator(25, { $lt: 25 })).toBe(false);
      expect(evaluateOperator(30, { $lt: 25 })).toBe(false);
    });

    test('$lte operator', () => {
      expect(evaluateOperator(20, { $lte: 25 })).toBe(true);
      expect(evaluateOperator(25, { $lte: 25 })).toBe(true);
      expect(evaluateOperator(30, { $lte: 25 })).toBe(false);
    });

    test('$in operator', () => {
      expect(evaluateOperator('active', { $in: ['active', 'pending'] })).toBe(true);
      expect(evaluateOperator('inactive', { $in: ['active', 'pending'] })).toBe(false);
      expect(evaluateOperator(25, { $in: [20, 25, 30] })).toBe(true);
    });

    test('$nin operator', () => {
      expect(evaluateOperator('inactive', { $nin: ['active', 'pending'] })).toBe(true);
      expect(evaluateOperator('active', { $nin: ['active', 'pending'] })).toBe(false);
    });

    test('multiple operators combined', () => {
      expect(evaluateOperator(25, { $gte: 18, $lt: 65 })).toBe(true);
      expect(evaluateOperator(15, { $gte: 18, $lt: 65 })).toBe(false);
      expect(evaluateOperator(70, { $gte: 18, $lt: 65 })).toBe(false);
    });

    test('direct value comparison (implicit $eq)', () => {
      expect(evaluateOperator(25, 25)).toBe(true);
      expect(evaluateOperator(25, 30)).toBe(false);
      expect(evaluateOperator('test', 'test')).toBe(true);
    });
  });

  describe('evaluateFilter', () => {
    test('simple equality filter', () => {
      const doc = { id: '1', name: 'Alice', age: 25 };
      expect(evaluateFilter(doc, { name: 'Alice' })).toBe(true);
      expect(evaluateFilter(doc, { name: 'Bob' })).toBe(false);
    });

    test('multiple conditions (AND)', () => {
      const doc = { id: '1', name: 'Alice', age: 25, status: 'active' };
      expect(evaluateFilter(doc, { name: 'Alice', status: 'active' })).toBe(true);
      expect(evaluateFilter(doc, { name: 'Alice', status: 'inactive' })).toBe(false);
    });

    test('operator-based filter', () => {
      const doc = { id: '1', age: 25 };
      expect(evaluateFilter(doc, { age: { $gte: 18 } })).toBe(true);
      expect(evaluateFilter(doc, { age: { $gte: 30 } })).toBe(false);
    });

    test('complex filter with multiple operators', () => {
      const doc = { id: '1', age: 25, status: 'active' };
      expect(
        evaluateFilter(doc, {
          age: { $gte: 18, $lt: 65 },
          status: { $in: ['active', 'pending'] },
        })
      ).toBe(true);
    });

    test('empty filter matches all', () => {
      const doc = { id: '1', name: 'test' };
      expect(evaluateFilter(doc, {})).toBe(true);
    });

    test('missing field returns false', () => {
      const doc = { id: '1', name: 'test' };
      expect(evaluateFilter(doc, { age: 25 })).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test query/evaluator.test.ts`
Expected: FAIL - evaluator module not found

**Step 3: Implement query evaluator**

```typescript
import type { QueryValue, QueryFilter } from '@bucket-db/types';

/**
 * Evaluates a single operator condition
 */
export function evaluateOperator<T>(
  value: T,
  condition: QueryValue<T>
): boolean {
  // Direct value comparison (implicit $eq)
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) {
    return value === condition;
  }

  const operators = condition as Record<string, any>;

  // Check all operators (AND logic)
  for (const [op, operand] of Object.entries(operators)) {
    switch (op) {
      case '$eq':
        if (value !== operand) return false;
        break;

      case '$ne':
        if (value === operand) return false;
        break;

      case '$gt':
        if (!(value > operand)) return false;
        break;

      case '$gte':
        if (!(value >= operand)) return false;
        break;

      case '$lt':
        if (!(value < operand)) return false;
        break;

      case '$lte':
        if (!(value <= operand)) return false;
        break;

      case '$in':
        if (!Array.isArray(operand) || !operand.includes(value)) return false;
        break;

      case '$nin':
        if (!Array.isArray(operand) || operand.includes(value)) return false;
        break;

      default:
        throw new Error(`Unknown operator: ${op}`);
    }
  }

  return true;
}

/**
 * Evaluates a complete filter against a document
 */
export function evaluateFilter<T extends Record<string, any>>(
  document: T,
  filter: QueryFilter<T>
): boolean {
  // Empty filter matches all documents
  if (Object.keys(filter).length === 0) {
    return true;
  }

  // All conditions must match (AND logic)
  for (const [field, condition] of Object.entries(filter)) {
    const value = document[field];

    // If field doesn't exist in document, fail the match
    if (value === undefined) {
      return false;
    }

    if (!evaluateOperator(value, condition as QueryValue<any>)) {
      return false;
    }
  }

  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test query/evaluator.test.ts`
Expected: PASS - All tests passing

**Step 5: Commit**

```bash
git add packages/core/src/query/evaluator.ts packages/core/tests/query/evaluator.test.ts
git commit -m "feat: implement query evaluation engine"
```

---

## Task 5: Index Manager with Sharding

**Files:**
- Create: `/packages/core/src/index/shard-manager.ts`
- Create: `/packages/core/src/utils/hash.ts`
- Create: `/packages/core/tests/index/shard-manager.test.ts`
- Create: `/packages/core/tests/utils/hash.test.ts`

**Step 1: Write failing test for hash function**

```typescript
import { describe, test, expect } from 'bun:test';
import { hashString, getShardId } from '../../src/utils/hash';

describe('Hash Utilities', () => {
  test('hashString produces consistent results', () => {
    const hash1 = hashString('test-id-123');
    const hash2 = hashString('test-id-123');
    expect(hash1).toBe(hash2);
  });

  test('hashString produces different results for different inputs', () => {
    const hash1 = hashString('id-1');
    const hash2 = hashString('id-2');
    expect(hash1).not.toBe(hash2);
  });

  test('getShardId returns value within range', () => {
    const shardId = getShardId('test-id', 16);
    expect(shardId).toBeGreaterThanOrEqual(0);
    expect(shardId).toBeLessThan(16);
  });

  test('getShardId is deterministic', () => {
    const shardId1 = getShardId('test-id', 16);
    const shardId2 = getShardId('test-id', 16);
    expect(shardId1).toBe(shardId2);
  });

  test('getShardId distributes across shards', () => {
    const shardCounts = new Map<number, number>();
    const shardCount = 16;

    // Generate 1000 IDs and count distribution
    for (let i = 0; i < 1000; i++) {
      const shardId = getShardId(`id-${i}`, shardCount);
      shardCounts.set(shardId, (shardCounts.get(shardId) || 0) + 1);
    }

    // Each shard should have at least some documents (rough distribution)
    expect(shardCounts.size).toBeGreaterThan(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test utils/hash.test.ts`
Expected: FAIL - hash module not found

**Step 3: Implement hash utilities**

```typescript
/**
 * Simple string hash function (DJB2 algorithm)
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Get shard ID for a document ID
 */
export function getShardId(docId: string, shardCount: number): number {
  return hashString(docId) % shardCount;
}

/**
 * Format shard ID as zero-padded string (e.g., "00", "01", "15")
 */
export function formatShardId(shardId: number): string {
  return shardId.toString().padStart(2, '0');
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test utils/hash.test.ts`
Expected: PASS - All tests passing

**Step 5: Write failing test for ShardManager**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { ShardManager } from '../../src/index/shard-manager';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import type { IndexShard } from '@bucket-db/types';

describe('ShardManager', () => {
  let adapter: MemoryStorageAdapter;
  let manager: ShardManager;
  const collectionPath = 'test-db/users';

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    manager = new ShardManager(adapter, collectionPath, 16);
  });

  test('addDocument adds entry to correct shard', async () => {
    const doc = {
      id: 'user-123',
      name: 'Alice',
      age: 25,
      _etag: 'etag-1',
      _updatedAt: '2026-02-08T00:00:00Z',
    };

    await manager.addDocument(doc);

    // Verify document was added to a shard
    const result = await manager.findById('user-123');
    expect(result).toEqual(doc);
  });

  test('updateDocument updates existing entry', async () => {
    const doc1 = {
      id: 'user-123',
      name: 'Alice',
      age: 25,
      _etag: 'etag-1',
      _updatedAt: '2026-02-08T00:00:00Z',
    };

    await manager.addDocument(doc1);

    const doc2 = {
      id: 'user-123',
      name: 'Alice',
      age: 26,
      _etag: 'etag-2',
      _updatedAt: '2026-02-08T01:00:00Z',
    };

    await manager.updateDocument(doc2);

    const result = await manager.findById('user-123');
    expect(result?.age).toBe(26);
    expect(result?._etag).toBe('etag-2');
  });

  test('removeDocument deletes entry', async () => {
    const doc = {
      id: 'user-123',
      name: 'Alice',
      age: 25,
      _etag: 'etag-1',
      _updatedAt: '2026-02-08T00:00:00Z',
    };

    await manager.addDocument(doc);
    await manager.removeDocument('user-123');

    const result = await manager.findById('user-123');
    expect(result).toBeNull();
  });

  test('findById returns null for non-existent document', async () => {
    const result = await manager.findById('missing');
    expect(result).toBeNull();
  });

  test('query returns matching documents', async () => {
    const docs = [
      { id: 'user-1', name: 'Alice', age: 25, status: 'active', _etag: 'e1', _updatedAt: '2026-02-08T00:00:00Z' },
      { id: 'user-2', name: 'Bob', age: 30, status: 'active', _etag: 'e2', _updatedAt: '2026-02-08T00:00:00Z' },
      { id: 'user-3', name: 'Charlie', age: 35, status: 'inactive', _etag: 'e3', _updatedAt: '2026-02-08T00:00:00Z' },
    ];

    for (const doc of docs) {
      await manager.addDocument(doc);
    }

    const results = await manager.query({ status: 'active' });
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id).sort()).toEqual(['user-1', 'user-2']);
  });

  test('query with operators', async () => {
    const docs = [
      { id: 'user-1', age: 20, _etag: 'e1', _updatedAt: '2026-02-08T00:00:00Z' },
      { id: 'user-2', age: 25, _etag: 'e2', _updatedAt: '2026-02-08T00:00:00Z' },
      { id: 'user-3', age: 30, _etag: 'e3', _updatedAt: '2026-02-08T00:00:00Z' },
      { id: 'user-4', age: 35, _etag: 'e4', _updatedAt: '2026-02-08T00:00:00Z' },
    ];

    for (const doc of docs) {
      await manager.addDocument(doc);
    }

    const results = await manager.query({ age: { $gte: 25, $lt: 35 } });
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id).sort()).toEqual(['user-2', 'user-3']);
  });

  test('handles multiple documents in different shards', async () => {
    // Add enough documents to ensure distribution across shards
    const docs = Array.from({ length: 50 }, (_, i) => ({
      id: `user-${i}`,
      name: `User ${i}`,
      age: 20 + (i % 30),
      _etag: `etag-${i}`,
      _updatedAt: '2026-02-08T00:00:00Z',
    }));

    for (const doc of docs) {
      await manager.addDocument(doc);
    }

    const results = await manager.query({ age: { $gte: 25 } });
    expect(results.length).toBeGreaterThan(0);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `cd packages/core && bun test index/shard-manager.test.ts`
Expected: FAIL - ShardManager not found

**Step 7: Implement ShardManager**

```typescript
import type { StorageAdapter, IndexShard, QueryFilter } from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';
import { getShardId, formatShardId } from '../utils/hash.js';
import { evaluateFilter } from '../query/evaluator.js';

/**
 * Manages index shards for a collection
 */
export class ShardManager {
  constructor(
    private adapter: StorageAdapter,
    private collectionPath: string,
    private shardCount: number
  ) {}

  private getShardPath(shardId: number): string {
    return `${this.collectionPath}/index/shard-${formatShardId(shardId)}.json`;
  }

  private async readShard(shardId: number): Promise<IndexShard> {
    const path = this.getShardPath(shardId);
    try {
      const { data } = await this.adapter.get(path);
      return data as IndexShard;
    } catch (error) {
      // Return empty shard if not found
      return {
        shardId: formatShardId(shardId),
        documents: {},
      };
    }
  }

  private async writeShard(shardId: number, shard: IndexShard, etag?: string): Promise<void> {
    const path = this.getShardPath(shardId);
    await this.adapter.put(path, shard, etag ? { ifMatch: etag } : undefined);
  }

  /**
   * Add document to index
   */
  async addDocument(doc: Record<string, any>): Promise<void> {
    const docId = doc.id;
    const shardId = getShardId(docId, this.shardCount);

    // Retry logic for optimistic locking
    let retries = 3;
    while (retries > 0) {
      try {
        const shard = await this.readShard(shardId);
        const currentEtag = shard.documents[docId] ?
          (await this.adapter.get(this.getShardPath(shardId))).etag :
          undefined;

        shard.documents[docId] = { ...doc };

        await this.writeShard(shardId, shard, currentEtag);
        return;
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
          retries--;
          await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
          continue;
        }
        throw error;
      }
    }
    throw new StorageError('Failed to add document after retries');
  }

  /**
   * Update document in index
   */
  async updateDocument(doc: Record<string, any>): Promise<void> {
    await this.addDocument(doc); // Same as add - upsert behavior
  }

  /**
   * Remove document from index
   */
  async removeDocument(docId: string): Promise<void> {
    const shardId = getShardId(docId, this.shardCount);

    let retries = 3;
    while (retries > 0) {
      try {
        const { etag } = await this.adapter.get(this.getShardPath(shardId));
        const shard = await this.readShard(shardId);

        delete shard.documents[docId];

        await this.writeShard(shardId, shard, etag);
        return;
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
          retries--;
          await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
          continue;
        }
        // Ignore if shard doesn't exist
        if (error instanceof StorageError && error.message.includes('not found')) {
          return;
        }
        throw error;
      }
    }
  }

  /**
   * Find document by ID
   */
  async findById(docId: string): Promise<Record<string, any> | null> {
    const shardId = getShardId(docId, this.shardCount);
    const shard = await this.readShard(shardId);
    return shard.documents[docId] || null;
  }

  /**
   * Query documents matching filter
   */
  async query(filter: QueryFilter<any>): Promise<Array<Record<string, any>>> {
    // Read all shards in parallel
    const shardPromises = Array.from(
      { length: this.shardCount },
      (_, i) => this.readShard(i)
    );

    const shards = await Promise.all(shardPromises);

    // Filter documents across all shards
    const results: Array<Record<string, any>> = [];
    for (const shard of shards) {
      for (const doc of Object.values(shard.documents)) {
        if (evaluateFilter(doc, filter)) {
          results.push(doc);
        }
      }
    }

    return results;
  }
}
```

**Step 8: Run test to verify it passes**

Run: `cd packages/core && bun test index/shard-manager.test.ts`
Expected: PASS - All tests passing

**Step 9: Commit**

```bash
git add packages/core/src/index/ packages/core/src/utils/ packages/core/tests/
git commit -m "feat: implement index shard manager with query support"
```

---

## Task 6: Collection Implementation

**Files:**
- Create: `/packages/core/src/core/collection.ts`
- Create: `/packages/core/tests/core/collection.test.ts`

**Step 1: Write failing test for Collection**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { Collection } from '../../src/core/collection';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import type { Document } from '@bucket-db/types';
import { DocumentNotFoundError, ConcurrentUpdateError } from '@bucket-db/types';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

describe('Collection', () => {
  let adapter: MemoryStorageAdapter;
  let collection: Collection<User>;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    collection = new Collection<User>(adapter, 'test-db', 'users', { shardCount: 16 });
  });

  describe('insert', () => {
    test('inserts document with generated ID', async () => {
      const user = await collection.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        status: 'active',
      });

      expect(user.id).toBeDefined();
      expect(user.name).toBe('Alice');
      expect(user.age).toBe(25);
      expect(user._etag).toBeDefined();
      expect(user._createdAt).toBeDefined();
      expect(user._updatedAt).toBeDefined();
    });

    test('inserts multiple documents', async () => {
      const user1 = await collection.insert({ name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });
      const user2 = await collection.insert({ name: 'Bob', age: 30, email: 'bob@example.com', status: 'active' });

      expect(user1.id).not.toBe(user2.id);
    });
  });

  describe('findById', () => {
    test('finds existing document', async () => {
      const inserted = await collection.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        status: 'active',
      });

      const found = await collection.findById(inserted.id);
      expect(found).toEqual(inserted);
    });

    test('returns null for non-existent document', async () => {
      const found = await collection.findById('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await collection.insert({ name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });
      await collection.insert({ name: 'Bob', age: 30, email: 'bob@example.com', status: 'active' });
      await collection.insert({ name: 'Charlie', age: 35, email: 'charlie@example.com', status: 'inactive' });
    });

    test('finds documents by equality filter', async () => {
      const results = await collection.find({ status: 'active' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'active')).toBe(true);
    });

    test('finds documents with operator filter', async () => {
      const results = await collection.find({ age: { $gte: 30 } });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.age >= 30)).toBe(true);
    });

    test('finds documents with multiple conditions', async () => {
      const results = await collection.find({
        status: 'active',
        age: { $gte: 25, $lt: 35 },
      });
      expect(results).toHaveLength(2);
    });

    test('returns empty array when no matches', async () => {
      const results = await collection.find({ name: 'David' });
      expect(results).toHaveLength(0);
    });

    test('applies limit option', async () => {
      const results = await collection.find({ status: 'active' }, { limit: 1 });
      expect(results).toHaveLength(1);
    });

    test('applies offset option', async () => {
      const all = await collection.find({ status: 'active' });
      const withOffset = await collection.find({ status: 'active' }, { offset: 1 });

      expect(withOffset).toHaveLength(1);
      expect(withOffset[0].id).toBe(all[1].id);
    });

    test('applies limit and offset together', async () => {
      const results = await collection.find({}, { limit: 1, offset: 1 });
      expect(results).toHaveLength(1);
    });
  });

  describe('update', () => {
    test('updates existing document', async () => {
      const user = await collection.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        status: 'active',
      });

      const updated = await collection.update(user.id, { age: 26 });

      expect(updated.id).toBe(user.id);
      expect(updated.age).toBe(26);
      expect(updated.name).toBe('Alice');
      expect(updated._etag).not.toBe(user._etag);
      expect(updated._updatedAt).not.toBe(user._updatedAt);
    });

    test('throws error when document not found', async () => {
      await expect(
        collection.update('non-existent', { age: 30 })
      ).rejects.toThrow(DocumentNotFoundError);
    });

    test('optimistic locking with correct etag', async () => {
      const user = await collection.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        status: 'active',
      });

      const updated = await collection.update(
        user.id,
        { age: 26 },
        { etag: user._etag }
      );

      expect(updated.age).toBe(26);
    });

    test('optimistic locking fails with wrong etag', async () => {
      const user = await collection.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        status: 'active',
      });

      await expect(
        collection.update(user.id, { age: 26 }, { etag: 'wrong-etag' })
      ).rejects.toThrow(ConcurrentUpdateError);
    });
  });

  describe('delete', () => {
    test('deletes existing document', async () => {
      const user = await collection.insert({
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        status: 'active',
      });

      await collection.delete(user.id);

      const found = await collection.findById(user.id);
      expect(found).toBeNull();
    });

    test('throws error when document not found', async () => {
      await expect(collection.delete('non-existent')).rejects.toThrow(DocumentNotFoundError);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test core/collection.test.ts`
Expected: FAIL - Collection not found

**Step 3: Implement Collection class**

```typescript
import type {
  ICollection,
  Document,
  InsertDocument,
  UpdateDocument,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  StorageAdapter,
} from '@bucket-db/types';
import { DocumentNotFoundError, ConcurrentUpdateError } from '@bucket-db/types';
import { ShardManager } from '../index/shard-manager.js';

/**
 * Generate UUID v4
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
function now(): string {
  return new Date().toISOString();
}

export interface CollectionOptions {
  shardCount?: number;
}

/**
 * Collection class for type-safe CRUD operations
 */
export class Collection<T extends Document> implements ICollection<T> {
  private shardManager: ShardManager;
  private basePath: string;

  constructor(
    private adapter: StorageAdapter,
    private dbPath: string,
    private collectionName: string,
    options: CollectionOptions = {}
  ) {
    this.basePath = `${dbPath}/${collectionName}`;
    this.shardManager = new ShardManager(
      adapter,
      this.basePath,
      options.shardCount || 16
    );
  }

  private getDocPath(id: string): string {
    return `${this.basePath}/docs/${id}.json`;
  }

  async insert(data: InsertDocument<T>): Promise<T> {
    const id = generateId();
    const timestamp = now();

    const document: T = {
      ...data,
      id,
      _createdAt: timestamp,
      _updatedAt: timestamp,
    } as T;

    // Write document to storage
    const { etag } = await this.adapter.put(this.getDocPath(id), document);

    document._etag = etag;

    // Add to index
    await this.shardManager.addDocument(document);

    return document;
  }

  async findById(id: string): Promise<T | null> {
    try {
      const { data } = await this.adapter.get(this.getDocPath(id));
      return data as T;
    } catch (error) {
      return null;
    }
  }

  async find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]> {
    // Query index to get matching document IDs
    const indexResults = await this.shardManager.query(filter);

    // Get full documents
    const ids = indexResults.map(doc => doc.id);

    if (ids.length === 0) {
      return [];
    }

    // Batch get documents
    const docMap = await this.adapter.batchGet(ids.map(id => this.getDocPath(id)));

    let results = Array.from(docMap.values()).map(obj => obj.data as T);

    // Apply pagination
    if (options?.offset) {
      results = results.slice(options.offset);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async update(
    id: string,
    data: UpdateDocument<T>,
    options?: UpdateOptions
  ): Promise<T> {
    // Get current document
    const current = await this.findById(id);
    if (!current) {
      throw new DocumentNotFoundError(id);
    }

    // Check optimistic lock if etag provided
    if (options?.etag && current._etag !== options.etag) {
      throw new ConcurrentUpdateError(`ETag mismatch for document ${id}`);
    }

    // Merge updates
    const updated: T = {
      ...current,
      ...data,
      id,
      _updatedAt: now(),
    } as T;

    // Write document
    const { etag } = await this.adapter.put(
      this.getDocPath(id),
      updated,
      current._etag ? { ifMatch: current._etag } : undefined
    );

    updated._etag = etag;

    // Update index
    await this.shardManager.updateDocument(updated);

    return updated;
  }

  async delete(id: string): Promise<void> {
    // Check if document exists
    const exists = await this.findById(id);
    if (!exists) {
      throw new DocumentNotFoundError(id);
    }

    // Delete from storage
    await this.adapter.delete(this.getDocPath(id));

    // Remove from index
    await this.shardManager.removeDocument(id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test core/collection.test.ts`
Expected: PASS - All tests passing

**Step 5: Commit**

```bash
git add packages/core/src/core/collection.ts packages/core/tests/core/collection.test.ts
git commit -m "feat: implement Collection with CRUD operations"
```

---

## Task 7: BucketDB Main Class

**Files:**
- Create: `/packages/core/src/core/bucket-db.ts`
- Create: `/packages/core/src/index.ts`
- Create: `/packages/core/tests/core/bucket-db.test.ts`

**Step 1: Write failing test for BucketDB**

```typescript
import { describe, test, expect } from 'bun:test';
import { BucketDB } from '../../src/core/bucket-db';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import type { Document } from '@bucket-db/types';

interface User extends Document {
  name: string;
  email: string;
}

describe('BucketDB', () => {
  test('creates database instance with memory adapter', () => {
    const adapter = new MemoryStorageAdapter();
    const db = new BucketDB(adapter, 'test-db');

    expect(db).toBeDefined();
  });

  test('creates collection', () => {
    const adapter = new MemoryStorageAdapter();
    const db = new BucketDB(adapter, 'test-db');

    const users = db.collection<User>('users');
    expect(users).toBeDefined();
  });

  test('same collection name returns same instance', () => {
    const adapter = new MemoryStorageAdapter();
    const db = new BucketDB(adapter, 'test-db');

    const users1 = db.collection<User>('users');
    const users2 = db.collection<User>('users');

    expect(users1).toBe(users2);
  });

  test('end-to-end: insert and query across collections', async () => {
    const adapter = new MemoryStorageAdapter();
    const db = new BucketDB(adapter, 'test-db');

    const users = db.collection<User>('users');

    await users.insert({ name: 'Alice', email: 'alice@example.com' });
    await users.insert({ name: 'Bob', email: 'bob@example.com' });

    const results = await users.find({ name: 'Alice' });
    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('alice@example.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test core/bucket-db.test.ts`
Expected: FAIL - BucketDB not found

**Step 3: Implement BucketDB class**

```typescript
import type { StorageAdapter, Document } from '@bucket-db/types';
import { Collection, CollectionOptions } from './collection.js';

export interface BucketDBOptions {
  defaultShardCount?: number;
}

/**
 * Main BucketDB class
 */
export class BucketDB {
  private collections = new Map<string, Collection<any>>();

  constructor(
    private adapter: StorageAdapter,
    private dbPath: string,
    private options: BucketDBOptions = {}
  ) {}

  /**
   * Get or create a collection
   */
  collection<T extends Document>(
    name: string,
    options?: CollectionOptions
  ): Collection<T> {
    if (this.collections.has(name)) {
      return this.collections.get(name)!;
    }

    const collection = new Collection<T>(
      this.adapter,
      this.dbPath,
      name,
      {
        shardCount: options?.shardCount || this.options.defaultShardCount || 16,
      }
    );

    this.collections.set(name, collection);
    return collection;
  }
}
```

**Step 4: Create main index.ts export file**

```typescript
// Core classes
export { BucketDB } from './core/bucket-db.js';
export { Collection } from './core/collection.js';

// Storage adapters
export { MemoryStorageAdapter } from './storage/memory-adapter.js';

// Re-export types from @bucket-db/types
export type {
  Document,
  InsertDocument,
  UpdateDocument,
  QueryOperator,
  QueryValue,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  StorageAdapter,
  StorageObject,
  PutOptions,
  StorageCredentials,
  StorageAdapterConfig,
  ICollection,
  CollectionMeta,
  IndexShard,
} from '@bucket-db/types';

export {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError,
} from '@bucket-db/types';
```

**Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test core/bucket-db.test.ts`
Expected: PASS - All tests passing

**Step 6: Build core package**

Run: `cd packages/core && bun run build`
Expected: Build successful

**Step 7: Run all tests**

Run: `cd packages/core && bun test`
Expected: All tests passing

**Step 8: Commit**

```bash
git add packages/core/src/core/bucket-db.ts packages/core/src/index.ts packages/core/tests/core/bucket-db.test.ts
git commit -m "feat: implement BucketDB main class and exports"
```

---

## Task 8: S3 Storage Adapter

**Files:**
- Create: `/packages/core/src/storage/s3-adapter.ts`
- Create: `/packages/core/tests/storage/s3-adapter.test.ts`

**Step 1: Write test for S3Adapter (will be skipped if no AWS credentials)**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { S3Adapter } from '../../src/storage/s3-adapter';
import { StorageError } from '@bucket-db/types';

// Skip tests if no AWS credentials available
const skipIfNoCredentials = process.env.AWS_ACCESS_KEY_ID ? test : test.skip;

describe('S3Adapter', () => {
  let adapter: S3Adapter;

  beforeEach(() => {
    adapter = new S3Adapter({
      bucket: process.env.TEST_S3_BUCKET || 'test-bucket',
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
      },
      endpoint: process.env.S3_ENDPOINT, // For LocalStack
    });
  });

  skipIfNoCredentials('put and get object', async () => {
    const data = { name: 'test', value: 123 };
    const { etag } = await adapter.put('test/key1.json', data);

    expect(etag).toBeDefined();

    const result = await adapter.get('test/key1.json');
    expect(result.data).toEqual(data);
    expect(result.etag).toBe(etag);
  });

  skipIfNoCredentials('exists returns true for existing key', async () => {
    await adapter.put('test/key1.json', { test: true });
    expect(await adapter.exists('test/key1.json')).toBe(true);
  });

  skipIfNoCredentials('delete removes object', async () => {
    await adapter.put('test/key1.json', { test: true });
    await adapter.delete('test/key1.json');
    expect(await adapter.exists('test/key1.json')).toBe(false);
  });

  skipIfNoCredentials('put with ifMatch optimistic locking', async () => {
    const { etag: etag1 } = await adapter.put('test/key1.json', { version: 1 });
    const { etag: etag2 } = await adapter.put('test/key1.json', { version: 2 }, { ifMatch: etag1 });

    expect(etag2).toBeDefined();
    expect(etag2).not.toBe(etag1);
  });

  test('adapter structure is correct', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.put).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.exists).toBe('function');
    expect(typeof adapter.listKeys).toBe('function');
    expect(typeof adapter.batchGet).toBe('function');
  });
});
```

**Step 2: Implement S3Adapter**

```typescript
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  StorageAdapterConfig,
} from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';

/**
 * S3 storage adapter
 */
export class S3Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(config: StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: config.credentials,
      endpoint: config.endpoint,
    });
  }

  async get(key: string): Promise<StorageObject> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      const body = await response.Body?.transformToString();

      if (!body) {
        throw new StorageError(`Empty response for key: ${key}`);
      }

      return {
        data: JSON.parse(body),
        etag: response.ETag?.replace(/"/g, '') || '',
        lastModified: response.LastModified || new Date(),
      };
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        throw new StorageError(`Object not found: ${key}`);
      }
      throw new StorageError(`Failed to get object: ${error.message}`, error);
    }
  }

  async put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: 'application/json',
        IfMatch: options?.ifMatch,
        IfNoneMatch: options?.ifNoneMatch,
      });

      const response = await this.client.send(command);

      return {
        etag: response.ETag?.replace(/"/g, '') || '',
      };
    } catch (error: any) {
      if (error.name === 'PreconditionFailed') {
        throw new StorageError('PreconditionFailed: ETag mismatch');
      }
      throw new StorageError(`Failed to put object: ${error.message}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
    } catch (error: any) {
      throw new StorageError(`Failed to delete object: ${error.message}`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return false;
      }
      throw new StorageError(`Failed to check existence: ${error.message}`, error);
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });

      const response = await this.client.send(command);
      return (response.Contents || []).map(obj => obj.Key!).filter(Boolean);
    } catch (error: any) {
      throw new StorageError(`Failed to list keys: ${error.message}`, error);
    }
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    const results = new Map<string, StorageObject>();

    // Fetch in parallel
    const promises = keys.map(async (key) => {
      try {
        const obj = await this.get(key);
        return { key, obj };
      } catch (error) {
        return null;
      }
    });

    const settled = await Promise.all(promises);

    for (const result of settled) {
      if (result) {
        results.set(result.key, result.obj);
      }
    }

    return results;
  }
}
```

**Step 3: Update core/index.ts to export S3Adapter**

```typescript
// Storage adapters
export { MemoryStorageAdapter } from './storage/memory-adapter.js';
export { S3Adapter } from './storage/s3-adapter.js';
```

**Step 4: Run tests**

Run: `cd packages/core && bun test storage/s3-adapter.test.ts`
Expected: Tests pass (or skip if no AWS credentials)

**Step 5: Commit**

```bash
git add packages/core/src/storage/s3-adapter.ts packages/core/tests/storage/s3-adapter.test.ts packages/core/src/index.ts
git commit -m "feat: implement S3 storage adapter"
```

---

## Task 9: OSS Storage Adapter

**Files:**
- Create: `/packages/core/src/storage/oss-adapter.ts`
- Create: `/packages/core/tests/storage/oss-adapter.test.ts`

**Step 1: Write test for OSSAdapter (will be skipped if no credentials)**

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { OSSAdapter } from '../../src/storage/oss-adapter';

const skipIfNoCredentials = process.env.OSS_ACCESS_KEY_ID ? test : test.skip;

describe('OSSAdapter', () => {
  let adapter: OSSAdapter;

  beforeEach(() => {
    adapter = new OSSAdapter({
      bucket: process.env.TEST_OSS_BUCKET || 'test-bucket',
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      credentials: {
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET || 'test',
      },
      endpoint: process.env.OSS_ENDPOINT,
    });
  });

  skipIfNoCredentials('put and get object', async () => {
    const data = { name: 'test', value: 123 };
    const { etag } = await adapter.put('test/key1.json', data);

    expect(etag).toBeDefined();

    const result = await adapter.get('test/key1.json');
    expect(result.data).toEqual(data);
  });

  test('adapter structure is correct', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.put).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.exists).toBe('function');
    expect(typeof adapter.listKeys).toBe('function');
    expect(typeof adapter.batchGet).toBe('function');
  });
});
```

**Step 2: Implement OSSAdapter**

```typescript
import OSS from 'ali-oss';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  StorageAdapterConfig,
} from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';

/**
 * Alibaba Cloud OSS storage adapter
 */
export class OSSAdapter implements StorageAdapter {
  private client: OSS;
  private bucket: string;

  constructor(config: StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.client = new OSS({
      region: config.region,
      accessKeyId: config.credentials.accessKeyId,
      accessKeySecret: config.credentials.secretAccessKey,
      bucket: config.bucket,
      endpoint: config.endpoint,
    });
  }

  async get(key: string): Promise<StorageObject> {
    try {
      const result = await this.client.get(key);

      return {
        data: JSON.parse(result.content.toString()),
        etag: result.res.headers.etag?.replace(/"/g, '') || '',
        lastModified: new Date(result.res.headers['last-modified']),
      };
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        throw new StorageError(`Object not found: ${key}`);
      }
      throw new StorageError(`Failed to get object: ${error.message}`, error);
    }
  }

  async put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }> {
    try {
      const headers: Record<string, string> = {};

      if (options?.ifMatch) {
        headers['If-Match'] = options.ifMatch;
      }
      if (options?.ifNoneMatch) {
        headers['If-None-Match'] = options.ifNoneMatch;
      }

      const result = await this.client.put(key, Buffer.from(JSON.stringify(data)), {
        headers,
      });

      return {
        etag: result.res.headers.etag?.replace(/"/g, '') || '',
      };
    } catch (error: any) {
      if (error.code === 'PreconditionFailed') {
        throw new StorageError('PreconditionFailed: ETag mismatch');
      }
      throw new StorageError(`Failed to put object: ${error.message}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (error: any) {
      throw new StorageError(`Failed to delete object: ${error.message}`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(key);
      return true;
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return false;
      }
      throw new StorageError(`Failed to check existence: ${error.message}`, error);
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    try {
      const result = await this.client.list({ prefix });
      return (result.objects || []).map(obj => obj.name);
    } catch (error: any) {
      throw new StorageError(`Failed to list keys: ${error.message}`, error);
    }
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    const results = new Map<string, StorageObject>();

    const promises = keys.map(async (key) => {
      try {
        const obj = await this.get(key);
        return { key, obj };
      } catch (error) {
        return null;
      }
    });

    const settled = await Promise.all(promises);

    for (const result of settled) {
      if (result) {
        results.set(result.key, result.obj);
      }
    }

    return results;
  }
}
```

**Step 3: Update core/index.ts to export OSSAdapter**

```typescript
export { OSSAdapter } from './storage/oss-adapter.js';
```

**Step 4: Run tests**

Run: `cd packages/core && bun test storage/oss-adapter.test.ts`
Expected: Tests pass (or skip if no credentials)

**Step 5: Commit**

```bash
git add packages/core/src/storage/oss-adapter.ts packages/core/tests/storage/oss-adapter.test.ts packages/core/src/index.ts
git commit -m "feat: implement OSS storage adapter"
```

---

## Task 10: Documentation and Examples

**Files:**
- Create: `/README.md`
- Create: `/packages/core/README.md`
- Create: `/examples/basic-usage/index.ts`
- Create: `/examples/basic-usage/package.json`

**Step 1: Create root README.md**

```markdown
# BucketDB

A TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS).

## Features

- 🚀 Use cloud object storage as backend - no database servers needed
- 📦 Type-safe TypeScript API with full type inference
- 🔍 Flexible document queries (equality and comparison operators)
- 🔒 Optimistic locking via ETag for concurrency control
- ☁️ Support for AWS S3 and Alibaba Cloud OSS with unified API
- 🎯 Collections organize documents with independent indexes
- 📊 Sharded index design scales to hundreds of thousands of documents

## Installation

```bash
bun add @bucket-db/core
```

## Quick Start

```typescript
import { BucketDB, MemoryStorageAdapter } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

// Create database with memory adapter (for testing)
const adapter = new MemoryStorageAdapter();
const db = new BucketDB(adapter, 'my-app');

// Get collection
const users = db.collection<User>('users');

// Insert document
const user = await users.insert({
  name: 'Alice',
  age: 25,
  email: 'alice@example.com',
  status: 'active',
});

// Find by ID
const found = await users.findById(user.id);

// Query documents
const activeUsers = await users.find({ status: 'active' });
const adults = await users.find({ age: { $gte: 18 } });

// Update with optimistic locking
const updated = await users.update(user.id, { age: 26 }, { etag: user._etag });

// Delete
await users.delete(user.id);
```

## Using S3

```typescript
import { BucketDB, S3Adapter } from '@bucket-db/core';

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const db = new BucketDB(adapter, 'production');
```

## Using Alibaba Cloud OSS

```typescript
import { BucketDB, OSSAdapter } from '@bucket-db/core';

const adapter = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'oss-cn-hangzhou',
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET!,
  },
});

const db = new BucketDB(adapter, 'production');
```

## Query Operators

- `$eq` - Equal (default)
- `$ne` - Not equal
- `$gt`, `$gte` - Greater than, greater than or equal
- `$lt`, `$lte` - Less than, less than or equal
- `$in` - In array
- `$nin` - Not in array

## Packages

- `@bucket-db/core` - Core database engine
- `@bucket-db/types` - TypeScript type definitions

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build all packages
bun run build
```

## License

MIT
```

**Step 2: Create packages/core/README.md**

```markdown
# @bucket-db/core

Core database engine for BucketDB.

See the [main README](../../README.md) for usage and documentation.

## API

### BucketDB

Main database class.

```typescript
const db = new BucketDB(adapter, dbPath, options);
```

### Collection

Type-safe collection interface.

```typescript
const collection = db.collection<T>(name);

await collection.insert(data);
await collection.findById(id);
await collection.find(filter, options);
await collection.update(id, data, options);
await collection.delete(id);
```

### Storage Adapters

- `MemoryStorageAdapter` - In-memory storage for testing
- `S3Adapter` - AWS S3 storage
- `OSSAdapter` - Alibaba Cloud OSS storage

## License

MIT
```

**Step 3: Create examples/basic-usage/package.json**

```json
{
  "name": "basic-usage-example",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@bucket-db/core": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

**Step 4: Create examples/basic-usage/index.ts**

```typescript
import { BucketDB, MemoryStorageAdapter } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

async function main() {
  // Create database with memory adapter
  const adapter = new MemoryStorageAdapter();
  const db = new BucketDB(adapter, 'my-app');

  // Get users collection
  const users = db.collection<User>('users');

  console.log('Inserting users...');
  const alice = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com',
    status: 'active',
  });
  console.log('Inserted:', alice);

  await users.insert({
    name: 'Bob',
    age: 30,
    email: 'bob@example.com',
    status: 'active',
  });

  await users.insert({
    name: 'Charlie',
    age: 35,
    email: 'charlie@example.com',
    status: 'inactive',
  });

  console.log('\nFinding active users...');
  const activeUsers = await users.find({ status: 'active' });
  console.log('Active users:', activeUsers.length);

  console.log('\nFinding users aged 25+...');
  const adults = await users.find({ age: { $gte: 25 } });
  console.log('Users 25+:', adults.length);

  console.log('\nUpdating Alice...');
  const updated = await users.update(alice.id, { age: 26 });
  console.log('Updated:', updated);

  console.log('\nDeleting Charlie...');
  const charlie = activeUsers.find(u => u.name === 'Charlie');
  if (charlie) {
    await users.delete(charlie.id);
    console.log('Deleted Charlie');
  }

  console.log('\nFinal count:');
  const all = await users.find({});
  console.log('Total users:', all.length);
}

main().catch(console.error);
```

**Step 5: Run example**

Run: `bun install && cd examples/basic-usage && bun run index.ts`
Expected: Example runs successfully and prints results

**Step 6: Commit**

```bash
git add README.md packages/core/README.md examples/
git commit -m "docs: add README and basic usage example"
```

---

## Task 11: Final Testing and Package Preparation

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests passing

**Step 2: Build all packages**

Run: `bun run build`
Expected: All packages build successfully

**Step 3: Add package.json publish configuration to core**

Edit `packages/core/package.json` to add:

```json
{
  "publishConfig": {
    "access": "public"
  },
  "keywords": [
    "database",
    "document-db",
    "s3",
    "oss",
    "typescript",
    "cloud-storage"
  ],
  "author": "",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/bucket-db.git",
    "directory": "packages/core"
  }
}
```

**Step 4: Add package.json publish configuration to types**

Edit `packages/types/package.json` similarly.

**Step 5: Verify package structure**

Run: `cd packages/core && ls -la dist/`
Expected: dist/ contains .js and .d.ts files

**Step 6: Commit**

```bash
git add packages/*/package.json
git commit -m "chore: prepare packages for publishing"
```

---

## Execution Complete

Plan complete and saved to `docs/plans/2026-02-08-bucket-db-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
