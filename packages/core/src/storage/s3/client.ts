import { BucketDBError, StorageError, UnsupportedError, ValidationError } from '../../errors.js';
import {
  MAX_LIST_LIMIT,
  type Capabilities,
  type ListOptions,
  type ListPage,
  type StorageAdapter,
  type WriteCondition,
} from '../adapter.js';
import type { CredentialProvider, Credentials } from './credentials.js';
import { EMPTY_SHA256, encodeRfc3986, sha256Hex, signRequest } from './sigv4.js';

/** Where an S3-compatible service departs from AWS S3. */
export interface Dialect {
  /** Header that makes a PUT fail when the key exists. */
  createIfAbsent: [header: string, value: string];
  supportsIfMatch: boolean;
  /** Whether a failed conditional PUT means "condition not met". */
  isConflict(status: number, code: string): boolean;
}

export const AWS_DIALECT: Dialect = {
  createIfAbsent: ['if-none-match', '*'],
  supportsIfMatch: true,
  isConflict: (status, code) => status === 412 || (status === 409 && code === 'ConditionalRequestConflict'),
};

export const OSS_DIALECT: Dialect = {
  createIfAbsent: ['x-oss-forbid-overwrite', 'true'],
  supportsIfMatch: false,
  isConflict: (status, code) => status === 412 || (status === 409 && code === 'FileAlreadyExists'),
};

export interface ResolvedOptions {
  bucket: string;
  /** Signing region */
  region: string;
  endpoint: URL;
  forcePathStyle: boolean;
  credentials: CredentialProvider;
  /** Per attempt */
  timeoutMs: number;
}

interface S3Response {
  status: number;
  /** Error `Code` / `Message` from the XML body; empty on success. */
  code: string;
  message: string;
  headers: Headers;
  body: Uint8Array;
}

interface RequestInit {
  /** A request with a query addresses the bucket itself (ListObjectsV2). */
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Uint8Array;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 100;
const BACKOFF_CAP_MS = 2000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['SlowDown', 'RequestTimeout']);

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decoder = new TextDecoder();

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] !== '#') return XML_ENTITIES[entity.toLowerCase()];
    const hex = entity[1] === 'x' || entity[1] === 'X';
    return String.fromCodePoint(Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10));
  });
}

/** Entity-decoded text of the first `<tag>`, or ''. */
function xmlValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : '';
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * StorageAdapter over the S3 REST protocol: SigV4 signing, per-attempt
 * timeout, retries with full-jitter backoff, and error classification.
 */
export class S3Client implements StorageAdapter {
  readonly capabilities: Capabilities;
  readonly remote = true;

  constructor(
    private readonly options: ResolvedOptions,
    private readonly dialect: Dialect
  ) {
    this.capabilities = { createIfAbsent: 'atomic', compareAndSwap: dialect.supportsIfMatch ? 'atomic' : 'none' };
  }

  async get(key: string): Promise<{ body: Uint8Array; etag: string }> {
    const { response } = await this.send('GET', key);
    if (response.status < 300) return { body: response.body, etag: this.etag(response) };
    throw this.failure('GET', key, response);
  }

  async put(key: string, body: Uint8Array, condition?: WriteCondition): Promise<{ etag: string }> {
    const headers: Record<string, string> = {};
    if (condition && 'ifMatch' in condition) {
      if (!this.dialect.supportsIfMatch) {
        throw new UnsupportedError(`This backend cannot compare-and-swap (put with ifMatch): ${key}`);
      }
      headers['if-match'] = `"${condition.ifMatch}"`;
    } else if (condition) {
      const [name, value] = this.dialect.createIfAbsent;
      headers[name] = value;
    }

    const { response, retried } = await this.send('PUT', key, { headers, body });
    if (response.status < 300) return { etag: this.etag(response) };
    if (!condition || !this.dialect.isConflict(response.status, response.code)) {
      throw this.failure('PUT', key, response);
    }
    if (retried) {
      // An earlier attempt may have written the object before its response was
      // lost; then the conflict is with ourselves.
      const current = await this.get(key).catch((error: unknown) => {
        if (error instanceof StorageError && error.kind === 'not-found') return undefined;
        throw error;
      });
      if (current && bytesEqual(current.body, body)) return { etag: current.etag };
    }
    throw new StorageError(`PUT ${key}: write condition not met (${response.status} ${response.code})`, {
      kind: 'conflict',
      key,
      status: response.status,
    });
  }

  async delete(key: string): Promise<void> {
    const { response } = await this.send('DELETE', key);
    if (response.status >= 300 && response.status !== 404) throw this.failure('DELETE', key, response);
  }

  async list(prefix: string, options: ListOptions = {}): Promise<ListPage> {
    const limit = options.limit ?? MAX_LIST_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) throw new ValidationError(`Invalid list limit: ${limit}`);
    const query: Record<string, string> = {
      'list-type': '2',
      prefix,
      'max-keys': String(Math.min(limit, MAX_LIST_LIMIT)),
      'encoding-type': 'url',
    };
    if (options.cursor !== undefined) query['continuation-token'] = options.cursor;

    const { response } = await this.send('GET', prefix, { query });
    if (response.status >= 300) throw this.failure('LIST', prefix, response, false);
    const xml = decoder.decode(response.body);
    const entries = Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g), ([, contents]) => ({
      // encoding-type=url encodes keys like a form: `+` is a space.
      key: decodeURIComponent(xmlValue(contents, 'Key').replace(/\+/g, ' ')),
      etag: xmlValue(contents, 'ETag').replace(/"/g, ''),
    }));
    const cursor = xmlValue(xml, 'IsTruncated') === 'true' ? xmlValue(xml, 'NextContinuationToken') : '';
    return cursor ? { entries, cursor } : { entries };
  }

  private etag(response: S3Response): string {
    return (response.headers.get('etag') ?? '').replace(/"/g, '');
  }

  private failure(operation: string, key: string, response: S3Response, notFound = true): StorageError {
    const { status, code, message } = response;
    return new StorageError(`${operation} ${key}: ${status} ${code}${message ? `: ${message}` : ''}`, {
      kind: notFound && status === 404 && code !== 'NoSuchBucket' ? 'not-found' : 'permanent',
      key,
      status,
    });
  }

  private url(key: string, query: Record<string, string> | undefined): URL {
    const { endpoint, bucket, forcePathStyle } = this.options;
    const segments = query ? [''] : key.split('/');
    if (segments.some(segment => segment === '.' || segment === '..')) {
      // URL parsing would resolve them and address a different key.
      throw new ValidationError(`Key has a '.' or '..' segment: ${key}`);
    }
    const url = new URL(endpoint);
    if (!forcePathStyle) url.hostname = `${bucket}.${url.hostname}`;
    url.pathname =
      url.pathname.replace(/\/$/, '') +
      (forcePathStyle ? `/${encodeRfc3986(bucket)}` : '') +
      `/${segments.map(encodeRfc3986).join('/')}`;
    url.search = query
      ? Object.entries(query)
          .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
          .join('&')
      : '';
    return url;
  }

  private async credentials(key: string): Promise<Credentials> {
    try {
      return await this.options.credentials();
    } catch (error) {
      if (error instanceof BucketDBError) throw error;
      throw new StorageError(`Failed to obtain credentials for ${key}`, { kind: 'permanent', key, cause: error });
    }
  }

  /**
   * Sends with retries. Returns the first response that is not retryable;
   * `retried` tells whether an earlier attempt failed transiently.
   */
  private async send(
    method: string,
    key: string,
    init: RequestInit = {}
  ): Promise<{ response: S3Response; retried: boolean }> {
    const url = this.url(key, init.query);
    const payloadHash = init.body ? await sha256Hex(init.body) : EMPTY_SHA256;
    let lastStatus: number | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
        await new Promise(resolve => setTimeout(resolve, Math.random() * ceiling));
      }
      const credentials = await this.credentials(key);
      try {
        const response = await this.attempt(method, url, init, payloadHash, credentials);
        if (!RETRYABLE_STATUSES.has(response.status) && !RETRYABLE_CODES.has(response.code)) {
          return { response, retried: attempt > 0 };
        }
        lastStatus = response.status;
        lastError = new Error(`${response.status} ${response.code}: ${response.message}`);
      } catch (error) {
        // Network failure or per-attempt timeout.
        lastError = error;
      }
    }
    throw new StorageError(`${method} ${key}: failed after ${MAX_ATTEMPTS} attempts`, {
      kind: 'transient',
      key,
      status: lastStatus,
      cause: lastError,
    });
  }

  private async attempt(
    method: string,
    url: URL,
    init: RequestInit,
    payloadHash: string,
    credentials: Credentials
  ): Promise<S3Response> {
    const headers = init.headers ?? {};
    const signed = await signRequest({
      method,
      url,
      headers,
      payloadHash,
      credentials,
      region: this.options.region,
      date: new Date(),
    });
    const response = await fetch(url, {
      method,
      headers: { ...headers, ...signed },
      body: init.body,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    // Read inside the attempt so the timeout and connection errors cover the body.
    const body = new Uint8Array(await response.arrayBuffer());
    const xml = response.status >= 300 ? decoder.decode(body) : '';
    return {
      status: response.status,
      code: xmlValue(xml, 'Code'),
      message: xmlValue(xml, 'Message'),
      headers: response.headers,
      body,
    };
  }
}
