import type { StorageAdapter, IndexShard, QueryFilter, ShardMetadata } from '../types/index.js';
import { StorageError } from '../types/index.js';
import { getShardId, formatShardId } from '../utils/hash.js';
import { evaluateFilter } from '../query/evaluator.js';

/**
 * Manages index shards for a collection
 */
export class ShardManager {
  constructor(
    private adapter: StorageAdapter,
    private collectionPath: string,
    private shardCount: number
  ) {}

  private getShardPath(shardId: number): string {
    return `${this.collectionPath}/index/shard-${formatShardId(shardId)}.json`;
  }

  private getShardMetadataPath(shardId: number): string {
    return `${this.collectionPath}/index/shard-${formatShardId(shardId)}.meta.json`;
  }

  private async readShardMetadata(shardId: number): Promise<ShardMetadata | null> {
    const path = this.getShardMetadataPath(shardId);
    try {
      const { data } = await this.adapter.get(path);
      return data as ShardMetadata;
    } catch (error) {
      return null;
    }
  }

  private async readShard(shardId: number): Promise<{ shard: IndexShard; etag?: string }> {
    const path = this.getShardPath(shardId);
    try {
      const { data, etag } = await this.adapter.get(path);
      return { shard: data as IndexShard, etag };
    } catch (error) {
      // Return empty shard if not found
      return {
        shard: {
          shardId: formatShardId(shardId),
          documents: {},
        },
        etag: undefined,
      };
    }
  }

  private async writeShard(shardId: number, shard: IndexShard, etag?: string): Promise<void> {
    const path = this.getShardPath(shardId);
    const metaPath = this.getShardMetadataPath(shardId);

    // Write shard data
    await this.adapter.put(path, shard, etag ? { ifMatch: etag } : undefined);

    // Write metadata
    const metadata: ShardMetadata = {
      shardId: formatShardId(shardId),
      docCount: Object.keys(shard.documents).length,
      lastUpdated: new Date().toISOString(),
    };
    await this.adapter.put(metaPath, metadata);
  }

  /**
   * Add document to index
   */
  async addDocument(doc: Record<string, any>): Promise<void> {
    const docId = doc.id;
    const shardId = getShardId(docId, this.shardCount);

    // Retry logic for optimistic locking with exponential backoff
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Read shard and etag in a single operation
        const { shard, etag } = await this.readShard(shardId);

        shard.documents[docId] = { ...doc };

        await this.writeShard(shardId, shard, etag);
        return;
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
          if (attempt < maxRetries - 1) {
            // Exponential backoff with jitter: 100ms * 2^attempt + random(0-50ms)
            const baseDelay = 100 * Math.pow(2, attempt);
            const jitter = Math.random() * 50;
            await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
            continue;
          }
        }
        throw error;
      }
    }
    throw new StorageError('Failed to add document after retries');
  }

  /**
   * Update document in index
   */
  async updateDocument(doc: Record<string, any>): Promise<void> {
    await this.addDocument(doc); // Same as add - upsert behavior
  }

  /**
   * Remove document from index
   */
  async removeDocument(docId: string): Promise<void> {
    const shardId = getShardId(docId, this.shardCount);

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Read shard and etag in a single operation
        const { shard, etag } = await this.readShard(shardId);

        delete shard.documents[docId];

        await this.writeShard(shardId, shard, etag);
        return;
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
          if (attempt < maxRetries - 1) {
            // Exponential backoff with jitter
            const baseDelay = 100 * Math.pow(2, attempt);
            const jitter = Math.random() * 50;
            await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
            continue;
          }
        }
        // Ignore if shard doesn't exist
        if (error instanceof StorageError && error.message.includes('not found')) {
          return;
        }
        throw error;
      }
    }
    throw new StorageError('Failed to remove document after retries');
  }

  /**
   * Find document by ID
   */
  async findById(docId: string): Promise<Record<string, any> | null> {
    const shardId = getShardId(docId, this.shardCount);
    const { shard } = await this.readShard(shardId);
    return shard.documents[docId] || null;
  }

  /**
   * Query documents matching filter
   */
  async query(filter: QueryFilter<any>): Promise<Array<Record<string, any>>> {
    // Optimization: If filter contains id equality, target specific shard
    if (filter.id && typeof filter.id === 'string') {
      const targetShardId = getShardId(filter.id, this.shardCount);
      const { shard } = await this.readShard(targetShardId);
      const doc = shard.documents[filter.id];
      if (doc && evaluateFilter(doc, filter)) {
        return [doc];
      }
      return [];
    }

    // Read all shard metadata first (lightweight)
    const metadataPromises = Array.from(
      { length: this.shardCount },
      (_, i) => this.readShardMetadata(i)
    );
    const allMetadata = await Promise.all(metadataPromises);

    // Filter out empty shards
    const nonEmptyShardIds = allMetadata
      .map((meta, index) => ({ meta, index }))
      .filter(({ meta }) => meta && meta.docCount > 0)
      .map(({ index }) => index);

    // Read only non-empty shards in parallel
    const shardPromises = nonEmptyShardIds.map(i => this.readShard(i));
    const shardResults = await Promise.all(shardPromises);

    // Filter documents across all shards
    const results: Array<Record<string, any>> = [];
    for (const { shard } of shardResults) {
      for (const doc of Object.values(shard.documents)) {
        if (evaluateFilter(doc, filter)) {
          results.push(doc);
        }
      }
    }

    return results;
  }
}
