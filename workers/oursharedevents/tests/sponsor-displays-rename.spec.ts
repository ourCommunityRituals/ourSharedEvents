/**
 * OSE-931: sponsor_impressions is sponsor_displays, end to end.
 *
 * "Display" states a render fact; "impression" is the ad-tech claim of a view
 * (PO 2026-08-20). Migration 0102 rebuilds the table (SQLite cannot change a
 * default), renames its three indexes and maps the stored value
 * 'impression' -> 'display'.
 *
 * Seen red against 0101 (no migration): the table, the default and the indexes
 * are the old ones, and the beacon writes 'impression'.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { seedSplitSponsor } from './helpers/seed-sponsor';

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

async function names(type: 'table' | 'index'): Promise<string[]> {
  const r = await db()
    .prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name')
    .bind(type)
    .all<{ name: string }>();
  return r.results.map((x) => x.name);
}

describe('the schema', () => {
  test('sponsor_displays exists and sponsor_impressions does not', async () => {
    const tables = await names('table');
    expect(tables).toContain('sponsor_displays');
    expect(tables).not.toContain('sponsor_impressions');
  });

  test('its three indexes carry the new name, and no old index is left', async () => {
    const idx = await names('index');
    for (const n of [
      'idx_sponsor_displays_sponsor',
      'idx_sponsor_displays_event',
      'idx_sponsor_displays_h3_res7',
    ]) {
      expect(idx, n).toContain(n);
    }
    expect(idx.filter((n) => /impression/i.test(n))).toEqual([]);
  });

  test('the columns are 0067 exactly, and event_type defaults to display', async () => {
    const cols = await db()
      .prepare('PRAGMA table_info(sponsor_displays)')
      .all<{ name: string; dflt_value: string | null }>();
    expect(cols.results.map((c) => c.name)).toEqual([
      'id',
      'sponsor_id',
      'event_id',
      'surface',
      'placement',
      'event_type',
      'created_at',
      'h3_res7',
    ]);
    const et = cols.results.find((c) => c.name === 'event_type');
    expect(et?.dflt_value).toBe("'display'");
  });
});

describe('the rebuild keeps what was stored, with the value mapped', () => {
  test("'impression' becomes 'display', a click stays a click, and nothing is lost", async () => {
    const all: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
    const copy = all.find((s) => /INSERT OR IGNORE INTO sponsor_displays/i.test(s));
    expect(copy, 'the migration copy statement is in the applied list').toBeTruthy();

    // Real parents for the foreign keys.
    await db()
      .prepare(
        `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         VALUES ('evt_displays_rename', 'b', 'Displays', 'evt_displays_rename', 'active', datetime('now'), datetime('now'))`
      )
      .run();
    await seedSplitSponsor(db(), { id: 'sp_displays_rename', eventId: 'evt_displays_rename' });

    // The old table as 0067 left it, with three rows.
    await db().prepare('DROP TABLE IF EXISTS sponsor_impressions').run();
    await db()
      .prepare(
        `CREATE TABLE sponsor_impressions (
           id TEXT PRIMARY KEY, sponsor_id TEXT NOT NULL, event_id TEXT NOT NULL,
           surface TEXT NOT NULL, placement TEXT NOT NULL,
           event_type TEXT NOT NULL DEFAULT 'impression',
           created_at TEXT NOT NULL DEFAULT (datetime('now')), h3_res7 TEXT)`
      )
      .run();
    await db()
      .prepare(
        `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, h3_res7)
         VALUES ('r1','sp_displays_rename','evt_displays_rename','display','p1','impression','8a1'),
                ('r2','sp_displays_rename','evt_displays_rename','poster','p2','click',NULL),
                ('r3','sp_displays_rename','evt_displays_rename','display','p1','impression',NULL)`
      )
      .run();
    await db().prepare("DELETE FROM sponsor_displays WHERE id IN ('r1','r2','r3')").run();

    await db().prepare(copy!).run();
    await db().prepare(copy!).run(); // again: nothing duplicated

    const r = await db()
      .prepare(
        "SELECT id, event_type, h3_res7 FROM sponsor_displays WHERE id IN ('r1','r2','r3') ORDER BY id"
      )
      .all<{ id: string; event_type: string; h3_res7: string | null }>();
    expect(r.results).toEqual([
      { id: 'r1', event_type: 'display', h3_res7: '8a1' },
      { id: 'r2', event_type: 'click', h3_res7: null },
      { id: 'r3', event_type: 'display', h3_res7: null },
    ]);

    await db().prepare('DROP TABLE sponsor_impressions').run();
    await db().prepare("DELETE FROM sponsor_displays WHERE id IN ('r1','r2','r3')").run();
  });
});

describe('the writers', () => {
  test("the render beacon stores 'display', and no source inserts into the old table", () => {
    const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
    const src = Object.entries(files).filter(([p]) => /[\\/]src[\\/]/.test(p));
    const oldTable = src
      .filter(([p, t]) => !/schema-lexicon.ts$/.test(p) && /bsponsor_impressionsb/.test(t))
      .map(([p]) => p); // schema-lexicon.ts names it once, in the rename comment
    expect(oldTable, 'files in src that still name sponsor_impressions').toEqual([]);

    const sponsors = src.find(([p]) => /handlers[\\/]sponsors\.ts$/.test(p))?.[1] ?? '';
    expect(sponsors).toMatch(/INSERT INTO sponsor_displays[\s\S]{0,200}'display'/);
    expect(sponsors).not.toMatch(/VALUES \(\?, \?, \?, \?, \?, 'impression', \?\)/);
  });
});
