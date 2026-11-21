# BucketDB Monorepo

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monorepo for BucketDB — a TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system.

```bash
npm install @hold-baby/bucket-db
```

The package includes the `bucket-db` command line tool, for shells and CI jobs:

```bash
export BUCKET_DB_URL='s3://my-bucket/ci-data?region=us-east-1'   # credentials from AWS_* variables
npx @hold-baby/bucket-db doctor                                   # check what the bucket guarantees
echo '{"ms":1234}' | npx @hold-baby/bucket-db put runs "$GITHUB_RUN_ID"
npx @hold-baby/bucket-db find runs --sort _createdAt:desc --limit 10 | jq '.[].ms'
```

See [docs/CLI.md](docs/CLI.md), the [CI recipes](examples/ci/) and, upgrading from 0.4, [docs/MIGRATION-0.5.md](docs/MIGRATION-0.5.md).

## Documentation

📚 https://bucket-db.vercel.app

## Packages

| Package | Description |
|---------|-------------|
| [`@hold-baby/bucket-db`](packages/core) | Core database engine ([README](packages/core/README.md)) |
| [`@hold-baby/bucket-db-mcp`](apps/mcp) | MCP server for AI tool integration (private) |
| [`@hold-baby/bucket-db-website`](apps/website) | Documentation site (private) |

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build
bun run --cwd packages/core build
```

## License

MIT
