import type { StorageAdapter, IndexShard, QueryFilter } from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';
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

  private async readShard(shardId: number): Promise<IndexShard> {
    const path = this.getShardPath(shardId);
    try {
      const { data } = await this.adapter.get(path);
      return data as IndexShard;
    } catch (error) {
      // Return empty shard if not found
      return {
        shardId: formatShardId(shardId),
        documents: {},
      };
    }
  }

  private async writeShard(shardId: number, shard: IndexShard, etag?: string): Promise<void> {
    const path = this.getShardPath(shardId);
    await this.adapter.put(path, shard, etag ? { ifMatch: etag } : undefined);
  }

  /**
   * Add document to index
   */
  async addDocument(doc: Record<string, any>): Promise<void> {
    const docId = doc.id;
    const shardId = getShardId(docId, this.shardCount);

    // Retry logic for optimistic locking
    let retries = 3;
    while (retries > 0) {
      try {
        const shard = await this.readShard(shardId);
        const currentEtag = shard.documents[docId] ?
          (await this.adapter.get(this.getShardPath(shardId))).etag :
          undefined;

        shard.documents[docId] = { ...doc };

        await this.writeShard(shardId, shard, currentEtag);
        return;
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
          retries--;
          await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
          continue;
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

    let retries = 3;
    while (retries > 0) {
      try {
        const { etag } = await this.adapter.get(this.getShardPath(shardId));
        const shard = await this.readShard(shardId);

        delete shard.documents[docId];

        await this.writeShard(shardId, shard, etag);
        return;
      } catch (error) {
        if (error instanceof StorageError && error.message.includes('PreconditionFailed')) {
          retries--;
          await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
          continue;
        }
        // Ignore if shard doesn't exist
        if (error instanceof StorageError && error.message.includes('not found')) {
          return;
        }
        throw error;
      }
    }
  }

  /**
   * Find document by ID
   */
  async findById(docId: string): Promise<Record<string, any> | null> {
    const shardId = getShardId(docId, this.shardCount);
    const shard = await this.readShard(shardId);
    return shard.documents[docId] || null;
  }

  /**
   * Query documents matching filter
   */
  async query(filter: QueryFilter<any>): Promise<Array<Record<string, any>>> {
    // Read all shards in parallel
    const shardPromises = Array.from(
      { length: this.shardCount },
      (_, i) => this.readShard(i)
    );

    const shards = await Promise.all(shardPromises);

    // Filter documents across all shards
    const results: Array<Record<string, any>> = [];
    for (const shard of shards) {
      for (const doc of Object.values(shard.documents)) {
        if (evaluateFilter(doc, filter)) {
          results.push(doc);
        }
      }
    }

    return results;
  }
}
