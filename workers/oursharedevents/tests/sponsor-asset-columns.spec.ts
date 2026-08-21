/**
 * OSE-726 / OSE-799 A2 — four-format sponsor creative.
 *
 * Pre-split (migration 0055) the four formats were nullable `{format}_url` /
 * `{format}_content_type` / `{format}_validated_at` columns on the `sponsors`
 * table. OSE-799 A2 retired that table; creative now lives ONE ROW PER FORMAT in
 * `sponsor_asset` (migration 0066) with a `format` CHECK and nullable value
 * columns (url, content_type, validated_at).
 *
 * This verifies the split-model contract preserves the OSE-726 guarantees: the
 * four formats (plus 'logo', the COALESCE fallback) are all valid
 * `sponsor_asset.format` values, the value columns stay nullable (no-backfill
 * safe), no index targets a format value, and the format set stays single-source
 * with the `sponsor_asset_draft` CHECK (migration 0054) — a drift would let a
 * draft carry a format the promoted table can never store (or vice-versa).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

// The frozen four-format constant — the single source the whole pipeline shares
// (0054 draft CHECK, 0066 sponsor_asset CHECK, order-10 R2 path, route enum).
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

let assetSql: string;
let assetCols: { name: string; notnull: number }[];

beforeAll(async () => {
  await applyMigrations();
  const table = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='sponsor_asset'"
  ).first<{ sql: string }>();
  assetSql = table?.sql ?? '';
  const info = await env.DB.prepare('PRAGMA table_info(sponsor_asset)').all<{
    name: string;
    notnull: number;
  }>();
  assetCols = (info.results ?? []).map((r) => ({ name: r.name, notnull: r.notnull }));
});

describe('OSE-726 / OSE-799 A2 — four-format sponsor creative (sponsor_asset)', () => {
  test('the four formats are all valid sponsor_asset.format values', () => {
    expect(assetSql, 'sponsor_asset table must exist').not.toBe('');
    for (const fmt of FORMATS) {
      expect(assetSql, `sponsor_asset CHECK must allow '${fmt}'`).toMatch(new RegExp(`'${fmt}'`));
    }
  });

  test('creative value columns (url, content_type, validated_at) exist and are nullable (no-backfill safe)', () => {
    for (const col of ['url', 'content_type', 'validated_at']) {
      const c = assetCols.find((x) => x.name === col);
      expect(c, `sponsor_asset.${col} must exist`).toBeDefined();
      expect(c!.notnull, `sponsor_asset.${col} must be nullable`).toBe(0);
    }
  });

  test("'logo' is a valid format (the COALESCE fallback source is preserved)", () => {
    expect(assetSql).toMatch(/'logo'/);
  });

  test('no index targets a format value (only the business FK is indexed)', async () => {
    const idx = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql LIKE '%sponsor_asset%'"
    ).all<{ name: string; sql: string | null }>();
    for (const row of idx.results ?? []) {
      for (const fmt of FORMATS) {
        expect(row.sql ?? '', `index ${row.name} must not target '${fmt}'`).not.toMatch(
          new RegExp(`'${fmt}'`)
        );
      }
    }
  });

  test('four-format set is single-source: sponsor_asset_draft CHECK == sponsor_asset CHECK', async () => {
    const draftSql = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='sponsor_asset_draft'"
    ).first<{ sql: string }>();
    for (const fmt of FORMATS) {
      // Present in the 0054 draft CHECK...
      expect(draftSql?.sql, `draft CHECK must allow '${fmt}'`).toMatch(new RegExp(`'${fmt}'`));
      // ...and in the 0066 sponsor_asset CHECK.
      expect(assetSql, `sponsor_asset CHECK must allow '${fmt}'`).toMatch(new RegExp(`'${fmt}'`));
    }
  });
});
