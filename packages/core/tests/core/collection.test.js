import { describe, test, expect, beforeEach } from 'bun:test';
import { Collection } from '../../src/core/collection';
import { MemoryStorageAdapter } from '../../src/storage/memory-adapter';
import { DocumentNotFoundError, ConcurrentUpdateError } from '../../src/index.js';
describe('Collection', () => {
    let adapter;
    let collection;
    beforeEach(() => {
        adapter = new MemoryStorageAdapter();
        collection = new Collection(adapter, 'test-db', 'users', { shardCount: 16 });
    });
    describe('insert', () => {
        test('inserts document with generated ID', async () => {
            const user = await collection.insert({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com',
                status: 'active',
            });
            expect(user.id).toBeDefined();
            expect(user.name).toBe('Alice');
            expect(user.age).toBe(25);
            expect(user._etag).toBeDefined();
            expect(user._createdAt).toBeDefined();
            expect(user._updatedAt).toBeDefined();
        });
        test('inserts multiple documents', async () => {
            const user1 = await collection.insert({ name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });
            const user2 = await collection.insert({ name: 'Bob', age: 30, email: 'bob@example.com', status: 'active' });
            expect(user1.id).not.toBe(user2.id);
        });
    });
    describe('findById', () => {
        test('finds existing document', async () => {
            const inserted = await collection.insert({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com',
                status: 'active',
            });
            const found = await collection.findById(inserted.id);
            expect(found).toEqual(inserted);
        });
        test('returns null for non-existent document', async () => {
            const found = await collection.findById('non-existent');
            expect(found).toBeNull();
        });
    });
    describe('find', () => {
        beforeEach(async () => {
            await collection.insert({ name: 'Alice', age: 25, email: 'alice@example.com', status: 'active' });
            await collection.insert({ name: 'Bob', age: 30, email: 'bob@example.com', status: 'active' });
            await collection.insert({ name: 'Charlie', age: 35, email: 'charlie@example.com', status: 'inactive' });
        });
        test('finds documents by equality filter', async () => {
            const results = await collection.find({ status: 'active' });
            expect(results).toHaveLength(2);
            expect(results.every(r => r.status === 'active')).toBe(true);
        });
        test('finds documents with operator filter', async () => {
            const results = await collection.find({ age: { $gte: 30 } });
            expect(results).toHaveLength(2);
            expect(results.every(r => r.age >= 30)).toBe(true);
        });
        test('finds documents with multiple conditions', async () => {
            const results = await collection.find({
                status: 'active',
                age: { $gte: 25, $lt: 35 },
            });
            expect(results).toHaveLength(2);
        });
        test('returns empty array when no matches', async () => {
            const results = await collection.find({ name: 'David' });
            expect(results).toHaveLength(0);
        });
        test('applies limit option', async () => {
            const results = await collection.find({ status: 'active' }, { limit: 1 });
            expect(results).toHaveLength(1);
        });
        test('applies offset option', async () => {
            const all = await collection.find({ status: 'active' });
            const withOffset = await collection.find({ status: 'active' }, { offset: 1 });
            expect(withOffset).toHaveLength(1);
            expect(withOffset[0].id).toBe(all[1].id);
        });
        test('applies limit and offset together', async () => {
            const results = await collection.find({}, { limit: 1, offset: 1 });
            expect(results).toHaveLength(1);
        });
    });
    describe('update', () => {
        test('updates existing document', async () => {
            const user = await collection.insert({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com',
                status: 'active',
            });
            // Wait 1ms to ensure different timestamp
            await new Promise(resolve => setTimeout(resolve, 1));
            const updated = await collection.update(user.id, { age: 26 });
            expect(updated.id).toBe(user.id);
            expect(updated.age).toBe(26);
            expect(updated.name).toBe('Alice');
            expect(updated._etag).not.toBe(user._etag);
            expect(updated._updatedAt).not.toBe(user._updatedAt);
        });
        test('throws error when document not found', async () => {
            await expect(collection.update('non-existent', { age: 30 })).rejects.toThrow(DocumentNotFoundError);
        });
        test('optimistic locking with correct etag', async () => {
            const user = await collection.insert({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com',
                status: 'active',
            });
            const updated = await collection.update(user.id, { age: 26 }, { etag: user._etag });
            expect(updated.age).toBe(26);
        });
        test('optimistic locking fails with wrong etag', async () => {
            const user = await collection.insert({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com',
                status: 'active',
            });
            await expect(collection.update(user.id, { age: 26 }, { etag: 'wrong-etag' })).rejects.toThrow(ConcurrentUpdateError);
        });
    });
    describe('delete', () => {
        test('deletes existing document', async () => {
            const user = await collection.insert({
                name: 'Alice',
                age: 25,
                email: 'alice@example.com',
                status: 'active',
            });
            await collection.delete(user.id);
            const found = await collection.findById(user.id);
            expect(found).toBeNull();
        });
        test('throws error when document not found', async () => {
            await expect(collection.delete('non-existent')).rejects.toThrow(DocumentNotFoundError);
        });
    });
});
//# sourceMappingURL=collection.test.js.map