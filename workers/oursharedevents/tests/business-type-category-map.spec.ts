/**
 * OSE-730/OSE-731 — migrations 0059 (schema) + 0060 (seed) business_type_category_map.
 *
 * The headline #5 invariant: EVERY is_default=1 mapping resolves to >=1
 * SELECTABLE template — selectable = a template in that category with
 * max_clearance_tier IS NOT NULL AND <= ALLOWED_MAX_TIER (the 0057 gate). A
 * default that points at a category with no selectable template would strand a
 * business type on step 5 with nothing to choose. Also validates referential
 * consistency (every seed category exists in category_registry) and the schema
 * guards (UNIQUE, index, DDL/DML split).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  resolveAllowedMaxTier,
  SELECTABLE_TEMPLATE_SQL_PREDICATE,
} from '../src/lib/template-clearance';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;

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

beforeAll(async () => {
  await applyMigrations();
});

describe('OSE-731 — business_type_category_map seed + selectable-default invariant', () => {
  test('map is seeded (non-empty)', async () => {
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM business_type_category_map').first<{
      c: number;
    }>();
    expect(cnt?.c ?? 0).toBeGreaterThan(0);
  });

  test('INVARIANT: every is_default=1 resolves to >=1 selectable template (zero rows)', async () => {
    const allowed = resolveAllowedMaxTier();
    const orphans = await env.DB.prepare(
      `SELECT m.business_type, m.category FROM business_type_category_map m
       WHERE m.is_default = 1
         AND NOT EXISTS (
           SELECT 1 FROM event_templates e
           WHERE e.category = m.category AND ${SELECTABLE_TEMPLATE_SQL_PREDICATE}
         )`
    )
      .bind(allowed)
      .all<{ business_type: string; category: string }>();

    const rows = orphans.results ?? [];
    expect(
      rows,
      `these default mappings have NO selectable template: ${JSON.stringify(rows)}`
    ).toHaveLength(0);
  });

  test('referential consistency: every seed category exists in category_registry', async () => {
    const dangling = await env.DB.prepare(
      `SELECT DISTINCT m.category FROM business_type_category_map m
       LEFT JOIN category_registry c ON m.category = c.category
       WHERE c.category IS NULL`
    ).all<{ category: string }>();
    expect(dangling.results ?? []).toHaveLength(0);
  });

  test('schema (0059): UNIQUE(business_type,category) rejects a duplicate', async () => {
    const row = await env.DB.prepare(
      'SELECT business_type, category FROM business_type_category_map LIMIT 1'
    ).first<{ business_type: string; category: string }>();
    expect(row?.business_type).toBeTruthy();
    await expect(
      env.DB.prepare(
        "INSERT INTO business_type_category_map (id, business_type, category) VALUES ('dup_test', ?, ?)"
      )
        .bind(row!.business_type, row!.category)
        .run()
    ).rejects.toThrow(/UNIQUE/i);
  });

  test('schema (0059): lookup index on business_type exists', async () => {
    const idx = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_business_type_category_map_bt'"
    ).first<{ name: string }>();
    expect(idx?.name).toBe('idx_business_type_category_map_bt');
  });

  test('DDL/DML split: 0059 has no INSERT; 0060 has no CREATE/ALTER', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const body = (re: RegExp) => {
      const entry = Object.entries(sources).find(([p]) => re.test(p.replace(/\\/g, '/')));
      expect(entry, `migration source ${re} must be visible`).toBeTruthy();
      return entry![1]
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');
    };
    const ddl = body(/0059_create_business_type_category_map\.sql$/);
    const dml = body(/0060_seed_business_type_category_map\.sql$/);
    expect(ddl).not.toMatch(/\bINSERT\b/i);
    expect(dml).not.toMatch(/\bCREATE\b/i);
    expect(dml).not.toMatch(/\bALTER\b/i);
  });
});
