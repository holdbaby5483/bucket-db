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
import { DocumentNotFoundError, ConcurrentUpdateError, StorageError } from '../types/index.js';
import { ShardManager } from '../index/shard-manager.js';
import { sanitizePathComponent, safePathJoin } from '../utils/path-validator.js';
import { WAL, type WALEntry } from './wal.js';

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
  private wal: WAL;
  private basePath: string;

  constructor(
    private adapter: StorageAdapter,
    dbPath: string,
    collectionName: string,
    options: CollectionOptions = {}
  ) {
    // Validate collection name to prevent path traversal
    const sanitizedCollectionName = sanitizePathComponent(collectionName);
    this.basePath = safePathJoin(dbPath, sanitizedCollectionName);
    this.shardManager = new ShardManager(
      adapter,
      this.basePath,
      options.shardCount || 16
    );
    this.wal = new WAL(adapter, this.basePath);

    // Recover from any pending WAL entries
    this.recoverFromWAL().catch(err => {
      console.error('WAL recovery failed:', err);
    });
  }

  /**
   * Recover from pending WAL entries
   */
  private async recoverFromWAL(): Promise<void> {
    await this.wal.recover(async (entry: WALEntry) => {
      // Replay the operation based on WAL entry
      switch (entry.operation) {
        case 'insert':
        case 'update':
          // Ensure document is indexed
          if (entry.documentData) {
            await this.shardManager.addDocument(entry.documentData);
          }
          break;
        case 'delete':
          // Ensure document is removed from index
          await this.shardManager.removeDocument(entry.documentId);
          break;
      }
    });
  }

  private getDocPath(id: string): string {
    // Validate document ID to prevent path traversal
    const sanitizedId = sanitizePathComponent(id);
    return safePathJoin(this.basePath, 'docs', `${sanitizedId}.json`);
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

    // 1. Log operation to WAL first
    await this.wal.log({
      operation: 'insert',
      collectionPath: this.basePath,
      documentId: id,
      documentData: document,
      timestamp,
    });

    try {
      // 2. Write document to storage
      const { etag } = await this.adapter.put(this.getDocPath(id), document);
      document._etag = etag;

      // 3. Add to index
      await this.shardManager.addDocument(document);

      // 4. Clear WAL entry after successful completion
      await this.wal.clear(id);

      return document;
    } catch (error) {
      // On failure, WAL entry remains for recovery
      throw error;
    }
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
    let ids = indexResults.map(doc => doc.id);

    if (ids.length === 0) {
      return [];
    }

    // Apply pagination on IDs before loading documents (PERF optimization)
    if (options?.offset) {
      ids = ids.slice(options.offset);
    }
    if (options?.limit) {
      ids = ids.slice(0, options.limit);
    }

    // Batch get only the required documents
    const docMap = await this.adapter.batchGet(ids.map(id => this.getDocPath(id)));

    // Convert to array and add etags
    const results = Array.from(docMap.values()).map(obj => {
      const doc = obj.data as T;
      doc._etag = obj.etag;
      return doc;
    });

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

    // 1. Log operation to WAL first
    await this.wal.log({
      operation: 'update',
      collectionPath: this.basePath,
      documentId: id,
      documentData: updated,
      timestamp: now(),
    });

    // 2. Write document; a failed precondition means another writer changed it since our read
    let etag: string;
    try {
      ({ etag } = await this.adapter.put(
        this.getDocPath(id),
        updated,
        current._etag ? { ifMatch: current._etag } : undefined
      ));
    } catch (error) {
      if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
        throw new ConcurrentUpdateError(`Document ${id} was modified by another writer`);
      }
      throw error;
    }

    updated._etag = etag;

    // 3. Update index
    await this.shardManager.updateDocument(updated);

    // 4. Clear WAL entry
    await this.wal.clear(id);

    return updated;
  }

  async delete(id: string): Promise<void> {
    // Check if document exists
    const exists = await this.findById(id);
    if (!exists) {
      throw new DocumentNotFoundError(id);
    }

    // 1. Log operation to WAL first
    await this.wal.log({
      operation: 'delete',
      collectionPath: this.basePath,
      documentId: id,
      timestamp: now(),
    });

    try {
      // 2. Delete from storage
      await this.adapter.delete(this.getDocPath(id));

      // 3. Remove from index
      await this.shardManager.removeDocument(id);

      // 4. Clear WAL entry
      await this.wal.clear(id);
    } catch (error) {
      throw error;
    }
  }
}
