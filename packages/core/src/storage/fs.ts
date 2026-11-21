import { mkdir, open, link, rename, unlink, readdir, writeFile, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StorageAdapter, Capabilities, WriteCondition, ListOptions, ListPage } from './adapter.js';
import { MAX_LIST_LIMIT } from './adapter.js';
import { StorageError } from '../errors.js';

export interface FileSystemAdapterConfig {
  /** Directory that holds all objects; created on first write. */
  basePath: string;
}

/** Temporary write files and 0.3.x `.meta` sidecars are not objects. */
const isInternalFile = (name: string) => name.endsWith('.tmp') || name.endsWith('.meta');

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

/** Every write replaces the file with a new inode, so the etag changes on every write. */
function etagOf(stats: BigIntStats): string {
  return `${stats.ino.toString(36)}-${stats.mtimeNs.toString(36)}-${stats.size.toString(36)}`;
}

/**
 * Stores each object as a file under `basePath`. Create-if-absent uses
 * `link()`, which is atomic across processes; compare-and-swap is serialized
 * only within this process.
 */
export class FileSystemAdapter implements StorageAdapter {
  readonly capabilities: Capabilities = { createIfAbsent: 'atomic', compareAndSwap: 'single-process' };
  private readonly basePath: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(config: FileSystemAdapterConfig) {
    this.basePath = resolve(config.basePath);
  }

  private pathOf(key: string): string {
    const segments = key.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment.includes('\\') || isInternalFile(segment))) {
      throw new StorageError(`Invalid key: ${key}`, { key });
    }
    return join(this.basePath, ...segments);
  }

  /** Runs `fn` after every earlier writer of `path` in this process has finished. */
  private async withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(path) ?? Promise.resolve()).then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(path, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(path) === tail) this.locks.delete(path);
    }
  }

  async get(key: string): Promise<{ body: Uint8Array; etag: string }> {
    const path = this.pathOf(key);
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
      }
      throw new StorageError(`Failed to read ${key}`, { key, cause: error });
    }
    try {
      // stat and read through one descriptor so the etag matches the bytes
      const stats = await handle.stat({ bigint: true });
      if (!stats.isFile()) {
        throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
      }
      return { body: new Uint8Array(await handle.readFile()), etag: etagOf(stats) };
    } finally {
      await handle.close();
    }
  }

  async put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }> {
    const path = this.pathOf(key);
    return this.withLock(path, async () => {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, body, { flag: 'wx' });
      try {
        // rename and link keep the inode and mtime, so this is the etag of the stored object
        const etag = etagOf(await stat(temp, { bigint: true }));
        if (condition && 'ifNoneMatch' in condition) {
          try {
            await link(temp, path);
          } catch (error) {
            if (errorCode(error) === 'EEXIST') {
              throw new StorageError(`Object already exists: ${key}`, { kind: 'conflict', key });
            }
            throw error;
          }
        } else {
          if (condition && 'ifMatch' in condition) {
            const current = await stat(path, { bigint: true }).catch((error: unknown) => {
              if (errorCode(error) === 'ENOENT') {
                throw new StorageError(`Object not found: ${key}`, { kind: 'not-found', key });
              }
              throw error;
            });
            if (etagOf(current) !== condition.ifMatch) {
              throw new StorageError(`ETag mismatch: ${key}`, { kind: 'conflict', key });
            }
          }
          await rename(temp, path);
        }
        return { etag };
      } catch (error) {
        if (error instanceof StorageError) throw error;
        throw new StorageError(`Failed to write ${key}`, { key, cause: error });
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    });
  }

  async delete(key: string): Promise<void> {
    const path = this.pathOf(key);
    await this.withLock(path, async () => {
      try {
        await unlink(path);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw new StorageError(`Failed to delete ${key}`, { key, cause: error });
        }
      }
    });
  }

  async list(prefix: string, options: ListOptions = {}): Promise<ListPage> {
    const limit = Math.min(options.limit ?? MAX_LIST_LIMIT, MAX_LIST_LIMIT);
    const slash = prefix.lastIndexOf('/');
    const directory = prefix.slice(0, slash + 1);
    const keys: string[] = [];
    const walk = async (keyPrefix: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(join(this.basePath, ...keyPrefix.split('/').filter(Boolean)), { withFileTypes: true });
      } catch (error) {
        const code = errorCode(error);
        if (code === 'ENOENT' || code === 'ENOTDIR') return;
        throw new StorageError(`Failed to list ${prefix}`, { cause: error });
      }
      for (const entry of entries) {
        const key = keyPrefix + entry.name;
        if (entry.isDirectory()) {
          if (prefix.startsWith(key + '/') || (key + '/').startsWith(prefix)) await walk(key + '/');
        } else if (entry.isFile() && !isInternalFile(entry.name) && key.startsWith(prefix)) {
          if (options.cursor === undefined || key > options.cursor) keys.push(key);
        }
      }
    };
    await walk(directory);
    keys.sort();

    const page = keys.slice(0, limit);
    const entries = [];
    for (const key of page) {
      try {
        entries.push({ key, etag: etagOf(await stat(this.pathOf(key), { bigint: true })) });
      } catch (error) {
        // deleted after the directory walk
        if (errorCode(error) !== 'ENOENT') throw new StorageError(`Failed to list ${prefix}`, { key, cause: error });
      }
    }
    return { entries, cursor: keys.length > limit ? page[page.length - 1] : undefined };
  }
}
