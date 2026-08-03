import Database from 'better-sqlite3';
import { SqliteAdapter } from '../src/adapters/sqlite.js';
import { runAdapterSpec } from './adapter-spec.js';

runAdapterSpec(
  'sqlite',
  () =>
    new SqliteAdapter(
      new Database(':memory:') as unknown as ConstructorParameters<typeof SqliteAdapter>[0]
    )
);
