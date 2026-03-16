import type { StorageAdapter } from '../types/index.js';
import { safePathJoin } from '../utils/path-validator.js';

/**
 * WAL operation types
 */
export type WALOperation = 'insert' | 'update' | 'delete';

/**
 * WAL entry structure
 */
export interface WALEntry {
  operation: WALOperation;
  collectionPath: string;
  documentId: string;
  documentData?: any;
  timestamp: string;
}

/**
 * Write-Ahead Log for ensuring index-document consistency
 */
export class WAL {
  private walPath: string;

  constructor(
    private adapter: StorageAdapter,
    basePath: string
  ) {
    this.walPath = safePathJoin(basePath, 'wal');
  }

  /**
   * Get WAL entry path for a document
   */
  private getWALEntryPath(documentId: string): string {
    return `${this.walPath}/${documentId}.wal.json`;
  }

  /**
   * Log an operation before execution
   */
  async log(entry: WALEntry): Promise<void> {
    const path = this.getWALEntryPath(entry.documentId);
    await this.adapter.put(path, entry);
  }

  /**
   * Clear WAL entry after successful operation
   */
  async clear(documentId: string): Promise<void> {
    const path = this.getWALEntryPath(documentId);
    try {
      await this.adapter.delete(path);
    } catch {
      // Ignore if entry doesn't exist
    }
  }

  /**
   * List all pending WAL entries
   */
  async listPending(): Promise<WALEntry[]> {
    try {
      const keys = await this.adapter.listKeys(this.walPath);
      const entries: WALEntry[] = [];

      for (const key of keys) {
        try {
          const { data } = await this.adapter.get(key);
          entries.push(data as WALEntry);
        } catch {
          // Skip corrupted entries
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Recover from pending WAL entries
   * This should be called on collection initialization
   */
  async recover(
    onRecover: (entry: WALEntry) => Promise<void>
  ): Promise<number> {
    const pending = await this.listPending();
    let recovered = 0;

    for (const entry of pending) {
      try {
        await onRecover(entry);
        await this.clear(entry.documentId);
        recovered++;
      } catch (error) {
        // Log error but continue recovery
        console.error(`Failed to recover WAL entry for ${entry.documentId}:`, error);
      }
    }

    return recovered;
  }
}
