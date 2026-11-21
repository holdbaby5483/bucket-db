import {
  FileSystemAdapter,
  S3Adapter,
  OSSAdapter,
  type StorageAdapter,
} from '@hold-baby/bucket-db';

export function createAdapter(): StorageAdapter {
  const adapterType = process.env.BUCKET_DB_ADAPTER;

  if (!adapterType) {
    console.error('Error: BUCKET_DB_ADAPTER environment variable is required (fs|s3|oss)');
    process.exit(1);
  }

  switch (adapterType) {
    case 'fs': {
      const basePath = process.env.BUCKET_DB_FS_BASE_PATH;
      if (!basePath) {
        console.error('Error: BUCKET_DB_FS_BASE_PATH is required for fs adapter');
        process.exit(1);
      }
      return new FileSystemAdapter({ basePath });
    }

    case 's3':
    case 'oss': {
      const prefix = adapterType === 's3' ? 'BUCKET_DB_S3' : 'BUCKET_DB_OSS';
      const bucket = process.env[`${prefix}_BUCKET`];
      if (!bucket) {
        console.error(`Error: ${prefix}_BUCKET is required for ${adapterType} adapter`);
        process.exit(1);
      }
      // Region and credentials are optional; when unset the adapter reads
      // AWS_REGION / AWS_ACCESS_KEY_ID / … (s3) or OSS_REGION / OSS_ACCESS_KEY_ID / … (oss).
      const region = process.env[`${prefix}_REGION`] || undefined;
      const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
      const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`];
      const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
      const options = { bucket, region, credentials };
      return adapterType === 's3' ? new S3Adapter(options) : new OSSAdapter(options);
    }

    default:
      console.error(`Error: Unknown BUCKET_DB_ADAPTER value: "${adapterType}". Must be fs|s3|oss`);
      process.exit(1);
  }
}

export function getDbPath(): string {
  return process.env.BUCKET_DB_PATH ?? 'default';
}
