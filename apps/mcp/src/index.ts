#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BucketDB } from '@hold-baby/bucket-db';
import { createAdapter, getDbPath } from './config.js';
import { registerTools } from './tools.js';

const adapter = createAdapter();
const dbPath = getDbPath();
const db = new BucketDB(adapter, dbPath);

const server = new McpServer({
  name: 'bucket-db',
  version: '0.1.0',
});

registerTools(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error(`bucket-db MCP server started (adapter=${process.env.BUCKET_DB_ADAPTER}, path=${dbPath})`);
