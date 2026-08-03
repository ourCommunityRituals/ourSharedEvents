/**
 * Postgres adapter behavioral test via pg-mem (in-memory Postgres).
 *
 * pg-mem implements Postgres SQL semantics in JS, including the
 * ON CONFLICT ... DO UPDATE + EXCLUDED forms PostgresAdapter relies on.
 * This exercises the real SQL dialect without a live DB. A production
 * integration test against a real Postgres still belongs in the
 * consumer app when one picks up this adapter.
 */
import { newDb } from 'pg-mem';
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
    returns: db.public.types.timestamp as unknown as never,
    implementation: () => new Date(),
    impure: true,
  });
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  return pool as unknown as PgClient;
}

runAdapterSpec('postgres', () => {
  const client = freshClient();
  return new PostgresAdapter(client);
});
