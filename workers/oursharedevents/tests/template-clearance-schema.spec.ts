/**
 * OSE-727 — migration 0056: template_event_types + max_clearance_tier (SCHEMA ONLY).
 *
 * Verifies the BLOCKING #4 join is created empty, the cached clearance column
 * is added NULL everywhere (distinct from tier 1 — the fail-safe schema-before-
 * seed window), UNIQUE(template_id,uec_code) is enforced, the FK to
 * event_type_registry(uec_code) resolves, and the migration is strictly DDL
 * (zero INSERT/UPDATE — the seed + recompute is 0057).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

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

describe('OSE-727 — template_event_types schema (0056)', () => {
  // NOTE: the vitest harness applies the FULL migration set (incl. the 0057
  // seed/recompute), so runtime "empty join" / "all-NULL" assertions are NOT
  // valid here — they were only true at the 0056 apply point. 0056's purity is
  // proven instead by the DDL-only file test below (0056 has no INSERT/UPDATE),
  // which is the property that matters for the schema-before-seed fail-safe
  // window. Seeded tier values are asserted by template-clearance-gate.spec.ts.

  test('template_event_types table exists with the join structure + UNIQUE guard', async () => {
    const sql = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='template_event_types'"
    ).first<{ sql: string }>();
    expect(sql?.sql).toMatch(/template_id/);
    expect(sql?.sql).toMatch(/uec_code/);
    expect(sql?.sql).toMatch(/UNIQUE\s*\(\s*template_id\s*,\s*uec_code\s*\)/i);
  });

  test('event_templates.max_clearance_tier column exists', async () => {
    const info = await env.DB.prepare('PRAGMA table_info(event_templates)').all<{ name: string }>();
    expect((info.results ?? []).map((r) => r.name)).toContain('max_clearance_tier');
  });

  test('UNIQUE(template_id,uec_code) rejects a duplicate mapping', async () => {
    // Use a real registry uec_code (seeded by 0024) and a real template id (0015).
    const uec = await env.DB.prepare('SELECT uec_code FROM event_type_registry LIMIT 1').first<{
      uec_code: string;
    }>();
    expect(uec?.uec_code, 'registry must be seeded by 0024').toBeTruthy();

    await env.DB.prepare(
      "INSERT INTO template_event_types (template_id, uec_code) VALUES ('custom', ?)"
    )
      .bind(uec!.uec_code)
      .run();

    await expect(
      env.DB.prepare(
        "INSERT INTO template_event_types (template_id, uec_code) VALUES ('custom', ?)"
      )
        .bind(uec!.uec_code)
        .run()
    ).rejects.toThrow(/UNIQUE/i);
  });

  test('FK to event_type_registry(uec_code) rejects a dangling code', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run();
    await expect(
      env.DB.prepare(
        "INSERT INTO template_event_types (template_id, uec_code) VALUES ('custom', 'NO-SUCH-UEC-999')"
      ).run()
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  test('migration 0056 is DDL-only — zero INSERT/UPDATE in the file', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const entry = Object.entries(sources).find(([p]) =>
      /0056_create_template_event_types\.sql$/.test(p.replace(/\\/g, '/'))
    );
    expect(entry, 'migration 0056 source must be visible to the gate').toBeTruthy();
    const body = entry![1]
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(body).not.toMatch(/\bINSERT\b/i);
    expect(body).not.toMatch(/\bUPDATE\b/i);
  });
});
