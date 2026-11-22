# CLI Reference

`bucket-db` reads and writes BucketDB collections from a shell or a CI job. It ships with `@hold-baby/bucket-db` (0.5.0 and later) and needs Node.js >= 22 or Bun.

```bash
npx @hold-baby/bucket-db <command> [arguments] [--url <url>]

# in CI, skip npx's install prompt
npx -y @hold-baby/bucket-db count runs

# or install it once
npm install -g @hold-baby/bucket-db
bucket-db --help
```

## Connecting

The database comes from `--url <url>`, or from the `BUCKET_DB_URL` environment variable when `--url` is absent. Without either, every command fails with exit code 1.

| URL | Backend | `dbPath` |
|---|---|---|
| `s3://bucket/prefix?region=us-east-1` | `S3Adapter` | `prefix` |
| `oss://bucket/prefix?region=cn-hangzhou` | `OSSAdapter` | `prefix` |
| `file:///absolute/dir`, `file://./relative/dir` | `FileSystemAdapter` with that `basePath` | `''` |
| `memory://prefix` | `MemoryStorageAdapter` (gone when the command exits) | `prefix` |

- `s3://` accepts the query parameters `region`, `endpoint`, `forcePathStyle` and `timeoutMs`; `oss://` accepts `region`, `endpoint` and `timeoutMs`. `file://` and `memory://` accept none. An unknown parameter is an error. URL-encode an `endpoint` value: `s3://bucket/ci?region=us-east-1&endpoint=http%3A%2F%2Flocalhost%3A9000`.
- The prefix may contain `/` (`s3://bucket/teams/a/ci`). Without one, collections sit at the bucket root.
- Omitted parameters and all credentials come from the environment, exactly as for the adapters: `AWS_REGION` / `AWS_DEFAULT_REGION`, `AWS_ENDPOINT_URL_S3` / `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` for S3; `OSS_REGION`, `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_SESSION_TOKEN` for OSS, falling back to `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN` (what `aliyun/configure-aliyun-credentials-action` exports).
- A URL with credentials in it (`s3://KEY:SECRET@bucket`) is refused. Error messages never repeat the URL, so `BUCKET_DB_URL` is safe to print in logs.

The same URLs work in code through [`BucketDB.connect`](./API.md#connection-urls).

### Proxies

The CLI reaches S3 / OSS through the runtime's built-in `fetch`, so whether it uses a proxy depends on the runtime. Measured against real S3 through a CONNECT proxy:

- **Bun** (1.4.2) honours `HTTPS_PROXY` by default.
- **Node** (22.23.5, 24.22.3) ignores `HTTP_PROXY` / `HTTPS_PROXY` by default and connects directly, even when the configured proxy is unreachable. With `NODE_USE_ENV_PROXY=1` (Node 22.21.0+ / 24.0.0+), or the flag `--use-env-proxy` (Node 22.21.0+ / 24.5.0+), requests go through the proxy. Node marks this "Stability 1.1 – Active development".

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy:3128 npx -y @hold-baby/bucket-db count items
```

`NO_PROXY` is honoured on Bun and on Node with `NODE_USE_ENV_PROXY=1` (measured on Bun 1.4.2 and Node 24.22.3): an exact host name, a domain suffix with or without a leading dot (`.amazonaws.com`, `amazonaws.com`) and `*` all bypass the proxy.

## Commands

| Command | What it does | stdout |
|---|---|---|
| `get <collection> <id>` | Read one document. Exit code 2 if it does not exist. | the document |
| `put <collection> <id> [json]` | Create or replace the whole document (`collection.put`). The JSON object comes from the argument, or from stdin when the argument is omitted. | the stored document |
| `find <collection> [filter] [--sort field[:desc]]... [--limit n] [--offset n]` | Query (`collection.find`). | one JSON array |
| `count <collection> [filter]` | Count all documents (lists only), or the matching ones. | a number |
| `delete <collection> <id>` | Delete one document. Deleting a missing document succeeds. | nothing |
| `export <collection>` | Print every document, one per line, without `_etag`, in the default order (`_createdAt`, then `id`). | JSON Lines |
| `import <collection> [file]` | Write JSON Lines from a file or stdin, keeping ids and timestamps. | number of documents written |
| `compact <collection>` | Rebuild the query snapshot (`collection.compact()`); does nothing on `file://` and `memory://`. | nothing |
| `doctor` | Check what the storage service guarantees. | text report |

`filter` is a JSON object with the same operators as `find` in code ([query semantics](./API.md#query-operators)). Quote it for the shell:

```bash
bucket-db find runs '{"status":"failed"}'
bucket-db count runs '{"ms":{"$gt":1000}}'
bucket-db find runs "{\"sha\":\"$GITHUB_SHA\"}"
```

### Options

| Option | Meaning |
|---|---|
| `--url <url>` | Connection URL; overrides `BUCKET_DB_URL` |
| `--sort <field>[:asc\|:desc]` | `find` only. Repeat for several fields, most significant first; default direction `asc`. Without `--sort` the order is `_createdAt`, then `id`. |
| `--limit <n>` | `find` only. At most `n` documents; `0` prints `[]`. |
| `--offset <n>` | `find` only. Skip the first `n` matches. |
| `-h`, `--help` | Print usage and exit 0 |

Options may appear anywhere on the line. A negative or fractional `--limit` / `--offset`, or a direction other than `asc` / `desc`, is an error before any request.

### Output and exit codes

stdout carries data only: one JSON value per line (`find` prints its whole result as one array), so it pipes straight into `jq`. `doctor` and `--help` print plain text. Errors and warnings go to stderr, prefixed `bucket-db: `.

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error: invalid arguments or JSON, invalid names, missing or invalid URL, storage failure, a failed `doctor` check. stderr says what. |
| `2` | Not found: `get` of a document that does not exist (stderr `bucket-db: not found: <id>`, stdout empty) |

```bash
$ bucket-db put runs x '{oops'
bucket-db: document is not valid JSON
$ echo $?
1
```

## Examples with jq

```bash
export BUCKET_DB_URL='s3://my-bucket/ci-data?region=us-east-1'

# write a record from a JSON file; the id makes re-runs overwrite instead of duplicating
jq -c '{sha: env.GITHUB_SHA, ms: .duration}' result.json | bucket-db put runs "$GITHUB_RUN_ID"

# read one field
bucket-db get runs "$GITHUB_RUN_ID" | jq -r '.ms'

# the five slowest successful runs
bucket-db find runs '{"ok":true}' --sort ms:desc --limit 5 | jq -r '.[] | "\(.ms)\t\(.id)"'

# the latest 10 records, newest first
bucket-db find runs --sort _createdAt:desc --limit 10 | jq -c '.[] | {id, ms}'

# fail a step unless three records exist for this commit
test "$(bucket-db count runs "{\"sha\":\"$GITHUB_SHA\"}")" -eq 3

# handle a missing document explicitly
if doc=$(bucket-db get deploys eu-west); then echo "$doc" | jq .version; else [ $? -eq 2 ] && echo "never deployed"; fi
```

## Export and import

`export` and `import` back up a collection, restore it, or copy it to another bucket:

```bash
bucket-db export users --url 's3://old-bucket/app?region=us-east-1' > users.jsonl
bucket-db import users users.jsonl --url 'oss://new-bucket/app?region=cn-hangzhou'

# or in one pipe
bucket-db export users --url "$FROM" | bucket-db import users --url "$TO"
```

- `import` parses every line before writing anything; an invalid line (`line 3 is not valid JSON`, or not a JSON object) fails the command with nothing written. Blank lines are skipped.
- A line with a string `id` is written directly in the [storage format](./STORAGE-FORMAT.md) as `docs/<id>.json`, with one unconditional PUT: `id`, `_createdAt`, `_updatedAt` and every other field are kept as given, and an existing document with that id is replaced. `_etag` is dropped.
- A line without `id` is inserted with a generated id and new timestamps.
- Writes run 16 at a time and are not atomic: if the command fails halfway, the documents written so far stay.

## doctor

`doctor` checks whether the storage service behind the URL does what BucketDB relies on. Run it once when you set up a bucket, a new S3-compatible service or new credentials.

```bash
$ BUCKET_DB_URL='oss://my-bucket/ci-data?region=cn-hangzhou' npx -y @hold-baby/bucket-db doctor
ok    write, read and delete an object
ok    list reflects writes, overwrites and deletes immediately, with matching etags
ok    create-if-absent (declared: atomic)
skip  compare-and-swap (declared: none): not supported by this backend; etag updates are refused
all checks passed
```

On S3 all four checks print `ok`, with `compare-and-swap (declared: atomic)`.

| Check | Passes when |
|---|---|
| write, read and delete an object | An object reads back with the same bytes and etag, and is gone after delete. |
| list reflects writes, overwrites and deletes immediately, with matching etags | LIST shows five new objects at once with the etags their PUTs returned, then the new etag after an overwrite and no entry after a delete. Queries depend on this. |
| create-if-absent | 10 concurrent creates of one key: exactly one succeeds. Skipped if the adapter declares `none`. Fails on a versioned OSS bucket. |
| compare-and-swap | 10 concurrent conditional updates with the same etag: exactly one succeeds, and a later write with the stale etag fails. Skipped if the adapter declares `none` (OSS). |

- It writes only under `<prefix>/_doctor-<unix time in ms>/` (`_doctor-<time>/` at the bucket root without a prefix; under the directory for `file://`) and deletes everything it wrote, also when a check fails. On the filesystem, empty directories may remain.
- Each line starts with `ok`, `skip` or `FAIL`; the last line is `all checks passed` or `<n> check(s) failed`. The exit code is 1 if any check failed; skipped checks do not fail.
- It needs the same permissions as normal use: read, write, delete and list under the prefix.

Verified: `doctor` passes on real AWS S3 and Alibaba Cloud OSS.

## In CI

[`examples/ci/`](../examples/ci/) has complete recipes: GitHub Actions and GitLab CI jobs that keep test durations across runs, with per-job credentials through OIDC, least-privilege IAM / RAM policies, an OIDC trust policy and a lifecycle rule for retention. This repository records its own benchmark results per commit with the CLI in [`.github/workflows/dogfood.yml`](../.github/workflows/dogfood.yml).

```yaml
env:
  BUCKET_DB_URL: s3://my-ci-bucket/ci-data?region=us-east-1

steps:
  - uses: aws-actions/configure-aws-credentials@v4 # exports AWS_* for the job
    with:
      role-to-assume: arn:aws:iam::123456789012:role/ci-bucket-db
      aws-region: us-east-1
  - name: Record durations
    if: always()
    run: |
      jq -c --arg sha "$GITHUB_SHA" --argjson shard ${{ matrix.shard }} \
        '{sha: $sha, shard: $shard, tests: [.testResults[].assertionResults[] | {name: .fullName, ms: .duration}]}' results.json \
        | npx -y @hold-baby/bucket-db put test-durations "$GITHUB_RUN_ID-${{ matrix.shard }}"
```

- Key records by something the run knows (`$GITHUB_RUN_ID-<shard>`) and write them with `put`: a re-run overwrites its own record instead of adding a duplicate.
- Parallel jobs can write to the same collection; each `put` is one independent object.
- Jobs with read-only credentials (pull requests from forks) can still `get`, `find` and `count`; the query snapshot is then not written.
- Use a bucket for data shared between runs; a `file://` directory lives only as long as the runner's disk.

Tests: [`packages/core/tests/core/cli.test.ts`](../packages/core/tests/core/cli.test.ts).
