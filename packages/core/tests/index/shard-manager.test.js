import { describe, test, expect, beforeEach } from 'bun:test';
import { ShardManager } from '../../src/index/shard-manager';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
describe('ShardManager', () => {
    let adapter;
    let manager;
    const collectionPath = 'test-db/users';
    beforeEach(() => {
        adapter = new MemoryStorageAdapter();
        manager = new ShardManager(adapter, collectionPath, 16);
    });
    test('addDocument adds entry to correct shard', async () => {
        const doc = {
            id: 'user-123',
            name: 'Alice',
            age: 25,
            _etag: 'etag-1',
            _updatedAt: '2026-02-08T00:00:00Z',
        };
        await manager.addDocument(doc);
        // Verify document was added to a shard
        const result = await manager.findById('user-123');
        expect(result).toEqual(doc);
    });
    test('updateDocument updates existing entry', async () => {
        const doc1 = {
            id: 'user-123',
            name: 'Alice',
            age: 25,
            _etag: 'etag-1',
            _updatedAt: '2026-02-08T00:00:00Z',
        };
        await manager.addDocument(doc1);
        const doc2 = {
            id: 'user-123',
            name: 'Alice',
            age: 26,
            _etag: 'etag-2',
            _updatedAt: '2026-02-08T01:00:00Z',
        };
        await manager.updateDocument(doc2);
        const result = await manager.findById('user-123');
        expect(result?.age).toBe(26);
        expect(result?._etag).toBe('etag-2');
    });
    test('removeDocument deletes entry', async () => {
        const doc = {
            id: 'user-123',
            name: 'Alice',
            age: 25,
            _etag: 'etag-1',
            _updatedAt: '2026-02-08T00:00:00Z',
        };
        await manager.addDocument(doc);
        await manager.removeDocument('user-123');
        const result = await manager.findById('user-123');
        expect(result).toBeNull();
    });
    test('findById returns null for non-existent document', async () => {
        const result = await manager.findById('missing');
        expect(result).toBeNull();
    });
    test('query returns matching documents', async () => {
        const docs = [
            { id: 'user-1', name: 'Alice', age: 25, status: 'active', _etag: 'e1', _updatedAt: '2026-02-08T00:00:00Z' },
            { id: 'user-2', name: 'Bob', age: 30, status: 'active', _etag: 'e2', _updatedAt: '2026-02-08T00:00:00Z' },
            { id: 'user-3', name: 'Charlie', age: 35, status: 'inactive', _etag: 'e3', _updatedAt: '2026-02-08T00:00:00Z' },
        ];
        for (const doc of docs) {
            await manager.addDocument(doc);
        }
        const results = await manager.query({ status: 'active' });
        expect(results).toHaveLength(2);
        expect(results.map(r => r.id).sort()).toEqual(['user-1', 'user-2']);
    });
    test('query with operators', async () => {
        const docs = [
            { id: 'user-1', age: 20, _etag: 'e1', _updatedAt: '2026-02-08T00:00:00Z' },
            { id: 'user-2', age: 25, _etag: 'e2', _updatedAt: '2026-02-08T00:00:00Z' },
            { id: 'user-3', age: 30, _etag: 'e3', _updatedAt: '2026-02-08T00:00:00Z' },
            { id: 'user-4', age: 35, _etag: 'e4', _updatedAt: '2026-02-08T00:00:00Z' },
        ];
        for (const doc of docs) {
            await manager.addDocument(doc);
        }
        const results = await manager.query({ age: { $gte: 25, $lt: 35 } });
        expect(results).toHaveLength(2);
        expect(results.map(r => r.id).sort()).toEqual(['user-2', 'user-3']);
    });
    test('handles multiple documents in different shards', async () => {
        // Add enough documents to ensure distribution across shards
        const docs = Array.from({ length: 50 }, (_, i) => ({
            id: `user-${i}`,
            name: `User ${i}`,
            age: 20 + (i % 30),
            _etag: `etag-${i}`,
            _updatedAt: '2026-02-08T00:00:00Z',
        }));
        for (const doc of docs) {
            await manager.addDocument(doc);
        }
        const results = await manager.query({ age: { $gte: 25 } });
        expect(results.length).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=shard-manager.test.js.map