# Guarantees and Limits

For 0.6.0. Each row names the test that checks it. Test files live in `packages/core/tests/` unless the path says otherwise; the conformance suites (`conformance/adapter-suite.ts` "storage contract", `conformance/collection-suite.ts` "collection") run against every backend listed under [Where the tests run](#where-the-tests-run).

## Per backend

| Guarantee | Memory | FileSystem | S3 | OSS | Checked by |
|---|---|---|---|---|---|
| Single write is atomic | yes | yes | yes | yes | Every write is one request: collection D2. A crash at any point leaves the old or the new state: `core/collection-crash.test.ts` (Memory). Atomicity of the one request is the backend's: S3 / OSS PUT, FileSystem temp file + `link()` / `rename()` |
| Create-if-absent (`insert`, with or without `id`) | yes | yes (across processes) | yes | yes (non-versioned buckets only) | Storage contract B1, B2; collection D15 (5 concurrent `insert`s with one `id`: exactly one succeeds, the rest throw `DocumentExistsError`); `core/multiprocess.test.ts`. Versioned OSS buckets are not tested |
| Conditional update (`etag`) | yes | single process only | yes | no — `UnsupportedError` | Storage contract B3, B4; collection D9; `core/collection-faults.test.ts` "update throws ConcurrentUpdateError when another writer changes the document…". OSS refusal: storage contract B5, collection D9 |
| Concurrent partial updates all apply | yes | single process | yes | no (last writer wins) | Collection D10 |
| Query results match the stored documents | yes | yes | yes | yes | Collection D4, D5, D7/D8, D13; `core/snapshot.test.ts` (see below). Relies on LIST reflecting writes immediately: storage contract A7 |

Multiple writer processes are supported for `insert` and `delete` on every backend, and for `update` on S3 (on Memory and FileSystem, within one process). `core/multiprocess.test.ts` runs 4 processes inserting 25 documents each and checks that all 100 are visible, on FileSystem, a fake S3, the local S3 in CI, real OSS and real S3.

## Collection operations

| Guarantee | Checked by |
|---|---|
| `find` returns exactly the documents that satisfy the filter, including after updates | Collection D4 |
| A document deleted between LIST and GET is left out | Collection D5 |
| A file under `docs/` that is not a JSON object fails `find` with `StorageError` naming the key | Collection D6 |
| A JSON object placed under `docs/` is a document; `id` and `_etag` come from the key and the service | Collection D7 / D8 |
| A 0.3 collection is readable; `index/` and `wal/` are ignored | Collection D13 |
| Invalid names, IDs and filters are rejected before any storage request | Collection D12 |
| `insert` and `delete` are one request each; `findById` is one GET | Collection D2 |
| `put` is one unconditional PUT that creates or replaces the whole document; repeating it leaves one document | Collection D14 "put creates or replaces the whole document in one unconditional write" |
| `insert` with an `id` creates once, then throws `DocumentExistsError`; an invalid `id` is a `ValidationError` | Collection D15 "insert with an explicit id creates once, then throws DocumentExistsError" |
| `count()` without a filter only lists (no GET); with a filter it counts the matches | Collection D16 "count without a filter only lists; with a filter it counts matches" |
| `deleteMany` deletes exactly the matches and returns how many | Collection D17 "deleteMany deletes the matches and reports how many". It is **not atomic** (one DELETE per match, 16 in parallel): a failure halfway leaves the earlier deletes done. That is by design and not tested as a guarantee |
| Default order is `_createdAt`, then `id`; `sort` orders by the given fields; `limit: 0` returns nothing; a negative `limit` is a `ValidationError` | Collection D18 "find sorts by _createdAt then id by default, by the given fields otherwise; limit 0 is empty" |

Consistency level: every document in a result is a version that was committed at some point, but the result set as a whole is not a point-in-time snapshot of the collection. A document written while a query runs may or may not be in it.

## Query semantics

`query/query.test.ts`, "settled semantics (0.5)" and "sortDocuments":

| Guarantee | Test |
|---|---|
| A range comparison between mismatched types is no match, not an error | "a type mismatch is no match, not an error" |
| `$ne` and `$nin` match a document missing the field; `$eq`, ranges and `$in` do not | "$ne and $nin match a missing field; $eq, ranges and $in do not" |
| `$nin: []` excludes nothing and does not skip the other operators | "an empty $nin excludes nothing and does not skip the other operators" |
| Default order is `_createdAt`, then `id` | "default order is _createdAt, then id" |
| Missing values sort last in both directions; ties fall back to `_createdAt` | "missing values sort last in both directions; ties fall back to _createdAt" |
| Mixed types order as booleans < numbers < strings | "mixed types order as booleans < numbers < strings" |
| An invalid sort direction or field is a `ValidationError` | "an invalid direction or field is a ValidationError" |

## Public API types

`packages/core/tests/types/public-api.ts`, compiled, never run, by `bun run --cwd packages/core typecheck` (`tsc -p tests/types`) on every push and pull request. A line marked `@ts-expect-error` fails the check if it stops being an error.

| Guarantee | Checked by |
|---|---|
| `insert`, `findById`, `find` and `update` return `Stored<T>`: `_etag` is a `string`, usable as `update`'s `etag` without `!` | `packages/core/tests/types/public-api.ts`, "Returned documents always carry an etag" |
| `sort` accepts the document's fields and `id`, `_etag`, `_createdAt`, `_updatedAt`; an unknown field or a direction other than `1` / `-1` does not compile | `packages/core/tests/types/public-api.ts`, "Sort keys are the document's fields plus the system fields" |
| `insert` and `update` data cannot contain `id` or `_createdAt` | `packages/core/tests/types/public-api.ts`, "insert / put / update accept no system fields" |
| `Collection` is exported as a type only; `new Collection()` does not compile | `packages/core/tests/types/public-api.ts`, "Collection is exported as a type only" |

## Connection URLs

`core/connect.test.ts`, "connection URLs":

| Guarantee | Test |
|---|---|
| `s3://`, `oss://`, `file://` and `memory://` select their backend; the path becomes `dbPath` | "each scheme selects its backend and the path becomes dbPath" |
| A URL with credentials is refused, and the error does not repeat them | "credentials in the URL are refused without echoing them" |
| Unknown parameters, unknown schemes and `s3://` / `oss://` URLs without a bucket are refused | "unknown parameters, schemes and missing buckets are refused" |
| `BUCKET_DB_URL` is the default | "BUCKET_DB_URL is the default" |
| `BucketDB.connect` works end to end on `file://`, `memory://` and an S3 endpoint | "connect works end to end on file, memory and an S3 endpoint" |

## CLI

`core/cli.test.ts`, "bucket-db CLI", running `src/cli.ts` as a child process; the Node job in CI also runs the built CLI (`put`, `count`, `export | import`, `get`, `doctor`, exit code 2) on Node 22 and 24.

| Guarantee | Test |
|---|---|
| `put` (argument or stdin), `get`, `find` with `--sort` / `--limit`, `count` and `delete` print JSON; `get` of a missing document exits 2 with empty stdout | "put, get, find, count and delete round trip with JSON output and exit codes" |
| `export` prints JSON Lines without `_etag`; `import` keeps ids and timestamps and inserts lines without `id` | "export then import into another collection keeps ids and timestamps" |
| Errors go to stderr with exit code 1; a URL with credentials is refused without printing them | "errors go to stderr with exit code 1 and never echo URL credentials" |
| `doctor` passes on FileSystem and an S3 endpoint and leaves no objects behind | "doctor passes on the filesystem and an S3 endpoint and leaves nothing behind" |
| `doctor` skips compare-and-swap on a backend that declares none (OSS dialect) and still passes | "doctor reports a backend that only pretends to create atomically" |

`doctor` itself checks a live service: an object round trip, LIST reflecting writes, overwrites and deletes immediately with matching etags, create-if-absent and compare-and-swap with 10 concurrent writers (exactly one must win; skipped where the backend declares none). It has passed against real AWS S3 and Alibaba Cloud OSS, run by hand. See [CLI.md](./CLI.md#doctor).

## MCP server

`apps/mcp/tests/mcp.test.ts`, "MCP server", over stdio:

| Guarantee | Test |
|---|---|
| `db_insert`, `db_put`, `db_find`, `db_count`, `db_update` and `db_delete` work through the protocol | "insert, put, find, count, update and delete through tools" |
| A taken `id` and invalid names come back as tool errors | "insert with a taken id and invalid names are reported as tool errors" |
| Without `BUCKET_DB_URL` the server exits with a message | "without BUCKET_DB_URL the server exits with a message" |

## Snapshot (S3, OSS and adapters with `remote: true`)

All in `core/snapshot.test.ts`, "query snapshot", against an in-memory adapter that declares `remote: true`. The collection suite also exercises the snapshot on S3 and OSS, because every `find` there goes through it.

| Guarantee | Test |
|---|---|
| A cold query builds the snapshot; a warm one makes only the LIST and the snapshot GET | "a cold query builds the snapshot; a warm one reads only the list and the snapshot" |
| The snapshot is rewritten only when more than 16 documents changed | "the snapshot is rewritten only when more than 16 documents changed" |
| After writes, only changed documents are read and the result is current | "after writes, only changed documents are read and the result is current" |
| A deleted, unparsable, wrongly shaped or future-version snapshot gives the same result | "a snapshot that is %s gives the same result" (4 cases) |
| Entries for deleted documents, stale copies and IDs that never existed are never used | "forged or stale entries are never trusted" |
| An older snapshot written over a newer one gives the same result | "an older snapshot written over a newer one gives the same result" |
| A failed snapshot write does not fail the query, is logged, and is not retried after 401 / 403 | "a failed snapshot write does not fail the query, is logged, and is not retried after a permission error" |
| A transient error reading the snapshot fails the query rather than reading every document | "a transient failure reading the snapshot fails the query instead of reading every document" |
| `compact()` removes deleted documents' contents from the snapshot | "compact removes the contents of deleted documents from the snapshot" |
| `compact()` writes nothing on local backends | "compact is a no-op on local backends" |
| A collection over 10,000 documents logs one warning; one inside the envelope logs nothing | "envelope warning": "a %s collection over 10,000 documents warns once", "a collection inside the envelope does not warn" |

## S3 / OSS client

`storage/s3-client.test.ts`, against a fake S3 server in both AWS and OSS dialects:

| Guarantee | Test |
|---|---|
| Up to 3 attempts on 5xx, 429, `SlowDown`, `RequestTimeout`, timeouts and reset connections; then `kind: 'transient'` | C1–C4 |
| 403 is not retried and is `kind: 'permanent'` | C5 |
| A conditional write whose earlier attempt succeeded is not reported as a conflict; a real conflict is | C6, C7 |
| Requests are signed correctly (SigV4) | C9 |
| Region, endpoint and credentials from the environment; credential providers refreshed before `expiresAt` | C8 |
| OSS: create-if-absent uses `x-oss-forbid-overwrite`; `ifMatch` throws `UnsupportedError` without a request | "S3Client over fake S3 (oss dialect)" |

## Where the tests run

| Backend | Storage contract + collection suite | Multi-process | When |
|---|---|---|---|
| Memory | `conformance/memory.test.ts` | — | every push and pull request |
| FileSystem | `conformance/fs.test.ts` | yes | every push and pull request |
| Fake S3 (AWS and OSS dialects) | `conformance/fake-s3.test.ts` | yes (AWS dialect) | every push and pull request |
| Local S3 (SeaweedFS) | `conformance/local-s3.test.ts` | yes | every push and pull request |
| Real OSS | `conformance/real-buckets.test.ts` | yes | every push to `main` and same-repository pull request |
| Real AWS S3 | `conformance/real-buckets.test.ts` | yes | manually, when `TEST_S3_BUCKET` and AWS credentials are set (no CI secrets yet) |

## Limits

- **No transactions.** Each write touches one document. `deleteMany` is a sequence of single deletes, not one operation.
- **`put` is last-writer-wins on every backend.** It uses no write condition; use `insert` with `id` to create only once, or `update` with `etag` to guard a change.
- **Envelope: at most 10,000 documents and 10 MB of snapshot per collection.** Beyond it, queries keep working but keep getting slower; the collection logs one warning per `Collection` instance (local backends check the document count only). Measured at 10,000 documents: a warm `find` takes 1.35 s on OSS and 3.2 s on S3, a query without a snapshot 34 s and 134 s. See [BENCHMARKS.md](./BENCHMARKS.md).
- **Query cost.** On S3 / OSS a warm `find` is ⌈N/1000⌉ LIST + 1 GET of the snapshot, plus one GET per document changed since the snapshot; when more than 16 changed, the query also rewrites the snapshot with one PUT. On Memory and FileSystem every `find` reads every document. A `{ id: '...' }` filter reads one document on every backend. `sort`, `limit` and `offset` do not reduce reads. `count()` without a filter is ⌈N/1000⌉ LIST only; `count(filter)` and `deleteMany(filter)` cost a `find`.
- **The snapshot holds document contents.** A deleted document's contents remain in `_snapshot.v1.json` until the snapshot is rewritten or `compact()` runs. Call `compact()` after deleting privacy-sensitive data.
- **OSS has no conditional update.** `update` with `etag` throws `UnsupportedError`; concurrent `update`s without `etag` are last-writer-wins. On versioned OSS buckets, create-if-absent is not enforced either.
- **FileSystem conditional updates are single-process.** `etag` checks and the merging of concurrent `update`s hold only among writers in one process.
- **Results are not a point-in-time snapshot.** See the consistency level above.
- **0.3.x and 0.4 or later must not write the same collection at the same time.** 0.3 reads only its own index and does not see later writes. 0.4, 0.5 and 0.6 write the same format through the same code paths, so they can share a collection; this follows from the code and is not covered by a test.
- **Only AWS S3 and Alibaba Cloud OSS are tested** among cloud services. Other S3-compatible services may work through `endpoint`; SeaweedFS runs in CI as a local stand-in.
- **LIST read-after-write on OSS is observed, not promised.** AWS documents strong LIST consistency; for OSS, storage contract A7 keeps checking it on the real service.
- **Proxies depend on the runtime.** The S3 / OSS client uses the built-in `fetch`. Measured against real S3 through a CONNECT proxy: Bun 1.4.2 honours `HTTPS_PROXY` by default; Node 22.23.5 and 24.22.3 ignore `HTTP_PROXY` / `HTTPS_PROXY` and connect directly unless `NODE_USE_ENV_PROXY=1` (Node 22.21.0+ / 24.0.0+) or `--use-env-proxy` (22.21.0+ / 24.5.0+) is set, which Node marks "Stability 1.1 – Active development". Checked by hand, not by a test in CI; `NO_PROXY` handling has not been tested. See [CLI.md](./CLI.md#proxies).
