/**
 * Child process for the multi-process test: inserts `count` documents
 * concurrently and prints their ids as JSON.
 */
import { BucketDB, FileSystemAdapter, OSSAdapter, S3Adapter } from '../../src/index.js';
import type { StorageAdapter } from '../../src/index.js';

export type WorkerBackend =
  | { kind: 'fs'; basePath: string }
  | { kind: 's3-endpoint'; endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }
  | { kind: 'oss' }
  | { kind: 's3' };

export interface WorkerConfig {
  backend: WorkerBackend;
  dbPath: string;
  worker: number;
  count: number;
}

export function adapterFor(backend: WorkerBackend): StorageAdapter {
  switch (backend.kind) {
    case 'fs':
      return new FileSystemAdapter({ basePath: backend.basePath });
    case 's3-endpoint':
      return new S3Adapter({
        bucket: backend.bucket,
        region: 'us-east-1',
        endpoint: backend.endpoint,
        credentials: { accessKeyId: backend.accessKeyId, secretAccessKey: backend.secretAccessKey },
      });
    case 'oss':
      return new OSSAdapter({ bucket: process.env.OSS_BUCKET! });
    case 's3':
      return new S3Adapter({ bucket: process.env.TEST_S3_BUCKET! });
  }
}

if (import.meta.main) {
  const config = JSON.parse(process.env.BUCKETDB_WORKER!) as WorkerConfig;
  const items = new BucketDB(adapterFor(config.backend), config.dbPath).collection<{
    id: string;
    worker: number;
    i: number;
  }>('items');
  const docs = await Promise.all(
    Array.from({ length: config.count }, (_, i) => items.insert({ worker: config.worker, i }))
  );
  console.log(JSON.stringify(docs.map(doc => doc.id)));
}
