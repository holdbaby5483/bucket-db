import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeS3 } from '../support/fake-s3';

const cliPath = join(import.meta.dir, '../../src/cli.ts');
const root = mkdtempSync(join(tmpdir(), 'bucketdb-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function cli(args: string[], options: { url?: string; stdin?: string; env?: Record<string, string> } = {}) {
  const child = Bun.spawn(['bun', cliPath, ...args], {
    env: { ...process.env, BUCKET_DB_URL: options.url ?? '', ...options.env },
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

describe('bucket-db CLI', () => {
  let url: string;
  beforeEach(() => {
    url = `file://${mkdtempSync(join(root, 'db-'))}`;
  });

  test('put, get, find, count and delete round trip with JSON output and exit codes', async () => {
    expect((await cli(['put', 'runs', 'sha-1', '{"ms":120,"ok":true}'], { url })).code).toBe(0);
    expect((await cli(['put', 'runs', 'sha-2'], { url, stdin: '{"ms":80,"ok":false}' })).code).toBe(0);
    await cli(['put', 'runs', 'sha-3', '{"ms":200,"ok":true}'], { url });

    const got = await cli(['get', 'runs', 'sha-1'], { url });
    expect(got.code).toBe(0);
    expect(JSON.parse(got.stdout)).toMatchObject({ id: 'sha-1', ms: 120 });

    const found = await cli(['find', 'runs', '{"ok":true}', '--sort', 'ms:desc', '--limit', '1'], { url });
    expect(JSON.parse(found.stdout).map((doc: { id: string }) => doc.id)).toEqual(['sha-3']);
    expect((await cli(['count', 'runs'], { url })).stdout.trim()).toBe('3');
    expect((await cli(['count', 'runs', '{"ms":{"$lt":100}}'], { url })).stdout.trim()).toBe('1');

    expect((await cli(['delete', 'runs', 'sha-1'], { url })).code).toBe(0);
    const missing = await cli(['get', 'runs', 'sha-1'], { url });
    expect(missing.code).toBe(2);
    expect(missing.stdout).toBe('');
  });

  test('export then import into another collection keeps ids and timestamps', async () => {
    await cli(['put', 'src', 'a', '{"n":1}'], { url });
    await cli(['put', 'src', 'b', '{"n":2}'], { url });
    const exported = await cli(['export', 'src'], { url });
    const lines = exported.stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toHaveProperty('_etag');

    const imported = await cli(['import', 'copy'], { url, stdin: `${exported.stdout}{"n":3}\n` });
    expect(imported.stdout.trim()).toBe('3');
    const copy = JSON.parse((await cli(['find', 'copy'], { url })).stdout);
    expect(copy.slice(0, 2).map(({ _etag, ...doc }: Record<string, unknown>) => doc)).toEqual(lines);
    expect(copy[2]).toMatchObject({ n: 3 });
  });

  test('errors go to stderr with exit code 1 and never echo URL credentials', async () => {
    const badJson = await cli(['put', 'runs', 'x', '{oops'], { url });
    expect([badJson.code, badJson.stderr]).toEqual([1, 'bucket-db: document is not valid JSON\n']);
    expect((await cli(['frobnicate', 'runs'], { url })).code).toBe(1);
    expect((await cli(['get', 'a/b', 'x'], { url })).stderr).toContain('Invalid collection name');

    const leaked = await cli(['count', 'runs'], { url: 's3://AKIAEXAMPLE:topsecret@bucket?region=us-east-1' });
    expect(leaked.code).toBe(1);
    expect(leaked.stderr).not.toContain('topsecret');
    expect((await cli(['count', 'runs'], { url: '' })).stderr).toContain('BUCKET_DB_URL');
    expect((await cli(['--help'])).code).toBe(0);
  });

  test('doctor passes on the filesystem and an S3 endpoint and leaves nothing behind', async () => {
    const fs = await cli(['doctor'], { url });
    expect(fs.code).toBe(0);
    expect(fs.stdout).toContain('ok    create-if-absent (declared: atomic)');
    expect(fs.stdout).toContain('all checks passed');
    // only empty directories may remain on the filesystem
    const dir = url.slice('file://'.length);
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile());
    expect(files).toEqual([]);

    const s3 = startFakeS3();
    try {
      const result = await cli(
        ['doctor', '--url', `s3://${s3.bucket}/ci?region=us-east-1&endpoint=${encodeURIComponent(s3.url)}`],
        {
          env: { AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' },
        }
      );
      expect(result.stdout).toContain('ok    compare-and-swap (declared: atomic)');
      expect(result.code).toBe(0);
      expect(s3.requests.filter(request => request.method === 'PUT').length).toBeGreaterThan(0);
      const remaining = s3.requests.at(-1)!;
      expect(remaining.method).toBe('GET'); // the final listing that confirmed cleanup
    } finally {
      s3.stop();
    }
  });

  test('doctor skips compare-and-swap where the backend declares none', async () => {
    const s3 = startFakeS3('fake', { dialect: 'oss' });
    try {
      const result = await cli(
        ['doctor', '--url', `oss://${s3.bucket}?region=cn-hangzhou&endpoint=${encodeURIComponent(s3.url)}`],
        {
          env: { OSS_ACCESS_KEY_ID: 'test', OSS_ACCESS_KEY_SECRET: 'test' },
        }
      );
      expect(result.stdout).toContain('skip  compare-and-swap (declared: none)');
      expect(result.code).toBe(0);
    } finally {
      s3.stop();
    }
  });
});
