import { createHash } from 'node:crypto';

interface StoredObject {
  body: string;
  etag: string;
  lastModified: Date;
}

export interface RecordedRequest {
  method: string;
  key: string;
  status: number;
}

export interface FakeS3 {
  url: string;
  bucket: string;
  /** Every request served, in arrival order. */
  requests: RecordedRequest[];
  /** Answer the next `count` requests with this method using `status`. */
  failNext(method: string, status: number, count?: number): void;
  stop(): void;
}

const errorCodes: Record<number, string> = {
  404: 'NoSuchKey',
  412: 'PreconditionFailed',
  500: 'InternalError',
  503: 'ServiceUnavailable',
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function errorResponse(status: number): Response {
  const code = errorCodes[status] ?? 'InternalError';
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message><RequestId>fake</RequestId></Error>`;
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}

function objectHeaders(object: StoredObject): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ETag: object.etag,
    'Last-Modified': object.lastModified.toUTCString(),
  };
}

/**
 * In-memory S3 endpoint speaking the HTTP protocol: path-style object
 * GET/HEAD/PUT/DELETE, conditional PUT (If-Match / If-None-Match) and
 * ListObjectsV2. Lets tests observe retries at the protocol level.
 */
export function startFakeS3(bucket = 'fake-bucket'): FakeS3 {
  const objects = new Map<string, StoredObject>();
  const requests: RecordedRequest[] = [];
  const faults: Array<{ method: string; status: number }> = [];

  function list(prefix: string): Response {
    const keys = [...objects.keys()].filter(key => key.startsWith(prefix)).sort();
    const contents = keys
      .map(key => {
        const object = objects.get(key)!;
        return `<Contents><Key>${escapeXml(key)}</Key><ETag>${escapeXml(object.etag)}</ETag><Size>${object.body.length}</Size><LastModified>${object.lastModified.toISOString()}</LastModified><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join('');
    const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
    return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
  }

  async function handle(request: Request, url: URL, key: string): Promise<Response> {
    const faultIndex = faults.findIndex(fault => fault.method === request.method);
    if (faultIndex !== -1) {
      const [fault] = faults.splice(faultIndex, 1);
      return errorResponse(fault.status);
    }

    if (request.method === 'GET' && key === '') {
      return list(url.searchParams.get('prefix') ?? '');
    }

    const existing = objects.get(key);
    switch (request.method) {
      case 'GET':
        return existing ? new Response(existing.body, { headers: objectHeaders(existing) }) : errorResponse(404);
      case 'HEAD':
        return existing ? new Response(null, { headers: objectHeaders(existing) }) : new Response(null, { status: 404 });
      case 'PUT': {
        const ifMatch = request.headers.get('if-match');
        const ifNoneMatch = request.headers.get('if-none-match');
        if (ifMatch !== null && !existing) return errorResponse(404);
        if (ifMatch !== null && ifMatch.replace(/"/g, '') !== existing!.etag.replace(/"/g, '')) return errorResponse(412);
        if (ifNoneMatch === '*' && existing) return errorResponse(412);
        const body = await request.text();
        const stored: StoredObject = {
          body,
          etag: `"${createHash('md5').update(body).digest('hex')}"`,
          lastModified: new Date(),
        };
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

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const [, , ...keyParts] = url.pathname.split('/');
      const key = decodeURIComponent(keyParts.join('/'));
      const response = await handle(request, url, key);
      requests.push({ method: request.method, key, status: response.status });
      return response;
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    bucket,
    requests,
    failNext(method, status, count = 1) {
      for (let i = 0; i < count; i++) faults.push({ method, status });
    },
    stop() {
      server.stop(true);
    },
  };
}
