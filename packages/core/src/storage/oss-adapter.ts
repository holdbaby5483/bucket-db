import OSS from 'ali-oss';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
  StorageAdapterConfig,
} from '../types/index.js';
import { StorageError } from '../types/index.js';

/**
 * Alibaba Cloud OSS storage adapter with retry logic and timeout configuration
 */
export class OSSAdapter implements StorageAdapter {
  private client: OSS;
  private bucket: string;

  constructor(config: StorageAdapterConfig) {
    this.bucket = config.bucket;
    this.client = new OSS({
      region: config.region,
      accessKeyId: config.credentials.accessKeyId,
      accessKeySecret: config.credentials.secretAccessKey,
      bucket: config.bucket,
      endpoint: config.endpoint,
    });
  }

  /**
   * Check if an error is retryable (temporary network issue or rate limit)
   */
  private isRetryableError(error: any): boolean {
    // OSS error codes for retryable errors
    const retryableCodes = ['RequestTimeout', 'ServiceUnavailable', 'Throttling', 'RequestTimeTooSkewed'];
    const retryableStatusCodes = [429, 500, 502, 503, 504];

    return (
      retryableCodes.includes(error.code) ||
      retryableStatusCodes.includes(error.status) ||
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
        const result = await this.client.get(key);

        return {
          data: JSON.parse(result.content.toString()),
          etag: result.res.headers.etag?.replace(/"/g, '') || '',
          lastModified: new Date(result.res.headers['last-modified']),
        };
      } catch (error: any) {
        if (error.code === 'NoSuchKey') {
          throw new StorageError(`Object not found: ${key}`);
        }
        throw new StorageError(`Failed to get object: ${error.message}`, error);
      }
    });
  }

  async put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }> {
    return this.withRetry(async () => {
      try {
        // Alibaba Cloud OSS does not support If-Match/If-None-Match headers on PUT.
        // Implement optimistic locking via HEAD check before writing.
        if (options?.ifMatch) {
          const currentEtag = await this.getEtag(key);
          if (currentEtag !== options.ifMatch) {
            throw new StorageError('PreconditionFailed: ETag mismatch');
          }
        }
        if (options?.ifNoneMatch) {
          const exists = await this.exists(key);
          if (exists) {
            throw new StorageError('PreconditionFailed: Object already exists');
          }
        }

        const result = await this.client.put(key, Buffer.from(JSON.stringify(data)));

        return {
          etag: result.res.headers.etag?.replace(/"/g, '') || '',
        };
      } catch (error: any) {
        if (error instanceof StorageError) {
          throw error;
        }
        throw new StorageError(`Failed to put object: ${error.message}`, error);
      }
    });
  }

  /**
   * Get the ETag of an object via HEAD request.
   * Returns null if the object does not exist.
   */
  private async getEtag(key: string): Promise<string | null> {
    try {
      const result = await this.client.head(key) as any;
      return result.res.headers.etag?.replace(/"/g, '') || null;
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (error: any) {
      throw new StorageError(`Failed to delete object: ${error.message}`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.head(key);
      return true;
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return false;
      }
      throw new StorageError(`Failed to check existence: ${error.message}`, error);
    }
  }

  async listKeys(prefix: string): Promise<string[]> {
    try {
      const result = await this.client.list({ prefix });
      return (result.objects || []).map(obj => obj.name);
    } catch (error: any) {
      throw new StorageError(`Failed to list keys: ${error.message}`, error);
    }
  }

  async batchGet(keys: string[]): Promise<Map<string, StorageObject>> {
    const results = new Map<string, StorageObject>();

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
