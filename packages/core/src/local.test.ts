import { MemoryLocalStore } from './local';
import { describeLocalStoreContract } from './testing';

describeLocalStoreContract('MemoryLocalStore', () => new MemoryLocalStore());
