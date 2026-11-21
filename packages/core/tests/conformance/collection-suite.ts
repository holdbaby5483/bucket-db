import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  BucketDB,
  ConcurrentUpdateError,
  DocumentExistsError,
  DocumentNotFoundError,
  StorageError,
  UnsupportedError,
  ValidationError,
} from '../../src/index.js';
import type { Document, StorageAdapter, QueryFilter } from '../../src/index.js';
import { FaultyAdapter, type StorageOperation } from '../support/faulty-adapter';

export interface CollectionTarget {
  adapter: StorageAdapter;
  /** Unique per run. Everything the suite writes lives under `${dbPath}/`. */
  dbPath: string;
}

interface Item extends Document {
  n: number;
  s: string;
  [field: string]: unknown;
}

const bytes = (text: string) => new TextEncoder().encode(text);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

/** Counts storage calls made through a wrapped adapter. */
function counted(adapter: StorageAdapter) {
  const storage = new FaultyAdapter(adapter);
  const calls: StorageOperation[] = [];
  storage.before = operation => {
    calls.push(operation);
  };
  return { storage, calls };
}

/** Deterministic pseudo-random numbers so failures reproduce. */
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/**
 * Collection behaviour every backend must give (M1A_PLAN §7 D2–D13).
 */
export function defineCollectionSuite(name: string, setup: () => CollectionTarget | Promise<CollectionTarget>) {
  describe(`collection: ${name}`, () => {
    let adapter: StorageAdapter;
    let dbPath: string;
    let db: BucketDB;
    let compareAndSwap: boolean;

    beforeAll(async () => {
      ({ adapter, dbPath } = await setup());
      db = new BucketDB(adapter, dbPath);
      compareAndSwap = adapter.capabilities.compareAndSwap !== 'none';
    });

    afterAll(async () => {
      let cursor: string | undefined;
      const keys: string[] = [];
      do {
        const page = await adapter.list(`${dbPath}/`, { cursor });
        keys.push(...page.entries.map(entry => entry.key));
        cursor = page.cursor;
      } while (cursor);
      await Promise.all(keys.map(key => adapter.delete(key)));
      expect((await adapter.list(`${dbPath}/`)).entries).toEqual([]);
    });

    test('D2 insert and delete are one storage call each; findById is one GET', async () => {
      const { storage, calls } = counted(adapter);
      const items = new BucketDB(storage, dbPath).collection<Item>('d2');

      const doc = await items.insert({ n: 1, s: 'a' });
      expect(calls).toEqual(['put']);
      calls.length = 0;
      await items.findById(doc.id);
      expect(calls).toEqual(['get']);
      calls.length = 0;
      await items.delete(doc.id);
      expect(calls).toEqual(['delete']);
      calls.length = 0;
      await items.delete(doc.id); // idempotent
      expect(calls).toEqual(['delete']);
    });

    test('D3 CRUD round trip; findById returns null only for a missing document', async () => {
      const items = db.collection<Item>('d3');
      const doc = await items.insert({ n: 1, s: 'a' });
      expect(doc._etag).toBeTruthy();
      expect(doc._createdAt).toBe(doc._updatedAt!);
      expect(await items.findById(doc.id)).toEqual(doc);

      const updated = await items.update(doc.id, { n: 2 });
      expect(updated).toMatchObject({ id: doc.id, n: 2, s: 'a', _createdAt: doc._createdAt });
      expect(updated._etag).not.toBe(doc._etag);
      expect(await items.findById(doc.id)).toEqual(updated);

      await items.delete(doc.id);
      expect(await items.findById(doc.id)).toBeNull();

      const storage = new FaultyAdapter(adapter);
      storage.before = operation => {
        if (operation === 'get') throw new StorageError('injected read failure', { kind: 'transient' });
      };
      const failing = new BucketDB(storage, dbPath).collection<Item>('d3');
      expect(await rejection(failing.findById(doc.id))).toBeInstanceOf(StorageError);
    });

    test('D3b offset and limit page through the matches; dbPath and collection names isolate data', async () => {
      const items = db.collection<Item>('d3b');
      await Promise.all(Array.from({ length: 5 }, (_, n) => items.insert({ n, s: 'p' })));
      const all = await items.find({ s: 'p' });
      expect(all).toHaveLength(5);
      expect(await items.find({ s: 'p' }, { limit: 2 })).toEqual(all.slice(0, 2));
      expect(await items.find({ s: 'p' }, { offset: 3 })).toEqual(all.slice(3));
      expect(await items.find({ s: 'p' }, { offset: 1, limit: 2 })).toEqual(all.slice(1, 3));

      expect(db.collection('d3b')).toBe(items);
      expect(await db.collection<Item>('d3b-other').find({})).toEqual([]);
      expect(await new BucketDB(adapter, `${dbPath}/elsewhere`).collection<Item>('d3b').find({})).toEqual([]);
    });

    test('D4 find returns exactly the documents that satisfy the filter', async () => {
      const items = db.collection<Item>('d4');
      const next = random(42);
      const letters = ['a', 'b', 'c', 'd', 'e'];
      const docs = await Promise.all(
        Array.from({ length: 30 }, () =>
          items.insert({ n: Math.floor(next() * 10), s: letters[Math.floor(next() * 5)] })
        )
      );

      for (let round = 0; round < 20; round++) {
        const k = Math.floor(next() * 10);
        const set = letters.filter(() => next() < 0.5).concat('a');
        const cases: Array<[QueryFilter<Item>, (doc: Item) => boolean]> = [
          [{ n: k }, doc => doc.n === k],
          [{ n: { $ne: k } }, doc => doc.n !== k],
          [{ n: { $gt: k } }, doc => doc.n > k],
          [{ n: { $gte: k, $lt: k + 3 } }, doc => doc.n >= k && doc.n < k + 3],
          [{ n: { $lte: k } }, doc => doc.n <= k],
          [{ s: { $in: set } }, doc => set.includes(doc.s)],
          [{ s: { $nin: set }, n: { $gt: k } }, doc => !set.includes(doc.s) && doc.n > k],
        ];
        const [filter, predicate] = cases[round % cases.length];
        const found = (await items.find(filter)).map(doc => doc.id).sort();
        expect(found).toEqual(
          docs
            .filter(predicate)
            .map(doc => doc.id)
            .sort()
        );
      }

      // the filter sees the current version, not an older copy
      const target = docs[0];
      await items.update(target.id, { n: 100 });
      expect((await items.find({ n: { $gte: 100 } })).map(doc => doc.id)).toEqual([target.id]);
      expect((await items.find({ n: target.n })).map(doc => doc.id)).not.toContain(target.id);
    });

    test('D5 a document deleted between list and read is left out', async () => {
      const items = db.collection<Item>('d5');
      const docs = await Promise.all([1, 2, 3].map(n => items.insert({ n, s: 'a' })));

      const storage = new FaultyAdapter(adapter);
      let removed: string | undefined;
      storage.before = async (operation, key) => {
        if (operation === 'get' && key.includes('/docs/') && removed === undefined) {
          removed = key;
          await adapter.delete(key);
        }
      };
      const found = await new BucketDB(storage, dbPath).collection<Item>('d5').find({});
      const removedId = docs.find(doc => removed!.endsWith(`/${doc.id}.json`))!.id;
      expect(found.map(doc => doc.id).sort()).toEqual(
        docs
          .map(doc => doc.id)
          .filter(id => id !== removedId)
          .sort()
      );
    });

    test('D6 a document file that is not a JSON object is an error naming the key', async () => {
      const items = db.collection<Item>('d6');
      await items.insert({ n: 1, s: 'a' });
      for (const [id, body] of [
        ['bad-json', 'not json'],
        ['bad-array', '[1,2]'],
      ]) {
        const key = `${dbPath}/d6/docs/${id}.json`;
        await adapter.put(key, bytes(body));
        const fromFind = await rejection(items.find({}));
        expect(fromFind).toBeInstanceOf(StorageError);
        expect((fromFind as StorageError).key).toBe(key);
        expect(((await rejection(items.findById(id))) as StorageError).key).toBe(key);
        await adapter.delete(key);
      }
      expect(await items.find({})).toHaveLength(1);
    });

    test('D7 a JSON file placed under docs/ is a document; D8 id and _etag come from storage', async () => {
      const items = db.collection<Item>('d7');
      const key = `${dbPath}/d7/docs/manual-1.json`;
      const { etag } = await adapter.put(key, bytes('{"n":7,"s":"m","id":"other","_etag":"stale"}'));

      const doc = await items.findById('manual-1');
      expect(doc).toMatchObject({ id: 'manual-1', _etag: etag, n: 7, s: 'm' });
      expect(await items.find({ s: 'm' })).toEqual([doc!]);

      const inserted = await items.insert({ n: 8, s: 'x' });
      const stored = JSON.parse(
        new TextDecoder().decode((await adapter.get(`${dbPath}/d7/docs/${inserted.id}.json`)).body)
      );
      expect(stored).not.toHaveProperty('_etag');
      expect(stored).toMatchObject({ n: 8, s: 'x' });
    });

    test('D9 update with a stale etag throws ConcurrentUpdateError without writing (UnsupportedError without compare-and-swap)', async () => {
      const { storage, calls } = counted(adapter);
      const items = new BucketDB(storage, dbPath).collection<Item>('d9');
      const doc = await items.insert({ n: 1, s: 'a' });
      calls.length = 0;

      if (compareAndSwap) {
        await items.update(doc.id, { n: 2 });
        calls.length = 0;
        expect(await rejection(items.update(doc.id, { n: 3 }, { etag: doc._etag }))).toBeInstanceOf(
          ConcurrentUpdateError
        );
        expect(calls).not.toContain('put');
        expect((await items.findById(doc.id))!.n).toBe(2);
      } else {
        expect(await rejection(items.update(doc.id, { n: 3 }, { etag: doc._etag }))).toBeInstanceOf(UnsupportedError);
        expect(calls).toEqual([]);
      }
    });

    test('D10 concurrent etag-less updates to different fields', async () => {
      const items = db.collection<Item>('d10');
      const doc = await items.insert({ n: 0, s: 'a' });
      const fields = Array.from({ length: 6 }, (_, i) => `f${i}`);
      await Promise.all(fields.map(field => items.update(doc.id, { [field]: true } as Partial<Item>)));

      const final = (await items.findById(doc.id))!;
      if (compareAndSwap) {
        for (const field of fields) expect(final[field]).toBe(true);
      } else {
        // last writer wins: at least one update survives
        expect(fields.some(field => final[field] === true)).toBe(true);
      }
    });

    test('D11 update of a missing document throws DocumentNotFoundError; system fields cannot be changed', async () => {
      const items = db.collection<Item>('d11');
      expect(await rejection(items.update('no-such-doc', { n: 1 }))).toBeInstanceOf(DocumentNotFoundError);

      const doc = await items.insert({ n: 1, s: 'a' });
      const sneaky = { n: 2, id: 'other', _createdAt: '1999-01-01T00:00:00.000Z' } as Partial<Item>;
      const updated = await items.update(doc.id, sneaky);
      expect(updated.id).toBe(doc.id);
      expect(updated._createdAt).toBe(doc._createdAt!);
      expect(await items.findById('other')).toBeNull();
    });

    test('D12 invalid names and IDs are rejected before any storage call', async () => {
      const { storage, calls } = counted(adapter);
      const scoped = new BucketDB(storage, dbPath);
      for (const name of ['a/b', '.hidden', '', 'x'.repeat(256), 'a b']) {
        expect(() => scoped.collection(name)).toThrow(ValidationError);
      }
      expect(() => new BucketDB(storage, '../up')).toThrow(ValidationError);
      expect(() => new BucketDB(storage, 'a//b')).toThrow(ValidationError);

      const items = scoped.collection<Item>('d12');
      for (const id of ['a/b', '.x', '', 'x'.repeat(256), '../x']) {
        expect(await rejection(items.findById(id))).toBeInstanceOf(ValidationError);
        expect(await rejection(items.update(id, { n: 1 }))).toBeInstanceOf(ValidationError);
        expect(await rejection(items.delete(id))).toBeInstanceOf(ValidationError);
      }
      expect(await rejection(items.find({ constructor: 1 } as QueryFilter<Item>))).toBeInstanceOf(ValidationError);
      expect(await rejection(items.find({ n: { $bad: 1 } } as unknown as QueryFilter<Item>))).toBeInstanceOf(
        ValidationError
      );
      expect(calls).toEqual([]);
    });

    test('D14 put creates or replaces the whole document in one unconditional write', async () => {
      const { storage, calls } = counted(adapter);
      const items = new BucketDB(storage, dbPath).collection<Item>('d14');
      const first = await items.put('run-42', { n: 1, s: 'a', extra: true });
      expect(calls).toEqual(['put']);
      const second = await items.put('run-42', { n: 2, s: 'b' });
      expect(await items.findById('run-42')).toEqual(second);
      expect(second).not.toHaveProperty('extra');
      expect(second._etag).not.toBe(first._etag);
      await items.put('run-42', { n: 2, s: 'b' }); // repeating is harmless
      expect(await items.count()).toBe(1);
    });

    test('D15 insert with an explicit id creates once, then throws DocumentExistsError', async () => {
      const items = db.collection<Item>('d15');
      const doc = await items.insert({ n: 1, s: 'a' }, { id: 'sha-abc123' });
      expect(doc.id).toBe('sha-abc123');
      expect(await rejection(items.insert({ n: 2, s: 'b' }, { id: 'sha-abc123' }))).toBeInstanceOf(DocumentExistsError);
      expect((await items.findById('sha-abc123'))!.n).toBe(1);
      const racers = await Promise.allSettled([1, 2, 3, 4, 5].map(n => items.insert({ n, s: 'r' }, { id: 'race' })));
      expect(racers.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(await rejection(items.insert({ n: 1, s: 'a' }, { id: 'a/b' }))).toBeInstanceOf(ValidationError);
    });

    test('D16 count without a filter only lists; with a filter it counts matches', async () => {
      const { storage, calls } = counted(adapter);
      const items = new BucketDB(storage, dbPath).collection<Item>('d16');
      await Promise.all([1, 2, 3].map(n => items.insert({ n, s: n === 1 ? 'x' : 'y' })));
      calls.length = 0;
      expect(await items.count()).toBe(3);
      expect(calls.every(operation => operation === 'list')).toBe(true);
      expect(await items.count({ s: 'y' })).toBe(2);
    });

    test('D17 deleteMany deletes the matches and reports how many', async () => {
      const items = db.collection<Item>('d17');
      await Promise.all([1, 2, 3, 4, 5].map(n => items.insert({ n, s: 'z' })));
      expect(await items.deleteMany({ n: { $lte: 3 } })).toBe(3);
      expect((await items.find({})).map(doc => doc.n).sort()).toEqual([4, 5]);
      expect(await items.deleteMany({ n: 100 })).toBe(0);
    });

    test('D18 find sorts by _createdAt then id by default, by the given fields otherwise; limit 0 is empty', async () => {
      const items = db.collection<Item>('d18');
      for (const n of [3, 1, 2]) {
        await items.put(`id-${n}`, { n, s: 's' });
        await Bun.sleep(2); // distinct _createdAt (millisecond resolution)
      }
      expect((await items.find({})).map(doc => doc.n)).toEqual([3, 1, 2]);
      expect((await items.find({}, { sort: { n: 1 } })).map(doc => doc.n)).toEqual([1, 2, 3]);
      expect((await items.find({}, { sort: { n: -1 }, limit: 2 })).map(doc => doc.n)).toEqual([3, 2]);
      expect(await items.find({}, { limit: 0 })).toEqual([]);
      expect(await rejection(items.find({}, { limit: -1 }))).toBeInstanceOf(ValidationError);
    });

    test('D13 a collection written by 0.3.x is readable; index/ and wal/ are ignored', async () => {
      const base = `${dbPath}/legacy`;
      const legacy = [
        {
          id: 'a1b2c3d4-0000-4000-8000-000000000001',
          n: 1,
          s: 'x',
          _etag: 'old',
          _createdAt: '2026-03-01T00:00:00.000Z',
          _updatedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'a1b2c3d4-0000-4000-8000-000000000002',
          n: 2,
          s: 'y',
          _createdAt: '2026-03-02T00:00:00.000Z',
          _updatedAt: '2026-03-02T00:00:00.000Z',
        },
      ];
      for (const doc of legacy) {
        await adapter.put(`${base}/docs/${doc.id}.json`, bytes(JSON.stringify(doc, null, 2)));
      }
      await adapter.put(
        `${base}/index/shard-03.json`,
        bytes(JSON.stringify({ shardId: '03', documents: { ghost: { id: 'ghost' } } }))
      );
      await adapter.put(`${base}/index/shard-03.meta.json`, bytes('{"shardId":"03","docCount":1}'));
      await adapter.put(`${base}/wal/ghost.wal.json`, bytes('{"operation":"insert","documentId":"ghost"}'));

      const found = await db.collection<Item>('legacy').find({});
      expect(found.map(doc => doc.id).sort()).toEqual(legacy.map(doc => doc.id));
      expect(found.find(doc => doc.n === 1)!._etag).not.toBe('old');
    });
  });
}
