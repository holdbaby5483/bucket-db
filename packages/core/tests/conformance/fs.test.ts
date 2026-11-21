import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'bun:test';
import { FileSystemAdapter } from '../../src/storage/fs.js';
import { defineAdapterSuite } from './adapter-suite';

const basePath = mkdtempSync(join(tmpdir(), 'bucketdb-conformance-'));
afterAll(() => rmSync(basePath, { recursive: true, force: true }));

defineAdapterSuite('filesystem', () => ({ adapter: new FileSystemAdapter({ basePath }), prefix: 'test/conformance/' }));
