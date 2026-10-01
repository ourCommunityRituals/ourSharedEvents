/**
 * Postgres adapter behavioral test via pg-mem (in-memory Postgres).
 *
 * pg-mem implements Postgres SQL semantics in JS, including the
 * ON CONFLICT ... DO UPDATE + EXCLUDED forms PostgresAdapter relies on.
 * This exercises the real SQL dialect without a live DB. A production
 * integration test against a real Postgres still belongs in the
 * consumer app when one picks up this adapter.
 */
import { DataType, newDb } from 'pg-mem';
import { PostgresAdapter } from '../src/adapters/postgres.js';
import { runAdapterSpec } from './adapter-spec.js';

type PgClient = {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
};

function freshClient(): PgClient {
  const db = newDb();
  // pg-mem lacks a native NOW() implementation for TIMESTAMPTZ columns in
  // some versions; register a deterministic one so updated_at assertions
  // stay stable.
  db.public.registerFunction({
    name: 'now',
    returns: DataType.timestamp,
    implementation: () => new Date(),
    impure: true,
  });
  // createPg() is typed `any`; pin the one constructor this spec uses.
  const { Pool } = db.adapters.createPg() as { Pool: new () => PgClient };
  return new Pool();
}

runAdapterSpec('postgres', () => {
  const client = freshClient();
  return new PostgresAdapter(client);
});
