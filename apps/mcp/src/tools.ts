import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BucketDB, Document } from '@hold-baby/bucket-db';
import { DocumentNotFoundError, ConcurrentUpdateError } from '@hold-baby/bucket-db';

type AnyDocument = Document & Record<string, unknown>;

export function registerTools(server: McpServer, db: BucketDB): void {
  server.registerTool(
    'db_insert',
    {
      description: 'Insert a document into a collection',
      inputSchema: {
        collection: z.string().describe('Collection name'),
        data: z.record(z.unknown()).describe('Document data as a JSON object'),
      },
    },
    async ({ collection, data }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        const doc = await col.insert(data as Omit<AnyDocument, 'id' | '_etag' | '_createdAt' | '_updatedAt'>);
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] };
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
        if (err instanceof DocumentNotFoundError) {
          return { isError: true, content: [{ type: 'text', text: `Document not found: ${id}` }] };
        }
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
        limit: z.number().int().positive().optional().describe('Maximum number of results'),
        offset: z.number().int().nonnegative().optional().describe('Number of documents to skip'),
      },
    },
    async ({ collection, filter, limit, offset }) => {
      try {
        const col = db.collection<AnyDocument>(collection);
        const docs = await col.find(
          (filter ?? {}) as Record<string, unknown>,
          { limit, offset }
        );
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
        etag: z.string().optional().describe('ETag for optimistic concurrency control'),
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
      description: 'Delete a document by ID',
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
        if (err instanceof DocumentNotFoundError) {
          return { isError: true, content: [{ type: 'text', text: `Document not found: ${id}` }] };
        }
        return { isError: true, content: [{ type: 'text', text: String(err) }] };
      }
    }
  );
}
