import { describe, test, expect } from 'bun:test';
import { BucketDB, MemoryStorageAdapter } from '../../src/index.js';
import type { Collection, Document } from '../../src/index.js';
import { FaultyAdapter } from '../support/faulty-adapter';

interface Item extends Document {
  n: number;
  s: string;
}

const open = (adapter: MemoryStorageAdapter | FaultyAdapter) => new BucketDB(adapter, 'db').collection<Item>('items');

/** After `budget` storage calls the "process" dies: every further call fails. */
function crashAfter(inner: MemoryStorageAdapter, budget: number) {
  const storage = new FaultyAdapter(inner);
  let calls = 0;
  storage.before = () => {
    if (calls++ >= budget) throw new Error('crash');
  };
  return storage;
}

/**
 * Runs `operation` with a crash injected after 0, 1, 2, … storage calls until it
 * completes, and checks the state a fresh process sees after each crash.
 */
async function everyCrashPoint<S>(
  prepare: (items: Collection<Item>) => Promise<S>,
  operation: (items: Collection<Item>, state: S) => Promise<unknown>,
  check: (items: Collection<Item>, state: S) => Promise<void>
) {
  for (let budget = 0; ; budget++) {
    const inner = new MemoryStorageAdapter();
    const state = await prepare(open(inner));
    const completed = await operation(open(crashAfter(inner, budget)), state).then(
      () => true,
      () => false
    );
    await check(open(inner), state);
    if (completed) return budget;
  }
}

const strip = ({ _etag, _updatedAt, ...rest }: Item) => rest;

describe('crash consistency: state after a crash is either the old or the new one', () => {
  test('insert', async () => {
    await everyCrashPoint(
      async () => undefined,
      items => items.insert({ n: 1, s: 'new' }),
      async items => {
        const docs = await items.find({});
        expect(docs.length).toBeLessThanOrEqual(1);
        if (docs.length === 1) expect(docs[0]).toMatchObject({ n: 1, s: 'new' });
      }
    );
  });

  for (const withEtag of [true, false]) {
    test(`update ${withEtag ? 'with' : 'without'} etag`, async () => {
      await everyCrashPoint(
        items => items.insert({ n: 1, s: 'old' }),
        (items, old) => items.update(old.id, { n: 2 }, withEtag ? { etag: old._etag } : {}),
        async (items, old) => {
          const current = strip((await items.findById(old.id))!);
          expect([strip(old), { ...strip(old), n: 2 }]).toContainEqual(current);
        }
      );
    });
  }

  test('delete', async () => {
    await everyCrashPoint(
      items => items.insert({ n: 1, s: 'old' }),
      (items, old) => items.delete(old.id),
      async (items, old) => {
        const current = await items.findById(old.id);
        if (current) expect(current).toEqual(old);
        expect((await items.find({})).length).toBe(current ? 1 : 0);
      }
    );
  });
});
