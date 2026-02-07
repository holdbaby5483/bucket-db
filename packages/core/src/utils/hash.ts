/**
 * Simple string hash function (DJB2 algorithm)
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Get shard ID for a document ID
 */
export function getShardId(docId: string, shardCount: number): number {
  return hashString(docId) % shardCount;
}

/**
 * Format shard ID as zero-padded string (e.g., "00", "01", "15")
 */
export function formatShardId(shardId: number): string {
  return shardId.toString().padStart(2, '0');
}
