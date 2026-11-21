import type { Document } from './types.js';
import type { StorageAdapter } from './storage/adapter.js';
import { Collection } from './collection.js';
import { validateDbPath } from './keys.js';

/**
 * Entry point: a storage backend plus a key prefix (`dbPath`, `''` for the bucket root).
 */
export class BucketDB {
  private readonly collections = new Map<string, unknown>();

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly dbPath: string
  ) {
    validateDbPath(dbPath);
  }

  /** Returns the same Collection instance for the same name. */
  collection<T extends Document>(name: string): Collection<T> {
    let collection = this.collections.get(name) as Collection<T> | undefined;
    if (!collection) {
      collection = new Collection<T>(this.adapter, this.dbPath, name);
      this.collections.set(name, collection);
    }
    return collection;
  }
}
