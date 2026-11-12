/**
 * A D1 database for NODE-project specs: Node's built-in SQLite (`node:sqlite`)
 * with every migration in `migrations/` applied, behind the slice of the D1
 * API the handlers use (prepare → bind → first / all / run, and batch).
 *
 * Why (OSE-1955): Stryker runs on the node project only (stryker.conf.mjs), so
 * a rule written in SQL could not be mutation-tested: the workers pool is too
 * slow per mutant and does not run on Windows. D1 is SQLite, so the real
 * statements run here against the real schema. Foreign keys are off, as in the
 * miniflare test database (tests/helpers/seed-sponsor.ts says the same).
 *
 * Not a full D1: no meta, no exec, no dump; `first(column)` is supported.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', 'migrations');

export interface SqliteD1 {
  prepare(sql: string): SqliteStatement;
  batch(stmts: SqliteStatement[]): Promise<unknown[]>;
  /** The raw SQLite handle, for a spec's own setup. */
  raw: DatabaseSync;
}

export interface SqliteStatement {
  bind(...values: unknown[]): SqliteStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }>;
  run(): Promise<{ success: true; meta: { changes: number } }>;
}

function toSql(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
}

function statement(db: DatabaseSync, sql: string, values: unknown[] = []): SqliteStatement {
  // Prepared lazily, like D1: an invalid statement rejects the call, not prepare().
  const stmt = () => db.prepare(sql);
  const args = () => values.map(toSql);
  return {
    bind: (...v) => statement(db, sql, v),
    async first<T>(column?: string) {
      const row = stmt().get(...args()) as Record<string, unknown> | undefined;
      if (!row) return null;
      return (column ? row[column] : { ...row }) as T;
    },
    async all<T>() {
      const rows = stmt().all(...args()) as Record<string, unknown>[];
      return { results: rows.map((r) => ({ ...r })) as T[], success: true as const };
    },
    async run() {
      const r = stmt().run(...args());
      return { success: true as const, meta: { changes: Number(r.changes) } };
    },
  };
}

/** A fresh in-memory database at the current migration level. */
export function sqliteD1(): SqliteD1 {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return {
    raw: db,
    prepare: (sql) => statement(db, sql),
    async batch(stmts) {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}
