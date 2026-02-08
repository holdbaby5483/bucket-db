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
bun add @bucket-db/core
```

## Quick Start

### Using Local File System (Development)

```typescript
import { BucketDB, FileSystemAdapter } from '@bucket-db/core';
import type { Document } from '@bucket-db/core';

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
import { BucketDB, MemoryStorageAdapter } from '@bucket-db/core';

// Create database with memory adapter (for testing)
const adapter = new MemoryStorageAdapter();
const db = new BucketDB(adapter, 'my-app');
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

## Storage Adapters

- **FileSystemAdapter** - Local file system storage (great for development)
- **MemoryStorageAdapter** - In-memory storage (for testing)
- **S3Adapter** - AWS S3 storage (for production)
- **OSSAdapter** - Alibaba Cloud OSS storage (for production)

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
