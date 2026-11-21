import { MemoryStorageAdapter } from '../../src/storage/memory.js';
import { defineAdapterSuite } from './adapter-suite';

defineAdapterSuite('memory', () => ({ adapter: new MemoryStorageAdapter(), prefix: 'test/conformance/' }));
