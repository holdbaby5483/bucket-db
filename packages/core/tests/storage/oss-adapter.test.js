import { describe, test, expect, beforeEach } from 'bun:test';
import { OSSAdapter } from '../../src/storage/oss-adapter';
const skipIfNoCredentials = process.env.OSS_ACCESS_KEY_ID ? test : test.skip;
describe('OSSAdapter', () => {
    let adapter;
    beforeEach(() => {
        adapter = new OSSAdapter({
            bucket: process.env.TEST_OSS_BUCKET || 'test-bucket',
            region: process.env.OSS_REGION || 'oss-cn-hangzhou',
            credentials: {
                accessKeyId: process.env.OSS_ACCESS_KEY_ID || 'test',
                secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET || 'test',
            },
            endpoint: process.env.OSS_ENDPOINT,
        });
    });
    skipIfNoCredentials('put and get object', async () => {
        const data = { name: 'test', value: 123 };
        const { etag } = await adapter.put('test/key1.json', data);
        expect(etag).toBeDefined();
        const result = await adapter.get('test/key1.json');
        expect(result.data).toEqual(data);
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
//# sourceMappingURL=oss-adapter.test.js.map