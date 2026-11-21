import { ValidationError } from '../../errors.js';
import { AWS_DIALECT, OSS_DIALECT, S3Client, type ResolvedOptions } from './client.js';
import { resolveCredentials, type CredentialProvider, type Credentials } from './credentials.js';

export type { CredentialProvider, Credentials };

export interface S3AdapterOptions {
  bucket: string;
  /** Default: `AWS_REGION`, then `AWS_DEFAULT_REGION`. */
  region?: string;
  /** Default: `AWS_ENDPOINT_URL_S3`, then `AWS_ENDPOINT_URL`, then `https://s3.<region>.amazonaws.com`. */
  endpoint?: string;
  /** Default: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. */
  credentials?: Credentials | CredentialProvider;
  /** Default: true when the endpoint host is an IP address or `localhost`, else virtual-hosted. */
  forcePathStyle?: boolean;
  /** Per-attempt timeout; default 10000. */
  timeoutMs?: number;
}

export interface OSSAdapterOptions {
  bucket: string;
  /** `cn-hangzhou` (or 0.3's `oss-cn-hangzhou`). Default: `OSS_REGION`. */
  region?: string;
  /** S3-compatible endpoint. Default: `https://s3.oss-<region>.aliyuncs.com`. */
  endpoint?: string;
  /** Default: `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN`, else the `ALIBABA_CLOUD_*` equivalents. */
  credentials?: Credentials | CredentialProvider;
  /** Per-attempt timeout; default 10000. */
  timeoutMs?: number;
}

interface CommonOptions {
  bucket: string;
  region: string | undefined;
  endpoint: string;
  credentials: CredentialProvider;
  forcePathStyle?: boolean;
  timeoutMs?: number;
}

function resolveOptions(name: string, options: CommonOptions): ResolvedOptions {
  const { bucket, region, timeoutMs = 10_000 } = options;
  if (!bucket) throw new ValidationError(`${name}: bucket is required`);
  if (!region) throw new ValidationError(`${name}: region is required (option or environment variable)`);
  if (!(timeoutMs > 0)) throw new ValidationError(`${name}: timeoutMs must be positive`);
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch (error) {
    throw new ValidationError(`${name}: invalid endpoint ${options.endpoint}`, { cause: error });
  }
  const { hostname } = endpoint;
  const local = hostname === 'localhost' || hostname.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
  return {
    bucket,
    region,
    endpoint,
    forcePathStyle: options.forcePathStyle ?? local,
    credentials: options.credentials,
    timeoutMs,
  };
}

/** Amazon S3, or any service speaking its protocol (MinIO, R2, …). */
export class S3Adapter extends S3Client {
  constructor(options: S3AdapterOptions) {
    const { env } = process;
    const region = options.region ?? (env.AWS_REGION || env.AWS_DEFAULT_REGION);
    const resolved = resolveOptions('S3Adapter', {
      ...options,
      region,
      endpoint:
        options.endpoint ?? (env.AWS_ENDPOINT_URL_S3 || env.AWS_ENDPOINT_URL || `https://s3.${region}.amazonaws.com`),
      credentials: resolveCredentials(options.credentials, [['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']]),
    });
    super(resolved, AWS_DIALECT);
  }
}

/**
 * Alibaba Cloud OSS through its S3-compatible endpoint. Compare-and-swap
 * (`put` with `ifMatch`) is not supported.
 */
export class OSSAdapter extends S3Client {
  constructor(options: OSSAdapterOptions) {
    const region = (options.region ?? process.env.OSS_REGION)?.replace(/^oss-/, '');
    const resolved = resolveOptions('OSSAdapter', {
      ...options,
      region,
      endpoint: options.endpoint ?? `https://s3.oss-${region}.aliyuncs.com`,
      // ossutil's names first, then the Alibaba Cloud CLI / OIDC action's
      credentials: resolveCredentials(options.credentials, [
        ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_SESSION_TOKEN'],
        ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'],
      ]),
    });
    super(resolved, OSS_DIALECT);
  }
}
