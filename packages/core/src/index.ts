// Core classes
export { BucketDB } from './core/bucket-db.js';
export { Collection } from './core/collection.js';

// Storage adapters
export { MemoryStorageAdapter } from './storage/memory-adapter.js';

// Re-export types from @bucket-db/types
export type {
  Document,
  InsertDocument,
  UpdateDocument,
  QueryOperator,
  QueryValue,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  StorageAdapter,
  StorageObject,
  PutOptions,
  StorageCredentials,
  StorageAdapterConfig,
  ICollection,
  CollectionMeta,
  IndexShard,
} from '@bucket-db/types';

export {
  BucketDBError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  ValidationError,
  StorageError,
} from '@bucket-db/types';
