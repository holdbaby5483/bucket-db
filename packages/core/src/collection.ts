import { setTimeout as sleep } from 'node:timers/promises';
import type { Document, InsertDocument, UpdateDocument, QueryFilter, QueryOptions, UpdateOptions } from './types.js';
import type { StorageAdapter } from './storage/adapter.js';
import { getMany } from './storage/adapter.js';
import { ConcurrentUpdateError, DocumentNotFoundError, StorageError, UnsupportedError } from './errors.js';
import { docsPrefix, isValidName, validateName } from './keys.js';
import { evaluateFilter, validateFilter } from './query.js';

/** Conflicting writes an etag-less update retries before giving up. */
const UPDATE_RETRIES = 5;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Drops system fields a caller may have passed in at runtime. */
function withoutSystemFields(data: object): Record<string, unknown> {
  const { id: _id, _etag, _createdAt, _updatedAt, ...rest } = data as Record<string, unknown>;
  return rest;
}

/**
 * A set of JSON documents stored one object per document at
 * `<dbPath>/<name>/docs/<id>.json`. Every write is a single storage request.
 */
export class Collection<T extends Document> {
  private readonly prefix: string;

  constructor(
    private readonly adapter: StorageAdapter,
    dbPath: string,
    name: string
  ) {
    this.prefix = docsPrefix(dbPath, validateName('collection name', name));
  }

  private keyOf(id: string): string {
    return `${this.prefix}${validateName('document ID', id)}.json`;
  }

  /** The key decides the id and the service decides the etag, whatever the body says. */
  private decode(key: string, id: string, body: Uint8Array, etag: string): T {
    let data: unknown;
    try {
      data = JSON.parse(decoder.decode(body));
    } catch (error) {
      throw new StorageError(`${key} is not valid JSON`, { key, cause: error });
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new StorageError(`${key} is not a JSON object`, { key });
    }
    return { ...data, id, _etag: etag } as T;
  }

  private encode(document: T): Uint8Array {
    const { _etag, ...body } = document;
    return encoder.encode(JSON.stringify(body));
  }

  /** Creates a document with a generated id. One PUT. */
  async insert(data: InsertDocument<T>): Promise<T> {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const document = { ...withoutSystemFields(data), id, _createdAt: timestamp, _updatedAt: timestamp } as T;
    const condition = this.adapter.capabilities.createIfAbsent === 'none' ? undefined : ({ ifNoneMatch: '*' } as const);
    const { etag } = await this.adapter.put(this.keyOf(id), this.encode(document), condition);
    return { ...document, _etag: etag };
  }

  /** Returns `null` only when the document does not exist; other failures throw. One GET. */
  async findById(id: string): Promise<T | null> {
    const key = this.keyOf(id);
    try {
      const { body, etag } = await this.adapter.get(key);
      return this.decode(key, id, body, etag);
    } catch (error) {
      if (error instanceof StorageError && error.kind === 'not-found') return null;
      throw error;
    }
  }

  /**
   * Lists the collection, reads every document and filters in memory.
   * An `id` equality filter reads a single document instead.
   */
  async find(filter: QueryFilter<T> = {}, options: QueryOptions = {}): Promise<T[]> {
    validateFilter(filter);

    let documents: T[];
    if (typeof filter.id === 'string') {
      const document = isValidName(filter.id) ? await this.findById(filter.id) : null;
      documents = document ? [document] : [];
    } else {
      documents = await this.readAll();
    }

    const matched = documents.filter(document => evaluateFilter(document as Record<string, unknown>, filter));
    const offset = options.offset ?? 0;
    return options.limit ? matched.slice(offset, offset + options.limit) : matched.slice(offset);
  }

  private async readAll(): Promise<T[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.adapter.list(this.prefix, { cursor });
      for (const { key } of page.entries) {
        const name = key.slice(this.prefix.length);
        if (name.startsWith('.')) continue; // hidden files (e.g. .DS_Store) are never documents
        keys.push(key);
      }
      cursor = page.cursor;
    } while (cursor);

    const documents: T[] = [];
    for (const result of await getMany(this.adapter, keys)) {
      if ('error' in result) {
        if (result.error.kind === 'not-found') continue; // deleted after the list
        throw result.error;
      }
      const name = result.key.slice(this.prefix.length);
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
      if (!isValidName(id)) {
        throw new StorageError(`${result.key} is not a document key (expected <id>.json)`, { key: result.key });
      }
      documents.push(this.decode(result.key, id, result.body, result.etag));
    }
    return documents;
  }

  /**
   * Merges `data` into the stored document.
   *
   * With `etag`: fails with ConcurrentUpdateError unless the document still has
   * that etag. Without: on backends that support compare-and-swap, conflicting
   * writers are retried so concurrent partial updates all apply; otherwise the
   * last write wins.
   */
  async update(id: string, data: UpdateDocument<T>, options: UpdateOptions = {}): Promise<T> {
    const key = this.keyOf(id);
    const compareAndSwap = this.adapter.capabilities.compareAndSwap !== 'none';
    if (options.etag !== undefined && !compareAndSwap) {
      throw new UnsupportedError('This storage backend cannot enforce an etag on update');
    }
    const changes = withoutSystemFields(data);

    for (let attempt = 0; ; attempt++) {
      const current = await this.findById(id);
      if (!current) throw new DocumentNotFoundError(id);
      if (options.etag !== undefined && current._etag !== options.etag) {
        throw new ConcurrentUpdateError(`ETag mismatch for document ${id}`);
      }

      const updated = {
        ...current,
        ...changes,
        id,
        _createdAt: current._createdAt,
        _updatedAt: new Date().toISOString(),
      } as T;
      try {
        const { etag } = await this.adapter.put(key, this.encode(updated), compareAndSwap ? { ifMatch: current._etag! } : undefined);
        return { ...updated, _etag: etag };
      } catch (error) {
        if (!(error instanceof StorageError)) throw error;
        if (error.kind === 'not-found') throw new DocumentNotFoundError(id);
        if (error.kind !== 'conflict') throw error;
        if (options.etag !== undefined) {
          throw new ConcurrentUpdateError(`Document ${id} was modified by another writer`);
        }
        if (attempt === UPDATE_RETRIES) {
          throw new ConcurrentUpdateError(`Document ${id} kept changing; gave up after ${attempt + 1} attempts`);
        }
        await sleep(Math.random() * Math.min(1000, 25 * 2 ** attempt));
      }
    }
  }

  /** Deletes the document if it exists. One DELETE. */
  async delete(id: string): Promise<void> {
    await this.adapter.delete(this.keyOf(id));
  }
}
