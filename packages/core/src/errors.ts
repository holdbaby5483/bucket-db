/**
 * Base class for every error BucketDB throws.
 */
export class BucketDBError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Invalid input: collection name, document ID, dbPath or filter.
 */
export class ValidationError extends BucketDBError {}

/**
 * `update` on a document that does not exist.
 */
export class DocumentNotFoundError extends BucketDBError {
  constructor(id: string) {
    super(`Document not found: ${id}`);
  }
}

/**
 * `update` lost a race: the supplied etag is stale, or retries were exhausted.
 */
export class ConcurrentUpdateError extends BucketDBError {
  constructor(message = 'Concurrent update conflict, please retry') {
    super(message);
  }
}

/**
 * The operation needs a capability the storage backend does not provide.
 */
export class UnsupportedError extends BucketDBError {}

/**
 * - `not-found`: the object does not exist
 * - `conflict`: a write condition (ifNoneMatch / ifMatch) was not met
 * - `transient`: a retryable failure that persisted after retries
 * - `permanent`: anything else (permissions, malformed data, …)
 */
export type StorageErrorKind = 'not-found' | 'conflict' | 'transient' | 'permanent';

export interface StorageErrorOptions {
  kind?: StorageErrorKind;
  key?: string;
  /** HTTP status, for HTTP backends */
  status?: number;
  cause?: unknown;
}

/**
 * A storage backend failure.
 */
export class StorageError extends BucketDBError {
  readonly kind: StorageErrorKind;
  readonly key?: string;
  readonly status?: number;

  constructor(message: string, options: StorageErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.kind = options.kind ?? 'permanent';
    this.key = options.key;
    this.status = options.status;
  }
}

/**
 * `insert` with an explicit id that is already taken.
 */
export class DocumentExistsError extends BucketDBError {
  constructor(id: string) {
    super(`Document already exists: ${id}`);
  }
}
