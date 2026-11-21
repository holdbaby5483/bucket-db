export { BucketDB } from './bucket-db.js';
export type { BucketDBOptions } from './bucket-db.js';
export { Collection } from './collection.js';
export type { CollectionOptions } from './collection.js';

export { MemoryStorageAdapter } from './storage/memory.js';
export { FileSystemAdapter } from './storage/fs.js';
export type { FileSystemAdapterConfig } from './storage/fs.js';
export { S3Adapter, OSSAdapter } from './storage/s3/adapters.js';
export type { S3AdapterOptions, OSSAdapterOptions, Credentials, CredentialProvider } from './storage/s3/adapters.js';
export type {
  StorageAdapter,
  Capabilities,
  Guarantee,
  WriteCondition,
  ObjectEntry,
  ListPage,
  ListOptions,
} from './storage/adapter.js';

export type {
  Document,
  InsertDocument,
  UpdateDocument,
  QueryOperator,
  QueryValue,
  QueryFilter,
  QueryOptions,
  UpdateOptions,
  Logger,
  LogEvent,
} from './types.js';

export {
  BucketDBError,
  ValidationError,
  DocumentNotFoundError,
  ConcurrentUpdateError,
  UnsupportedError,
  StorageError,
} from './errors.js';
export type { StorageErrorKind, StorageErrorOptions } from './errors.js';
