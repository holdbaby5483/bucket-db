import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { StorageError, UnsupportedError, ValidationError } from '../../src/errors.js';
import { OSSAdapter, S3Adapter, type Credentials, type S3AdapterOptions } from '../../src/storage/s3/adapters.js';
import { EMPTY_SHA256, signRequest } from '../../src/storage/s3/sigv4.js';
import { startFakeS3, type FakeS3 } from '../support/fake-s3';

const TIMEOUT_MS = 150;
const credentials: Credentials = { accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' };
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const md5 = (text: string) => createHash('md5').update(text).digest('hex');

async function rejection(promise: Promise<unknown>): Promise<StorageError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(StorageError);
    return error as StorageError;
  }
  throw new Error('expected a rejection');
}

/** Sets (or, for undefined, removes) environment variables while `fn` runs. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(vars).map(name => [name, process.env[name]]));
  const assign = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  assign(vars);
  try {
    await fn();
  } finally {
    assign(saved);
  }
}

let s3: FakeS3;
const aws = (options: Partial<S3AdapterOptions> = {}) =>
  new S3Adapter({
    bucket: s3.bucket,
    region: 'us-east-1',
    endpoint: s3.url,
    credentials,
    timeoutMs: TIMEOUT_MS,
    ...options,
  });
const count = (method: string) => s3.requests.filter(request => request.method === method).length;

describe('SigV4', () => {
  test('C9: matches the AWS "GET Object" example', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      region: 'us-east-1',
      date: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers).toEqual({
      'x-amz-date': '20130524T000000Z',
      'x-amz-content-sha256': EMPTY_SHA256,
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    });
  });
});

describe('S3Client over fake S3 (aws dialect)', () => {
  beforeEach(() => {
    s3 = startFakeS3();
  });
  afterEach(() => {
    s3.stop();
  });

  test('accepts the 0.3 constructor shape and round-trips bytes with unquoted etags', async () => {
    const adapter = new S3Adapter({
      bucket: s3.bucket,
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      endpoint: s3.url,
    });
    expect(adapter.capabilities).toEqual({ createIfAbsent: 'atomic', compareAndSwap: 'atomic' });

    const { etag } = await adapter.put('a/b.json', bytes('{"n":1}'));
    expect(etag).toBe(md5('{"n":1}'));
    const got = await adapter.get('a/b.json');
    expect(new TextDecoder().decode(got.body)).toBe('{"n":1}');
    expect(got.etag).toBe(etag);

    const put = s3.requests[0];
    expect(put.headers['x-amz-content-sha256']).toBe(createHash('sha256').update('{"n":1}').digest('hex'));
    expect(put.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );
    expect(put.headers['x-amz-security-token']).toBeUndefined();

    await adapter.delete('a/b.json');
    const missing = await rejection(adapter.get('a/b.json'));
    expect(missing.kind).toBe('not-found');
    expect(missing.key).toBe('a/b.json');
    expect(missing.status).toBe(404);
    await adapter.delete('a/b.json');
  });

  test('encodes key segments per RFC 3986 and lists them back decoded', async () => {
    const adapter = aws();
    const key = "docs/a b+c&d<e>!'()*%~ü.json";
    await adapter.put(key, bytes('x'));
    expect(s3.requests[0].key).toBe(key);
    expect((await adapter.get(key)).body).toEqual(bytes('x'));
    expect((await adapter.list('docs/')).entries.map(entry => entry.key)).toEqual([key]);
  });

  test('C1: retries 503, 500 and 429 and succeeds within 3 attempts', async () => {
    const adapter = aws();
    for (const status of [503, 500, 429]) {
      s3.requests.length = 0;
      s3.failNext('PUT', status);
      await adapter.put(`k-${status}`, bytes('v'));
      expect(s3.requests.map(request => request.status)).toEqual([status, 200]);
    }

    s3.requests.length = 0;
    s3.failNext('GET', 503);
    s3.failNext('GET', 429);
    expect((await adapter.get('k-503')).body).toEqual(bytes('v'));
    expect(s3.requests.map(request => request.status)).toEqual([503, 429, 200]);
  });

  test('C1: retries the SlowDown and RequestTimeout error codes', async () => {
    const adapter = aws();
    s3.failNext('PUT', 400, 1, 'RequestTimeout');
    s3.failNext('PUT', 400, 1, 'SlowDown');
    await adapter.put('k', bytes('v'));
    expect(s3.requests.map(request => request.status)).toEqual([400, 400, 200]);
  });

  test('C2: exhausted retries throw transient with the last status', async () => {
    const adapter = aws();
    s3.failNext('GET', 503, 2);
    s3.failNext('GET', 500);
    s3.failNext('GET', 503);
    const error = await rejection(adapter.get('k'));
    expect(error.kind).toBe('transient');
    expect(error.status).toBe(500);
    expect(error.key).toBe('k');
    expect(count('GET')).toBe(3);
  });

  test('C3: an attempt slower than timeoutMs is aborted and retried; exhausted → transient', async () => {
    const adapter = aws();
    await adapter.put('k', bytes('v'));
    s3.delayNext('GET', TIMEOUT_MS * 3);
    expect((await adapter.get('k')).body).toEqual(bytes('v'));
    expect(count('GET')).toBe(2);

    s3.delayNext('GET', TIMEOUT_MS * 3, 3);
    const error = await rejection(adapter.get('k'));
    expect(error.kind).toBe('transient');
    expect(error.status).toBeUndefined();
    expect((error.cause as Error).name).toBe('TimeoutError');
    expect(count('GET')).toBe(5);
  });

  test('C4: a reset connection is retried; exhausted → transient', async () => {
    const adapter = aws();
    s3.resetNext('PUT');
    await adapter.put('k', bytes('v'));
    expect(s3.requests.map(request => request.status)).toEqual([0, 200]);

    s3.resetNext('GET', 3);
    const error = await rejection(adapter.get('k'));
    expect(error.kind).toBe('transient');
    expect(count('GET')).toBe(3);
  });

  test('C5: 403 is not retried and is permanent', async () => {
    const adapter = aws();
    s3.failNext('PUT', 403);
    const error = await rejection(adapter.put('k', bytes('v')));
    expect(error.kind).toBe('permanent');
    expect(error.status).toBe(403);
    expect(error.key).toBe('k');
    expect(error.message).toContain('AccessDenied');
    expect(s3.requests).toHaveLength(1);

    s3.failNext('GET', 403);
    expect((await rejection(adapter.list('p/'))).kind).toBe('permanent');
    expect(s3.requests).toHaveLength(2);
  });

  test('conditional writes: conflicts, not-found, and no retry on conflict', async () => {
    const adapter = aws();
    const { etag } = await adapter.put('k', bytes('one'), { ifNoneMatch: '*' });
    expect(s3.requests[0].headers['if-none-match']).toBe('*');

    const exists = await rejection(adapter.put('k', bytes('one'), { ifNoneMatch: '*' }));
    expect(exists.kind).toBe('conflict');
    expect(exists.status).toBe(412);
    expect(exists.key).toBe('k');

    const next = await adapter.put('k', bytes('two'), { ifMatch: etag });
    expect(s3.requests.at(-1)!.headers['if-match']).toBe(`"${etag}"`);
    const stale = await rejection(adapter.put('k', bytes('three'), { ifMatch: etag }));
    expect(stale.kind).toBe('conflict');
    expect(s3.getObject('k')!.etag).toBe(next.etag);

    s3.failNext('PUT', 409, 1, 'ConditionalRequestConflict');
    expect((await rejection(adapter.put('k', bytes('four'), { ifMatch: next.etag }))).kind).toBe('conflict');

    expect((await rejection(adapter.put('missing', bytes('x'), { ifMatch: etag }))).kind).toBe('not-found');
    // A conflict without an earlier transient failure is reported without reading back.
    expect(count('GET')).toBe(0);
    expect(count('PUT')).toBe(6);
  });

  test('C6: ifNoneMatch whose first attempt was applied but its response lost reports success', async () => {
    const adapter = aws();
    s3.loseResponseNext('PUT', TIMEOUT_MS * 3);
    const { etag } = await adapter.put('k', bytes('mine'), { ifNoneMatch: '*' });
    expect(etag).toBe(md5('mine'));
    expect(s3.requests.map(request => `${request.method} ${request.status}`)).toEqual([
      'PUT 200',
      'PUT 412',
      'GET 200',
    ]);
  });

  test('C6: ifMatch whose first attempt was applied but its response lost reports success', async () => {
    const adapter = aws();
    const first = await adapter.put('k', bytes('v1'));
    s3.loseResponseNext('PUT', TIMEOUT_MS * 3);
    const { etag } = await adapter.put('k', bytes('v2'), { ifMatch: first.etag });
    expect(etag).toBe(md5('v2'));
    expect(s3.requests.map(request => `${request.method} ${request.status}`)).toEqual([
      'PUT 200',
      'PUT 200',
      'PUT 412',
      'GET 200',
    ]);
  });

  test('C7: another writer between attempts → the conflict is reported (ifNoneMatch and ifMatch)', async () => {
    const adapter = aws();
    s3.loseResponseNext('PUT', TIMEOUT_MS * 3, () => s3.setObject('a', 'theirs'));
    const created = await rejection(adapter.put('a', bytes('mine'), { ifNoneMatch: '*' }));
    expect(created.kind).toBe('conflict');
    expect(created.status).toBe(412);

    const first = await adapter.put('b', bytes('v1'));
    s3.loseResponseNext('PUT', TIMEOUT_MS * 3, () => s3.setObject('b', 'theirs'));
    expect((await rejection(adapter.put('b', bytes('v2'), { ifMatch: first.etag }))).kind).toBe('conflict');
    expect(new TextDecoder().decode(s3.getObject('b')!.body)).toBe('theirs');
  });

  test('C7: after a transient failure, a conflict with different stored bytes is reported', async () => {
    const adapter = aws();
    s3.setObject('k', 'theirs');
    s3.failNext('PUT', 503);
    const error = await rejection(adapter.put('k', bytes('mine'), { ifNoneMatch: '*' }));
    expect(error.kind).toBe('conflict');
    expect(s3.requests.map(request => `${request.method} ${request.status}`)).toEqual([
      'PUT 503',
      'PUT 412',
      'GET 200',
    ]);
  });

  test('delete is idempotent: 204 and 404 both succeed', async () => {
    const adapter = aws();
    await adapter.delete('never-existed');
    s3.failNext('DELETE', 404);
    await adapter.delete('never-existed');
    expect(s3.requests.map(request => request.status)).toEqual([204, 404]);
  });

  test('list paginates 25 keys with limit 10', async () => {
    const adapter = aws();
    const keys = Array.from({ length: 25 }, (_, i) => `p/k${String(i).padStart(2, '0')}`);
    for (const key of keys) s3.setObject(key, key);

    const pages = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.list('p/', { cursor, limit: 10 });
      pages.push(page.entries);
      cursor = page.cursor;
    } while (cursor);

    expect(pages.map(page => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(keys.map(key => ({ key, etag: md5(key) })));
    expect(s3.requests[0].query).toEqual({ 'list-type': '2', prefix: 'p/', 'max-keys': '10', 'encoding-type': 'url' });
    expect(s3.requests[1].query['continuation-token']).toBeDefined();
  });

  test('list respects the prefix boundary and reports the same etag as get', async () => {
    const adapter = aws();
    await adapter.put('docs/a.json', bytes('a'));
    await adapter.put('docs2/b.json', bytes('b'));
    const page = await adapter.list('docs/');
    expect(page).toEqual({ entries: [{ key: 'docs/a.json', etag: (await adapter.get('docs/a.json')).etag }] });
  });

  test('list clamps limit to 1000 and rejects invalid limits without a request', async () => {
    const adapter = aws();
    await adapter.list('', { limit: 5000 });
    expect(s3.requests[0].query['max-keys']).toBe('1000');
    await expect(adapter.list('', { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    expect(s3.requests).toHaveLength(1);
  });
});

describe('S3Client over fake S3 (oss dialect)', () => {
  const oss = () =>
    new OSSAdapter({
      bucket: s3.bucket,
      region: 'oss-cn-hangzhou',
      endpoint: s3.url,
      credentials,
      timeoutMs: TIMEOUT_MS,
    });

  beforeEach(() => {
    s3 = startFakeS3('fake-oss', { dialect: 'oss' });
  });
  afterEach(() => {
    s3.stop();
  });

  test('create-if-absent uses x-oss-forbid-overwrite; 409 FileAlreadyExists is a conflict', async () => {
    const adapter = oss();
    expect(adapter.capabilities).toEqual({ createIfAbsent: 'atomic', compareAndSwap: 'none' });
    await adapter.put('k', bytes('one'), { ifNoneMatch: '*' });
    expect(s3.requests[0].headers['x-oss-forbid-overwrite']).toBe('true');
    expect(s3.requests[0].headers['if-none-match']).toBeUndefined();
    expect(s3.requests[0].headers.authorization).toContain('/cn-hangzhou/s3/aws4_request');

    const error = await rejection(adapter.put('k', bytes('two'), { ifNoneMatch: '*' }));
    expect(error.kind).toBe('conflict');
    expect(error.status).toBe(409);
  });

  test('C6 on OSS: lost response then FileAlreadyExists with identical bytes reports success', async () => {
    const adapter = oss();
    s3.loseResponseNext('PUT', TIMEOUT_MS * 3);
    expect((await adapter.put('k', bytes('mine'), { ifNoneMatch: '*' })).etag).toBe(md5('mine'));
    expect(s3.requests.map(request => `${request.method} ${request.status}`)).toEqual([
      'PUT 200',
      'PUT 409',
      'GET 200',
    ]);
  });

  test('ifMatch throws UnsupportedError without sending a request', async () => {
    const adapter = oss();
    await expect(adapter.put('k', bytes('v'), { ifMatch: 'abc' })).rejects.toBeInstanceOf(UnsupportedError);
    expect(s3.requests).toHaveLength(0);
  });
});

describe('C8: credentials and configuration', () => {
  beforeEach(() => {
    s3 = startFakeS3();
  });
  afterEach(() => {
    s3.stop();
  });

  test('reads region, endpoint and credentials (with session token) from the AWS environment', () =>
    withEnv(
      {
        AWS_REGION: undefined,
        AWS_DEFAULT_REGION: 'eu-west-1',
        AWS_ENDPOINT_URL_S3: s3.url,
        AWS_ACCESS_KEY_ID: 'ENVKEY',
        AWS_SECRET_ACCESS_KEY: 'envsecret',
        AWS_SESSION_TOKEN: 'envtoken',
      },
      async () => {
        await new S3Adapter({ bucket: s3.bucket }).put('k', bytes('v'));
        const { headers } = s3.requests[0];
        expect(headers.authorization).toContain('Credential=ENVKEY/');
        expect(headers.authorization).toContain('/eu-west-1/s3/aws4_request');
        expect(headers.authorization).toContain('x-amz-security-token');
        expect(headers['x-amz-security-token']).toBe('envtoken');
      }
    ));

  test('reads OSS region (oss- prefix stripped) and credentials from the OSS environment', () =>
    withEnv(
      {
        OSS_REGION: 'oss-cn-shanghai',
        OSS_ACCESS_KEY_ID: 'OSSKEY',
        OSS_ACCESS_KEY_SECRET: 's',
        OSS_SESSION_TOKEN: undefined,
      },
      async () => {
        await new OSSAdapter({ bucket: s3.bucket, endpoint: s3.url }).get('k').catch(() => undefined);
        const { headers } = s3.requests[0];
        expect(headers.authorization).toContain('Credential=OSSKEY/');
        expect(headers.authorization).toContain('/cn-shanghai/s3/aws4_request');
        expect(headers['x-amz-security-token']).toBeUndefined();
      }
    ));

  test('missing region throws ValidationError at construction; missing credentials at first request', () =>
    withEnv(
      {
        AWS_REGION: undefined,
        AWS_DEFAULT_REGION: undefined,
        AWS_ACCESS_KEY_ID: undefined,
        AWS_SECRET_ACCESS_KEY: undefined,
        OSS_REGION: undefined,
      },
      async () => {
        expect(() => new S3Adapter({ bucket: 'b' })).toThrow(ValidationError);
        expect(() => new OSSAdapter({ bucket: 'b' })).toThrow(ValidationError);
        expect(() => new S3Adapter({ bucket: '', region: 'us-east-1' })).toThrow(ValidationError);
        const adapter = new S3Adapter({ bucket: s3.bucket, region: 'us-east-1', endpoint: s3.url });
        await expect(adapter.get('k')).rejects.toBeInstanceOf(ValidationError);
        expect(s3.requests).toHaveLength(0);
      }
    ));

  test('a provider is called again once within 5 minutes of expiresAt, and its token is sent', async () => {
    let calls = 0;
    const adapter = aws({
      credentials: async () => {
        calls++;
        return { ...credentials, sessionToken: `token-${calls}`, expiresAt: new Date(Date.now() + 4 * 60 * 1000) };
      },
    });
    await adapter.delete('a');
    await adapter.delete('b');
    expect(calls).toBe(2);
    expect(s3.requests.map(request => request.headers['x-amz-security-token'])).toEqual(['token-1', 'token-2']);
  });

  test('a provider result is cached until 5 minutes before expiresAt (forever without it), shared by concurrent requests', async () => {
    for (const expiresAt of [new Date(Date.now() + 60 * 60 * 1000), undefined]) {
      let calls = 0;
      const adapter = aws({
        credentials: async () => {
          calls++;
          return { ...credentials, expiresAt };
        },
      });
      await Promise.all([adapter.delete('a'), adapter.delete('b'), adapter.delete('c')]);
      await adapter.delete('d');
      expect(calls).toBe(1);
    }
  });

  test('a failing provider surfaces as a permanent StorageError and is retried on the next request', async () => {
    let calls = 0;
    const adapter = aws({
      credentials: async () => {
        if (++calls === 1) throw new Error('metadata service down');
        return credentials;
      },
    });
    const error = await rejection(adapter.delete('k'));
    expect(error.kind).toBe('permanent');
    expect(error.key).toBe('k');
    await adapter.delete('k');
    expect(calls).toBe(2);
  });
});
