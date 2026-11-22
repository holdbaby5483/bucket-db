export { BucketDB } from './bucket-db.js';
export type { BucketDBOptions } from './bucket-db.js';
// A type only: collections come from db.collection(name).
export type { Collection } from './collection.js';

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
  InsertOptions,
  Logger,
  LogEvent,
  Stored,
  SortSpec,
} from './types.js';

export {
  BucketDBError,
  ValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  ConcurrentUpdateError,
  UnsupportedError,
  StorageError,
} from './errors.js';
export type { StorageErrorKind, StorageErrorOptions } from './errors.js';
