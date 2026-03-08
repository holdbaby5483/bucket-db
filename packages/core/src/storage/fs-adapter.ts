import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { createHash } from 'crypto';
import type {
  StorageAdapter,
  StorageObject,
  PutOptions,
} from '../types/index.js';
import { StorageError } from '../types/index.js';

export interface FileSystemAdapterConfig {
  basePath: string;
}

interface FileMetadata {
  etag: string;
  data: any;
}

/**
 * Local file system storage adapter
 */
export class FileSystemAdapter implements StorageAdapter {
  private basePath: string;

  constructor(config: FileSystemAdapterConfig) {
    this.basePath = config.basePath;

    // Ensure base directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    return join(this.basePath, key);
  }

  private getMetadataPath(key: string): string {
    return join(this.basePath, key + '.meta');
  }

  private generateETag(data: any): string {
    const content = JSON.stringify(data);
    return createHash('md5').update(content).digest('hex');
  }

  private ensureDirectoryExists(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  async get(key: string): Promise<StorageObject> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetadataPath(key);

    try {
      if (!existsSync(filePath)) {
        throw new StorageError(`Object not found: ${key}`);
      }

      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      let etag: string;
      if (existsSync(metaPath)) {
        const metadata: FileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
        etag = metadata.etag;
      } else {
        etag = this.generateETag(data);
      }

      const stats = statSync(filePath);

      return {
        data,
        etag,
        lastModified: stats.mtime,
      };
    } catch (error: any) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to get object: ${error.message}`, error);
    }
  }

  async put(key: string, data: any, options?: PutOptions): Promise<{ etag: string }> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetadataPath(key);

    try {
      // Check conditional writes
      if (options?.ifMatch || options?.ifNoneMatch) {
        if (existsSync(metaPath)) {
          const currentMeta: FileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));

          if (options.ifMatch && currentMeta.etag !== options.ifMatch) {
            throw new StorageError('PreconditionFailed: ETag mismatch');
          }

          if (options.ifNoneMatch && existsSync(filePath)) {
            throw new StorageError('PreconditionFailed: Object already exists');
          }
        } else if (options.ifMatch) {
          // ifMatch provided but no existing metadata
          throw new StorageError('PreconditionFailed: ETag mismatch');
        }
      }

      // Ensure directory exists
      this.ensureDirectoryExists(filePath);

      // Generate ETag
      const etag = this.generateETag(data);

      // Write data file
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

      // Write metadata file
      const metadata: FileMetadata = { etag, data };
      writeFileSync(metaPath, JSON.stringify(metadata), 'utf-8');

      return { etag };
    } catch (error: any) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(`Failed to put object: ${error.message}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetadataPath(key);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      if (existsSync(metaPath)) {
        unlinkSync(metaPath);
      }
    } catch (error: any) {
      throw new StorageError(`Failed to delete object: ${error.message}`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    return existsSync(filePath);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const prefixPath = join(this.basePath, prefix);

    try {
      const walk = (dir: string): void => {
        if (!existsSync(dir)) {
          return;
        }

        const files = readdirSync(dir, { withFileTypes: true });

        for (const file of files) {
          const fullPath = join(dir, file.name);

          if (file.isDirectory()) {
            walk(fullPath);
          } else if (file.isFile() && !file.name.endsWith('.meta')) {
            // Get relative path from base
            const relativePath = relative(this.basePath, fullPath);

            // Check if it starts with the prefix
            if (relativePath.startsWith(prefix)) {
              keys.push(relativePath);
            }
          }
        }
      };

      // If prefix path exists as a directory, walk it
      if (existsSync(prefixPath) && statSync(prefixPath).isDirectory()) {
        walk(prefixPath);
      } else {
        // Walk from base and filter by prefix
        walk(this.basePath);
      }

      return keys.sort();
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
