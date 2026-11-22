import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BucketDB } from '../bucket-db.js';
import { BucketDBError, ValidationError } from '../errors.js';
import { isValidName } from '../keys.js';
import type { StorageAdapter } from '../storage/adapter.js';
import type { Document, QueryFilter, SortSpec, Stored } from '../types.js';

const PAGE_SIZE = 50;
/** List pages (1,000 keys each) read before the collection scan pauses. */
const SCAN_PAGES = 100;
const DEFAULT_PORT = 7340;
const DOCUMENT_KEY = /^([^/]+)\/docs\/([^/]+)\.json$/;

export interface UiOptions {
  /** The connection URL, shown on the page. It never contains credentials. */
  label: string;
  /** Default 7340; 0 picks a free port. */
  port?: number;
}

export interface UiServer {
  /** Includes the launch token: opening it signs the browser in. */
  url: string;
  port: number;
  close(): Promise<void>;
}

interface Scan {
  counts: Map<string, number>;
  cursor?: string;
  state: 'idle' | 'running' | 'paused' | 'done';
  error?: string;
  running?: Promise<void>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function same(given: string | null | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function integer(text: string | null, fallback: number, minimum: number, what: string): number {
  const value = text === null ? fallback : Number(text);
  if (!Number.isInteger(value) || value < minimum)
    throw new ValidationError(`${what} must be an integer >= ${minimum}`);
  return value;
}

/**
 * Serves the read-only query page on 127.0.0.1. The process holds the storage
 * credentials, so every request must come from this machine's browser session:
 * the launch token becomes a cookie, and Host and Origin must be this server's.
 * There is no endpoint that writes a document.
 */
export async function startUi(adapter: StorageAdapter, dbPath: string, options: UiOptions): Promise<UiServer> {
  const token = randomBytes(24).toString('base64url');
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const warnings = new Set<string>();
  const db = new BucketDB(adapter, dbPath, { logger: ({ message }) => warnings.add(message) });
  const prefix = dbPath === '' ? '' : `${dbPath}/`;
  let port = 0;
  let scan: Scan = { counts: new Map(), state: 'idle' };
  let last: { key: string; documents: Stored<Document>[]; fetchedAt: string; ms: number } | undefined;

  /** Collections are not listed anywhere: they are the names that have keys under `<name>/docs/`. */
  async function runScan(target: Scan): Promise<void> {
    target.state = 'running';
    target.error = undefined;
    try {
      for (let pages = 0; pages < SCAN_PAGES; pages++) {
        const { entries, cursor } = await adapter.list(prefix, { cursor: target.cursor });
        for (const { key } of entries) {
          const match = DOCUMENT_KEY.exec(key.slice(prefix.length));
          if (match && isValidName(match[1]) && isValidName(match[2]))
            target.counts.set(match[1], (target.counts.get(match[1]) ?? 0) + 1);
        }
        target.cursor = cursor;
        if (cursor === undefined) {
          target.state = 'done';
          return;
        }
      }
    } catch (error) {
      target.error = messageOf(error);
    }
    target.state = 'paused';
  }

  async function collections(params: URLSearchParams) {
    if (params.has('refresh')) scan = { counts: new Map(), state: 'idle' };
    if (scan.state === 'idle' || (scan.state === 'paused' && params.has('more'))) scan.running = runScan(scan);
    if (params.has('wait')) await scan.running;
    return {
      collections: [...scan.counts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
      scanning: scan.state === 'running',
      truncated: scan.state === 'paused',
      ...(scan.error === undefined ? {} : { error: scan.error }),
    };
  }

  async function find(params: URLSearchParams) {
    const name = params.get('collection') ?? '';
    const text = (params.get('filter') ?? '').trim();
    let filter: unknown = {};
    if (text) {
      try {
        filter = JSON.parse(text);
      } catch {
        throw new ValidationError('The filter is not valid JSON');
      }
    }
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter))
      throw new ValidationError('The filter must be a JSON object, for example {"ok":true}');
    const sort: Record<string, 1 | -1> = {};
    const sortText = params.get('sort');
    if (sortText) {
      const colon = sortText.lastIndexOf(':');
      const direction = sortText.slice(colon + 1);
      if (colon < 1 || (direction !== 'asc' && direction !== 'desc'))
        throw new ValidationError('sort must be field:asc or field:desc');
      sort[sortText.slice(0, colon)] = direction === 'asc' ? 1 : -1;
    }
    const pageNumber = integer(params.get('page'), 1, 1, 'page');
    const collection = db.collection(name);

    const key = JSON.stringify([name, filter, sort]);
    if (last?.key !== key || params.has('refresh')) {
      const started = performance.now();
      const documents = await collection.find(filter as QueryFilter<Document>, { sort: sort as SortSpec<Document> });
      last = { key, documents, fetchedAt: new Date().toISOString(), ms: Math.round(performance.now() - started) };
    }
    return {
      total: last.documents.length,
      page: pageNumber,
      pageSize: PAGE_SIZE,
      documents: last.documents.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE),
      fetchedAt: last.fetchedAt,
      ms: last.ms,
      warnings: [...warnings],
    };
  }

  function send(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    });
    response.end(body);
  }
  const json = (response: ServerResponse, status: number, value: unknown) =>
    send(response, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET') return send(response, 405, 'Only GET is supported', { allow: 'GET' });
    const host = request.headers.host ?? '';
    // DNS rebinding reaches this server under another name; a cross-site page announces itself in Origin.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(response, 403, 'Forbidden host');
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return send(response, 403, 'Forbidden origin');

    const url = new URL(request.url ?? '/', `http://${host}`);
    const cookieName = `bucketdb_ui_${port}`;
    if (url.pathname === '/' && url.searchParams.has('token')) {
      if (!same(url.searchParams.get('token'), token)) return send(response, 403, 'Invalid token');
      return send(response, 302, '', {
        location: '/',
        'set-cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }
    const cookie = (request.headers.cookie ?? '')
      .split(';')
      .map(part => part.trim().split('='))
      .find(([name]) => name === cookieName)?.[1];
    if (!same(cookie, token))
      return send(response, 403, 'Open the URL printed by `bucket-db ui`; it carries the token.');

    switch (url.pathname) {
      case '/': {
        const nonce = randomBytes(16).toString('base64');
        return send(response, 200, page.replaceAll('__NONCE__', nonce), {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
      }
      case '/api/info':
        return json(response, 200, { url: options.label, pageSize: PAGE_SIZE });
      case '/api/collections':
        return json(response, 200, await collections(url.searchParams));
      case '/api/find':
        return json(response, 200, await find(url.searchParams));
      default:
        return send(response, 404, 'Not found');
    }
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const status = error instanceof ValidationError ? 400 : error instanceof BucketDBError ? 502 : 500;
      json(response, status, { error: messageOf(error) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      const wanted = options.port ?? DEFAULT_PORT;
      reject(
        error.code === 'EADDRINUSE'
          ? new ValidationError(`Port ${wanted} is in use: pass --port <n> (0 picks a free port)`)
          : error
      );
    });
    server.listen(options.port ?? DEFAULT_PORT, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    port,
    close: () =>
      new Promise(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** The `bucket-db ui` command: starts the server, prints its URL and opens the browser. */
export async function runUi(
  adapter: StorageAdapter,
  dbPath: string,
  options: { label: string; port?: string; open: boolean }
): Promise<number> {
  const port = options.port === undefined ? undefined : integer(options.port, 0, 0, '--port');
  const { url } = await startUi(adapter, dbPath, { label: options.label, port });
  console.log(`bucket-db ui: ${url}\nRead-only; listening on this machine only. Press Ctrl+C to stop.`);
  if (options.open) {
    const [command, ...args] =
      process.platform === 'darwin'
        ? ['open', url]
        : process.platform === 'win32'
          ? ['cmd', '/c', 'start', '', url]
          : ['xdg-open', url];
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => undefined)
      .unref();
  }
  return 0;
}
