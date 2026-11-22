# Contributing to BucketDB

Bug reports and pull requests are welcome at https://github.com/holdbaby5483/bucket-db.

## Prerequisites

- [Bun](https://bun.sh) 1.4.2 (the version CI pins)
- Node.js 22 or later (the published package supports Node >= 22; CI smoke-tests Node 22 and 24)

```bash
git clone https://github.com/holdbaby5483/bucket-db.git
cd bucket-db
bun install --frozen-lockfile
```

## Project layout

```
packages/core/            @hold-baby/bucket-db, the published package (zero runtime dependencies)
  src/                    bucket-db.ts, collection.ts, query.ts, snapshot.ts, keys.ts, url.ts,
                          errors.ts, types.ts, cli.ts, doctor.ts; index.ts is the public export list
  src/storage/            adapter.ts (StorageAdapter), memory.ts, fs.ts, s3/ (S3 and OSS client, SigV4)
  tests/                  conformance/ (adapter and collection suites per backend), core/, query/,
                          storage/, support/ (fakes and workers), types/ (public API type tests)
  scripts/                check-budget.sh (size gates), node-smoke.mjs (built package on Node)
  bench/                  run.ts, the benchmark behind docs/BENCHMARKS.md
apps/mcp/                 MCP server (private, not on npm), see apps/mcp/README.md
apps/website/             documentation site (VitePress, Chinese), https://bucket-db.pages.dev
examples/                 runnable examples and CI recipes, see examples/README.md
docs/                     English reference docs
```

## Checks

CI (`.github/workflows/test.yml`) runs these; run them before opening a pull request. `bun run format` fixes what
`bun run lint` reports as formatting.

```bash
bun run lint                              # biome ci .  (lint + format check)
bun run --cwd packages/core build         # tsc; tests of apps/mcp and the steps below need the build
bun run --cwd packages/core typecheck     # tsc --noEmit, plus the type tests in tests/types
bun test                                  # all tests in the workspace
packages/core/scripts/check-budget.sh     # size and dependency gates
node packages/core/scripts/node-smoke.mjs # the built package on Node
```

CI also runs `bun run index.ts` in `examples/basic-usage`, `examples/local-storage` and `examples/dbpath-demo`.

`check-budget.sh` fails the build if any of these is exceeded:

| Gate | Limit |
|---|---|
| Runtime dependencies | 0 |
| Installed packages | 1 (BucketDB itself) |
| Installed size | < 200 kB |
| Tarball size | <= 50 kB |
| `packages/core/src` | <= 2,070 lines in total |

### Tests against real buckets

`bun test` runs everything against memory, the filesystem and an in-process fake S3. The tests against real
services skip themselves unless their variables are set; Bun reads them from a `.env` file at the repository root:

- OSS: `OSS_BUCKET`, `OSS_REGION`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`
- S3: `TEST_S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- A local S3 (CI uses SeaweedFS): `LOCAL_S3_ENDPOINT`, `LOCAL_S3_BUCKET`, optionally `LOCAL_S3_ACCESS_KEY_ID`,
  `LOCAL_S3_SECRET_ACCESS_KEY`, `LOCAL_S3_REGION`

Never commit `.env` (it is in `.gitignore`). Tests and benchmarks that touch a real bucket must write only under
the `test/` prefix and clean up after themselves. See [docs/security/credentials.md](docs/security/credentials.md)
for how to scope credentials.

### The M0 regression test

`packages/core/tests/core/collection-faults.test.ts` is the M0 regression test and must stay byte-identical; that
is why `biome.json` excludes it from linting and formatting. Do not reformat or edit it. If a change makes it
fail, the change is wrong.

## Code

- TypeScript strict mode; Biome settles formatting (2 spaces, single quotes, 120 columns).
- `packages/core` must keep zero runtime dependencies and stay within the budgets above.
- A change to the public API starts in `packages/core/src/index.ts`; update `tests/types/public-api.ts`,
  `docs/API.md` and the changelog with it. What may change before and after 1.0 is in
  [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- A change to the stored format needs an entry in [docs/STORAGE-FORMAT.md](docs/STORAGE-FORMAT.md) and an upgrade
  note in the matching `docs/MIGRATION-*.md`.
- A new guarantee needs a test that proves it, listed in [docs/GUARANTEES.md](docs/GUARANTEES.md).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), in English, with a scope where it helps and `!` for
breaking changes. Examples from the history:

```
feat(core): bucket-db CLI with doctor, export and import
feat(core)!: settle public types before 1.0
fix(core): count a changed document once when deciding to rewrite the snapshot
perf(core): add benchmark script and results
ci(publish): rely on npm trusted publishing only
docs(website): stop double-escaping generics in API headings
style: format with Biome
```

## Documentation

- `docs/` is the English source of truth; `apps/website/guide/` is the Chinese mirror. Change both together.
- `apps/website/api/*.md` are generated from `docs/API.md`: do not edit them; run `bun run sync` in
  `apps/website` (the website build runs it too).
- Each topic has one home (guarantees in `docs/GUARANTEES.md`, the API in `docs/API.md`, the CLI in `docs/CLI.md`,
  numbers in `docs/BENCHMARKS.md`); link to it instead of repeating it.

## Releases

Maintainers release by pushing a version tag; the procedure is in [.github/RELEASE.md](.github/RELEASE.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License.
