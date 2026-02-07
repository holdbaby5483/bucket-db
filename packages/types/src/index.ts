// Document types
export type { Document, InsertDocument, UpdateDocument } from './document.js';

// Query types
export type {
  QueryOperator,
  QueryValue,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
} from './query.js';

// Storage types
export type {
  StorageObject,
  PutOptions,
  StorageAdapter,
  StorageCredentials,
  StorageAdapterConfig,
} from './storage.js';

// Collection types
export type {
  ICollection,
  CollectionMeta,
  IndexShard,
} from './collection.js';

// Error classes
export {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError,
} from './errors.js';
