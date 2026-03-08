import type { Document, InsertDocument, UpdateDocument } from './document.js';
import type { QueryFilter, QueryOptions, UpdateOptions } from './query.js';

/**
 * Collection interface for type-safe CRUD operations
 */
export interface ICollection<T extends Document> {
  insert(data: InsertDocument<T>): Promise<T>;
  findById(id: string): Promise<T | null>;
  find(filter: QueryFilter<T>, options?: QueryOptions): Promise<T[]>;
  update(id: string, data: UpdateDocument<T>, options?: UpdateOptions): Promise<T>;
  delete(id: string): Promise<void>;
}

/**
 * Collection metadata
 */
export interface CollectionMeta {
  name: string;
  version: number;
  indexShardCount: number;
  indexedFields: string[];
  createdAt: string;
  documentCount: number;
  lastUpdated: string;
}

/**
 * Index shard structure
 */
export interface IndexShard {
  shardId: string;
  documents: Record<string, any>;
}
