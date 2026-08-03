import { MemoryAdapter } from '../src/adapters/memory.js';
import { runAdapterSpec } from './adapter-spec.js';

runAdapterSpec('memory', () => new MemoryAdapter());
