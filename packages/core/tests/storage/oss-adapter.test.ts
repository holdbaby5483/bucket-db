import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { OSSAdapter } from '../../src/storage/oss-adapter';

const skipIfNoCredentials = process.env.OSS_ACCESS_KEY_ID ? test : test.skip;

describe('OSSAdapter', () => {
  let adapter: OSSAdapter;
  const testKeys: string[] = [];

  beforeEach(() => {
    adapter = new OSSAdapter({
      bucket: process.env.OSS_BUCKET || process.env.TEST_OSS_BUCKET || 'test-bucket',
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      credentials: {
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || 'test',
        secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET || 'test',
      },
      endpoint: process.env.OSS_ENDPOINT,
    });
    testKeys.length = 0;
  });

  afterEach(async () => {
    for (const key of testKeys) {
      try { await adapter.delete(key); } catch {}
    }
  });

  function testKey(name: string): string {
    const key = `test/oss-adapter/${name}-${Date.now()}.json`;
    testKeys.push(key);
    return key;
  }

  test('adapter structure is correct', () => {
    expect(adapter).toBeDefined();
    expect(typeof adapter.get).toBe('function');
    expect(typeof adapter.put).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.exists).toBe('function');
    expect(typeof adapter.listKeys).toBe('function');
    expect(typeof adapter.batchGet).toBe('function');
  });

  skipIfNoCredentials('put and get object', async () => {
    const key = testKey('put-get');
    const data = { name: 'test', value: 123 };
    const { etag } = await adapter.put(key, data);

    expect(etag).toBeDefined();

    const result = await adapter.get(key);
    expect(result.data).toEqual(data);
  });

  skipIfNoCredentials('put without conditional headers succeeds', async () => {
    const key = testKey('put-simple');
    const { etag } = await adapter.put(key, { hello: 'world' });

    expect(etag).toBeDefined();
    expect(typeof etag).toBe('string');
    expect(etag.length).toBeGreaterThan(0);
  });

  skipIfNoCredentials('put with ifMatch succeeds when etag matches', async () => {
    const key = testKey('ifmatch-ok');
    const { etag: etag1 } = await adapter.put(key, { version: 1 });

    const { etag: etag2 } = await adapter.put(key, { version: 2 }, { ifMatch: etag1 });
    expect(etag2).toBeDefined();
    expect(etag2).not.toBe(etag1);

    const result = await adapter.get(key);
    expect(result.data).toEqual({ version: 2 });
  });

  skipIfNoCredentials('put with ifMatch fails when etag does not match', async () => {
    const key = testKey('ifmatch-fail');
    await adapter.put(key, { version: 1 });

    await expect(
      adapter.put(key, { version: 2 }, { ifMatch: 'wrong-etag' })
    ).rejects.toThrow('PreconditionFailed');
  });

  skipIfNoCredentials('put with ifMatch fails when object does not exist', async () => {
    const key = testKey('ifmatch-noexist');

    await expect(
      adapter.put(key, { version: 1 }, { ifMatch: 'any-etag' })
    ).rejects.toThrow('PreconditionFailed');
  });

  skipIfNoCredentials('put with ifNoneMatch fails when object exists', async () => {
    const key = testKey('ifnonematch-fail');
    await adapter.put(key, { version: 1 });

    await expect(
      adapter.put(key, { version: 2 }, { ifNoneMatch: '*' })
    ).rejects.toThrow('PreconditionFailed');
  });

  skipIfNoCredentials('put with ifNoneMatch succeeds when object does not exist', async () => {
    const key = testKey('ifnonematch-ok');

    const { etag } = await adapter.put(key, { version: 1 }, { ifNoneMatch: '*' });
    expect(etag).toBeDefined();
  });

  skipIfNoCredentials('exists returns true for existing object', async () => {
    const key = testKey('exists-true');
    await adapter.put(key, { data: 1 });

    expect(await adapter.exists(key)).toBe(true);
  });

  skipIfNoCredentials('exists returns false for non-existing object', async () => {
    expect(await adapter.exists('test/oss-adapter/nonexistent-key.json')).toBe(false);
  });

  skipIfNoCredentials('delete removes object', async () => {
    const key = testKey('delete');
    await adapter.put(key, { data: 1 });
    expect(await adapter.exists(key)).toBe(true);

    await adapter.delete(key);
    // Remove from cleanup list since already deleted
    testKeys.pop();
    expect(await adapter.exists(key)).toBe(false);
  });

  skipIfNoCredentials('get throws for non-existing object', async () => {
    await expect(
      adapter.get('test/oss-adapter/nonexistent-key.json')
    ).rejects.toThrow();
  });

  skipIfNoCredentials('listKeys returns matching keys', async () => {
    const prefix = `test/oss-adapter/list-${Date.now()}`;
    const key1 = `${prefix}/a.json`;
    const key2 = `${prefix}/b.json`;
    testKeys.push(key1, key2);

    await adapter.put(key1, { a: 1 });
    await adapter.put(key2, { b: 2 });

    const keys = await adapter.listKeys(prefix);
    expect(keys).toContain(key1);
    expect(keys).toContain(key2);
  });

  skipIfNoCredentials('batchGet returns multiple objects', async () => {
    const key1 = testKey('batch-1');
    const key2 = testKey('batch-2');

    await adapter.put(key1, { a: 1 });
    await adapter.put(key2, { b: 2 });

    const results = await adapter.batchGet([key1, key2]);
    expect(results.size).toBe(2);
    expect(results.get(key1)?.data).toEqual({ a: 1 });
    expect(results.get(key2)?.data).toEqual({ b: 2 });
  });
});
