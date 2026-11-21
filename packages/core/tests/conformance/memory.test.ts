import { MemoryStorageAdapter } from '../../src/index.js';
import { defineAdapterSuite } from './adapter-suite';
import { defineCollectionSuite } from './collection-suite';

defineAdapterSuite('memory', () => ({ adapter: new MemoryStorageAdapter(), prefix: 'test/conformance/' }));
defineCollectionSuite('memory', () => ({ adapter: new MemoryStorageAdapter(), dbPath: 'test/conformance' }));
