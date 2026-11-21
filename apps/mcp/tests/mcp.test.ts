/**
 * Drives the MCP server over stdio as a client would. Needs the core package
 * built (`bun run build`), since the server imports @hold-baby/bucket-db.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

const serverPath = join(import.meta.dir, '../src/index.ts');

interface ToolResult {
  isError: boolean;
  text: string;
}

function startServer(env: Record<string, string>) {
  const child = Bun.spawn(['bun', serverPath], {
    env: { ...process.env, ...env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const pending = new Map<
    number,
    (message: { result?: { isError?: boolean; content: Array<{ text: string }> } }) => void
  >();
  let nextId = 0;
  (async () => {
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk);
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const message = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        pending.get(message.id)?.(message);
      }
    }
  })();
  const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const request = (method: string, params: object) =>
    new Promise<{ result?: { isError?: boolean; content: Array<{ text: string }> } }>(resolve => {
      const id = ++nextId;
      pending.set(id, resolve);
      send({ id, method, params });
    });
  return {
    child,
    async initialize() {
      await request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      });
      send({ method: 'notifications/initialized' });
    },
    async tool(name: string, args: object): Promise<ToolResult> {
      const { result } = await request('tools/call', { name, arguments: args });
      return { isError: Boolean(result?.isError), text: result!.content[0].text };
    },
  };
}

describe('MCP server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bucketdb-mcp-'));
  let server: ReturnType<typeof startServer>;

  beforeAll(async () => {
    server = startServer({ BUCKET_DB_URL: `file://${dir}` });
    await server.initialize();
  });

  afterAll(() => {
    (server.child as Subprocess).kill();
    rmSync(dir, { recursive: true, force: true });
  });

  test('insert, put, find, count, update and delete through tools', async () => {
    const inserted = JSON.parse(
      (await server.tool('db_insert', { collection: 'notes', data: { title: 'a', n: 2 } })).text
    );
    await server.tool('db_put', { collection: 'notes', id: 'fixed', data: { title: 'b', n: 1 } });

    const sorted = JSON.parse((await server.tool('db_find', { collection: 'notes', filter: {}, sort: { n: 1 } })).text);
    expect(sorted.map((doc: { id: string }) => doc.id)).toEqual(['fixed', inserted.id]);
    expect((await server.tool('db_count', { collection: 'notes', filter: { n: { $gt: 1 } } })).text).toBe('1');

    const conflict = await server.tool('db_update', {
      collection: 'notes',
      id: 'fixed',
      data: { n: 5 },
      etag: 'stale',
    });
    expect(conflict).toEqual({ isError: true, text: 'Concurrent update conflict for: fixed' });
    expect(
      JSON.parse((await server.tool('db_update', { collection: 'notes', id: 'fixed', data: { n: 5 } })).text).n
    ).toBe(5);

    expect((await server.tool('db_delete', { collection: 'notes', id: 'fixed' })).isError).toBe(false);
    expect((await server.tool('db_delete', { collection: 'notes', id: 'fixed' })).isError).toBe(false);
    expect(await server.tool('db_find_by_id', { collection: 'notes', id: 'fixed' })).toEqual({
      isError: true,
      text: 'Document not found: fixed',
    });
  });

  test('insert with a taken id and invalid names are reported as tool errors', async () => {
    await server.tool('db_insert', { collection: 'notes', data: { n: 1 }, id: 'once' });
    const again = await server.tool('db_insert', { collection: 'notes', data: { n: 2 }, id: 'once' });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('DocumentExistsError');
    expect((await server.tool('db_find', { collection: 'a/b' })).text).toContain('Invalid collection name');
  });

  test('without BUCKET_DB_URL the server exits with a message', async () => {
    const child = Bun.spawn(['bun', serverPath], {
      env: { ...process.env, BUCKET_DB_URL: '' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain('BUCKET_DB_URL');
  });
});
