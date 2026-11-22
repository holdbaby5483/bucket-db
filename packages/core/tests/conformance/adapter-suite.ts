import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { StorageAdapter } from '../../src/storage/adapter.js';
import { StorageError, UnsupportedError } from '../../src/errors.js';

export interface AdapterTarget {
  adapter: StorageAdapter;
  /** Unique per run, ends with '/'. Everything the suite writes lives under it. */
  prefix: string;
}

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (body: Uint8Array) => new TextDecoder().decode(body);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

async function listAll(adapter: StorageAdapter, prefix: string) {
  const entries = [];
  let cursor: string | undefined;
  do {
    const page = await adapter.list(prefix, { cursor });
    entries.push(...page.entries);
    cursor = page.cursor;
  } while (cursor);
  return entries;
}

/**
 * The storage contract every backend must meet (cases A1–A8 and B1–B5; docs/GUARANTEES.md maps them to guarantees).
 * Conditional-write cases run according to the backend's declared capabilities.
 */
export function defineAdapterSuite(
  name: string,
  setup: () => AdapterTarget | Promise<AdapterTarget>,
  options: { listRounds?: number } = {}
) {
  describe(`storage contract: ${name}`, () => {
    let adapter: StorageAdapter;
    let prefix: string;

    beforeAll(async () => {
      ({ adapter, prefix } = await setup());
    });

    afterAll(async () => {
      const leftovers = await listAll(adapter, prefix);
      await Promise.all(leftovers.map(entry => adapter.delete(entry.key)));
      expect(await listAll(adapter, prefix)).toEqual([]);
    });

    test('A1 get of a missing key is not-found', async () => {
      const error = await rejection(adapter.get(`${prefix}a1/missing.json`));
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).kind).toBe('not-found');
    });

    test('A2 put then get returns the same bytes and etag', async () => {
      const key = `${prefix}a2/object.json`;
      const { etag } = await adapter.put(key, bytes('{"a":2}'));
      const object = await adapter.get(key);
      expect(text(object.body)).toBe('{"a":2}');
      expect(object.etag).toBe(etag);
      expect(etag).not.toContain('"');
    });

    test('A3 unconditional put overwrites and changes the etag', async () => {
      const key = `${prefix}a3/object.json`;
      const first = await adapter.put(key, bytes('one'));
      const second = await adapter.put(key, bytes('two'));
      expect(second.etag).not.toBe(first.etag);
      expect(text((await adapter.get(key)).body)).toBe('two');
    });

    test('A4 delete removes the object and is idempotent', async () => {
      const key = `${prefix}a4/object.json`;
      await adapter.put(key, bytes('x'));
      await adapter.delete(key);
      expect(((await rejection(adapter.get(key))) as StorageError).kind).toBe('not-found');
      await adapter.delete(key);
    });

    test('A5 list returns only keys under the prefix, sorted, with matching etags', async () => {
      const base = `${prefix}a5/`;
      const written = new Map<string, string>();
      for (const key of [`${base}docs/b.json`, `${base}docs/a.json`, `${base}docs/sub/c.json`]) {
        written.set(key, (await adapter.put(key, bytes(key))).etag);
      }
      await adapter.put(`${base}docs2/x.json`, bytes('outside'));

      const entries = await listAll(adapter, `${base}docs/`);
      expect(entries.map(entry => entry.key)).toEqual([...written.keys()].sort());
      for (const entry of entries) {
        expect(entry.etag).toBe(written.get(entry.key)!);
        expect(entry.etag).toBe((await adapter.get(entry.key)).etag);
      }
    });

    test('A6 list paginates without gaps or duplicates', async () => {
      const base = `${prefix}a6/`;
      const keys = Array.from({ length: 25 }, (_, n) => `${base}k${String(n).padStart(2, '0')}.json`);
      await Promise.all(keys.map(key => adapter.put(key, bytes(key))));

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await adapter.list(base, { cursor, limit: 10 });
        expect(page.entries.length).toBeLessThanOrEqual(10);
        seen.push(...page.entries.map(entry => entry.key));
        cursor = page.cursor;
        pages++;
      } while (cursor);
      expect(seen).toEqual(keys);
      expect(pages).toBe(3);
    });

    test('A7 list reflects writes, overwrites and deletes immediately', async () => {
      for (let round = 0; round < (options.listRounds ?? 5); round++) {
        const base = `${prefix}a7/r${round}/`;
        const keys = Array.from({ length: 5 }, (_, n) => `${base}k${n}.json`);
        const etags = await Promise.all(keys.map(key => adapter.put(key, bytes(key)).then(result => result.etag)));
        expect((await listAll(adapter, base)).map(entry => entry.key)).toEqual(keys);

        const overwritten = await adapter.put(keys[0], bytes('changed'));
        const afterOverwrite = await listAll(adapter, base);
        expect(afterOverwrite[0].etag).toBe(overwritten.etag);
        expect(afterOverwrite.slice(1).map(entry => entry.etag)).toEqual(etags.slice(1));

        await adapter.delete(keys[1]);
        expect((await listAll(adapter, base)).map(entry => entry.key)).toEqual([keys[0], ...keys.slice(2)]);
      }
    });

    test('A8 keys with every allowed character round-trip', async () => {
      const key = `${prefix}a8/nested/deeper/Az09_-.name.json`;
      await adapter.put(key, bytes('ok'));
      expect(text((await adapter.get(key)).body)).toBe('ok');
      expect((await listAll(adapter, `${prefix}a8/`)).map(entry => entry.key)).toEqual([key]);
    });

    test('B1 ifNoneMatch creates once and then conflicts', async () => {
      if (adapter.capabilities.createIfAbsent === 'none') return;
      const key = `${prefix}b1/object.json`;
      await adapter.put(key, bytes('first'), { ifNoneMatch: '*' });
      const error = await rejection(adapter.put(key, bytes('second'), { ifNoneMatch: '*' }));
      expect((error as StorageError).kind).toBe('conflict');
      expect(text((await adapter.get(key)).body)).toBe('first');
    });

    test('B2 concurrent ifNoneMatch on one key: exactly one wins', async () => {
      if (adapter.capabilities.createIfAbsent === 'none') return;
      const key = `${prefix}b2/object.json`;
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, n) => adapter.put(key, bytes(`writer-${n}`), { ifNoneMatch: '*' }))
      );
      const winners = results.flatMap((result, n) => (result.status === 'fulfilled' ? [n] : []));
      expect(winners).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected') expect((result.reason as StorageError).kind).toBe('conflict');
      }
      expect(text((await adapter.get(key)).body)).toBe(`writer-${winners[0]}`);
    });

    test('B3 ifMatch succeeds on the current etag, conflicts on a stale one, not-found on a missing key', async () => {
      if (adapter.capabilities.compareAndSwap === 'none') return;
      const key = `${prefix}b3/object.json`;
      const { etag: first } = await adapter.put(key, bytes('one'));
      await adapter.put(key, bytes('two'), { ifMatch: first });
      const stale = await rejection(adapter.put(key, bytes('three'), { ifMatch: first }));
      expect((stale as StorageError).kind).toBe('conflict');
      expect(text((await adapter.get(key)).body)).toBe('two');

      const missing = await rejection(adapter.put(`${prefix}b3/missing.json`, bytes('x'), { ifMatch: first }));
      expect((missing as StorageError).kind).toBe('not-found');
    });

    test('B4 concurrent ifMatch with one etag: exactly one wins', async () => {
      if (adapter.capabilities.compareAndSwap === 'none') return;
      const key = `${prefix}b4/object.json`;
      const { etag } = await adapter.put(key, bytes('base'));
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, n) => adapter.put(key, bytes(`writer-${n}`), { ifMatch: etag }))
      );
      const winners = results.flatMap((result, n) => (result.status === 'fulfilled' ? [n] : []));
      expect(winners).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected') expect((result.reason as StorageError).kind).toBe('conflict');
      }
      expect(text((await adapter.get(key)).body)).toBe(`writer-${winners[0]}`);
    });

    test('B5 a condition the backend cannot enforce is refused', async () => {
      const key = `${prefix}b5/object.json`;
      if (adapter.capabilities.compareAndSwap === 'none') {
        await adapter.put(key, bytes('base'));
        const error = await rejection(adapter.put(key, bytes('x'), { ifMatch: 'anything' }));
        expect(error).toBeInstanceOf(UnsupportedError);
        expect(text((await adapter.get(key)).body)).toBe('base');
      }
      if (adapter.capabilities.createIfAbsent === 'none') {
        expect(await rejection(adapter.put(key, bytes('x'), { ifNoneMatch: '*' }))).toBeInstanceOf(UnsupportedError);
      }
    });
  });
}
