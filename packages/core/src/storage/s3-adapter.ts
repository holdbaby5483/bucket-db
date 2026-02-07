import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  StorageAdapterConfig,
} from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';

/**
 * S3 storage adapter
 */
export class S3Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(config: StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: config.credentials,
      endpoint: config.endpoint,
    });
  }

  async get(key: string): Promise<StorageObject> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      const body = await response.Body?.transformToString();

      if (!body) {
        throw new StorageError(`Empty response for key: ${key}`);
      }

      return {
        data: JSON.parse(body),
        etag: response.ETag?.replace(/"/g, '') || '',
        lastModified: response.LastModified || new Date(),
      };
    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        throw new StorageError(`Object not found: ${key}`);
      }
      throw new StorageError(`Failed to get object: ${error.message}`, error);
    }
  }

  async put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: 'application/json',
        IfMatch: options?.ifMatch,
        IfNoneMatch: options?.ifNoneMatch,
      });

      const response = await this.client.send(command);

      return {
        etag: response.ETag?.replace(/"/g, '') || '',
      };
    } catch (error: any) {
      if (error.name === 'PreconditionFailed') {
        throw new StorageError('PreconditionFailed: ETag mismatch');
      }
      throw new StorageError(`Failed to put object: ${error.message}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
    } catch (error: any) {
      throw new StorageError(`Failed to delete object: ${error.message}`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return false;
      }
      throw new StorageError(`Failed to check existence: ${error.message}`, error);
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });

      const response = await this.client.send(command);
      return (response.Contents || []).map(obj => obj.Key!).filter(Boolean);
    } catch (error: any) {
      throw new StorageError(`Failed to list keys: ${error.message}`, error);
    }
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    const results = new Map<string, StorageObject>();

    // Fetch in parallel
    const promises = keys.map(async (key) => {
      try {
        const obj = await this.get(key);
        return { key, obj };
      } catch (error) {
        return null;
      }
    });

    const settled = await Promise.all(promises);

    for (const result of settled) {
      if (result) {
        results.set(result.key, result.obj);
      }
    }

    return results;
  }
}
