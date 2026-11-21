/**
 * AWS Signature Version 4 for S3-protocol requests, on Web Crypto.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */

export interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  /** Path must already be RFC 3986 encoded; it is signed as is (S3 does not double-encode). */
  url: URL;
  /** Headers the caller sets itself; all of them are signed. `host` is taken from `url`. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body; `EMPTY_SHA256` without a body. */
  payloadHash: string;
  credentials: SigningCredentials;
  region: string;
  date: Date;
  service?: string;
}

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const encoder = new TextEncoder();

/** RFC 3986 percent-encoding: everything except unreserved `A-Z a-z 0-9 - . _ ~`. */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

/** `20130524T000000Z` */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Returns the headers to add to the request: `x-amz-date`,
 * `x-amz-content-sha256`, `x-amz-security-token` (with a session token) and
 * `authorization`.
 */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const { credentials, region, payloadHash } = input;
  const service = input.service ?? 's3';
  const timestamp = amzDate(input.date);
  const day = timestamp.slice(0, 8);

  const added: Record<string, string> = {
    'x-amz-date': timestamp,
    'x-amz-content-sha256': payloadHash,
  };
  if (credentials.sessionToken) added['x-amz-security-token'] = credentials.sessionToken;

  const signed = new Map<string, string>([['host', input.url.host]]);
  for (const [name, value] of Object.entries({ ...input.headers, ...added })) {
    signed.set(name.toLowerCase(), value.trim().replace(/\s+/g, ' '));
  }
  const names = [...signed.keys()].sort();
  const signedHeaders = names.join(';');
  // Sort by encoded name, then value.
  const canonicalQuery = [...input.url.searchParams]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    input.url.pathname || '/',
    canonicalQuery,
    names.map(name => `${name}:${signed.get(name)}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, await sha256Hex(canonicalRequest)].join('\n');

  let key = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), day);
  for (const part of [region, service, 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));

  added.authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return added;
}
