# bucket-db MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server over stdio that lets AI tools (Claude Desktop,
Cursor and other MCP clients) read and write a BucketDB database.

The package `@hold-baby/bucket-db-mcp` is private and not published to npm; run it from a checkout of this
repository. Full guide (Chinese), including client configuration: https://bucket-db.pages.dev/guide/mcp

## Run from source

Requires Bun 1.4.2 for the build and Node.js 22 or later to run.

```bash
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd apps/mcp build
BUCKET_DB_URL=file:///path/to/data node apps/mcp/dist/index.js
```

`BUCKET_DB_URL` is the only setting and takes the same URLs as `BucketDB.connect()` (`file://`, `s3://`, `oss://`,
`memory://`; see [connection URLs](../../docs/API.md#connection-urls)). Credentials come from the usual
`AWS_*` / `OSS_*` environment variables, never from the URL. Without a valid `BUCKET_DB_URL` the server prints the
reason to stderr and exits; logs go to stderr because stdout carries the protocol.

## Tools

| Tool | What it does |
|---|---|
| `db_insert` | Insert a document; with `id`, fails if that id is taken |
| `db_put` | Create or replace the whole document with this id (idempotent) |
| `db_find_by_id` | Find a document by id |
| `db_find` | Query a collection with an optional filter, `sort`, `limit` and `offset` |
| `db_count` | Count the documents in a collection, optionally matching a filter |
| `db_update` | Update a document by id |
| `db_delete` | Delete a document by id; deleting a missing document succeeds |

## Tests

`apps/mcp/tests/mcp.test.ts` starts the server and calls every tool; it runs as part of `bun test` at the
repository root and needs `packages/core` built first.
