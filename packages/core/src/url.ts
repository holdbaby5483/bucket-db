import type { StorageAdapter } from './storage/adapter.js';
import { MemoryStorageAdapter } from './storage/memory.js';
import { FileSystemAdapter } from './storage/fs.js';
import { OSSAdapter, S3Adapter } from './storage/s3/adapters.js';
import { ValidationError } from './errors.js';

const PARAMETERS: Record<string, string[]> = {
  s3: ['region', 'endpoint', 'forcePathStyle', 'timeoutMs'],
  oss: ['region', 'endpoint', 'timeoutMs'],
  memory: [],
};

/**
 * Resolves a connection URL (default: `BUCKET_DB_URL`) to a backend and a dbPath:
 *
 * - `s3://bucket/prefix?region=…&endpoint=…&forcePathStyle=true&timeoutMs=…`
 * - `oss://bucket/prefix?region=…&endpoint=…&timeoutMs=…`
 * - `file:///absolute/dir`, `file://./relative/dir`
 * - `memory://prefix`
 *
 * Credentials are never accepted in the URL, so it can be logged safely.
 * Error messages never repeat the URL.
 */
export function openUrl(url = process.env.BUCKET_DB_URL): { adapter: StorageAdapter; dbPath: string } {
  if (!url) throw new ValidationError('No connection URL: pass one or set BUCKET_DB_URL');

  if (url.startsWith('file:')) {
    const path = decodeURIComponent(url.replace(/^file:(\/\/)?/, ''));
    if (!path || path.includes('?')) throw new ValidationError('file:// URLs take a directory and no parameters');
    return { adapter: new FileSystemAdapter({ basePath: path }), dbPath: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('Invalid connection URL');
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError('Connection URLs must not contain credentials; use environment variables or the credentials option');
  }
  const scheme = parsed.protocol.slice(0, -1);
  const allowed = PARAMETERS[scheme];
  if (!allowed) throw new ValidationError(`Unsupported scheme ${scheme}: use s3://, oss://, file:// or memory://`);
  const params: Record<string, string> = {};
  for (const [name, value] of parsed.searchParams) {
    if (!allowed.includes(name)) {
      throw new ValidationError(`Unknown parameter "${name}" for ${scheme}://; allowed: ${allowed.join(', ') || 'none'}`);
    }
    params[name] = value;
  }

  const path = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, '');
  if (scheme === 'memory') {
    return { adapter: new MemoryStorageAdapter(), dbPath: [parsed.hostname, path].filter(Boolean).join('/') };
  }
  if (!parsed.hostname) throw new ValidationError(`${scheme}:// URLs need a bucket: ${scheme}://bucket/prefix`);
  const timeoutMs = params.timeoutMs === undefined ? undefined : Number(params.timeoutMs);
  const options = { bucket: parsed.hostname, region: params.region, endpoint: params.endpoint, timeoutMs };
  const adapter =
    scheme === 's3'
      ? new S3Adapter({ ...options, forcePathStyle: params.forcePathStyle === undefined ? undefined : params.forcePathStyle === 'true' })
      : new OSSAdapter(options);
  return { adapter, dbPath: path };
}
