import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BucketDB, Document } from '@hold-baby/bucket-db';
import { ConcurrentUpdateError, DocumentNotFoundError } from '@hold-baby/bucket-db';

type AnyDocument = Document & Record<string, unknown>;

export function registerTools(server: McpServer, db: BucketDB): void {
  server.registerTool(
    'db_insert',
    {
      description: 'Insert a document into a collection. With id, fails if that id is taken.',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        data: z.record(z.unknown()).describe('Document data as a JSON object'),
        id: z.string().optional().describe('Document ID to use instead of a generated one'),
      },
    },
    async ({ collection, data, id }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        const doc = await col.insert(data as Omit<AnyDocument, 'id' | '_etag' | '_createdAt' | '_updatedAt'>, { id });
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );

  server.registerTool(
    'db_put',
    {
      description: 'Create or replace the whole document with this ID (idempotent)',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Document ID'),
        data: z.record(z.unknown()).describe('Document data as a JSON object'),
      },
    },
    async ({ collection, id, data }) => {
      try {
        const doc = await db.collection<AnyDocument>(collection).put(id, data as Omit<AnyDocument, 'id'>);
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );

  server.registerTool(
    'db_count',
    {
      description: 'Count the documents in a collection, optionally matching a filter',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        filter: z.record(z.unknown()).optional().describe('Query filter as a JSON object'),
      },
    },
    async ({ collection, filter }) => {
      try {
        const count = await db.collection<AnyDocument>(collection).count((filter ?? {}) as Record<string, unknown>);
        return { content: [{ type: 'text', text: String(count) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );

  server.registerTool(
    'db_find_by_id',
    {
      description: 'Find a document by its ID',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Document ID'),
      },
    },
    async ({ collection, id }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        const doc = await col.findById(id);
        if (!doc) {
          return { isError: true, content: [{ type: 'text', text: `Document not found: ${id}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );

  server.registerTool(
    'db_find',
    {
      description: 'Query documents in a collection',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        filter: z.record(z.unknown()).optional().describe('Query filter as a JSON object'),
        limit: z.number().int().nonnegative().optional().describe('Maximum number of results'),
        offset: z.number().int().nonnegative().optional().describe('Number of documents to skip'),
        sort: z
          .record(z.union([z.literal(1), z.literal(-1)]))
          .optional()
          .describe('Sort fields in order, 1 ascending or -1 descending; default _createdAt then id'),
      },
    },
    async ({ collection, filter, limit, offset, sort }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        const docs = await col.find((filter ?? {}) as Record<string, unknown>, { limit, offset, sort });
        return { content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );

  server.registerTool(
    'db_update',
    {
      description: 'Update a document by ID',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Document ID'),
        data: z.record(z.unknown()).describe('Fields to update as a JSON object'),
        etag: z.string().optional().describe('ETag for optimistic concurrency control (not supported on OSS)'),
      },
    },
    async ({ collection, id, data, etag }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        const doc = await col.update(
          id,
          data as Partial<AnyDocument>,
          etag ? { etag } : undefined
        );
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] };
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          return { isError: true, content: [{ type: 'text', text: `Document not found: ${id}` }] };
        }
        if (err instanceof ConcurrentUpdateError) {
          return { isError: true, content: [{ type: 'text', text: `Concurrent update conflict for: ${id}` }] };
        }
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );

  server.registerTool(
    'db_delete',
    {
      description: 'Delete a document by ID. Deleting a document that does not exist succeeds.',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Document ID'),
      },
    },
    async ({ collection, id }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        await col.delete(id);
        return { content: [{ type: 'text', text: `Deleted document: ${id}` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );
}
