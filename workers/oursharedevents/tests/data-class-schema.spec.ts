/**
 * data-class-schema.spec.ts — OSE-606/OSE-608 migration 0052.
 *
 * Verifies the `data_class` enum on events: the third data class beside
 * production/synthetic. Default 'production' (existing rows are real), CHECK
 * makes an unknown class impossible at write time, 'demo' is accepted.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

beforeAll(async () => {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
});

describe('OSE-606/608: events.data_class enum (migration 0052)', () => {
  test('events has a data_class column', async () => {
    const info = await tenv().DB.prepare('PRAGMA table_info(events)').all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).toContain('data_class');
  });

  test('defaults to "production" for rows written without it', async () => {
    await tenv()
      .DB.prepare(
        "INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, 'root', 'DC Default', 'dc-default', 'draft')"
      )
      .bind('evt_dc_default')
      .run();
    const row = await tenv()
      .DB.prepare('SELECT data_class FROM events WHERE id = ?')
      .bind('evt_dc_default')
      .first<{ data_class: string }>();
    expect(row?.data_class).toBe('production');
  });

  test('accepts data_class = "demo"', async () => {
    await tenv()
      .DB.prepare(
        "INSERT INTO events (id, brand_id, title, slug, status, data_class) VALUES (?, 'root', 'DC Demo', 'dc-demo', 'active', 'demo')"
      )
      .bind('evt_dc_demo')
      .run();
    const row = await tenv()
      .DB.prepare('SELECT data_class FROM events WHERE id = ?')
      .bind('evt_dc_demo')
      .first<{ data_class: string }>();
    expect(row?.data_class).toBe('demo');
  });

  test('CHECK rejects an unknown data_class (fail-closed at write time)', async () => {
    await expect(
      tenv()
        .DB.prepare(
          "INSERT INTO events (id, brand_id, title, slug, status, data_class) VALUES (?, 'root', 'DC Bad', 'dc-bad', 'draft', 'bogus')"
        )
        .bind('evt_dc_bad')
        .run()
    ).rejects.toThrow();
  });
});
