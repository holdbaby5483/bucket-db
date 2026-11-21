/**
 * Request counts and latency per operation at 100, 1,000 and 10,000 documents.
 *
 *   bun packages/core/bench/run.ts <fs|s3|oss> [sizes]
 *
 * s3 / oss use the buckets from the environment (TEST_S3_BUCKET, OSS_BUCKET and
 * the usual AWS_* / OSS_* variables), write only under test/bench-<time>/ and
 * delete everything afterwards. Prints a Markdown table.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BucketDB, FileSystemAdapter, OSSAdapter, S3Adapter } from '../src/index.js';
import type { Document, ListOptions, StorageAdapter, WriteCondition } from '../src/index.js';

interface Item extends Document {
  n: number;
  name: string;
  tags: string[];
  note: string;
}

/** Counts storage requests passing through. */
class Counting implements StorageAdapter {
  requests = 0;
  constructor(private readonly inner: StorageAdapter) {}
  get capabilities() {
    return this.inner.capabilities;
  }
  get remote() {
    return this.inner.remote;
  }
  get(key: string) {
    this.requests++;
    return this.inner.get(key);
  }
  put(key: string, body: Uint8Array, condition?: WriteCondition) {
    this.requests++;
    return this.inner.put(key, body, condition);
  }
  delete(key: string) {
    this.requests++;
    return this.inner.delete(key);
  }
  list(prefix: string, options?: ListOptions) {
    this.requests++;
    return this.inner.list(prefix, options);
  }
}

const backend = process.argv[2];
const sizes = (process.argv[3] ?? '100,1000,10000').split(',').map(Number);
let cleanupDir: string | undefined;
const inner: StorageAdapter =
  backend === 'fs'
    ? new FileSystemAdapter({ basePath: (cleanupDir = mkdtempSync(join(tmpdir(), 'bucketdb-bench-'))) })
    : backend === 's3'
      ? new S3Adapter({ bucket: process.env.TEST_S3_BUCKET! })
      : backend === 'oss'
        ? new OSSAdapter({ bucket: process.env.OSS_BUCKET! })
        : (() => {
            throw new Error('usage: bench/run.ts <fs|s3|oss> [sizes]');
          })();
const storage = new Counting(inner);

/** Runs `fn` `times` times sequentially; mean latency and requests per run. */
async function measure(times: number, fn: (index: number) => Promise<unknown>) {
  const requests = storage.requests;
  const start = performance.now();
  for (let index = 0; index < times; index++) await fn(index);
  return { ms: (performance.now() - start) / times, requests: (storage.requests - requests) / times };
}

async function inBatches<T>(values: T[], size: number, fn: (value: T) => Promise<unknown>) {
  for (let start = 0; start < values.length; start += size) await Promise.all(values.slice(start, start + size).map(fn));
}

const document = (n: number) => ({
  n,
  name: `record-${n}`,
  tags: ['ci', `shard-${n % 7}`],
  note: 'x'.repeat(300), // ~450 bytes per document
});

const rows: string[] = [];
const row = (n: number, operation: string, result: { ms: number; requests: number }, extra = '') =>
  rows.push(`| ${n} | ${operation} | ${Number(result.requests.toFixed(1))} | ${result.ms.toFixed(0)} | ${extra} |`);

const dbRoot = `test/bench-${Date.now()}`;
try {
  for (const n of sizes) {
    const dbPath = `${dbRoot}/n${n}`;
    const items = new BucketDB(storage, dbPath, { logger: () => {} }).collection<Item>('items');
    const snapshotKey = `${dbPath}/items/_snapshot.v1.json`;

    const seeded: Item[] = [];
    await inBatches(Array.from({ length: n }, (_, i) => i), 64, async i => seeded.push(await items.insert(document(i))));

    row(n, 'insert', await measure(5, i => items.insert(document(n + i))));
    row(n, 'findById', await measure(5, i => items.findById(seeded[i].id)));

    await inner.delete(snapshotKey).catch(() => undefined);
    row(n, 'find, no snapshot', await measure(1, () => items.find({ n: { $lt: 10 } })));
    row(n, 'find, current snapshot', await measure(3, () => items.find({ n: { $lt: 10 } })));

    for (const changed of [10, 100].filter(k => k < n)) {
      await inBatches(seeded.slice(0, changed), 32, doc => items.update(doc.id, { n: doc.n + 1 }));
      row(n, `find after ${changed} updates`, await measure(1, () => items.find({ n: { $lt: 10 } })));
      row(n, `next find`, await measure(1, () => items.find({ n: { $lt: 10 } })));
    }

    const compact = await measure(1, () => items.compact());
    const snapshotBytes = backend === 'fs' ? 0 : (await inner.get(snapshotKey)).body.length;
    row(n, 'compact', compact, backend === 'fs' ? 'no snapshot on local backends' : `snapshot ${(snapshotBytes / 1024).toFixed(0)} kB`);
    console.error(`n=${n} done`);
  }
} finally {
  if (cleanupDir) {
    rmSync(cleanupDir, { recursive: true, force: true });
  } else {
    let keys: string[];
    do {
      keys = (await inner.list(`${dbRoot}/`)).entries.map(entry => entry.key);
      await inBatches(keys, 64, key => inner.delete(key));
    } while (keys.length > 0);
  }
}

console.log(`| documents | operation | requests | ms | note |\n|---:|---|---:|---:|---|\n${rows.join('\n')}`);
