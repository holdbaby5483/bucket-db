import type { StorageAdapter, Document } from '../types/index.js';
import { Collection, CollectionOptions } from './collection.js';
import { sanitizePathComponent } from '../utils/path-validator.js';

export interface BucketDBOptions {
  defaultShardCount?: number;
}

/**
 * Main BucketDB class
 */
export class BucketDB {
  private collections = new Map<string, Collection<any>>();

  constructor(
    private adapter: StorageAdapter,
    private dbPath: string,
    private options: BucketDBOptions = {}
  ) {}

  /**
   * Get or create a collection
   */
  collection<T extends Document>(
    name: string,
    options?: CollectionOptions
  ): Collection<T> {
    // Validate collection name to prevent path traversal
    sanitizePathComponent(name);

    if (this.collections.has(name)) {
      return this.collections.get(name)!;
    }

    const collection = new Collection<T>(
      this.adapter,
      this.dbPath,
      name,
      {
        shardCount: options?.shardCount || this.options.defaultShardCount || 16,
      }
    );

    this.collections.set(name, collection);
    return collection;
  }
}
