/**
 * Runs the contract against a local S3-compatible service, e.g. the one CI
 * starts in a container. Set LOCAL_S3_ENDPOINT and LOCAL_S3_BUCKET (the bucket
 * must exist); LOCAL_S3_ACCESS_KEY_ID / LOCAL_S3_SECRET_ACCESS_KEY default to
 * dummy values for services that do not check signatures.
 */
import { describe, setDefaultTimeout } from 'bun:test';
import { S3Adapter } from '../../src/index.js';
import { defineAdapterSuite } from './adapter-suite';
import { defineCollectionSuite } from './collection-suite';

setDefaultTimeout(60_000);

const { LOCAL_S3_ENDPOINT: endpoint, LOCAL_S3_BUCKET: bucket } = process.env;

if (endpoint && bucket) {
  const adapter = () =>
    new S3Adapter({
      bucket,
      region: process.env.LOCAL_S3_REGION ?? 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.LOCAL_S3_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.LOCAL_S3_SECRET_ACCESS_KEY ?? 'test',
      },
    });
  const run = Date.now();
  defineAdapterSuite('local S3', () => ({ adapter: adapter(), prefix: `test/conformance-local-${run}/` }));
  defineCollectionSuite('local S3', () => ({ adapter: adapter(), dbPath: `test/collection-local-${run}` }));
} else {
  describe.skip('local S3 (LOCAL_S3_ENDPOINT / LOCAL_S3_BUCKET not set)', () => {});
}
