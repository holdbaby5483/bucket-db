import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { FileSystemAdapter } from '../../src/storage/fs-adapter';
import { StorageError } from '@bucket-db/types';
import { rmSync, existsSync } from 'fs';

describe('FileSystemAdapter', () => {
  let adapter: FileSystemAdapter;
  const testDir = '/tmp/bucket-db-test';

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    adapter = new FileSystemAdapter({ basePath: testDir });
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('put and get object', async () => {
    const data = { name: 'test', value: 123 };
    const { etag } = await adapter.put('key1', data);

    expect(etag).toBeDefined();

    const result = await adapter.get('key1');
    expect(result.data).toEqual(data);
    expect(result.etag).toBe(etag);
    expect(result.lastModified).toBeInstanceOf(Date);
  });

  test('get non-existent key throws error', async () => {
    await expect(adapter.get('missing')).rejects.toThrow(StorageError);
  });

  test('exists returns true for existing key', async () => {
    await adapter.put('key1', { test: true });
    expect(await adapter.exists('key1')).toBe(true);
  });

  test('exists returns false for non-existent key', async () => {
    expect(await adapter.exists('missing')).toBe(false);
  });

  test('delete removes object', async () => {
    await adapter.put('key1', { test: true });
    await adapter.delete('key1');
    expect(await adapter.exists('key1')).toBe(false);
  });

  test('put with ifMatch fails when etag does not match', async () => {
    await adapter.put('key1', { version: 1 });
    await expect(
      adapter.put('key1', { version: 2 }, { ifMatch: 'wrong-etag' })
    ).rejects.toThrow('PreconditionFailed');
  });

  test('put with ifMatch succeeds when etag matches', async () => {
    const { etag: etag1 } = await adapter.put('key1', { version: 1 });
    const { etag: etag2 } = await adapter.put('key1', { version: 2 }, { ifMatch: etag1 });

    expect(etag2).toBeDefined();
    expect(etag2).not.toBe(etag1);

    const result = await adapter.get('key1');
    expect(result.data).toEqual({ version: 2 });
  });

  test('listKeys returns keys with prefix', async () => {
    await adapter.put('users/1', { id: 1 });
    await adapter.put('users/2', { id: 2 });
    await adapter.put('posts/1', { id: 1 });

    const keys = await adapter.listKeys('users/');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('users/1');
    expect(keys).toContain('users/2');
  });

  test('batchGet returns multiple objects', async () => {
    await adapter.put('key1', { value: 1 });
    await adapter.put('key2', { value: 2 });
    await adapter.put('key3', { value: 3 });

    const results = await adapter.batchGet(['key1', 'key2', 'missing']);

    expect(results.size).toBe(2);
    expect(results.get('key1')?.data).toEqual({ value: 1 });
    expect(results.get('key2')?.data).toEqual({ value: 2 });
    expect(results.has('missing')).toBe(false);
  });

  test('handles nested paths', async () => {
    await adapter.put('db1/users/docs/123.json', { id: 123 });
    await adapter.put('db1/users/index/shard-00.json', { shardId: '00' });

    const exists1 = await adapter.exists('db1/users/docs/123.json');
    const exists2 = await adapter.exists('db1/users/index/shard-00.json');

    expect(exists1).toBe(true);
    expect(exists2).toBe(true);

    const keys = await adapter.listKeys('db1/users/');
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });
});
