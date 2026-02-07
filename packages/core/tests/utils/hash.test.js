import { describe, test, expect } from 'bun:test';
import { hashString, getShardId } from '../../src/utils/hash';
describe('Hash Utilities', () => {
    test('hashString produces consistent results', () => {
        const hash1 = hashString('test-id-123');
        const hash2 = hashString('test-id-123');
        expect(hash1).toBe(hash2);
    });
    test('hashString produces different results for different inputs', () => {
        const hash1 = hashString('id-1');
        const hash2 = hashString('id-2');
        expect(hash1).not.toBe(hash2);
    });
    test('getShardId returns value within range', () => {
        const shardId = getShardId('test-id', 16);
        expect(shardId).toBeGreaterThanOrEqual(0);
        expect(shardId).toBeLessThan(16);
    });
    test('getShardId is deterministic', () => {
        const shardId1 = getShardId('test-id', 16);
        const shardId2 = getShardId('test-id', 16);
        expect(shardId1).toBe(shardId2);
    });
    test('getShardId distributes across shards', () => {
        const shardCounts = new Map();
        const shardCount = 16;
        // Generate 1000 IDs and count distribution
        for (let i = 0; i < 1000; i++) {
            const shardId = getShardId(`id-${i}`, shardCount);
            shardCounts.set(shardId, (shardCounts.get(shardId) || 0) + 1);
        }
        // Each shard should have at least some documents (rough distribution)
        expect(shardCounts.size).toBeGreaterThan(10);
    });
});
//# sourceMappingURL=hash.test.js.map