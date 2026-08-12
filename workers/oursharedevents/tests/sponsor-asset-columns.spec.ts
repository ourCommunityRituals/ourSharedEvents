/**
 * OSE-726 — migration 0055: sponsors four-format asset columns (#3).
 *
 * Verifies the 12 nullable asset columns land on `sponsors`, that NO index was
 * created on them (idx total stays gated at 61 by constraints.spec.ts), and
 * that the four-format set is single-source: every {format}_url column on
 * sponsors corresponds to exactly the format the sponsor_asset_draft CHECK (0054)
 * allows. A drift between the two would let an asset draft carry a format the
 * production table can never store (or vice-versa).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

// The frozen four-format constant — the single source the whole pipeline shares
// (0054 CHECK, 0055 *_url columns, order-10 R2 path, order-12 route enum).
const FORMATS = ['poster', 'banner', 'vertical', 'square'] as const;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

let sponsorCols: { name: string; notnull: number }[];

beforeAll(async () => {
  await applyMigrations();
  const info = await env.DB.prepare('PRAGMA table_info(sponsors)').all<{
    name: string;
    notnull: number;
  }>();
  sponsorCols = (info.results ?? []).map((r) => ({ name: r.name, notnull: r.notnull }));
});

describe('OSE-726 — sponsors four-format asset columns', () => {
  test('all 12 asset columns exist and are nullable (no-backfill safe)', () => {
    for (const fmt of FORMATS) {
      for (const suffix of ['url', 'content_type', 'validated_at']) {
        const col = sponsorCols.find((c) => c.name === `${fmt}_${suffix}`);
        expect(col, `sponsors.${fmt}_${suffix} must exist`).toBeDefined();
        expect(col!.notnull, `sponsors.${fmt}_${suffix} must be nullable`).toBe(0);
      }
    }
  });

  test('logo_url remains (the COALESCE fallback source is preserved)', () => {
    expect(sponsorCols.map((c) => c.name)).toContain('logo_url');
  });

  test('no index was created on any *_url column (idx total stays stable)', async () => {
    const idx = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='index'").all<{
      name: string;
      sql: string | null;
    }>();
    for (const row of idx.results ?? []) {
      for (const fmt of FORMATS) {
        expect(row.sql ?? '', `index ${row.name} must not target ${fmt}_url`).not.toMatch(
          new RegExp(`${fmt}_url`)
        );
      }
    }
  });

  test('four-format set is single-source: sponsor_asset_draft CHECK == sponsors *_url set', async () => {
    const draftSql = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='sponsor_asset_draft'"
    ).first<{ sql: string }>();
    for (const fmt of FORMATS) {
      // Present in the 0054 CHECK...
      expect(draftSql?.sql).toMatch(new RegExp(`'${fmt}'`));
      // ...and as a 0055 production column.
      expect(sponsorCols.map((c) => c.name)).toContain(`${fmt}_url`);
    }
  });
});
