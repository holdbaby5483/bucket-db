# BucketDB 类

主数据库类,管理集合和配置。

### BucketDB

Main database class for managing collections.

#### Constructor

```typescript
new BucketDB(
  adapter: StorageAdapter,
  dbPath: string,
  options?: BucketDBOptions
)
```

**Parameters:**
- `adapter` - Storage adapter instance (MemoryStorageAdapter, FileSystemAdapter, S3Adapter, or OSSAdapter)
- `dbPath` - Database path for isolation (e.g., 'my-app', 'tenant-123')
- `options` - Optional configuration
  - `defaultShardCount?: number` - Default number of shards for collections (default: 16)

**Example:**
```typescript
import { BucketDB, FileSystemAdapter } from '@bucket-db/core';

const db = new BucketDB(
  new FileSystemAdapter({ basePath: './data' }),
  'my-app',
  { defaultShardCount: 32 }
);
```

#### Methods

##### `collection<T>(name: string, options?: CollectionOptions): Collection<T>`

Get or create a collection with type-safe operations.

**Parameters:**
- `name` - Collection name
- `options` - Optional collection configuration
  - `shardCount?: number` - Number of shards (overrides default)

**Returns:** `Collection<T>` instance

**Example:**
```typescript
interface User extends Document {
  name: string;
  email: string;
}

const users = db.collection<User>('users');
```

---
