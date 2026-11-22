# BucketDB Monorepo

[![npm version](https://img.shields.io/npm/v/@hold-baby/bucket-db.svg)](https://www.npmjs.com/package/@hold-baby/bucket-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monorepo for BucketDB, a TypeScript document database built on cloud object storage (AWS S3 / Alibaba Cloud OSS) or the local file system. Each document is one JSON object in your bucket; there is no database server.

```bash
npm install @hold-baby/bucket-db
```

Requires Node.js >= 22 or Bun. Usage, guarantees and adapters: [packages/core/README.md](packages/core/README.md).

## Documentation

📚 https://bucket-db.pages.dev

- [API reference](docs/API.md)
- [CLI reference](docs/CLI.md) and the [query UI](docs/UI.md) (`bucket-db ui`)
- [Guarantees and limits](docs/GUARANTEES.md)
- [Compatibility policy](docs/COMPATIBILITY.md)
- [Storage format](docs/STORAGE-FORMAT.md)
- [Benchmarks](docs/BENCHMARKS.md)
- [Credentials](docs/security/credentials.md)
- Upgrading: [from 0.5](docs/MIGRATION-0.6.md), [from 0.4](docs/MIGRATION-0.5.md), [from 0.3](docs/MIGRATION-0.4.md)
- [Examples](examples/), including [CI recipes](examples/ci/)
- [Contributing](CONTRIBUTING.md)

## Packages

| Package | Description |
|---------|-------------|
| [`@hold-baby/bucket-db`](packages/core) | Core library and `bucket-db` CLI ([README](packages/core/README.md)) |
| [`@hold-baby/bucket-db-mcp`](apps/mcp) | MCP server for AI tool integration (private, not published) |
| [`@hold-baby/bucket-db-website`](apps/website) | Documentation site (private) |

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Lint and format check (Biome)
bun run lint

# Type-check, including the public API type tests
bun run --cwd packages/core typecheck

# Build the core package
bun run --cwd packages/core build
```

## License

MIT
