import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { S3Adapter } from '../../src/storage/s3-adapter';

// Skip tests if no AWS credentials available
const skipIfNoCredentials = process.env.AWS_ACCESS_KEY_ID ? test : test.skip;

describe('S3Adapter', () => {
  let adapter: S3Adapter;
  const testKeys: string[] = [];

  beforeEach(() => {
    adapter = new S3Adapter({
      bucket: process.env.TEST_S3_BUCKET || 'test-bucket',
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
      },
      endpoint: process.env.S3_ENDPOINT, // For LocalStack
    });
    testKeys.length = 0;
  });

  afterEach(async () => {
    for (const key of testKeys) {
      try { await adapter.delete(key); } catch {}
    }
  });

  function testKey(name: string): string {
    const key = `test/s3-adapter/${name}-${Date.now()}.json`;
    testKeys.push(key);
    return key;
  }

  skipIfNoCredentials('put and get object', async () => {
    const key = testKey('put-get');
    const data = { name: 'test', value: 123 };
    const { etag } = await adapter.put(key, data);

    expect(etag).toBeDefined();

    const result = await adapter.get(key);
    expect(result.data).toEqual(data);
    expect(result.etag).toBe(etag);
  });

  skipIfNoCredentials('exists returns true for existing key', async () => {
    const key = testKey('exists');
    await adapter.put(key, { test: true });
    expect(await adapter.exists(key)).toBe(true);
  });

  skipIfNoCredentials('delete removes object', async () => {
    const key = testKey('delete');
    await adapter.put(key, { test: true });
    await adapter.delete(key);
    expect(await adapter.exists(key)).toBe(false);
  });

  skipIfNoCredentials('put with ifMatch optimistic locking', async () => {
    const key = testKey('if-match');
    const { etag: etag1 } = await adapter.put(key, { version: 1 });
    const { etag: etag2 } = await adapter.put(key, { version: 2 }, { ifMatch: etag1 });

    expect(etag2).toBeDefined();
    expect(etag2).not.toBe(etag1);
  });

  test('adapter structure is correct', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.put).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.exists).toBe('function');
    expect(typeof adapter.listKeys).toBe('function');
    expect(typeof adapter.batchGet).toBe('function');
  });
});
