import type { StorageAdapter, Capabilities, WriteCondition, ListOptions, ListPage } from './adapter.js';
import { MAX_LIST_LIMIT } from './adapter.js';
import { StorageError } from '../errors.js';

/**
 * In-process storage for tests and local development. Nothing is persisted.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly capabilities: Capabilities = { createIfAbsent: 'atomic', compareAndSwap: 'atomic' };
  private readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  private version = 0;

  async get(key: string): Promise<{ body: Uint8Array; etag: string }> {
    const object = this.objects.get(key);
    if (!object) {
      throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
    }
    return { body: object.body.slice(), etag: object.etag };
  }

  async put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }> {
    const existing = this.objects.get(key);
    if (condition && 'ifNoneMatch' in condition && existing) {
      throw new StorageError(`Object already exists: ${key}`, { kind: 'conflict', key });
    }
    if (condition && 'ifMatch' in condition) {
      if (!existing) {
        throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
      }
      if (existing.etag !== condition.ifMatch) {
        throw new StorageError(`ETag mismatch: ${key}`, { kind: 'conflict', key });
      }
    }
    const etag = `m${++this.version}`;
    this.objects.set(key, { body: body.slice(), etag });
    return { etag };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string, options: ListOptions = {}): Promise<ListPage> {
    const limit = Math.min(options.limit ?? MAX_LIST_LIMIT, MAX_LIST_LIMIT);
    const entries = [...this.objects]
      .filter(([key]) => key.startsWith(prefix) && (options.cursor === undefined || key > options.cursor))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, { etag }]) => ({ key, etag }));
    const page = entries.slice(0, limit);
    return {
      entries: page,
      cursor: entries.length > limit ? page[page.length - 1].key : undefined,
    };
  }
}
