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
} from '../types/index.js';
import { StorageError } from '../types/index.js';

/**
 * S3 storage adapter with retry logic and timeout configuration
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
      maxAttempts: 1, // Disable SDK's built-in retry, use our custom retry logic
      requestHandler: {
        connectionTimeout: 3000,
        requestTimeout: 3000,
      },
    });
  }

  /**
   * Check if an error is retryable (temporary network issue or rate limit)
   */
  private isRetryableError(error: any): boolean {
    // AWS SDK error codes for retryable errors
    const retryableCodes = ['RequestTimeout', 'ServiceUnavailable', 'ThrottlingException', 'RequestThrottled'];
    const retryableStatusCodes = [429, 500, 502, 503, 504];

    return (
      retryableCodes.includes(error.name) ||
      retryableStatusCodes.includes(error.$metadata?.httpStatusCode) ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET'
    );
  }

  /**
   * Retry wrapper with exponential backoff
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        if (this.isRetryableError(error) && attempt < maxRetries - 1) {
          // Exponential backoff with jitter: 100ms * 2^attempt + random(0-50ms)
          const baseDelay = 100 * Math.pow(2, attempt);
          const jitter = Math.random() * 50;
          await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unreachable');
  }

  async get(key: string): Promise<StorageObject> {
    return this.withRetry(async () => {
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
    });
  }

  async put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }> {
    return this.withRetry(async () => {
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
    });
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
    return this.withRetry(async () => {
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
    });
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
