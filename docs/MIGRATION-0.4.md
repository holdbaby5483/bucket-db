# Migrating from 0.3.x to 0.4.0

0.4.0 rewrites the storage core. Each document is one object, `<dbPath>/<collection>/docs/<id>.json`; there is no index and no write-ahead log, every write is a single storage request, and the S3 / OSS client is built in (no runtime dependencies). On S3 and OSS, queries keep a disposable snapshot next to `docs/` so they do not download every document. The document format is unchanged, so 0.4 reads 0.3 collections as they are. Several APIs changed, and custom storage adapters must be rewritten.

```bash
npm install @hold-baby/bucket-db
```

## What changed

| | 0.3.x | 0.4.0 |
|---|---|---|
| Storage layout | documents + index shards + log | `<dbPath>/<collection>/docs/<id>.json`; on S3 / OSS also `<dbPath>/<collection>/_snapshot.v1.json` |
| Runtime dependencies | AWS SDK, ali-oss | none |
| Runtime | not declared | Node.js >= 20 or Bun |
| `insert` | 6 requests | 1 conditional PUT |
| `find` | downloads the index | lists the collection; on S3 / OSS reads the snapshot plus documents changed since it, on Memory / FileSystem reads every document; `{ id }` reads one |
| Shard options | `defaultShardCount` / `shardCount` | removed |
| `delete` of a missing document | throws `DocumentNotFoundError` | succeeds (idempotent) |
| Invalid names | rewritten (`a/b` → `a_b`) or `PathValidationError` | `ValidationError`, never rewritten |
| `findById` on a storage failure | returns `null` | throws `StorageError`; `null` only for a missing document |
| `StorageError` | `new StorageError(message, cause)` | `new StorageError(message, { kind, key, status, cause })` |
| Adapter `region` / `credentials` | required | optional, read from the environment |
| OSS `region` / `endpoint` | `oss-cn-hangzhou` / native OSS endpoint | `cn-hangzhou` / S3-compatible endpoint |
| OSS `update` with `etag` | accepted, not enforced | throws `UnsupportedError` |
| `update` without `etag`, concurrent | could reject under contention | retried; concurrent partial updates all apply (except OSS: last writer wins) |
| `UpdateDocument<T>` | could include `_etag`, `_createdAt`, `_updatedAt` | excludes all system fields |
| Multiple writer processes | not supported | supported, see the guarantees table in the README |
| Warnings | none | snapshot write failures and envelope warnings go to `logger` (default `console.warn`) |
| `StorageAdapter` | `get/put/delete/exists/listKeys/batchGet`, JSON values | `capabilities` + `get/put/delete/list`, bytes, paginated |

## Breaking changes

### Shard options removed

`BucketDB`'s third argument no longer takes shard options (it now takes `{ logger }`), and `db.collection()` takes no second argument.

```typescript
// 0.3
const db = new BucketDB(adapter, 'my-app', { defaultShardCount: 32 });
const users = db.collection<User>('users', { shardCount: 32 });

// 0.4
const db = new BucketDB(adapter, 'my-app');
const users = db.collection<User>('users');
```

### No query result cache

The in-process query cache removed in 0.3.2 does not return. Every `find` lists storage, so it reflects completed writes; on S3 / OSS document bodies come from the query snapshot when their etag still matches. Cache results in your application if you need to.

### `delete` is idempotent

```typescript
// 0.3
try {
  await users.delete(id);
} catch (error) {
  if (!(error instanceof DocumentNotFoundError)) throw error;
}

// 0.4: no error if the document does not exist
await users.delete(id);
```

`update` on a missing document still throws `DocumentNotFoundError`.

### Invalid names throw `ValidationError`

Collection names, document IDs and every `/`-separated segment of `dbPath` must match `^[A-Za-z0-9_.-]{1,255}$` and must not start with `.`. 0.4 never rewrites them. `PathValidationError` no longer exists.

```typescript
// 0.3: stored as 'reports_2024'
const reports = db.collection('reports/2024');

// 0.4: use a valid name, otherwise ValidationError
const reports = db.collection('reports_2024');
```

If 0.3 rewrote one of your names, use the rewritten name (the directory that exists in storage) in 0.4.

`dbPath` is no longer normalized with `path.join`: `'./app/'` was stored as `app` in 0.3 and is rejected in 0.4; pass `'app'`. A multi-level prefix such as `'tenants/a'` is still allowed.

```typescript
import { ValidationError } from '@hold-baby/bucket-db';

try {
  db.collection(userInput);
} catch (error) {
  if (error instanceof ValidationError) {
    // invalid name
  }
}
```

### `findById` throws on storage errors

```typescript
// 0.3: null also on network or permission errors
const user = await users.findById(id);
if (!user) { /* missing, or the read failed */ }

// 0.4: null only when the document does not exist
try {
  const user = await users.findById(id);
  if (!user) { /* missing */ }
} catch (error) {
  if (error instanceof StorageError) {
    console.error(error.kind, error.key, error.status);
  }
}
```

### `StorageError` gains `kind`, `key` and `status`

The second constructor argument is now an options object. `kind` is `'not-found' | 'conflict' | 'transient' | 'permanent'` (default `'permanent'`); `transient` means a retryable failure that persisted after retries.

```typescript
// 0.3
throw new StorageError('Failed to read', cause);

// 0.4
throw new StorageError('Failed to read', { kind: 'transient', key, status: 503, cause });
```

### Adapter constructors

`region` and `credentials` are optional and fall back to environment variables. `credentials` accepts a `sessionToken`, and may be an async function (re-called 5 minutes before the `expiresAt` it returns).

```typescript
// 0.3
const s3 = new S3Adapter({
  bucket: 'my-bucket',
  region: 'us-east-1',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
});

// 0.4: may rely entirely on AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
const s3 = new S3Adapter({ bucket: 'my-bucket' });
```

| | S3 default | OSS default |
|---|---|---|
| `region` | `AWS_REGION`, `AWS_DEFAULT_REGION` | `OSS_REGION` |
| `endpoint` | `AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL`, `https://s3.<region>.amazonaws.com` | `https://s3.oss-<region>.aliyuncs.com` |
| `credentials` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN` |

For OSS, write the region as `cn-hangzhou` (the 0.3 form `oss-cn-hangzhou` is still accepted). `endpoint` now means OSS's **S3-compatible** endpoint; `OSS_ENDPOINT` is not read.

```typescript
// 0.3
const oss = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'oss-cn-hangzhou',
  credentials: { accessKeyId: '...', secretAccessKey: '...' },
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
});

// 0.4: credentials may come from OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_SESSION_TOKEN
const oss = new OSSAdapter({
  bucket: 'my-bucket',
  region: 'cn-hangzhou',
});
```

If you set `endpoint` to a native OSS endpoint in 0.3, remove it (use the default) or replace it with the S3-compatible one. New OSS users in mainland China may need a custom domain as `endpoint`; S3-compatible access through a custom domain has not been verified.

The retry behaviour changed too: both adapters now make up to 3 attempts on network errors, timeouts, 5xx, 429, `SlowDown` and `RequestTimeout`, with a 10 s per-attempt timeout (`timeoutMs`). In 0.3, OSS did not retry 5xx or 429.

### OSS `update` with `etag` throws `UnsupportedError`

OSS cannot do conditional updates. 0.3 emulated them without any guarantee; 0.4 refuses.

```typescript
// 0.3: accepted on OSS, did not prevent a concurrent overwrite
await users.update(id, { age: 26 }, { etag: user._etag });

// 0.4: UnsupportedError on OSS (no request is sent); drop the etag
await users.update(id, { age: 26 });
```

Concurrent `update`s without `etag` on OSS are last-writer-wins. Use S3 if you need optimistic locking.

### `UpdateDocument<T>` excludes system fields

```typescript
// 0.3: the type allowed _etag / _createdAt / _updatedAt
await users.update(id, { age: 26, _updatedAt: new Date().toISOString() });

// 0.4: system fields are not part of the update; _updatedAt is set automatically
await users.update(id, { age: 26 });
```

System fields passed at runtime anyway are dropped.

### Type exports

- **Removed:** `StorageObject`, `PutOptions`, `StorageCredentials`, `StorageAdapterConfig`, `ICollection`, `CollectionMeta`, `IndexShard`
- **Added:** `UnsupportedError`, `Capabilities`, `Guarantee`, `WriteCondition`, `ObjectEntry`, `ListPage`, `ListOptions`, `S3AdapterOptions`, `OSSAdapterOptions`, `Credentials`, `CredentialProvider`, `FileSystemAdapterConfig`, `StorageErrorKind`, `StorageErrorOptions`, `BucketDBOptions`, `CollectionOptions`, `Logger`, `LogEvent`

```typescript
// 0.3
import type { StorageCredentials, StorageAdapterConfig } from '@hold-baby/bucket-db';

// 0.4
import type { Credentials, S3AdapterOptions, OSSAdapterOptions } from '@hold-baby/bucket-db';
```

## Moving a 0.3 collection

The document objects `docs/<id>.json` have not changed. **No data conversion is needed.**

1. **Stop every 0.3 writer.** 0.3 reads only its own index and does not see 0.4 writes, so 0.3 and 0.4 must not write the same collection at the same time.
2. Upgrade to `@hold-baby/bucket-db@0.4.0` and apply the code changes above.
3. Start the 0.4 clients.
4. Optionally delete 0.3's `index/` and `wal/` directories and `docs/*.meta` files. 0.4 ignores them; deleting them only saves space.

0.4 lists `docs/` directly instead of reading 0.3's index. A document file that the 0.3 index did not list — for example from a 0.3 `insert` that failed after writing the document — now appears in `find` results, and `find` returns each document file's content where the 0.3 index copy may have been stale. Run `find({})` once after the upgrade if this matters to you.

On S3 and OSS, 0.4 creates one new object per collection it queries: `<dbPath>/<collection>/_snapshot.v1.json`, next to `docs/` (written once a query has had to read more than 16 documents individually). It is a cache: deleting it is always safe, and it is rebuilt. It holds copies of document contents, so apply the same access rules as to `docs/`. Read-only credentials work: when the snapshot cannot be written (401 / 403), queries still return correct results, the failure is logged once, and that collection stops trying to write it; each query then reads the documents that changed since the last snapshot, or every document if there is none. See [STORAGE-FORMAT.md](./STORAGE-FORMAT.md).

## Rewriting a custom storage adapter

The 0.4 `StorageAdapter` is a flat key/value object store over bytes that declares, through `capabilities`, how strongly it enforces write conditions.

```typescript
// 0.3
interface StorageAdapter {
  get(key: string): Promise<StorageObject>;
  put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
  batchGet(keys: string[]): Promise<Map<string, StorageObject>>;
}

// 0.4
interface StorageAdapter {
  readonly capabilities: Capabilities;
  readonly remote?: boolean;
  get(key: string): Promise<{ body: Uint8Array; etag: string }>;
  put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  list(prefix: string, options?: ListOptions): Promise<ListPage>;
}
```

Contract:

- `capabilities.createIfAbsent` (`put` with `{ ifNoneMatch: '*' }`) and `capabilities.compareAndSwap` (`put` with `{ ifMatch: etag }`) are `'atomic'` (enforced by the storage service, across processes), `'single-process'` (enforced only within one process) or `'none'`.
- `get` of a missing key: `StorageError` with `kind: 'not-found'`.
- `put` whose condition fails: `kind: 'conflict'`; `ifMatch` on a missing key: `kind: 'not-found'`.
- `put` with a condition whose capability is `'none'`: throw `UnsupportedError` without sending a request.
- `delete` of a missing key: no error.
- `list` returns `{ key, etag }` entries in lexicographic key order, at most `limit` per page (default and maximum 1000), plus a `cursor` when another page follows. The etag is unquoted and equals what `get` / `put` report for the same version.
- Retryable failures that persist: `kind: 'transient'`; everything else: `kind: 'permanent'`.
- `remote` (optional): `true` for backends where every request is a network round trip. `Collection` then keeps the query snapshot; leave it unset for local backends.

`exists`, `listKeys` and `batchGet` are gone: BucketDB lists documents with `list` and reads them with concurrent `get` calls. JSON encoding moved into `Collection`; adapters see only bytes.

Sketch (an in-memory adapter, the same as the built-in `MemoryStorageAdapter`):

```typescript
import { StorageError, UnsupportedError } from '@hold-baby/bucket-db';
import type { StorageAdapter, Capabilities, WriteCondition, ListOptions, ListPage } from '@hold-baby/bucket-db';

class MapAdapter implements StorageAdapter {
  readonly capabilities: Capabilities = { createIfAbsent: 'atomic', compareAndSwap: 'atomic' };
  private readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  private version = 0;

  async get(key: string): Promise<{ body: Uint8Array; etag: string }> {
    const object = this.objects.get(key);
    if (!object) throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
    return { body: object.body.slice(), etag: object.etag };
  }

  async put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }> {
    if (condition && 'ifMatch' in condition && this.capabilities.compareAndSwap === 'none') {
      throw new UnsupportedError('Conditional update is not supported');
    }
    const existing = this.objects.get(key);
    if (condition && 'ifNoneMatch' in condition && existing) {
      throw new StorageError(`Object already exists: ${key}`, { kind: 'conflict', key });
    }
    if (condition && 'ifMatch' in condition) {
      if (!existing) throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
      if (existing.etag !== condition.ifMatch) {
        throw new StorageError(`ETag mismatch: ${key}`, { kind: 'conflict', key });
      }
    }
    const etag = `v${++this.version}`;
    this.objects.set(key, { body: body.slice(), etag });
    return { etag };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string, options: ListOptions = {}): Promise<ListPage> {
    const limit = Math.min(options.limit ?? 1000, 1000);
    const keys = [...this.objects.keys()]
      .filter(key => key.startsWith(prefix) && (options.cursor === undefined || key > options.cursor))
      .sort();
    const page = keys.slice(0, limit);
    return {
      entries: page.map(key => ({ key, etag: this.objects.get(key)!.etag })),
      cursor: keys.length > limit ? page[page.length - 1] : undefined,
    };
  }
}
```

For a backend that cannot do conditional writes at all, declare `'none'` for that capability: `insert` then writes unconditionally (safe in practice, IDs are random UUIDs), and `update` with `etag` throws `UnsupportedError`.

## See also

- [README](../packages/core/README.md): guarantees per backend and remaining limits
- [Guarantees and limits](./GUARANTEES.md) and [storage format](./STORAGE-FORMAT.md)
- [API reference](./API.md)
- [CHANGELOG](../CHANGELOG.md)
