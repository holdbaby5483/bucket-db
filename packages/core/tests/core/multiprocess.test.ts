import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BucketDB } from '../../src/index.js';
import { startFakeS3 } from '../support/fake-s3';
import { adapterFor, type WorkerBackend, type WorkerConfig } from '../support/insert-worker';

const WORKERS = 4;
const PER_WORKER = 25;
const workerPath = join(import.meta.dir, '../support/insert-worker.ts');

/** Several independent processes insert into one collection; every acknowledged insert must be visible. */
async function insertFromProcesses(backend: WorkerBackend) {
  const dbPath = `test/multiprocess-${Date.now()}`;
  const processes = Array.from({ length: WORKERS }, (_, worker) => {
    const config: WorkerConfig = { backend, dbPath, worker, count: PER_WORKER };
    return Bun.spawn(['bun', workerPath], {
      env: { ...process.env, BUCKETDB_WORKER: JSON.stringify(config) },
      stdout: 'pipe',
      stderr: 'inherit',
    });
  });
  const acknowledged = (
    await Promise.all(
      processes.map(async child => {
        const output = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        return JSON.parse(output) as string[];
      })
    )
  ).flat();

  const adapter = adapterFor(backend);
  try {
    const found = await new BucketDB(adapter, dbPath).collection('items').find({});
    expect(acknowledged).toHaveLength(WORKERS * PER_WORKER);
    expect(found.map(doc => doc.id).sort()).toEqual(acknowledged.sort());
  } finally {
    let cursor: string | undefined;
    do {
      const page = await adapter.list(`${dbPath}/`, { cursor });
      await Promise.all(page.entries.map(entry => adapter.delete(entry.key)));
      cursor = page.cursor;
    } while (cursor);
  }
}

const withOss = process.env.OSS_ACCESS_KEY_ID ? test : test.skip;
const withS3 = process.env.AWS_ACCESS_KEY_ID && process.env.TEST_S3_BUCKET ? test : test.skip;

describe('multiple processes inserting into one collection', () => {
  const basePath = mkdtempSync(join(tmpdir(), 'bucketdb-multiprocess-'));
  afterAll(() => rmSync(basePath, { recursive: true, force: true }));

  test('filesystem', () => insertFromProcesses({ kind: 'fs', basePath }), 60_000);

  test('fake S3', async () => {
    const s3 = startFakeS3();
    try {
      await insertFromProcesses({ kind: 'fake-s3', endpoint: s3.url, bucket: s3.bucket });
    } finally {
      s3.stop();
    }
  }, 60_000);

  withOss('real OSS', () => insertFromProcesses({ kind: 'oss' }), 120_000);
  withS3('real S3', () => insertFromProcesses({ kind: 's3' }), 120_000);
});
