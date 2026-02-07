/**
 * Base error class for BucketDB
 */
export class BucketDBError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BucketDBError';
  }
}

/**
 * Document not found error
 */
export class DocumentNotFoundError extends BucketDBError {
  constructor(id: string) {
    super(`Document not found: ${id}`);
    this.name = 'DocumentNotFoundError';
  }
}

/**
 * Concurrent update conflict error
 */
export class ConcurrentUpdateError extends BucketDBError {
  constructor(message: string = 'Concurrent update conflict, please retry') {
    super(message);
    this.name = 'ConcurrentUpdateError';
  }
}

/**
 * Validation error
 */
export class ValidationError extends BucketDBError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Storage error
 */
export class StorageError extends BucketDBError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'StorageError';
  }
}
