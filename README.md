# BucketDB Monorepo

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monorepo for BucketDB — a TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or local file system.

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
