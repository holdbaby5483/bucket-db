import { describe, test, expect, beforeEach } from 'bun:test';
import { S3Adapter } from '../../src/storage/s3-adapter';
// Skip tests if no AWS credentials available
const skipIfNoCredentials = process.env.AWS_ACCESS_KEY_ID ? test : test.skip;
describe('S3Adapter', () => {
    let adapter;
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
    });
    skipIfNoCredentials('put and get object', async () => {
        const data = { name: 'test', value: 123 };
        const { etag } = await adapter.put('test/key1.json', data);
        expect(etag).toBeDefined();
        const result = await adapter.get('test/key1.json');
        expect(result.data).toEqual(data);
        expect(result.etag).toBe(etag);
    });
    skipIfNoCredentials('exists returns true for existing key', async () => {
        await adapter.put('test/key1.json', { test: true });
        expect(await adapter.exists('test/key1.json')).toBe(true);
    });
    skipIfNoCredentials('delete removes object', async () => {
        await adapter.put('test/key1.json', { test: true });
        await adapter.delete('test/key1.json');
        expect(await adapter.exists('test/key1.json')).toBe(false);
    });
    skipIfNoCredentials('put with ifMatch optimistic locking', async () => {
        const { etag: etag1 } = await adapter.put('test/key1.json', { version: 1 });
        const { etag: etag2 } = await adapter.put('test/key1.json', { version: 2 }, { ifMatch: etag1 });
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
//# sourceMappingURL=s3-adapter.test.js.map