import { isValidName } from './keys.js';
import type { Document } from './types.js';

/**
 * A disposable cache of a collection's documents, stored next to `docs/`.
 * Entries are trusted only when their etag equals the one LIST reports for
 * the document, so a missing, stale, corrupt or overwritten snapshot changes
 * how many GETs a query needs, never its result.
 */
export const SNAPSHOT_NAME = '_snapshot.v1.json';
const FORMAT = 'bucket-db-snapshot';

export interface SnapshotEntry {
  etag: string;
  /** Document body without `id` and `_etag`. */
  body: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** `undefined` when the bytes are not a version-1 snapshot. */
export function parseSnapshot(bytes: Uint8Array): Map<string, SnapshotEntry> | undefined {
  let data: unknown;
  try {
    data = JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
  if (!isObject(data) || data.format !== FORMAT || data.version !== 1 || !isObject(data.documents)) {
    return undefined;
  }
  const entries = new Map<string, SnapshotEntry>();
  for (const [id, entry] of Object.entries(data.documents)) {
    if (isValidName(id) && isObject(entry) && typeof entry.etag === 'string' && isObject(entry.body)) {
      entries.set(id, { etag: entry.etag, body: entry.body });
    }
  }
  return entries;
}

export function encodeSnapshot(documents: Document[]): Uint8Array {
  // null prototype: `__proto__` is a valid document id
  const entries: Record<string, SnapshotEntry> = Object.create(null);
  for (const { id, _etag, ...body } of documents) {
    entries[id] = { etag: _etag!, body: body as Record<string, unknown> };
  }
  return encoder.encode(JSON.stringify({ format: FORMAT, version: 1, documents: entries }));
}
