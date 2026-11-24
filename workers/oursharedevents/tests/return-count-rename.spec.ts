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
  test('OSE-2214: no source writes anon_id_returns any more (the nightly writer is retired)', () => {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const writers = Object.entries(files)
      .filter(([p]) => /[\\/]src[\\/]/.test(p))
      .filter(([, t]) => /INSERT\s+(OR\s+\w+\s+)?INTO\s+anon_id_returns\b/i.test(t))
      .map(([p]) => p);
    expect(writers, 'files in src that still write anon_id_returns').toEqual([]);
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
