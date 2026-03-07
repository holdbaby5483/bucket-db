# BucketDB

A TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system.

## Features

- 🚀 Use cloud object storage or local files as backend - no database servers needed
- 📦 Type-safe TypeScript API with full type inference
- 🔍 Flexible document queries (equality and comparison operators)
- 🔒 Optimistic locking via ETag for concurrency control
- ☁️ Support for AWS S3, Alibaba Cloud OSS, and local file system with unified API
- 🎯 Collections organize documents with independent indexes
- 📊 Sharded index design scales to hundreds of thousands of documents

## Installation

```bash
bun add @hold-baby/bucket-db-core
```

## Quick Start

### Using Local File System (Development)

```typescript
import { BucketDB, FileSystemAdapter } from '@hold-baby/bucket-db-core';
import type { Document } from '@hold-baby/bucket-db-core';

interface User extends Document {
  name: string;
  age: number;
  email: string;
  status: 'active' | 'inactive';
}

// Create database with local file system adapter
const adapter = new FileSystemAdapter({
  basePath: './my-database',
});
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

### Using Memory Storage (Testing)

```typescript
import { BucketDB, MemoryStorageAdapter } from '@hold-baby/bucket-db-core';

// Create database with memory adapter (for testing)
const adapter = new MemoryStorageAdapter();
const db = new BucketDB(adapter, 'my-app');
```

## Using S3

```typescript
import { BucketDB, S3Adapter } from '@hold-baby/bucket-db-core';

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
import { BucketDB, OSSAdapter } from '@hold-baby/bucket-db-core';

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

## Storage Adapters

- **FileSystemAdapter** - Local file system storage (great for development)
- **MemoryStorageAdapter** - In-memory storage (for testing)
- **S3Adapter** - AWS S3 storage (for production)
- **OSSAdapter** - Alibaba Cloud OSS storage (for production)

## Documentation

📚 **官方网站**: https://bucket-db.vercel.app

- [快速开始](https://bucket-db.vercel.app/guide/) - 5 分钟上手教程
- [API 参考](https://bucket-db.vercel.app/api/) - 完整的 API 文档
- [示例](https://bucket-db.vercel.app/examples/) - 实际使用示例

**本地文档**:
- [API Reference](docs/API.md) - Complete API documentation
- [Contributing Guide](CONTRIBUTING.md) - How to contribute to the project
- [Design Document](docs/plans/2026-02-08-bucket-db-design.md) - Architecture and design decisions
- [Implementation Status](docs/plans/IMPLEMENTATION_STATUS.md) - Current implementation status

## Packages

- `@hold-baby/bucket-db-core` - Core database engine
- `@hold-baby/bucket-db-types` - TypeScript type definitions

## Examples

Check out the [examples](examples/) directory for more usage examples:
- [basic-usage](examples/basic-usage/) - Basic CRUD operations
- [local-storage](examples/local-storage/) - FileSystemAdapter usage
- [dbpath-demo](examples/dbpath-demo/) - Multi-database isolation

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
