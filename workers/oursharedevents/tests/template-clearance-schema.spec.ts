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
  test('template_event_types exists and is empty (seed is 0057)', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM template_event_types').first<{
      cnt: number;
    }>();
    expect(row?.cnt).toBe(0);
  });

  test('event_templates.max_clearance_tier exists and is NULL for every row (distinct from tier 1)', async () => {
    const info = await env.DB.prepare('PRAGMA table_info(event_templates)').all<{ name: string }>();
    expect((info.results ?? []).map((r) => r.name)).toContain('max_clearance_tier');

    const nonNull = await env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM event_templates WHERE max_clearance_tier IS NOT NULL'
    ).first<{ cnt: number }>();
    expect(nonNull?.cnt).toBe(0);
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
