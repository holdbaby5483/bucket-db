import { StorageError } from '../errors.js';

/**
 * How strongly a backend enforces a write condition:
 * - `atomic`: enforced by the storage service, across processes
 * - `single-process`: enforced only among writers in one process
 * - `none`: not supported; requesting it throws UnsupportedError
 */
export type Guarantee = 'atomic' | 'single-process' | 'none';

export interface Capabilities {
  /** `put(key, body, { ifNoneMatch: '*' })` */
  readonly createIfAbsent: Guarantee;
  /** `put(key, body, { ifMatch })` */
  readonly compareAndSwap: Guarantee;
}

export type WriteCondition = { ifNoneMatch: '*' } | { ifMatch: string };

export interface ObjectEntry {
  key: string;
  /** Unquoted; equals the etag `get` / `put` report for the same version. */
  etag: string;
}

export interface ListPage {
  /** In lexicographic key order. */
  entries: ObjectEntry[];
  /** Present when another page follows. */
  cursor?: string;
}

export interface ListOptions {
  cursor?: string;
  /** Page size; default and maximum 1000. */
  limit?: number;
}

/**
 * A flat key/value object store. Keys use `/` as separator.
 *
 * Errors are StorageError with `kind`:
 * - `get` of a missing key: `not-found`
 * - `put` whose condition fails: `conflict`; `ifMatch` on a missing key: `not-found`
 * - `put` with a condition whose capability is `none`: UnsupportedError, without a request
 * - `delete` of a missing key: no error
 */
export interface StorageAdapter {
  readonly capabilities: Capabilities;
  get(key: string): Promise<{ body: Uint8Array; etag: string }>;
  put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  list(prefix: string, options?: ListOptions): Promise<ListPage>;
}

export const MAX_LIST_LIMIT = 1000;

export type GetManyResult =
  | { key: string; body: Uint8Array; etag: string }
  | { key: string; error: StorageError };

/**
 * Reads `keys` with at most `concurrency` requests in flight. Results follow
 * the input order; a failed read is reported in place instead of rejecting.
 */
export async function getMany(
  adapter: StorageAdapter,
  keys: string[],
  concurrency = 16
): Promise<GetManyResult[]> {
  const results = new Array<GetManyResult>(keys.length);
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const index = next++;
      const key = keys[index];
      try {
        results[index] = { key, ...(await adapter.get(key)) };
      } catch (error) {
        results[index] = {
          key,
          error: error instanceof StorageError ? error : new StorageError(`Failed to read ${key}`, { key, cause: error }),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return results;
}
