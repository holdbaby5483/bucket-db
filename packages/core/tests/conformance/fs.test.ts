import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { FileSystemAdapter, StorageError } from '../../src/index.js';
import { defineAdapterSuite } from './adapter-suite';
import { defineCollectionSuite } from './collection-suite';

const basePath = mkdtempSync(join(tmpdir(), 'bucketdb-conformance-'));
afterAll(() => rmSync(basePath, { recursive: true, force: true }));

defineAdapterSuite('filesystem', () => ({ adapter: new FileSystemAdapter({ basePath }), prefix: 'test/conformance/' }));
defineCollectionSuite('filesystem', () => ({
  adapter: new FileSystemAdapter({ basePath }),
  dbPath: 'test/collection',
}));

// root ignores directory permissions, so the failure cannot be provoked there
describe.skipIf(process.getuid?.() === 0)('filesystem write errors', () => {
  test('a put that cannot create the directory or the file throws StorageError', async () => {
    const readOnly = join(basePath, 'read-only');
    mkdirSync(join(readOnly, 'docs'), { recursive: true });
    chmodSync(join(readOnly, 'docs'), 0o555);
    chmodSync(readOnly, 0o555);
    try {
      const adapter = new FileSystemAdapter({ basePath: readOnly });
      const body = new TextEncoder().encode('{}');
      for (const key of ['new-dir/a.json', 'docs/a.json']) {
        const error = await adapter.put(key, body).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(StorageError);
        expect(error).toMatchObject({ kind: 'permanent', key });
      }
    } finally {
      chmodSync(readOnly, 0o755);
      chmodSync(join(readOnly, 'docs'), 0o755);
    }
  });
});
