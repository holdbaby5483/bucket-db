import { describe, test, expect } from 'bun:test';
import { BucketDB } from '../../src/core/bucket-db';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
describe('BucketDB', () => {
    test('creates database instance with memory adapter', () => {
        const adapter = new MemoryStorageAdapter();
        const db = new BucketDB(adapter, 'test-db');
        expect(db).toBeDefined();
    });
    test('creates collection', () => {
        const adapter = new MemoryStorageAdapter();
        const db = new BucketDB(adapter, 'test-db');
        const users = db.collection('users');
        expect(users).toBeDefined();
    });
    test('same collection name returns same instance', () => {
        const adapter = new MemoryStorageAdapter();
        const db = new BucketDB(adapter, 'test-db');
        const users1 = db.collection('users');
        const users2 = db.collection('users');
        expect(users1).toBe(users2);
    });
    test('end-to-end: insert and query across collections', async () => {
        const adapter = new MemoryStorageAdapter();
        const db = new BucketDB(adapter, 'test-db');
        const users = db.collection('users');
        await users.insert({ name: 'Alice', email: 'alice@example.com' });
        await users.insert({ name: 'Bob', email: 'bob@example.com' });
        const results = await users.find({ name: 'Alice' });
        expect(results).toHaveLength(1);
        expect(results[0].email).toBe('alice@example.com');
    });
});
//# sourceMappingURL=bucket-db.test.js.map