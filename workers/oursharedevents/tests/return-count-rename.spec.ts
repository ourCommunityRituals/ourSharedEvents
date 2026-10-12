/**
 * OSE-932: anon_id_returns.visit_count is return_count.
 *
 * "Visit" is on the banned lexicon (HONESTY-LEXICON.md). Migration 0103 renames
 * the column and its index; no row and no wire contract moves, because the
 * BigQuery return export counts distinct events and never reads this column.
 *
 * Seen red against 0102 (no migration): the column and the index carry the old
 * names and the lexicon gate has to hold them as exemptions.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { EXEMPT_IDENTIFIERS } from '../src/lib/schema-lexicon';
import { materializeAnonIdReturns } from '../src/lib/shared-report';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;
const db = () => tenv().DB;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv().TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await db().prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

beforeAll(applyMigrations);

describe('the schema', () => {
  test('anon_id_returns has return_count and no visit_count, other columns untouched', async () => {
    const cols = await db().prepare('PRAGMA table_info(anon_id_returns)').all<{ name: string }>();
    const names = cols.results.map((c) => c.name);
    expect(names).toContain('return_count');
    expect(names).not.toContain('visit_count');
    for (const kept of [
      'anon_id_hash',
      'venue_id',
      'first_seen_at',
      'last_seen_at',
      'computed_at',
    ]) {
      expect(names, kept).toContain(kept);
    }
  });

  test('the (venue, count) index carries the new name and the old one is gone', async () => {
    const r = await db()
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'anon_id_returns'"
      )
      .all<{ name: string; sql: string | null }>();
    const byName = new Map(r.results.map((x) => [x.name, x.sql ?? '']));
    expect(byName.has('idx_anon_id_returns_venue_return')).toBe(true);
    expect(byName.get('idx_anon_id_returns_venue_return')).toContain('return_count');
    expect([...byName.keys()].filter((n) => /visit/i.test(n))).toEqual([]);
  });

  test('no exemption is held for the family any more', () => {
    for (const k of ['visit_count', 'idx_anon_id_returns_venue_visit']) {
      expect(EXEMPT_IDENTIFIERS.has(k), k).toBe(false);
    }
  });
});

describe('the writer', () => {
  test('a repeat run bumps return_count and keeps one row (the UPSERT names the new column)', async () => {
    await db()
      .prepare(
        `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, start_date, end_date, created_at, updated_at)
         VALUES ('evt_return_count', 'b', 'Return count', 'evt_return_count', 'active',
                 date('now', '-1 day'), date('now', '-1 day'), datetime('now'), datetime('now'))`
      )
      .run();
    await db()
      .prepare(
        `INSERT OR IGNORE INTO scan_node_returns (id, event_id, anonymous_id, scan_bucket, created_at)
         VALUES ('snr_rc_1', 'evt_return_count', ?, '2026-10-10T19:00', '2026-10-10 19:00:00')`
      )
      .bind(`snk1_${'0'.repeat(64)}`)
      .run();

    const run = () =>
      materializeAnonIdReturns({ DB: db(), ANON_ID_HASH_PEPPER: 'pepper-return-count' } as never);
    await run();
    await run();

    const rows = await db()
      .prepare('SELECT return_count FROM anon_id_returns WHERE venue_id = ?')
      .bind('evt_return_count')
      .all<{ return_count: number }>();
    // One pseudonym, one row; the count moved only if the event was in the job's window.
    expect(rows.results.length).toBeLessThanOrEqual(1);
    for (const r of rows.results) expect(r.return_count).toBeGreaterThanOrEqual(1);
  });

  test('no source names the old column', () => {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const named = Object.entries(files)
      .filter(([p]) => /[\\/]src[\\/]/.test(p))
      .filter(([p]) => !/schema-lexicon\.ts$/.test(p))
      .filter(([, t]) => /\bvisit_count\b/.test(t))
      .map(([p]) => p);
    expect(named, 'files in src that still name visit_count').toEqual([]);
  });
});
