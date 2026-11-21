import { describe, test, expect } from 'bun:test';
import {
  BucketDB,
  MemoryStorageAdapter,
  S3Adapter,
  StorageError,
  ConcurrentUpdateError,
} from '../../src/index.js';
import type { Document } from '../../src/index.js';
import { FaultyAdapter } from '../support/faulty-adapter';
import { startFakeS3 } from '../support/fake-s3';

interface Item extends Document {
  n: number;
}

describe('Collection under concurrency and storage faults', () => {
  test('concurrent inserts into a new collection are all visible to find', async () => {
    const items = new BucketDB(new MemoryStorageAdapter(), 'db').collection<Item>('items');

    const inserted = await Promise.all(Array.from({ length: 50 }, (_, n) => items.insert({ n })));
    const found = await items.find({});

    expect(found.map(doc => doc.id).sort()).toEqual(inserted.map(doc => doc.id).sort());
  });

  test('a failed storage read during insert rejects the insert and loses no documents', async () => {
    const storage = new FaultyAdapter(new MemoryStorageAdapter());
    const items = new BucketDB(storage, 'db').collection<Item>('items');
    const acknowledged: string[] = [];
    for (let n = 0; n < 100; n++) {
      acknowledged.push((await items.insert({ n })).id);
    }

    let injected = false;
    storage.before = (operation, key) => {
      if (operation === 'get' && !injected) {
        injected = true;
        throw new StorageError(`Failed to get object: injected fault on ${key}`);
      }
    };
    const outcome = await items.insert({ n: 100 }).then(
      doc => ({ doc }),
      (error: unknown) => ({ error })
    );
    storage.before = undefined;

    // A read that fails must surface as an error, never be read as "empty".
    if (injected) {
      expect('error' in outcome && outcome.error).toBeInstanceOf(StorageError);
    } else if ('doc' in outcome) {
      acknowledged.push(outcome.doc.id);
    }
    const found = (await items.find({})).map(doc => doc.id);
    expect(found).toEqual(expect.arrayContaining(acknowledged));
  });

  test('a 503 from S3 is retried and the insert succeeds', async () => {
    const s3 = startFakeS3();
    try {
      const adapter = new S3Adapter({
        bucket: s3.bucket,
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        endpoint: s3.url,
      });
      const items = new BucketDB(adapter, 'db').collection<Item>('items');

      s3.failNext('PUT', 503);
      const doc = await items.insert({ n: 1 });

      const failed = s3.requests.find(request => request.status === 503)!;
      const retried = s3.requests.some(
        request => request.method === failed.method && request.key === failed.key && request.status === 200
      );
      expect(retried).toBe(true);
      expect(await items.findById(doc.id)).toMatchObject({ n: 1 });
    } finally {
      s3.stop();
    }
  });

  test('update throws ConcurrentUpdateError when another writer changes the document between its read and its write', async () => {
    const shared = new MemoryStorageAdapter();
    const storage = new FaultyAdapter(shared);
    const mine = new BucketDB(storage, 'db').collection<Item>('items');
    const theirs = new BucketDB(shared, 'db').collection<Item>('items');
    const doc = await mine.insert({ n: 0 });

    let raced = false;
    storage.before = async (operation, key) => {
      if (operation === 'put' && key.endsWith(`/docs/${doc.id}.json`) && !raced) {
        raced = true;
        await theirs.update(doc.id, { n: 1 });
      }
    };

    await expect(mine.update(doc.id, { n: 2 }, { etag: doc._etag })).rejects.toBeInstanceOf(ConcurrentUpdateError);
    expect(raced).toBe(true);
    expect((await theirs.findById(doc.id))?.n).toBe(1);
  });
});
