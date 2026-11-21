# Storage Format

What BucketDB 0.4 and 0.5 write to your bucket or directory (the format did not change in 0.5), and the rules any other reader or writer of that data must follow. The same layout is used on every backend; only S3 and OSS add a snapshot.

## Key layout

```
<dbPath>/
  <collection>/
    docs/
      <id>.json            # one object per document
    _snapshot.v1.json      # S3 / OSS only: query snapshot, disposable
```

- `<dbPath>` is the prefix passed to `new BucketDB(adapter, dbPath)`, or the path of a connection URL (`s3://bucket/<dbPath>`, see `BucketDB.connect`). It may contain `/` (`tenants/a`). With `dbPath = ''` the collections sit at the bucket root: `<collection>/docs/<id>.json`.
- On `FileSystemAdapter` every key is a file path under `basePath`. `MemoryStorageAdapter` keeps the same keys in memory.
- The snapshot sits next to `docs/`, not inside it, so it never appears in the list of documents.

Nothing else is written: no index, no log, no metadata objects. The one exception is `bucket-db doctor` ([CLI.md](./CLI.md#doctor)), which writes test objects under `<dbPath>/_doctor-<unix time in ms>/` (`_doctor-<time>/` at the root when `dbPath` is `''`) and deletes them before it exits, also when a check fails. None of its keys is under a `docs/` directory, so no collection ever reads them. If the process is killed midway, the leftover `_doctor-…/` prefix can be deleted.

## Names

Collection names, document IDs and every `/`-separated segment of `dbPath` must be 1–255 characters from `A-Z a-z 0-9 _ - .` (`^[A-Za-z0-9_.-]{1,255}$`) and must not start with `.`. BucketDB rejects anything else with `ValidationError`; it never rewrites a name. `insert` generates IDs with `crypto.randomUUID()` unless it is given `{ id }`; `put` always takes the ID from the caller.

## Documents: `docs/<id>.json`

The object body is a UTF-8 JSON object. BucketDB writes:

```json
{
  "name": "Alice",
  "id": "0b6c1f3e-5a7d-4e8b-9c1a-2f3d4e5f6a7b",
  "_createdAt": "2026-11-21T08:00:00.000Z",
  "_updatedAt": "2026-11-21T08:00:00.000Z"
}
```

Rules:

- **The key decides the ID.** On every read, `id` is the `<id>` from the key, whatever the body says. BucketDB writes `id` into the body, but never reads it back.
- **The storage service decides the etag.** `_etag` is the ETag the service reports (unquoted); it is never stored in the body, and a stored `_etag` is ignored.
- **System fields.** `_createdAt` and `_updatedAt` are ISO 8601 timestamps. `insert` and `put` set both to the current time (`put` does not read the old document, so a replaced document gets a new `_createdAt`); `update` keeps `_createdAt` and sets `_updatedAt`. `find`'s default order is `_createdAt`, then `id`. A body without them is still a valid document; the fields are then absent, and such documents sort last by default.
- **Any JSON object is a document.** A file placed at `docs/<id>.json` by other means is read like one BucketDB wrote.
- **Anything else under `docs/` is an error.** A name that is not `<valid id>.json`, or a body that is not a JSON object, makes `find` throw `StorageError` with `key` set to that object. Names starting with `.` (for example `.DS_Store`) are skipped. `FileSystemAdapter` also skips its own `*.tmp` write files and 0.3's `*.meta` files.

Every write is one request on one document object: `insert` is a create-if-absent PUT, `put` an unconditional PUT, `update` a GET plus a (where supported, conditional) PUT, `delete` a DELETE. `deleteMany` is a `find` followed by one DELETE per match.

## Writing documents from other tools

Because the key decides the ID and any JSON object is a document, other programs can write documents directly: PUT a JSON object to `<dbPath>/<collection>/docs/<id>.json`. Include `_createdAt` (ISO 8601) if the document should take its place in the default order.

`bucket-db import` ([CLI.md](./CLI.md#export-and-import)) does exactly this: each JSON line with a string `id` is written as the body of `docs/<id>.json` with one unconditional PUT, `id`, `_createdAt`, `_updatedAt` and every other field kept as given and `_etag` left out. That is why `bucket-db export | bucket-db import` restores a collection with its IDs and timestamps. Lines without `id` go through `insert`.

## Snapshot: `_snapshot.v1.json`

Kept only on remote backends: `S3Adapter`, `OSSAdapter` and custom adapters that declare `remote: true`. It exists so a query does not GET every document. It is a cache, never a source of truth.

```json
{
  "format": "bucket-db-snapshot",
  "version": 1,
  "documents": {
    "0b6c1f3e-5a7d-4e8b-9c1a-2f3d4e5f6a7b": {
      "etag": "9a0364b9e99bb480dd25e1f0284c8555",
      "body": { "name": "Alice", "_createdAt": "2026-11-21T08:00:00.000Z", "_updatedAt": "2026-11-21T08:00:00.000Z" }
    }
  }
}
```

- `documents` maps each document ID to the etag of the version that was copied and that version's body without `id` and `_etag`.
- The whole file is one UTF-8 JSON object. Its size is roughly the total size of the collection's documents (5.2 MB for 10,000 documents of about 450 bytes, see [BENCHMARKS.md](./BENCHMARKS.md)).

### Rules for readers

A reader must treat the snapshot as a hint and the LIST of `docs/` as the authority:

1. LIST `<dbPath>/<collection>/docs/` to learn which documents exist and their etags.
2. Use a snapshot entry **only if its etag equals the etag LIST reported** for `docs/<id>.json`. GET every other listed document.
3. Ignore entries whose ID is not in the list (deleted documents), and entries that are malformed.
4. Treat a file that is not valid JSON, has a different `format`, a `version` other than `1`, or a `documents` value that is not an object as missing.

Followed this way, a missing, stale, corrupt, foreign-version or concurrently overwritten snapshot changes only how many GETs a query needs, never its result.

### When BucketDB writes it

- A query rewrites it when the number of documents it had to GET individually (new, changed, or missing from the snapshot) plus the number of snapshot entries for deleted documents exceeds 16. Below that the snapshot is left as it is, so a collection of 16 documents or fewer may never get one.
- `collection.compact()` rebuilds it from all current documents.
- The write is an unconditional PUT. Concurrent writers may overwrite each other, including with an older copy; readers are unaffected because of the etag rule above.
- With credentials that cannot write (401 / 403), the collection stops trying and every query keeps working, at the cost of reading changed documents individually.

The snapshot holds full document contents. A deleted document's contents remain in it until the next rewrite or `compact()`. Lifecycle rules that expire objects under `docs/` work as a TTL: expired documents vanish from LIST and therefore from query results.

## 0.3 leftovers

0.3 kept `index/` and `wal/` directories next to `docs/`, and `FileSystemAdapter` wrote `*.meta` files beside each document. 0.4 and later never read them: they list only `docs/` and read only the snapshot key above. They can be deleted. The document objects themselves have the same format, so 0.4 and later read 0.3 collections without conversion. See [MIGRATION-0.4.md](./MIGRATION-0.4.md).

## Compatibility promise

- The document layout (`docs/<id>.json` and the body rules above) is the one 0.3 already used. Changing it would be a breaking change, listed in the changelog with migration steps.
- The snapshot is disposable. A change to its format uses a new versioned key (`_snapshot.v2.json`); clients of different versions then keep separate snapshots and never read each other's. No migration is needed: deleting any snapshot is always safe.
