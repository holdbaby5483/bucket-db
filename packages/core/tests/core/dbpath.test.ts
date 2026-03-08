import { describe, test, expect } from 'bun:test';
import { BucketDB, MemoryStorageAdapter } from '../../src/index';
import type { Document } from '../../src/index.js';

interface TestDoc extends Document {
  name: string;
}

describe('BucketDB dbPath', () => {
  test('dbPath is used in storage keys', async () => {
    const adapter = new MemoryStorageAdapter();
    const db = new BucketDB(adapter, 'my-database');

    const collection = db.collection<TestDoc>('users');
    const doc = await collection.insert({ name: 'Alice' });

    // Check that the document is stored with the correct path
    const keys = await adapter.listKeys('my-database/');
    expect(keys.length).toBeGreaterThan(0);

    // Document should be at: my-database/users/docs/{id}.json
    const docKey = `my-database/users/docs/${doc.id}.json`;
    const exists = await adapter.exists(docKey);
    expect(exists).toBe(true);

    // Index shard should be at: my-database/users/index/shard-*.json
    const indexKeys = await adapter.listKeys('my-database/users/index/');
    expect(indexKeys.length).toBeGreaterThan(0);
  });

  test('different dbPaths create separate databases', async () => {
    const adapter = new MemoryStorageAdapter();

    const db1 = new BucketDB(adapter, 'database1');
    const db2 = new BucketDB(adapter, 'database2');

    const users1 = db1.collection<TestDoc>('users');
    const users2 = db2.collection<TestDoc>('users');

    await users1.insert({ name: 'Alice' });
    await users2.insert({ name: 'Bob' });

    const results1 = await users1.find({});
    const results2 = await users2.find({});

    expect(results1).toHaveLength(1);
    expect(results1[0].name).toBe('Alice');

    expect(results2).toHaveLength(1);
    expect(results2[0].name).toBe('Bob');
  });
});
