/**
 * Runs the contract against the real buckets configured in the environment
 * (see .env / CI secrets). Writes only under test/conformance-<backend>-<time>/
 * and removes everything it wrote.
 */
import { describe, setDefaultTimeout } from 'bun:test';
import { S3Adapter, OSSAdapter } from '../../src/index.js';
import { defineAdapterSuite } from './adapter-suite';
import { defineCollectionSuite } from './collection-suite';

// Round trips to a remote region take far longer than bun's 5 s default.
setDefaultTimeout(120_000);

const run = Date.now();

if (process.env.TEST_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
  const adapter = () => new S3Adapter({ bucket: process.env.TEST_S3_BUCKET! });
  defineAdapterSuite('real S3', () => ({ adapter: adapter(), prefix: `test/conformance-s3-${run}/` }));
  defineCollectionSuite('real S3', () => ({ adapter: adapter(), dbPath: `test/collection-s3-${run}` }));
} else {
  describe.skip('real S3 (TEST_S3_BUCKET / AWS credentials not set)', () => {});
}

if (process.env.OSS_BUCKET && process.env.OSS_ACCESS_KEY_ID) {
  const adapter = () => new OSSAdapter({ bucket: process.env.OSS_BUCKET! });
  defineAdapterSuite('real OSS', () => ({ adapter: adapter(), prefix: `test/conformance-oss-${run}/` }));
  defineCollectionSuite('real OSS', () => ({ adapter: adapter(), dbPath: `test/collection-oss-${run}` }));
} else {
  describe.skip('real OSS (OSS_BUCKET / OSS credentials not set)', () => {});
}
