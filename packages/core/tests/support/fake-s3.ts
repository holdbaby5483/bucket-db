import { createHash } from 'node:crypto';

interface StoredObject {
  body: Uint8Array;
  etag: string;
  lastModified: Date;
}

export interface RecordedRequest {
  method: string;
  key: string;
  /** Status of the response; 0 when the connection was reset instead. */
  status: number;
  /** Request headers, names lowercased. */
  headers: Record<string, string>;
  /** Query parameters, decoded. */
  query: Record<string, string>;
}

export interface FakeS3Options {
  /**
   * `aws` (default): If-None-Match / If-Match, conflicts are 412.
   * `oss`: additionally `x-oss-forbid-overwrite: true` → 409 FileAlreadyExists,
   * and If-Match → 400 NotImplemented, like OSS's S3-compatible endpoint.
   */
  dialect?: 'aws' | 'oss';
}

export interface FakeS3 {
  url: string;
  bucket: string;
  /** Every request served, in arrival order. */
  requests: RecordedRequest[];
  /** Answer the next `count` requests with this method using `status` (and error `code`). */
  failNext(method: string, status: number, count?: number, code?: string): void;
  /** Hold the next `count` requests with this method for `ms`, then answer 504 without applying them. */
  delayNext(method: string, ms: number, count?: number): void;
  /**
   * Apply the next request with this method, then hold its response for `ms`:
   * the write happened but the client never learns it. `afterApply` runs right
   * after the request is applied (e.g. to let another writer in).
   */
  loseResponseNext(method: string, ms: number, afterApply?: () => void): void;
  /** Drop the connection of the next `count` requests with this method without a response. */
  resetNext(method: string, count?: number): void;
  /** Direct access to the store, bypassing HTTP (another writer, assertions). */
  setObject(key: string, body: Uint8Array | string): void;
  getObject(key: string): { body: Uint8Array; etag: string } | undefined;
  stop(): void;
}

type Fault =
  | { method: string; type: 'fail'; status: number; code?: string }
  | { method: string; type: 'delay'; ms: number }
  | { method: string; type: 'lose'; ms: number; afterApply?: () => void }
  | { method: string; type: 'reset' };

const errorCodes: Record<number, string> = {
  400: 'InvalidRequest',
  403: 'AccessDenied',
  404: 'NoSuchKey',
  409: 'OperationAborted',
  412: 'PreconditionFailed',
  429: 'TooManyRequests',
  500: 'InternalError',
  502: 'BadGateway',
  503: 'ServiceUnavailable',
  504: 'GatewayTimeout',
};

const encoder = new TextEncoder();

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function errorResponse(status: number, code = errorCodes[status] ?? 'InternalError'): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code} &amp; more</Message><RequestId>fake</RequestId></Error>`;
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}

function objectHeaders(object: StoredObject): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ETag: object.etag,
    'Last-Modified': object.lastModified.toUTCString(),
  };
}

function store(body: Uint8Array): StoredObject {
  return { body, etag: `"${createHash('md5').update(body).digest('hex')}"`, lastModified: new Date() };
}

/** `encoding-type=url` as S3 does it: form encoding, `/` kept. */
function urlEncodeKey(key: string): string {
  return encodeURIComponent(key).replace(/%2F/g, '/').replace(/%20/g, '+');
}

/**
 * In-memory S3 endpoint speaking the HTTP protocol: path-style object
 * GET/HEAD/PUT/DELETE, conditional PUT (If-Match / If-None-Match, OSS's
 * x-oss-forbid-overwrite) and paginated ListObjectsV2. Lets tests observe
 * retries at the protocol level and inject faults.
 */
export function startFakeS3(bucket = 'fake-bucket', options: FakeS3Options = {}): FakeS3 {
  const dialect = options.dialect ?? 'aws';
  const objects = new Map<string, StoredObject>();
  const requests: RecordedRequest[] = [];
  const faults: Fault[] = [];

  function list(params: URLSearchParams): Response {
    const prefix = params.get('prefix') ?? '';
    const maxKeys = Math.min(Number(params.get('max-keys') ?? 1000), 1000);
    const token = params.get('continuation-token');
    const after = token === null ? undefined : Buffer.from(token, 'base64url').toString();
    const urlEncoded = params.get('encoding-type') === 'url';
    const keys = [...objects.keys()]
      .filter(key => key.startsWith(prefix) && (after === undefined || key > after))
      .sort();
    const page = keys.slice(0, maxKeys);
    const truncated = keys.length > page.length;
    const contents = page
      .map(key => {
        const object = objects.get(key)!;
        const name = urlEncoded ? urlEncodeKey(key) : key;
        return `<Contents><Key>${escapeXml(name)}</Key><ETag>${escapeXml(object.etag)}</ETag><Size>${object.body.length}</Size><LastModified>${object.lastModified.toISOString()}</LastModified><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join('');
    const next = truncated
      ? `<NextContinuationToken>${Buffer.from(page[page.length - 1]).toString('base64url')}</NextContinuationToken>`
      : '';
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
      `<Name>${bucket}</Name><Prefix>${escapeXml(urlEncoded ? urlEncodeKey(prefix) : prefix)}</Prefix>` +
      `<KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>` +
      (urlEncoded ? '<EncodingType>url</EncodingType>' : '') +
      `<IsTruncated>${truncated}</IsTruncated>${next}${contents}</ListBucketResult>`;
    return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
  }

  async function apply(request: Request, url: URL, key: string): Promise<Response> {
    if (request.method === 'GET' && key === '') return list(url.searchParams);

    const existing = objects.get(key);
    switch (request.method) {
      case 'GET':
        return existing ? new Response(existing.body, { headers: objectHeaders(existing) }) : errorResponse(404);
      case 'HEAD':
        return existing ? new Response(null, { headers: objectHeaders(existing) }) : new Response(null, { status: 404 });
      case 'PUT': {
        const ifMatch = request.headers.get('if-match');
        const ifNoneMatch = request.headers.get('if-none-match');
        if (dialect === 'oss' && ifMatch !== null) return errorResponse(400, 'NotImplemented');
        if (dialect === 'oss' && request.headers.get('x-oss-forbid-overwrite') === 'true' && existing) {
          return errorResponse(409, 'FileAlreadyExists');
        }
        if (ifMatch !== null && !existing) return errorResponse(404);
        if (ifMatch !== null && ifMatch.replace(/"/g, '') !== existing!.etag.replace(/"/g, '')) return errorResponse(412);
        if (ifNoneMatch === '*' && existing) return errorResponse(412);
        const stored = store(new Uint8Array(await request.arrayBuffer()));
        objects.set(key, stored);
        return new Response(null, { headers: { ETag: stored.etag } });
      }
      case 'DELETE':
        objects.delete(key);
        return new Response(null, { status: 204 });
      default:
        return errorResponse(500);
    }
  }

  async function serve(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [, , ...keyParts] = url.pathname.split('/');
    const key = decodeURIComponent(keyParts.join('/'));
    const record = (status: number) =>
      requests.push({
        method: request.method,
        key,
        status,
        headers: Object.fromEntries(request.headers),
        query: Object.fromEntries(url.searchParams),
      });

    const faultIndex = faults.findIndex(fault => fault.method === request.method);
    const fault = faultIndex === -1 ? undefined : faults.splice(faultIndex, 1)[0];
    switch (fault?.type) {
      case 'fail': {
        const response = errorResponse(fault.status, fault.code);
        record(response.status);
        return response;
      }
      case 'delay':
        record(504);
        await Bun.sleep(fault.ms);
        return errorResponse(504);
      case 'reset':
        record(0);
        // Erroring the body stream makes Bun drop the connection before any response bytes.
        return new Response(new ReadableStream({ pull: controller => controller.error() }));
      case 'lose': {
        const response = await apply(request, url, key);
        record(response.status);
        fault.afterApply?.();
        await Bun.sleep(fault.ms);
        return response;
      }
    }
    const response = await apply(request, url, key);
    record(response.status);
    return response;
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const response = await serve(request);
      // One connection per request: Bun's fetch silently resends a GET once when a
      // reused keep-alive connection drops, which would hide resets from the client.
      response.headers.set('Connection', 'close');
      return response;
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    bucket,
    requests,
    failNext(method, status, count = 1, code) {
      for (let i = 0; i < count; i++) faults.push({ method, type: 'fail', status, code });
    },
    delayNext(method, ms, count = 1) {
      for (let i = 0; i < count; i++) faults.push({ method, type: 'delay', ms });
    },
    loseResponseNext(method, ms, afterApply) {
      faults.push({ method, type: 'lose', ms, afterApply });
    },
    resetNext(method, count = 1) {
      for (let i = 0; i < count; i++) faults.push({ method, type: 'reset' });
    },
    setObject(key, body) {
      objects.set(key, store(typeof body === 'string' ? encoder.encode(body) : body));
    },
    getObject(key) {
      const object = objects.get(key);
      return object && { body: object.body, etag: object.etag.replace(/"/g, '') };
    },
    stop() {
      server.stop(true);
    },
  };
}
