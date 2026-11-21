import type { StorageAdapter } from './storage/adapter.js';
import { StorageError } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Outcome = true | `skip: ${string}` | string;

/** Concurrent writers on one key; returns how many succeeded and what the rest failed with. */
async function race(writes: Array<() => Promise<unknown>>) {
  const results = await Promise.allSettled(writes.map(write => write()));
  const wins = results.filter(result => result.status === 'fulfilled').length;
  const other = results.find(result => result.status === 'rejected' && !(result.reason instanceof StorageError && result.reason.kind === 'conflict'));
  return { wins, other: other?.status === 'rejected' ? String(other.reason) : undefined };
}

/**
 * Checks what a storage service actually guarantees, writing only under
 * `<dbPath>/_doctor-<time>/` and removing it afterwards. Prints one line per
 * check; returns the number of failed checks.
 */
export async function doctor(adapter: StorageAdapter, dbPath: string, print: (line: string) => void): Promise<number> {
  const base = `${dbPath ? `${dbPath}/` : ''}_doctor-${Date.now()}/`;
  const { createIfAbsent, compareAndSwap } = adapter.capabilities;
  const listKeys = async (prefix: string) => (await adapter.list(prefix)).entries;

  const checks: Array<[string, () => Promise<Outcome>]> = [
    ['write, read and delete an object', async () => {
      const { etag } = await adapter.put(`${base}a.json`, encoder.encode('{"a":1}'));
      const read = await adapter.get(`${base}a.json`);
      if (decoder.decode(read.body) !== '{"a":1}' || read.etag !== etag) return 'read back different bytes or etag';
      await adapter.delete(`${base}a.json`);
      const gone = await adapter.get(`${base}a.json`).then(() => false, (error: unknown) => error instanceof StorageError && error.kind === 'not-found');
      return gone || 'object still readable after delete';
    }],
    ['list reflects writes, overwrites and deletes immediately, with matching etags', async () => {
      const keys = [0, 1, 2, 3, 4].map(n => `${base}list/${n}.json`);
      const etags = await Promise.all(keys.map(key => adapter.put(key, encoder.encode(key)).then(result => result.etag)));
      let listed = await listKeys(`${base}list/`);
      if (listed.map(entry => entry.key).join() !== keys.join()) return 'a new object was missing from the list';
      if (listed.some((entry, index) => entry.etag !== etags[index])) return 'list etags differ from write etags';
      const { etag } = await adapter.put(keys[0], encoder.encode('changed'));
      await adapter.delete(keys[1]);
      listed = await listKeys(`${base}list/`);
      if (listed[0]?.etag !== etag) return 'list showed an old etag after an overwrite';
      return listed.length === 4 || 'list still showed a deleted object';
    }],
    [`create-if-absent (declared: ${createIfAbsent})`, async () => {
      if (createIfAbsent === 'none') return 'skip: not supported by this backend';
      const key = `${base}create.json`;
      const { wins, other } = await race(Array.from({ length: 10 }, (_, n) => () => adapter.put(key, encoder.encode(`${n}`), { ifNoneMatch: '*' })));
      return other ?? (wins === 1 || `${wins} of 10 concurrent creates succeeded (a versioned OSS bucket does this)`);
    }],
    [`compare-and-swap (declared: ${compareAndSwap})`, async () => {
      if (compareAndSwap === 'none') return 'skip: not supported by this backend; etag updates are refused';
      const key = `${base}swap.json`;
      const { etag } = await adapter.put(key, encoder.encode('base'));
      const { wins, other } = await race(Array.from({ length: 10 }, (_, n) => () => adapter.put(key, encoder.encode(`${n}`), { ifMatch: etag })));
      if (other) return other;
      if (wins !== 1) return `${wins} of 10 concurrent conditional updates succeeded`;
      const stale = await race([() => adapter.put(key, encoder.encode('stale'), { ifMatch: etag })]);
      return stale.wins === 0 || 'a write with a stale etag succeeded';
    }],
  ];

  let failed = 0;
  try {
    for (const [name, check] of checks) {
      const outcome = await check().catch((error: unknown) => `error: ${error instanceof Error ? error.message : String(error)}`);
      if (outcome !== true && !outcome.startsWith('skip')) failed++;
      print(outcome === true ? `ok    ${name}` : outcome.startsWith('skip') ? `skip  ${name}: ${outcome.slice(6)}` : `FAIL  ${name}: ${outcome}`);
    }
  } finally {
    let leftovers = await listKeys(base);
    while (leftovers.length > 0) {
      await Promise.all(leftovers.map(entry => adapter.delete(entry.key)));
      leftovers = await listKeys(base);
    }
  }
  print(failed === 0 ? 'all checks passed' : `${failed} check(s) failed`);
  return failed;
}
