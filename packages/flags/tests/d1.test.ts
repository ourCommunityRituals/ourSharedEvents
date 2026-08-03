/**
 * D1 adapter behavioral test.
 *
 * D1 is SQLite-based on Cloudflare's side, so running the D1Adapter's
 * actual SQL strings against `better-sqlite3` via a thin API shim is a
 * high-fidelity behavioral test — it exercises the real dialect-specific
 * constructs the adapter emits (`datetime('now')`, `ON CONFLICT ...
 * DO UPDATE SET`, `scope_id IS NULL OR = ''`, etc.).
 *
 * A production integration test against a live Worker's D1 still belongs
 * in the consumer app (OSE's Worker test harness); this unit test
 * guarantees the SQL contract the adapter ships.
 */
import Database from 'better-sqlite3';
import { D1Adapter } from '../src/adapters/d1.js';
import { runAdapterSpec } from './adapter-spec.js';

// D1Adapter declares its minimal D1Database shape internally; we satisfy
// it structurally via cast rather than importing workers-types.
type D1DatabaseShape = ConstructorParameters<typeof D1Adapter>[0];

// Minimal D1 API surface over better-sqlite3.
// Implements only the subset D1Adapter uses: prepare → bind → first/all/run, batch.
class FakeD1PreparedStatement {
  constructor(
    private readonly stmt: Database.Statement,
    private readonly params: unknown[] = []
  ) {}
  bind(...params: unknown[]): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.stmt, params);
  }
  async first<T>(): Promise<T | null> {
    const row = this.stmt.get(...this.params) as T | undefined;
    return row ?? null;
  }
  async all<T>(): Promise<{ results: T[]; meta: Record<string, unknown> }> {
    return { results: this.stmt.all(...this.params) as T[], meta: {} };
  }
  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const r = this.stmt.run(...this.params);
    return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid ?? 0) } };
  }
}

class FakeD1Database {
  constructor(private readonly db: Database.Database) {}
  prepare(sql: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this.db.prepare(sql));
  }
  async batch(statements: FakeD1PreparedStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const s of statements) results.push(await s.run());
    return results;
  }
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const start = Date.now();
    this.db.exec(sql);
    return { count: 0, duration: Date.now() - start };
  }
}

// D1 deployments manage schema via wrangler migrations. For this test
// we create the expected schema before exercising the adapter.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS feature_flags (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('global','event')),
  scope_id   TEXT NOT NULL DEFAULT '',
  flag_key   TEXT NOT NULL,
  enabled    INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  UNIQUE (scope, scope_id, flag_key)
);
`;

runAdapterSpec('d1', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA);
  const fake = new FakeD1Database(sqlite) as unknown as D1DatabaseShape;
  return new D1Adapter(fake);
});
