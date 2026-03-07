## Storage Adapters

### MemoryStorageAdapter

In-memory storage adapter for testing.

#### Constructor

```typescript
new MemoryStorageAdapter()
```

**Example:**
```typescript
import { MemoryStorageAdapter } from '@hold-baby/bucket-db-core';

const adapter = new MemoryStorageAdapter();
```

#### Additional Methods

##### `clear(): void`

Clear all stored data (testing utility).

---

### FileSystemAdapter

Local file system storage adapter.

#### Constructor

```typescript
new FileSystemAdapter(config: FileSystemAdapterConfig)
```

**Parameters:**
- `config.basePath` - Base directory path for storage

**Example:**
```typescript
import { FileSystemAdapter } from '@hold-baby/bucket-db-core';

const adapter = new FileSystemAdapter({
  basePath: './my-database',
});
```

**Storage Structure:**
```
basePath/
  dbPath/
    collectionName/
      docs/
        {id}.json         # Document files
      index/
        shard-00.json     # Index shards
        shard-01.json
        ...
```

---

### S3Adapter

AWS S3 storage adapter.

#### Constructor

```typescript
new S3Adapter(config: StorageAdapterConfig)
```

**Parameters:**
- `config.bucket` - S3 bucket name
- `config.region` - AWS region (e.g., 'us-east-1')
- `config.credentials` - AWS credentials
  - `accessKeyId` - AWS access key ID
  - `secretAccessKey` - AWS secret access key
- `config.endpoint?` - Optional custom endpoint (for LocalStack, MinIO, etc.)

**Example:**
```typescript
import { S3Adapter } from '@hold-baby/bucket-db-core';

const adapter = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

---

### OSSAdapter

Alibaba Cloud OSS storage adapter.

#### Constructor

```typescript
new OSSAdapter(config: StorageAdapterConfig)
```

**Parameters:**
- `config.bucket` - OSS bucket name
- `config.region` - OSS region (e.g., 'oss-cn-hangzhou')
- `config.credentials` - OSS credentials
  - `accessKeyId` - OSS access key ID
  - `secretAccessKey` - OSS access key secret
- `config.endpoint?` - Optional custom endpoint

**Example:**
```typescript
import { OSSAdapter } from '@hold-baby/bucket-db-core';

const adapter = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'oss-cn-hangzhou',
  credentials: {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET!,
  },
});
```

---