/**
 * OSE-729 — migration 0058: category_registry (create + seed).
 *
 * Verifies the canonical category lookup is seeded with EXACTLY the DISTINCT set
 * of event_templates.category values (data-driven, not hand-typed), that it is a
 * soft-reference (no CHECK added to event_templates.category, no recreate), and
 * that a fresh DB is fully seeded by migrations apply alone.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
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

describe('OSE-729 — category_registry (0058)', () => {
  test('seeded with EXACTLY the DISTINCT set of event_templates.category', async () => {
    const reg = await env.DB.prepare(
      'SELECT category FROM category_registry ORDER BY category'
    ).all<{
      category: string;
    }>();
    const distinct = await env.DB.prepare(
      'SELECT DISTINCT category FROM event_templates WHERE category IS NOT NULL ORDER BY category'
    ).all<{ category: string }>();

    const regSet = (reg.results ?? []).map((r) => r.category);
    const distinctSet = (distinct.results ?? []).map((r) => r.category);

    expect(distinctSet.length).toBeGreaterThan(0);
    expect(regSet).toEqual(distinctSet);
  });

  test('is a soft-reference: no CHECK on event_templates.category', async () => {
    const sql = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='event_templates'"
    ).first<{ sql: string }>();
    // event_templates.category must remain a plain TEXT column (no CHECK clause
    // referencing category — that would have forced a recreate).
    expect(sql?.sql).not.toMatch(/CHECK\s*\([^)]*category/i);
  });

  test('category PK rejects a duplicate insert', async () => {
    const existing = await env.DB.prepare('SELECT category FROM category_registry LIMIT 1').first<{
      category: string;
    }>();
    expect(existing?.category).toBeTruthy();
    await expect(
      env.DB.prepare('INSERT INTO category_registry (category) VALUES (?)')
        .bind(existing!.category)
        .run()
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);
  });
});
