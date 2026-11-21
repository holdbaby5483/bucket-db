import type { StorageAdapter, WriteCondition, ListOptions, ListPage } from '../../src/index.js';

export type StorageOperation = 'get' | 'put' | 'delete' | 'list';

/**
 * Runs before a storage call. Throw to inject a failure; await to let another
 * writer act first. For `list`, `key` is the prefix.
 */
export type BeforeHook = (operation: StorageOperation, key: string) => void | Promise<void>;

/**
 * Wraps a StorageAdapter so tests can inject failures and races at the
 * storage boundary without knowing how Collection uses storage.
 */
export class FaultyAdapter implements StorageAdapter {
  before: BeforeHook | undefined;

  constructor(private readonly inner: StorageAdapter) {}

  get capabilities() {
    return this.inner.capabilities;
  }

  async get(key: string): Promise<{ body: Uint8Array; etag: string }> {
    await this.before?.('get', key);
    return this.inner.get(key);
  }

  async put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }> {
    await this.before?.('put', key);
    return this.inner.put(key, body, condition);
  }

  async delete(key: string): Promise<void> {
    await this.before?.('delete', key);
    return this.inner.delete(key);
  }

  async list(prefix: string, options?: ListOptions): Promise<ListPage> {
    await this.before?.('list', prefix);
    return this.inner.list(prefix, options);
  }
}
