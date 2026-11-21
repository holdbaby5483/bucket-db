import { afterAll } from 'bun:test';
import { S3Adapter, OSSAdapter } from '../../src/index.js';
import { startFakeS3 } from '../support/fake-s3';
import { defineAdapterSuite } from './adapter-suite';
import { defineCollectionSuite } from './collection-suite';

const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
const aws = startFakeS3('fake-aws', { dialect: 'aws' });
const oss = startFakeS3('fake-oss', { dialect: 'oss' });
afterAll(() => {
  aws.stop();
  oss.stop();
});

const s3Adapter = () => new S3Adapter({ bucket: aws.bucket, region: 'us-east-1', endpoint: aws.url, credentials });
const ossAdapter = () => new OSSAdapter({ bucket: oss.bucket, region: 'cn-hangzhou', endpoint: oss.url, credentials });

defineAdapterSuite('fake S3 (aws dialect)', () => ({ adapter: s3Adapter(), prefix: 'test/conformance/' }));
defineCollectionSuite('fake S3 (aws dialect)', () => ({ adapter: s3Adapter(), dbPath: 'test/collection' }));
defineAdapterSuite('fake S3 (oss dialect)', () => ({ adapter: ossAdapter(), prefix: 'test/conformance/' }));
defineCollectionSuite('fake S3 (oss dialect)', () => ({ adapter: ossAdapter(), dbPath: 'test/collection' }));
