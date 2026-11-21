import type { StorageAdapter, StorageObject, PutOptions } from '../../src/index.js';

export type StorageOperation = 'get' | 'put' | 'delete' | 'exists' | 'listKeys' | 'batchGet';

/**
 * Runs before a storage call. Throw to inject a failure; await to let another
 * writer act first. `batchGet` invokes it once per key.
 */
export type BeforeHook = (operation: StorageOperation, key: string) => void | Promise<void>;

/**
 * Wraps a StorageAdapter so tests can inject failures and races at the
 * storage boundary without knowing how Collection uses storage.
 */
export class FaultyAdapter implements StorageAdapter {
  before: BeforeHook | undefined;

  constructor(private readonly inner: StorageAdapter) {}

  async get(key: string): Promise<StorageObject> {
    await this.before?.('get', key);
    return this.inner.get(key);
  }

  async put(key: string, data: unknown, options?: PutOptions): Promise<{ etag: string }> {
    await this.before?.('put', key);
    return this.inner.put(key, data, options);
  }

  async delete(key: string): Promise<void> {
    await this.before?.('delete', key);
    return this.inner.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    await this.before?.('exists', key);
    return this.inner.exists(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    await this.before?.('listKeys', prefix);
    return this.inner.listKeys(prefix);
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    for (const key of keys) {
      await this.before?.('batchGet', key);
    }
    return this.inner.batchGet(keys);
  }
}
