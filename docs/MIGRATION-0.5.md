# Migrating from 0.4 to 0.5

0.5.0 adds `BucketDB.connect(url)`, `put`, `insert` with an id, `sort`, `count`, `deleteMany` and the `bucket-db` CLI, and settles how queries treat missing fields and mismatched types. The storage format is unchanged: 0.5 reads and writes the same objects as 0.4, so there is nothing to convert. Upgrading from 0.3.x: read [MIGRATION-0.4.md](./MIGRATION-0.4.md) first.

```bash
npm install @hold-baby/bucket-db@0.5.0
```

## Breaking changes

### Query semantics

A field missing from a document now evaluates as `undefined`, and a range comparison between mismatched types is no match instead of an error.

| Filter | 0.4 | 0.5 |
|---|---|---|
| `{ age: { $gt: 18 } }` on `age: '30'` | throws `ValidationError` | no match |
| `{ flag: { $gt: 0 } }` on `flag: true` | throws `ValidationError` | no match |
| `{ status: { $ne: 'archived' } }` on a document without `status` | no match | **match** |
| `{ status: { $nin: ['archived'] } }` on a document without `status` | no match | **match** |
| `{ n: { $nin: [], $gt: 5 } }` on `n: 1` | match (`$nin: []` skipped the other operators) | no match |
| `{ status: { $nin: [] } }` on a document without `status` | no match | match (`$nin: []` excludes nothing) |

`$eq`, plain values, range operators and `$in` still never match a missing field.

If you relied on the error to catch bad data, check types in your code. If you relied on `$ne` / `$nin` skipping documents without the field, add a condition that requires a value, for example a range on the same field, or filter in code:

```typescript
// 0.4: only documents that have a status other than 'archived'
await users.find({ status: { $ne: 'archived' } });

// 0.5: the same documents
(await users.find({ status: { $ne: 'archived' } })).filter(user => user.status !== undefined);
```

### Default order of `find`

Results without `sort` are ordered by `_createdAt`, then `id`. 0.4 returned them in key order, which for generated UUIDs looked random. Code that sorted the result itself keeps working; code that depended on ID order should ask for it:

```typescript
await users.find({}, { sort: { id: 1 } }); // the 0.4 order
```

Documents without `_createdAt` (placed by other tools) sort last. `put` sets a new `_createdAt`, so a replaced document moves to the end of the default order.

### `limit: 0` and invalid paging

`find(filter, { limit: 0 })` returns `[]`; 0.4 ignored it and returned everything. A negative or fractional `limit` / `offset`, and a `sort` direction other than `1` / `-1`, throw `ValidationError` before any request.

### MCP server configuration

The MCP server (0.2.0) is configured by one variable, `BUCKET_DB_URL`, plus the usual credential variables. `BUCKET_DB_ADAPTER`, `BUCKET_DB_PATH`, `BUCKET_DB_FS_BASE_PATH`, `BUCKET_DB_S3_*` and `BUCKET_DB_OSS_*` are no longer read; without `BUCKET_DB_URL` the server exits with a message.

| Before | After |
|---|---|
| `BUCKET_DB_ADAPTER=fs BUCKET_DB_FS_BASE_PATH=/data BUCKET_DB_PATH=app` | `BUCKET_DB_URL=file:///data/app` |
| `BUCKET_DB_ADAPTER=s3 BUCKET_DB_S3_BUCKET=b BUCKET_DB_S3_REGION=us-east-1 BUCKET_DB_PATH=app` | `BUCKET_DB_URL=s3://b/app?region=us-east-1` |
| `BUCKET_DB_ADAPTER=oss BUCKET_DB_OSS_BUCKET=b BUCKET_DB_OSS_REGION=cn-hangzhou BUCKET_DB_PATH=app` | `BUCKET_DB_URL=oss://b/app?region=cn-hangzhou` |
| `BUCKET_DB_S3_ACCESS_KEY_ID` / `BUCKET_DB_S3_SECRET_ACCESS_KEY` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |
| `BUCKET_DB_OSS_ACCESS_KEY_ID` / `BUCKET_DB_OSS_SECRET_ACCESS_KEY` | `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` |

`BUCKET_DB_PATH` used to default to `default`. If you never set it, put `default` in the URL to keep using the same data: `file:///data/default`, `s3://b/default?region=…`.

## New, no changes needed

- `BucketDB.connect(url?)` opens a database from `s3://`, `oss://`, `file://` or `memory://` URLs, by default `BUCKET_DB_URL`. `new BucketDB(adapter, dbPath)` works as before. See [API.md](./API.md#connection-urls).
- `collection.put(id, data)` creates or replaces a document in one PUT; `insert(data, { id })` creates a document with a chosen id or throws the new `DocumentExistsError`.
- `find(filter, { sort })`, `count(filter?)` and `deleteMany(filter)`.
- `OSSAdapter` falls back to the `ALIBABA_CLOUD_*` credential variables when `OSS_*` are unset.
- The `bucket-db` CLI ships with the package: `npx @hold-baby/bucket-db doctor`. See [CLI.md](./CLI.md).

## Running 0.4 and 0.5 side by side

The storage format and the write paths are the same, so 0.4 and 0.5 clients can read and write the same collections. They differ only in how queries evaluate and order results (the changes above), not in what they write. This follows from the code; no test runs the two versions against each other.

## See also

- [CHANGELOG.md](../CHANGELOG.md)
- [API.md](./API.md)
- [CLI.md](./CLI.md)
