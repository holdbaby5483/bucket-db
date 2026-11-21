import { setTimeout as sleep } from 'node:timers/promises';
import type {
  Document,
  InsertDocument,
  InsertOptions,
  UpdateDocument,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  Logger,
} from './types.js';
import type { StorageAdapter } from './storage/adapter.js';
import { getMany } from './storage/adapter.js';
import {
  ConcurrentUpdateError,
  DocumentExistsError,
  DocumentNotFoundError,
  StorageError,
  UnsupportedError,
  ValidationError,
} from './errors.js';
import { docsPrefix, isValidName, validateName } from './keys.js';
import { evaluateFilter, sortDocuments, validateFilter } from './query.js';
import { SNAPSHOT_NAME, encodeSnapshot, parseSnapshot, type SnapshotEntry } from './snapshot.js';

/** Conflicting writes an etag-less update retries before giving up. */
const UPDATE_RETRIES = 5;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Drops system fields a caller may have passed in at runtime. */
function withoutSystemFields(data: object): Record<string, unknown> {
  const { id: _id, _etag, _createdAt, _updatedAt, ...rest } = data as Record<string, unknown>;
  return rest;
}

export interface CollectionOptions {
  /** Receives snapshot write failures and envelope warnings. Default: console.warn. */
  logger?: Logger;
}

/** Documents fetched or dropped beyond which a query rewrites the snapshot. */
const SNAPSHOT_REWRITE_THRESHOLD = 16;
/** Collections beyond this are outside the documented envelope. */
const ENVELOPE_DOCUMENTS = 10_000;
const ENVELOPE_BYTES = 10 * 1024 * 1024;

const defaultLogger: Logger = ({ message, error }) => console.warn(`[bucket-db] ${message}`, ...(error ? [error] : []));

/**
 * A set of JSON documents stored one object per document at
 * `<dbPath>/<name>/docs/<id>.json`. Every write is a single storage request.
 */
export class Collection<T extends Document> {
  private readonly prefix: string;
  private readonly snapshotKey: string;
  private readonly logger: Logger;
  /** Cleared after a permission error, e.g. read-only credentials. */
  private snapshotWritable = true;
  private warnedEnvelope = false;

  constructor(
    private readonly adapter: StorageAdapter,
    dbPath: string,
    name: string,
    options: CollectionOptions = {}
  ) {
    this.prefix = docsPrefix(dbPath, validateName('collection name', name));
    this.snapshotKey = `${this.prefix.slice(0, -'docs/'.length)}${SNAPSHOT_NAME}`;
    this.logger = options.logger ?? defaultLogger;
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

  /**
   * Creates a document. One conditional PUT. With `options.id` the call fails
   * with DocumentExistsError when that id is taken; otherwise an id is generated.
   */
  async insert(data: InsertDocument<T>, options: InsertOptions = {}): Promise<T> {
    const id = options.id ?? crypto.randomUUID();
    const key = this.keyOf(id);
    const atomic = this.adapter.capabilities.createIfAbsent !== 'none';
    if (options.id !== undefined && !atomic) {
      throw new UnsupportedError('This storage backend cannot create a document only if it is absent');
    }
    const timestamp = new Date().toISOString();
    const document = { ...withoutSystemFields(data), id, _createdAt: timestamp, _updatedAt: timestamp } as T;
    try {
      const { etag } = await this.adapter.put(key, this.encode(document), atomic ? { ifNoneMatch: '*' } : undefined);
      return { ...document, _etag: etag };
    } catch (error) {
      if (error instanceof StorageError && error.kind === 'conflict') throw new DocumentExistsError(id);
      throw error;
    }
  }

  /**
   * Creates or replaces the whole document under `id`. One unconditional PUT, so
   * repeating it is harmless; `_createdAt` is reset, the old document is not read.
   */
  async put(id: string, data: InsertDocument<T>): Promise<T> {
    const timestamp = new Date().toISOString();
    const document = { ...withoutSystemFields(data), id, _createdAt: timestamp, _updatedAt: timestamp } as T;
    const { etag } = await this.adapter.put(this.keyOf(id), this.encode(document));
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
   * Lists the collection, reads the documents (from the snapshot where it is
   * current) and filters, sorts and pages in memory. An `id` equality filter
   * reads a single document instead.
   */
  async find(filter: QueryFilter<T> = {}, options: QueryOptions = {}): Promise<T[]> {
    validateFilter(filter);
    sortDocuments([], options.sort); // validates the sort spec before any request
    const { offset = 0, limit, sort } = options;
    if (!Number.isInteger(offset) || offset < 0 || (limit !== undefined && (!Number.isInteger(limit) || limit < 0))) {
      throw new ValidationError('offset and limit must be non-negative integers');
    }

    let documents: T[];
    if (typeof filter.id === 'string') {
      const document = isValidName(filter.id) ? await this.findById(filter.id) : null;
      documents = document ? [document] : [];
    } else {
      documents = await this.readAll();
    }

    const matched = documents.filter(document => evaluateFilter(document as Record<string, unknown>, filter));
    sortDocuments(matched as Array<T & Record<string, unknown>>, sort);
    return matched.slice(offset, limit === undefined ? undefined : offset + limit);
  }

  /** Without a filter this only lists the collection; with one it is `find(filter).length`. */
  async count(filter: QueryFilter<T> = {}): Promise<number> {
    if (Object.keys(filter).length > 0) return (await this.find(filter)).length;
    return (await this.listDocuments()).length;
  }

  /**
   * Deletes every document matching `filter` and returns how many. Not atomic:
   * documents are deleted one by one, 16 at a time.
   */
  async deleteMany(filter: QueryFilter<T>): Promise<number> {
    const matched = await this.find(filter);
    for (let start = 0; start < matched.length; start += 16) {
      await Promise.all(matched.slice(start, start + 16).map(document => this.delete(document.id)));
    }
    return matched.length;
  }

  private idOf(key: string): string {
    const name = key.slice(this.prefix.length);
    const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
    if (!isValidName(id)) {
      throw new StorageError(`${key} is not a document key (expected <id>.json)`, { key });
    }
    return id;
  }

  private async readSnapshot(): Promise<Map<string, SnapshotEntry>> {
    try {
      const { body } = await this.adapter.get(this.snapshotKey);
      const entries = parseSnapshot(body);
      if (!entries)
        this.logger({ level: 'warn', message: `${this.snapshotKey} is not a valid snapshot; rebuilding it` });
      return entries ?? new Map();
    } catch (error) {
      // a missing snapshot is rebuilt; any other read failure fails the query
      if (error instanceof StorageError && error.kind === 'not-found') return new Map();
      throw error;
    }
  }

  /** Lost, overwritten or failed snapshot writes only cost speed, so failures are logged, not thrown. */
  private async writeSnapshot(documents: T[], throwOnError = false): Promise<void> {
    const body = encodeSnapshot(documents);
    this.checkEnvelope(documents.length, body.length);
    if (!this.snapshotWritable && !throwOnError) return;
    try {
      await this.adapter.put(this.snapshotKey, body);
    } catch (error) {
      if (throwOnError) throw error;
      if (error instanceof StorageError && (error.status === 401 || error.status === 403))
        this.snapshotWritable = false;
      this.logger({
        level: 'error',
        message: `Failed to write ${this.snapshotKey}; queries stay correct but slower`,
        error,
      });
    }
  }

  private checkEnvelope(documents: number, bytes: number): void {
    if (this.warnedEnvelope || (documents <= ENVELOPE_DOCUMENTS && bytes <= ENVELOPE_BYTES)) return;
    this.warnedEnvelope = true;
    this.logger({
      level: 'warn',
      message: `Collection ${this.prefix.slice(0, -1)} has ${documents} documents (${Math.round(bytes / 1024)} kB); BucketDB is designed for at most ${ENVELOPE_DOCUMENTS} documents and ${ENVELOPE_BYTES / 1024 / 1024} MB per collection, and queries will keep getting slower`,
    });
  }

  /** Every document key in the collection with its etag, in key order. */
  private async listDocuments(): Promise<Array<{ key: string; etag: string; id: string }>> {
    const listed: Array<{ key: string; etag: string; id: string }> = [];
    let cursor: string | undefined;
    do {
      const page = await this.adapter.list(this.prefix, { cursor });
      for (const { key, etag } of page.entries) {
        if (key.slice(this.prefix.length).startsWith('.')) continue; // hidden files (e.g. .DS_Store) are never documents
        listed.push({ key, etag, id: this.idOf(key) });
      }
      cursor = page.cursor;
    } while (cursor);
    return listed;
  }

  /**
   * Lists the collection, then takes each document from the snapshot when its
   * etag still matches and GETs the rest. The list is the authority: the
   * snapshot never adds, removes or changes a document in the result.
   */
  private async readAll(useSnapshot = this.adapter.remote === true): Promise<T[]> {
    const listed = await this.listDocuments();

    const snapshot = useSnapshot ? await this.readSnapshot() : new Map<string, SnapshotEntry>();
    const documents = new Array<T | undefined>(listed.length);
    const missing: number[] = [];
    let listedInSnapshot = 0;
    listed.forEach(({ etag, id }, index) => {
      const cached = snapshot.get(id);
      if (cached) listedInSnapshot++;
      if (cached && cached.etag === etag) documents[index] = { ...cached.body, id, _etag: etag } as T;
      else missing.push(index);
    });

    const fetched = await getMany(
      this.adapter,
      missing.map(index => listed[index].key)
    );
    fetched.forEach((result, position) => {
      if ('error' in result) {
        if (result.error.kind === 'not-found') return; // deleted after the list
        throw result.error;
      }
      const index = missing[position];
      documents[index] = this.decode(result.key, listed[index].id, result.body, result.etag);
    });

    const present = documents.filter((document): document is T => document !== undefined);
    // documents read individually (new or changed) plus snapshot entries of deleted documents
    const deleted = snapshot.size - listedInSnapshot;
    if (useSnapshot && missing.length + deleted > SNAPSHOT_REWRITE_THRESHOLD) {
      await this.writeSnapshot(present);
    } else {
      this.checkEnvelope(present.length, 0);
    }
    return present;
  }

  /**
   * Rewrites the snapshot from the documents as they are now, removing the
   * contents of deleted documents from it. No-op on local backends.
   */
  async compact(): Promise<void> {
    if (this.adapter.remote !== true) return;
    await this.writeSnapshot(await this.readAll(false), true);
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
        const condition = compareAndSwap ? { ifMatch: current._etag ?? '' } : undefined;
        const { etag } = await this.adapter.put(key, this.encode(updated), condition);
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
