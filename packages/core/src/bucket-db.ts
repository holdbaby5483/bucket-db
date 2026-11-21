import type { Document, Logger } from './types.js';
import type { StorageAdapter } from './storage/adapter.js';
import { Collection } from './collection.js';
import { validateDbPath } from './keys.js';

export interface BucketDBOptions {
  /** Receives snapshot write failures and envelope warnings. Default: console.warn. */
  logger?: Logger;
}

/**
 * Entry point: a storage backend plus a key prefix (`dbPath`, `''` for the bucket root).
 */
export class BucketDB {
  private readonly collections = new Map<string, unknown>();

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly dbPath: string,
    private readonly options: BucketDBOptions = {}
  ) {
    validateDbPath(dbPath);
  }

  /** Returns the same Collection instance for the same name. */
  collection<T extends Document>(name: string): Collection<T> {
    let collection = this.collections.get(name) as Collection<T> | undefined;
    if (!collection) {
      collection = new Collection<T>(this.adapter, this.dbPath, name, { logger: this.options.logger });
      this.collections.set(name, collection);
    }
    return collection;
  }
}
