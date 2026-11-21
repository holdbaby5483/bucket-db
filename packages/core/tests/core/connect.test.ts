import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BucketDB,
  FileSystemAdapter,
  MemoryStorageAdapter,
  OSSAdapter,
  S3Adapter,
  ValidationError,
} from '../../src/index.js';
import { openUrl } from '../../src/url.js';
import { startFakeS3 } from '../support/fake-s3';

function failure(url: string): ValidationError {
  try {
    openUrl(url);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error(`expected ${url} to be rejected`);
}

describe('connection URLs', () => {
  test('each scheme selects its backend and the path becomes dbPath', () => {
    const s3 = openUrl('s3://my-bucket/ci-data/runs?region=us-east-1');
    expect(s3.adapter).toBeInstanceOf(S3Adapter);
    expect(s3.dbPath).toBe('ci-data/runs');
    const oss = openUrl('oss://my-bucket?region=cn-hangzhou');
    expect(oss.adapter).toBeInstanceOf(OSSAdapter);
    expect(oss.dbPath).toBe('');
    expect(openUrl('memory://app').adapter).toBeInstanceOf(MemoryStorageAdapter);
    expect(openUrl('memory://app/sub').dbPath).toBe('app/sub');
    expect(openUrl('file:///tmp/db').adapter).toBeInstanceOf(FileSystemAdapter);
  });

  test('credentials in the URL are refused without echoing them', () => {
    for (const url of ['s3://AKIAEXAMPLE:s3cr3t@bucket/x?region=us-east-1', 'oss://user@bucket?region=cn-hangzhou']) {
      const error = failure(url);
      expect(error.message).toContain('credentials');
      expect(error.message).not.toContain('s3cr3t');
      expect(error.message).not.toContain('AKIAEXAMPLE');
    }
  });

  test('unknown parameters, schemes and missing buckets are refused', () => {
    expect(failure('s3://bucket?region=x&secretAccessKey=abc').message).toContain(
      'Unknown parameter "secretAccessKey"'
    );
    expect(failure('oss://bucket?forcePathStyle=true').message).toContain('Unknown parameter');
    expect(failure('ftp://bucket').message).toContain('Unsupported scheme');
    expect(failure('s3:///prefix?region=x').message).toContain('need a bucket');
    expect(failure('not a url').message).toBe('Invalid connection URL');
    expect(() => openUrl('')).toThrow('BUCKET_DB_URL');
  });

  test('BUCKET_DB_URL is the default', () => {
    const previous = process.env.BUCKET_DB_URL;
    process.env.BUCKET_DB_URL = 'memory://from-env';
    try {
      expect(openUrl().dbPath).toBe('from-env');
    } finally {
      if (previous === undefined) delete process.env.BUCKET_DB_URL;
      else process.env.BUCKET_DB_URL = previous;
    }
  });

  test('connect works end to end on file, memory and an S3 endpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bucketdb-connect-'));
    const s3 = startFakeS3();
    const saved = {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    };
    Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' });
    try {
      for (const url of [
        `file://${dir}`,
        'memory://x',
        `s3://${s3.bucket}/p?region=us-east-1&endpoint=${encodeURIComponent(s3.url)}`,
      ]) {
        const items = BucketDB.connect(url).collection<{ id: string; n: number }>('items');
        await items.put('a', { n: 1 });
        expect((await items.find({})).map(doc => doc.n)).toEqual([1]);
      }
      expect(s3.requests.some(request => request.key === 'p/items/docs/a.json')).toBe(true);
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      s3.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
