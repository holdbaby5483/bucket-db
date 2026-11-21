// Exercises the built package on Node (bun:test cannot run there): CRUD on
// memory, the filesystem and S3Adapter against an in-process HTTP stub.
// Run after `bun run build`: node scripts/node-smoke.mjs
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { BucketDB, MemoryStorageAdapter, FileSystemAdapter, S3Adapter, ConcurrentUpdateError } from '../dist/index.js';

async function crud(adapter, label) {
  const items = new BucketDB(adapter, 'smoke').collection('items');
  const a = await items.insert({ n: 1 });
  const b = await items.insert({ n: 2 });
  assert.deepEqual(
    (await items.find({ n: { $gte: 2 } })).map(doc => doc.id),
    [b.id]
  );
  const updated = await items.update(a.id, { n: 3 }, { etag: a._etag });
  assert.equal(updated.n, 3);
  await assert.rejects(items.update(a.id, { n: 4 }, { etag: a._etag }), ConcurrentUpdateError);
  await items.delete(b.id);
  assert.equal(await items.findById(b.id), null);
  assert.deepEqual(
    (await items.find({})).map(doc => doc.n),
    [3]
  );
  console.log(`${label}: ok`);
}

/** Path-style object PUT (If-None-Match / If-Match), GET, DELETE and ListObjectsV2. */
function startS3Stub() {
  const objects = new Map();
  let version = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://stub');
    const key = url.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const existing = objects.get(key);
    const send = (status, headers = {}, body) => {
      response.writeHead(status, headers);
      response.end(body);
    };
    const error = (status, code) =>
      send(status, { 'content-type': 'application/xml' }, `<Error><Code>${code}</Code></Error>`);

    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const contents = [...objects.keys()]
        .filter(name => name.startsWith(prefix))
        .sort()
        .map(
          name =>
            `<Contents><Key>${encodeURIComponent(name)}</Key><ETag>&quot;${objects.get(name).etag}&quot;</ETag></Contents>`
        )
        .join('');
      return send(
        200,
        { 'content-type': 'application/xml' },
        `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
      );
    }
    if (request.method === 'GET') {
      return existing ? send(200, { etag: `"${existing.etag}"` }, existing.body) : error(404, 'NoSuchKey');
    }
    if (request.method === 'DELETE') {
      objects.delete(key);
      return send(204);
    }
    if (request.method === 'PUT') {
      const ifMatch = request.headers['if-match'];
      if (request.headers['if-none-match'] === '*' && existing) return error(412, 'PreconditionFailed');
      if (ifMatch !== undefined && !existing) return error(404, 'NoSuchKey');
      if (ifMatch !== undefined && ifMatch.replace(/"/g, '') !== existing.etag) return error(412, 'PreconditionFailed');
      const etag = `v${++version}`;
      objects.set(key, { body: Buffer.concat(chunks), etag });
      return send(200, { etag: `"${etag}"` });
    }
    error(405, 'MethodNotAllowed');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

await crud(new MemoryStorageAdapter(), 'memory');

const basePath = await mkdtemp(join(tmpdir(), 'bucketdb-node-smoke-'));
try {
  await crud(new FileSystemAdapter({ basePath }), 'filesystem');
} finally {
  await rm(basePath, { recursive: true, force: true });
}

const server = await startS3Stub();
try {
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  await crud(new S3Adapter({ bucket: 'smoke', region: 'us-east-1', endpoint, credentials }), 's3 (stub)');
} finally {
  server.closeAllConnections();
  server.close();
}
