/**
 * Storage object returned by adapter
 */
export interface StorageObject {
  data: any;
  etag: string;
  lastModified: Date;
}

/**
 * Put options for conditional writes
 */
export interface PutOptions {
  ifMatch?: string;
  ifNoneMatch?: string;
}

/**
 * Storage adapter interface (abstraction for S3/OSS)
 */
export interface StorageAdapter {
  get(key: string): Promise<StorageObject>;
  put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
  batchGet(keys: string[]): Promise<Map<string, StorageObject>>;
}

/**
 * Storage credentials
 */
export interface StorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Storage adapter configuration
 */
export interface StorageAdapterConfig {
  bucket: string;
  region: string;
  credentials: StorageCredentials;
  endpoint?: string;
}
