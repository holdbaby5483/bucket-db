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

    case 's3': {
      const bucket = process.env.BUCKET_DB_S3_BUCKET;
      const region = process.env.BUCKET_DB_S3_REGION;
      const accessKeyId = process.env.BUCKET_DB_S3_ACCESS_KEY_ID;
      const secretAccessKey = process.env.BUCKET_DB_S3_SECRET_ACCESS_KEY;

      if (!bucket || !region || !accessKeyId || !secretAccessKey) {
        console.error(
          'Error: BUCKET_DB_S3_BUCKET, BUCKET_DB_S3_REGION, BUCKET_DB_S3_ACCESS_KEY_ID, BUCKET_DB_S3_SECRET_ACCESS_KEY are required for s3 adapter'
        );
        process.exit(1);
      }
      return new S3Adapter({ bucket, region, credentials: { accessKeyId, secretAccessKey } });
    }

    case 'oss': {
      const bucket = process.env.BUCKET_DB_OSS_BUCKET;
      const region = process.env.BUCKET_DB_OSS_REGION;
      const accessKeyId = process.env.BUCKET_DB_OSS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.BUCKET_DB_OSS_SECRET_ACCESS_KEY;

      if (!bucket || !region || !accessKeyId || !secretAccessKey) {
        console.error(
          'Error: BUCKET_DB_OSS_BUCKET, BUCKET_DB_OSS_REGION, BUCKET_DB_OSS_ACCESS_KEY_ID, BUCKET_DB_OSS_SECRET_ACCESS_KEY are required for oss adapter'
        );
        process.exit(1);
      }
      return new OSSAdapter({ bucket, region, credentials: { accessKeyId, secretAccessKey } });
    }

    default:
      console.error(`Error: Unknown BUCKET_DB_ADAPTER value: "${adapterType}". Must be fs|s3|oss`);
      process.exit(1);
  }
}

export function getDbPath(): string {
  return process.env.BUCKET_DB_PATH ?? 'default';
}
