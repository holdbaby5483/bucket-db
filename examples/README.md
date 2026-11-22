# Examples

Each example imports `@hold-baby/bucket-db` from this workspace, so build the core package first:

```bash
bun install --frozen-lockfile
bun run --cwd packages/core build
```

| Directory | What it shows | Run |
|---|---|---|
| [`basic-usage/`](basic-usage/) | CRUD and queries on the in-memory adapter | `cd examples/basic-usage && bun run index.ts` |
| [`local-storage/`](local-storage/) | The same on `FileSystemAdapter`, one JSON file per document under `./local-db-data` | `cd examples/local-storage && bun run index.ts` |
| [`dbpath-demo/`](dbpath-demo/) | How `dbPath` and collection names become storage keys | `cd examples/dbpath-demo && bun run index.ts` |
| [`ci/`](ci/) | Recipes for keeping CI data in a bucket with OIDC credentials (workflow files and IAM/RAM policies, not a script) | see [`ci/README.md`](ci/README.md) |

CI (`.github/workflows/test.yml`) runs `basic-usage`, `local-storage` and `dbpath-demo` on every push and pull
request to `main`. The `ci/` files are not run themselves; `.github/workflows/dogfood.yml` applies the same pattern
to this repository.
