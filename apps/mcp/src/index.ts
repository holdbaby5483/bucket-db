#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BucketDB } from '@hold-baby/bucket-db';
import { registerTools } from './tools.js';

// BUCKET_DB_URL, e.g. s3://bucket/prefix?region=us-east-1 or file:///data;
// credentials come from the usual AWS_* / OSS_* environment variables.
let db: BucketDB;
try {
  db = BucketDB.connect(undefined, { logger: ({ message }) => console.error(`bucket-db: ${message}`) });
} catch (error) {
  console.error(`bucket-db MCP server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = new McpServer({
  name: 'bucket-db',
  version: '0.2.0',
});

registerTools(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('bucket-db MCP server started');
