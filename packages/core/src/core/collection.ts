import type {
  ICollection,
  Document,
  InsertDocument,
  UpdateDocument,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  StorageAdapter,
} from '../types/index.js';
import { DocumentNotFoundError, ConcurrentUpdateError } from '../types/index.js';
import { ShardManager } from '../index/shard-manager.js';

/**
 * Generate UUID v4
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
function now(): string {
  return new Date().toISOString();
}

export interface CollectionOptions {
  shardCount?: number;
}

/**
 * Collection class for type-safe CRUD operations
 */
export class Collection<T extends Document> implements ICollection<T> {
  private shardManager: ShardManager;
  private basePath: string;

  constructor(
    private adapter: StorageAdapter,
    private dbPath: string,
    private collectionName: string,
    options: CollectionOptions = {}
  ) {
    this.basePath = `${dbPath}/${collectionName}`;
    this.shardManager = new ShardManager(
      adapter,
      this.basePath,
      options.shardCount || 16
    );
  }

  private getDocPath(id: string): string {
    return `${this.basePath}/docs/${id}.json`;
  }

  async insert(data: InsertDocument<T>): Promise<T> {
    const id = generateId();
    const timestamp = now();

    const document: T = {
      ...data,
      id,
      _createdAt: timestamp,
      _updatedAt: timestamp,
    } as T;

    // Write document to storage
    const { etag } = await this.adapter.put(this.getDocPath(id), document);

    document._etag = etag;

    // Add to index
    await this.shardManager.addDocument(document);

    return document;
  }

  async findById(id: string): Promise<T | null> {
    try {
      const { data, etag } = await this.adapter.get(this.getDocPath(id));
      const doc = data as T;
      doc._etag = etag;
      return doc;
    } catch (error) {
      return null;
    }
  }

  async find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]> {
    // Query index to get matching document IDs
    const indexResults = await this.shardManager.query(filter);

    // Get full documents
    const ids = indexResults.map(doc => doc.id);

    if (ids.length === 0) {
      return [];
    }

    // Batch get documents
    const docMap = await this.adapter.batchGet(ids.map(id => this.getDocPath(id)));

    let results = Array.from(docMap.values()).map(obj => {
      const doc = obj.data as T;
      doc._etag = obj.etag;
      return doc;
    });

    // Apply pagination
    if (options?.offset) {
      results = results.slice(options.offset);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async update(
    id: string,
    data: UpdateDocument<T>,
    options?: UpdateOptions
  ): Promise<T> {
    // Get current document
    const current = await this.findById(id);
    if (!current) {
      throw new DocumentNotFoundError(id);
    }

    // Check optimistic lock if etag provided
    if (options?.etag && current._etag !== options.etag) {
      throw new ConcurrentUpdateError(`ETag mismatch for document ${id}`);
    }

    // Merge updates
    const updated: T = {
      ...current,
      ...data,
      id,
      _updatedAt: now(),
    } as T;

    // Write document
    const { etag } = await this.adapter.put(
      this.getDocPath(id),
      updated,
      current._etag ? { ifMatch: current._etag } : undefined
    );

    updated._etag = etag;

    // Update index
    await this.shardManager.updateDocument(updated);

    return updated;
  }

  async delete(id: string): Promise<void> {
    // Check if document exists
    const exists = await this.findById(id);
    if (!exists) {
      throw new DocumentNotFoundError(id);
    }

    // Delete from storage
    await this.adapter.delete(this.getDocPath(id));

    // Remove from index
    await this.shardManager.removeDocument(id);
  }
}
