import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
} from '@hold-baby/bucket-db-types';
import { StorageError } from '@hold-baby/bucket-db-types';

interface StorageEntry {
  data: any;
  etag: string;
  lastModified: Date;
}

/**
 * In-memory storage adapter for testing
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private storage = new Map<string, StorageEntry>();
  private etagCounter = 0;

  private generateETag(): string {
    return `etag-${++this.etagCounter}-${Date.now()}`;
  }

  async get(key: string): Promise<StorageObject> {
    const entry = this.storage.get(key);
    if (!entry) {
      throw new StorageError(`Object not found: ${key}`);
    }
    return {
      data: JSON.parse(JSON.stringify(entry.data)), // Deep clone
      etag: entry.etag,
      lastModified: entry.lastModified,
    };
  }

  async put(
    key: string,
    data: any,
    options?: PutOptions
  ): Promise<{ etag: string }> {
    const existing = this.storage.get(key);

    // Check ifMatch condition
    if (options?.ifMatch) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new StorageError('PreconditionFailed: ETag mismatch');
      }
    }

    // Check ifNoneMatch condition
    if (options?.ifNoneMatch && existing) {
      throw new StorageError('PreconditionFailed: Object already exists');
    }

    const etag = this.generateETag();
    this.storage.set(key, {
      data: JSON.parse(JSON.stringify(data)), // Deep clone
      etag,
      lastModified: new Date(),
    });

    return { etag };
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for (const key of this.storage.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys.sort();
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    const results = new Map<string, StorageObject>();
    for (const key of keys) {
      const entry = this.storage.get(key);
      if (entry) {
        results.set(key, {
          data: JSON.parse(JSON.stringify(entry.data)),
          etag: entry.etag,
          lastModified: entry.lastModified,
        });
      }
    }
    return results;
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.storage.clear();
  }
}
