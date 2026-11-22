import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BucketDB, MemoryStorageAdapter } from '../../src/index.js';
import type { Document, StorageAdapter } from '../../src/index.js';
import { startUi, type UiServer } from '../../src/ui/server.js';
import { FaultyAdapter } from '../support/faulty-adapter';

interface Run extends Document {
  ms: number;
  ok: boolean;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** node:http rather than fetch, so the Host and Origin headers can be forged. */
function get(ui: UiServer, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port: ui.port, path, method, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Exchanges the launch token for the session cookie, as the browser does on first visit. */
async function signIn(ui: UiServer): Promise<Record<string, string>> {
  const reply = await get(ui, new URL(ui.url).pathname + new URL(ui.url).search);
  const cookie = String(reply.headers['set-cookie']).split(';')[0];
  return { cookie };
}

async function json<T>(ui: UiServer, path: string, headers: Record<string, string>): Promise<T> {
  return JSON.parse((await get(ui, path, headers)).body) as T;
}

interface Collections {
  collections: Array<{ name: string; count: number }>;
  scanning: boolean;
  truncated: boolean;
}

/** `wait=1` makes the server reply when the running scan has paused or finished. */
function collections(ui: UiServer, headers: Record<string, string>, query = ''): Promise<Collections> {
  return json<Collections>(ui, `/api/collections?wait=1${query}`, headers);
}

interface Found {
  total: number;
  page: number;
  pageSize: number;
  documents: Array<Run & { _etag: string }>;
  error?: string;
}

const findPath = (params: Record<string, string>) => `/api/find?${new URLSearchParams(params)}`;

describe('query UI server', () => {
  let ui: UiServer | undefined;
  afterEach(async () => {
    await ui?.close();
    ui = undefined;
  });

  async function start(adapter: StorageAdapter, dbPath = 'app') {
    ui = await startUi(adapter, dbPath, { label: 'memory://app', port: 0 });
    return { ui, headers: await signIn(ui) };
  }

  test('the launch token becomes a session cookie, and nothing is served without it', async () => {
    ui = await startUi(new MemoryStorageAdapter(), 'app', { label: 'memory://app', port: 0 });
    expect(new URL(ui.url).hostname).toBe('127.0.0.1');

    expect((await get(ui, '/')).status).toBe(403);
    expect((await get(ui, '/api/find?collection=runs')).status).toBe(403);
    expect((await get(ui, '/?token=wrong')).status).toBe(403);
    expect((await get(ui, '/api/find?collection=runs', { cookie: 'bucketdb_ui=wrong' })).status).toBe(403);

    const exchange = await get(ui, new URL(ui.url).pathname + new URL(ui.url).search);
    expect(exchange.status).toBe(302);
    expect(exchange.headers.location).toBe('/');
    const cookie = String(exchange.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const page = await get(ui, '/', { cookie: cookie.split(';')[0] });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(String(page.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(page.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('a foreign Host or Origin, or a method other than GET, is refused even with the cookie', async () => {
    const { ui, headers } = await start(new MemoryStorageAdapter());
    const path = '/api/find?collection=runs';
    expect((await get(ui, path, headers)).status).toBe(200);
    expect((await get(ui, path, { ...headers, host: `localhost:${ui.port}` })).status).toBe(200);
    expect((await get(ui, path, { ...headers, origin: `http://127.0.0.1:${ui.port}` })).status).toBe(200);

    expect((await get(ui, path, { ...headers, host: `attacker.example:${ui.port}` })).status).toBe(403);
    expect((await get(ui, path, { ...headers, host: '127.0.0.1:1' })).status).toBe(403);
    expect((await get(ui, path, { ...headers, origin: 'https://attacker.example' })).status).toBe(403);
    expect((await get(ui, path, { ...headers, origin: 'null' })).status).toBe(403);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await get(ui, path, headers, method)).status).toBe(405);
    }
  });

  test('collections are the names with documents under the database prefix, with their counts', async () => {
    const adapter = new MemoryStorageAdapter();
    const db = new BucketDB(adapter, 'app');
    for (let n = 0; n < 3; n++) await db.collection<Run>('runs').insert({ ms: n, ok: true });
    await db.collection<Run>('deploys').insert({ ms: 1, ok: true });
    await new BucketDB(adapter, 'app2').collection<Run>('other').insert({ ms: 1, ok: true });
    const bytes = new TextEncoder().encode('{}');
    await adapter.put('app/runs/_snapshot.v1.json', bytes);
    await adapter.put('app/runs/index/shard-0.json', bytes);
    await adapter.put('app/notes.txt', bytes);
    await adapter.put('app/runs/docs/nested/x.json', bytes);

    const { ui, headers } = await start(adapter);
    expect(await collections(ui, headers)).toEqual({
      collections: [
        { name: 'deploys', count: 1 },
        { name: 'runs', count: 3 },
      ],
      scanning: false,
      truncated: false,
    });

    await db.collection<Run>('new').insert({ ms: 1, ok: true });
    expect((await collections(ui, headers)).collections).toHaveLength(2);
    expect((await collections(ui, headers, '&refresh=1')).collections.map(c => c.name)).toEqual([
      'deploys',
      'new',
      'runs',
    ]);
  });

  test('a database at the bucket root is scanned from the empty prefix', async () => {
    const adapter = new MemoryStorageAdapter();
    await new BucketDB(adapter, '').collection<Run>('runs').insert({ ms: 1, ok: true });
    const { ui, headers } = await start(adapter, '');
    expect((await collections(ui, headers)).collections).toEqual([{ name: 'runs', count: 1 }]);
  });

  test('the scan pauses after 100 list pages and continues on request', async () => {
    const keys = Array.from({ length: 150 }, (_, n) => `app/runs/docs/${String(n).padStart(3, '0')}.json`);
    /** One key per page, like a bucket with 150,000 keys read 1,000 at a time. */
    const adapter = {
      capabilities: new MemoryStorageAdapter().capabilities,
      get: () => Promise.reject(new Error('unused')),
      put: () => Promise.reject(new Error('unused')),
      delete: () => Promise.reject(new Error('unused')),
      async list(_prefix: string, options: { cursor?: string } = {}) {
        const index = options.cursor === undefined ? 0 : Number(options.cursor);
        return {
          entries: [{ key: keys[index], etag: 'e' }],
          cursor: index + 1 < keys.length ? String(index + 1) : undefined,
        };
      },
    } satisfies StorageAdapter;

    const { ui, headers } = await start(adapter);
    const first = await collections(ui, headers);
    expect(first).toMatchObject({ collections: [{ name: 'runs', count: 100 }], truncated: true });
    const rest = await collections(ui, headers, '&more=1');
    expect(rest).toMatchObject({ collections: [{ name: 'runs', count: 150 }], truncated: false });
  });

  test('find pages through exactly what the library returns for the same filter and sort', async () => {
    const adapter = new MemoryStorageAdapter();
    const runs = new BucketDB(adapter, 'app').collection<Run>('runs');
    for (let n = 0; n < 120; n++) await runs.put(`run-${n}`, { ms: (n * 37) % 101, ok: n % 3 !== 0 });
    const expected = await runs.find({ ok: true }, { sort: { ms: -1 } });
    expect(expected).toHaveLength(80);

    const { ui, headers } = await start(adapter);
    const params = { collection: 'runs', filter: '{"ok":true}', sort: 'ms:desc' };
    const first = await json<Found>(ui, findPath(params), headers);
    expect(first).toMatchObject({ total: 80, page: 1, pageSize: 50 });
    expect(first.documents).toEqual(expected.slice(0, 50));
    const second = await json<Found>(ui, findPath({ ...params, page: '2' }), headers);
    expect(second.documents).toEqual(expected.slice(50));
    expect((await json<Found>(ui, findPath({ ...params, page: '3' }), headers)).documents).toEqual([]);

    const all = await json<Found>(ui, findPath({ collection: 'runs' }), headers);
    expect(all.total).toBe(120);
    expect(all.documents).toEqual((await runs.find({})).slice(0, 50));
  });

  test('an invalid filter, sort, page or collection name is a 400 that reads no storage', async () => {
    const storage = new FaultyAdapter(new MemoryStorageAdapter());
    let calls = 0;
    storage.before = () => {
      calls++;
    };
    const { ui, headers } = await start(storage);
    const cases: Array<Record<string, string>> = [
      { collection: 'runs', filter: '{"ok":' },
      { collection: 'runs', filter: '[1]' },
      { collection: 'runs', filter: '"text"' },
      { collection: 'runs', filter: '{"ms":{"$regex":"x"}}' },
      { collection: 'runs', sort: 'ms:sideways' },
      { collection: 'runs', page: '0' },
      { collection: 'runs', page: '1.5' },
      { collection: '../other' },
      {},
    ];
    for (const params of cases) {
      const reply = await get(ui, findPath(params), headers);
      expect([params, reply.status]).toEqual([params, 400]);
      expect(JSON.parse(reply.body).error).toBeString();
    }
    expect(calls).toBe(0);
  });

  test('pages are served from the last query until the query changes or is refreshed', async () => {
    const storage = new FaultyAdapter(new MemoryStorageAdapter());
    const runs = new BucketDB(storage, 'app').collection<Run>('runs');
    for (let n = 0; n < 60; n++) await runs.put(`run-${n}`, { ms: n, ok: true });
    let calls = 0;
    storage.before = () => {
      calls++;
    };

    const { ui, headers } = await start(storage);
    const params = { collection: 'runs', sort: 'ms:asc' };
    await json<Found>(ui, findPath(params), headers);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(0);

    await runs.put('run-new', { ms: -1, ok: true });
    const writes = calls - afterFirst;
    const page2 = await json<Found>(ui, findPath({ ...params, page: '2' }), headers);
    expect(page2.total).toBe(60);
    expect(calls).toBe(afterFirst + writes);

    const refreshed = await json<Found>(ui, findPath({ ...params, refresh: '1' }), headers);
    expect(refreshed.total).toBe(61);
    expect(refreshed.documents[0].id).toBe('run-new');
    expect((await json<Found>(ui, findPath({ ...params, sort: 'ms:desc' }), headers)).documents[0].ms).toBe(59);
  });

  test('a storage failure is reported as an error, not as an empty result', async () => {
    const storage = new FaultyAdapter(new MemoryStorageAdapter());
    await new BucketDB(storage, 'app').collection<Run>('runs').insert({ ms: 1, ok: true });
    const { ui, headers } = await start(storage);
    storage.before = operation => {
      if (operation === 'get') throw new Error('disk on fire');
    };
    const reply = await get(ui, findPath({ collection: 'runs' }), headers);
    expect(reply.status).toBeGreaterThanOrEqual(500);
    expect(JSON.parse(reply.body).error).toBeString();
  });
});

describe('bucket-db ui', () => {
  test('prints a local URL whose token opens the page for the database in --url', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bucketdb-ui-'));
    const child = Bun.spawn(
      ['bun', join(import.meta.dir, '../../src/cli.ts'), 'ui', '--no-open', '--port', '0', '--url', `file://${dir}`],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUCKET_DB_URL: '' } }
    );
    try {
      await BucketDB.connect(`file://${dir}`).collection<Run>('runs').insert({ ms: 7, ok: true });
      const reader = child.stdout.getReader();
      let output = '';
      while (!/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.test(output)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`ui exited: ${output}${await new Response(child.stderr).text()}`);
        output += new TextDecoder().decode(value);
      }
      const url = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(output)?.[0] ?? '';
      const exchange = await fetch(url, { redirect: 'manual' });
      const cookie = String(exchange.headers.get('set-cookie')).split(';')[0];
      const found = await fetch(new URL('/api/find?collection=runs', url), { headers: { cookie } });
      expect(((await found.json()) as Found).documents.map(doc => doc.ms)).toEqual([7]);
    } finally {
      child.kill();
      await child.exited;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
