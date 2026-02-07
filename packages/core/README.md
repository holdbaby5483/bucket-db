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
