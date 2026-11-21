import { describe, test, expect, beforeEach } from 'bun:test';
import { BucketDB, MemoryStorageAdapter, StorageError } from '../../src/index.js';
import type { Collection, Document, LogEvent, StorageAdapter } from '../../src/index.js';
import { FaultyAdapter, type StorageOperation } from '../support/faulty-adapter';

interface Item extends Document {
  n: number;
}

/** An in-memory backend that asks Collection to keep a snapshot, like S3/OSS. */
class RemoteMemory extends MemoryStorageAdapter {
  readonly remote = true;
}

/** The same data seen without a snapshot: the reference result. */
class LocalView extends FaultyAdapter {
  get remote() {
    return false;
  }
}

const SNAPSHOT = 'db/items/_snapshot.v1.json';
const bytes = (text: string) => new TextEncoder().encode(text);

describe('query snapshot', () => {
  let inner: RemoteMemory;
  let storage: FaultyAdapter;
  let calls: Array<[StorageOperation, string]>;
  let events: LogEvent[];
  let items: Collection<Item>;

  const truth = async () => new BucketDB(new LocalView(inner), 'db', { logger: () => {} }).collection<Item>('items').find({});
  const ids = (docs: Item[]) => docs.map(doc => doc.id);

  beforeEach(async () => {
    inner = new RemoteMemory();
    storage = new FaultyAdapter(inner);
    calls = [];
    storage.before = (operation, key) => {
      calls.push([operation, key]);
    };
    events = [];
    items = new BucketDB(storage, 'db', { logger: event => events.push(event) }).collection<Item>('items');
    await Promise.all(Array.from({ length: 40 }, (_, n) => items.insert({ n })));
    calls.length = 0;
  });

  test('a cold query builds the snapshot; a warm one reads only the list and the snapshot', async () => {
    const cold = await items.find({});
    expect(cold).toEqual(await truth());
    expect(calls.filter(([operation]) => operation === 'get')).toHaveLength(41); // snapshot + 40 documents
    expect(calls).toContainEqual(['put', SNAPSHOT]);

    calls.length = 0;
    expect(await items.find({})).toEqual(cold);
    expect(calls).toEqual([
      ['list', 'db/items/docs/'],
      ['get', SNAPSHOT],
    ]);
  });

  test('the snapshot is rewritten only when more than 16 documents changed', async () => {
    const docs = await items.find({});
    const snapshotWrites = () => calls.filter(([operation, key]) => operation === 'put' && key === SNAPSHOT).length;
    const documentReads = () => calls.filter(([operation, key]) => operation === 'get' && key.includes('/docs/')).length;

    await Promise.all(docs.slice(0, 16).map(doc => items.update(doc.id, { n: -1 })));
    for (let query = 0; query < 2; query++) {
      calls.length = 0;
      await items.find({});
      expect([documentReads(), snapshotWrites()]).toEqual([16, 0]);
    }

    await items.update(docs[16].id, { n: -1 });
    calls.length = 0;
    await items.find({});
    expect([documentReads(), snapshotWrites()]).toEqual([17, 1]);
    calls.length = 0;
    await items.find({});
    expect([documentReads(), snapshotWrites()]).toEqual([0, 0]);
  });

  test('after writes, only changed documents are read and the result is current', async () => {
    const before = await items.find({});
    await items.update(before[0].id, { n: 100 });
    await items.delete(before[1].id);
    await items.insert({ n: 200 });
    calls.length = 0;

    expect(await items.find({})).toEqual(await truth());
    const documentReads = calls.filter(([operation, key]) => operation === 'get' && key.includes('/docs/'));
    expect(documentReads).toHaveLength(2); // the updated and the inserted document
  });

  test.each([
    ['deleted', async () => inner.delete(SNAPSHOT)],
    ['not JSON', async () => void (await inner.put(SNAPSHOT, bytes('{{{')))],
    ['the wrong shape', async () => void (await inner.put(SNAPSHOT, bytes('{"format":"bucket-db-snapshot","version":1,"documents":[]}')))],
    ['a future version', async () => void (await inner.put(SNAPSHOT, bytes('{"format":"bucket-db-snapshot","version":2,"documents":{}}')))],
  ])('a snapshot that is %s gives the same result', async (_, damage) => {
    await items.find({});
    await damage();
    expect(await items.find({})).toEqual(await truth());
  });

  test('forged or stale entries are never trusted', async () => {
    const docs = await items.find({});
    await items.delete(docs[0].id);
    const forged = {
      format: 'bucket-db-snapshot',
      version: 1,
      documents: {
        [docs[0].id]: { etag: docs[0]._etag, body: { n: 0 } }, // deleted document
        [docs[1].id]: { etag: 'not-the-current-etag', body: { n: -1 } }, // stale copy
        'ghost-id': { etag: 'x', body: { n: 999 } }, // never existed
      },
    };
    await inner.put(SNAPSHOT, bytes(JSON.stringify(forged)));
    const found = await items.find({});
    expect(found).toEqual(await truth());
    expect(ids(found)).not.toContain(docs[0].id);
    expect(found.find(doc => doc.id === docs[1].id)!.n).toBe(docs[1].n);
  });

  test('an older snapshot written over a newer one gives the same result', async () => {
    await items.find({});
    const old = (await inner.get(SNAPSHOT)).body;
    const docs = await items.find({});
    for (const doc of docs.slice(0, 20)) await items.update(doc.id, { n: doc.n + 1000 });
    await items.find({}); // writes a newer snapshot
    await inner.put(SNAPSHOT, old); // a slower writer overwrites it

    expect(await items.find({})).toEqual(await truth());
  });

  test('a failed snapshot write does not fail the query, is logged, and is not retried after a permission error', async () => {
    storage.before = (operation, key) => {
      calls.push([operation, key]);
      if (operation === 'put' && key === SNAPSHOT) throw new StorageError('denied', { key, status: 403 });
    };
    expect(await items.find({})).toEqual(await truth());
    expect(events.filter(event => event.level === 'error')).toHaveLength(1);

    calls.length = 0;
    await items.find({});
    expect(calls.filter(([operation]) => operation === 'put')).toEqual([]);
  });

  test('a transient failure reading the snapshot fails the query instead of reading every document', async () => {
    storage.before = (operation, key) => {
      if (operation === 'get' && key === SNAPSHOT) throw new StorageError('timeout', { kind: 'transient', key });
    };
    const error = await items.find({}).then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect((error as StorageError).kind).toBe('transient');
  });

  test('compact removes the contents of deleted documents from the snapshot', async () => {
    const docs = await items.find({});
    await items.delete(docs[0].id);
    await items.find({}); // one change: below the rewrite threshold, the snapshot keeps the deleted body
    expect(new TextDecoder().decode((await inner.get(SNAPSHOT)).body)).toContain(docs[0].id);

    await items.compact();
    const snapshot = new TextDecoder().decode((await inner.get(SNAPSHOT)).body);
    expect(snapshot).not.toContain(docs[0].id);
    expect(await items.find({})).toEqual(await truth());
  });

  test('compact is a no-op on local backends', async () => {
    const local = new MemoryStorageAdapter();
    const collection = new BucketDB(local, 'db').collection<Item>('items');
    await collection.insert({ n: 1 });
    await collection.compact();
    expect((await local.list('db/')).entries.map(entry => entry.key)).not.toContain(SNAPSHOT);
  });
});

describe('envelope warning', () => {
  async function fill(adapter: StorageAdapter, count: number) {
    const events: LogEvent[] = [];
    const items = new BucketDB(adapter, 'db', { logger: event => events.push(event) }).collection<Item>('items');
    for (let start = 0; start < count; start += 1000) {
      await Promise.all(Array.from({ length: Math.min(1000, count - start) }, (_, n) => items.insert({ n: start + n })));
    }
    return { items, events };
  }

  test.each([
    ['remote', () => new RemoteMemory()],
    ['local', () => new MemoryStorageAdapter()],
  ])('a %s collection over 10,000 documents warns once', async (_, make) => {
    const { items, events } = await fill(make(), 10_001);
    await items.find({});
    await items.find({});
    expect(events.filter(event => event.level === 'warn')).toHaveLength(1);
    expect(events[0].message).toContain('10001 documents');
  }, 60_000);

  test('a collection inside the envelope does not warn', async () => {
    const { items, events } = await fill(new RemoteMemory(), 100);
    await items.find({});
    expect(events).toEqual([]);
  });
});
