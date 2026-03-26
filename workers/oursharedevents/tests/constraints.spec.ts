/**
 * QA Constraint Verification Tests — validates D1 schema enforcement.
 *
 * Gates:
 *   QA-1. Idempotency: re-run all migrations — zero errors, zero duplicate tables
 *   QA-2. Foreign key enforcement: INSERT with invalid references fails
 *   QA-3. UNIQUE constraints: duplicate slug, qr_token rejected
 *   QA-4. scan_aggregates empty on fresh deploy
 *   QA-5. Production DB isolation: binding mismatch caught
 *
 * Migration SQL and config files are injected at build time via vitest.config.ts
 * `define` constants (Workers runtime cannot use node:fs).
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

// ── Test env bindings (injected via vitest.config.ts miniflare bindings) ─────
interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string; // JSON array of SQL statements
  TEST_SOURCE_FILES_JSON: string;
  TEST_WRANGLER_TOML: string;
}

// ── Setup: apply migrations + enable FK enforcement ──────────────────────────

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare('PRAGMA foreign_keys = ON').run();
});

// ── QA-1: Idempotency ────────────────────────────────────────────────────────

describe('QA-1: Migration idempotency', () => {
  test('re-running all 7 migrations produces zero errors and zero duplicate tables', async () => {
    // Run migrations a second time — CREATE IF NOT EXISTS should be safe
    await expect(applyMigrations()).resolves.not.toThrow();

    // Verify still exactly 7 application tables (no duplicates)
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    expect(names).toHaveLength(7);
  });

  test('indexes remain at exactly 11 after idempotent re-run', async () => {
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all();
    expect(indexes.results).toHaveLength(11);
  });
});

// ── QA-2: Foreign key enforcement ────────────────────────────────────────────

describe('QA-2: Foreign key constraints', () => {
  test('INSERT into scans with invalid event_id fails with FK error', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run();

    try {
      await env.DB.prepare(
        `INSERT INTO scans (id, event_id, poster_deployment_id, scan_bucket)
         VALUES ('scan_bad_fk', 'nonexistent_event', 'nonexistent_pd', '2026-03-26T12')`
      ).run();
      expect.fail('INSERT with invalid event_id should have thrown FK constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/FOREIGN KEY/);
    }
  });

  test('INSERT into poster_deployments with invalid event_id fails with FK error', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run();

    try {
      await env.DB.prepare(
        `INSERT INTO poster_deployments (id, event_id, qr_token)
         VALUES ('pd_bad_fk', 'nonexistent_event', 'token_fk_test')`
      ).run();
      expect.fail(
        'INSERT with invalid event_id should have thrown FK constraint error'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/FOREIGN KEY/);
    }
  });

  test('INSERT into sponsors with invalid event_id fails with FK error', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run();

    try {
      await env.DB.prepare(
        `INSERT INTO sponsors (id, event_id, name)
         VALUES ('spn_bad_fk', 'nonexistent_event', 'Bad Sponsor')`
      ).run();
      expect.fail(
        'INSERT with invalid event_id should have thrown FK constraint error'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/FOREIGN KEY/);
    }
  });

  test('valid FK chain succeeds: event → poster_deployment → scan', async () => {
    await env.DB.prepare('PRAGMA foreign_keys = ON').run();

    await env.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status)
       VALUES ('evt_fk_test', 'brand_1', 'FK Test Event', 'fk-test-event', 'active')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token)
       VALUES ('pd_fk_test', 'evt_fk_test', 'qr_fk_test_token')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO scans (id, event_id, poster_deployment_id, scan_bucket)
       VALUES ('scan_fk_test', 'evt_fk_test', 'pd_fk_test', '2026-03-26T12')`
    ).run();

    const result = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM scans WHERE id = 'scan_fk_test'"
    ).first<{ cnt: number }>();
    expect(result?.cnt).toBe(1);
  });
});

// ── QA-3: UNIQUE constraints ─────────────────────────────────────────────────

describe('QA-3: UNIQUE constraints', () => {
  test('events.slug UNIQUE — second INSERT with same slug returns constraint violation', async () => {
    await env.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug)
       VALUES ('evt_uniq_1', 'brand_1', 'Event One', 'unique-slug-test')`
    ).run();

    try {
      await env.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug)
         VALUES ('evt_uniq_2', 'brand_1', 'Event Two', 'unique-slug-test')`
      ).run();
      expect.fail('Duplicate slug INSERT should have thrown UNIQUE constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });

  test('poster_deployments.qr_token UNIQUE — duplicate token insert fails cleanly', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug)
       VALUES ('evt_qr_uniq', 'brand_1', 'QR Test Event', 'qr-unique-test')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token)
       VALUES ('pd_uniq_1', 'evt_qr_uniq', 'duplicate-qr-token')`
    ).run();

    try {
      await env.DB.prepare(
        `INSERT INTO poster_deployments (id, event_id, qr_token)
         VALUES ('pd_uniq_2', 'evt_qr_uniq', 'duplicate-qr-token')`
      ).run();
      expect.fail('Duplicate qr_token INSERT should have thrown UNIQUE constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });

  test('sponsors.click_token UNIQUE — duplicate click_token insert fails', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug)
       VALUES ('evt_spn_uniq', 'brand_1', 'Sponsor Uniq Event', 'sponsor-unique-test')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO sponsors (id, event_id, name, click_token)
       VALUES ('spn_uniq_1', 'evt_spn_uniq', 'Sponsor A', 'click_token_dup')`
    ).run();

    try {
      await env.DB.prepare(
        `INSERT INTO sponsors (id, event_id, name, click_token)
         VALUES ('spn_uniq_2', 'evt_spn_uniq', 'Sponsor B', 'click_token_dup')`
      ).run();
      expect.fail('Duplicate click_token INSERT should have thrown UNIQUE constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });

  test('sponsors.impression_token UNIQUE — duplicate impression_token insert fails', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug)
       VALUES ('evt_imp_uniq', 'brand_1', 'Impression Uniq Event', 'impression-unique-test')`
    ).run();

    await env.DB.prepare(
      `INSERT INTO sponsors (id, event_id, name, impression_token)
       VALUES ('spn_uniq_3', 'evt_imp_uniq', 'Sponsor C', 'imp_token_dup')`
    ).run();

    try {
      await env.DB.prepare(
        `INSERT INTO sponsors (id, event_id, name, impression_token)
         VALUES ('spn_uniq_4', 'evt_imp_uniq', 'Sponsor D', 'imp_token_dup')`
      ).run();
      expect.fail(
        'Duplicate impression_token INSERT should have thrown UNIQUE constraint error'
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });
});

// ── QA-4: scan_aggregates empty on fresh deploy ──────────────────────────────

describe('QA-4: scan_aggregates fresh state', () => {
  test('scan_aggregates has zero rows on fresh deploy — no data until scheduled Worker runs', async () => {
    const result = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM scan_aggregates'
    ).first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });
});

// ── QA-5: Production DB isolation ────────────────────────────────────────────

describe('QA-5: Production DB isolation', () => {
  test('wrangler.toml has separate database_name per environment — no cross-env contamination', () => {
    const toml = (env as unknown as TestEnv).TEST_WRANGLER_TOML;

    const dbNames = [...toml.matchAll(/database_name\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );

    expect(dbNames.length).toBeGreaterThanOrEqual(3);
    const unique = new Set(dbNames);
    expect(unique.size).toBe(dbNames.length);

    expect(dbNames).toContain('ocr-db-local');
    expect(dbNames).toContain('ocr-db-staging');
    expect(dbNames).toContain('ocr-db-production');
  });

  test('wrangler.toml has separate database_id per environment', () => {
    const toml = (env as unknown as TestEnv).TEST_WRANGLER_TOML;

    const dbIds = [...toml.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );

    expect(dbIds.length).toBeGreaterThanOrEqual(3);
    const unique = new Set(dbIds);
    expect(unique.size).toBe(dbIds.length);
  });

  test('no FIREBASE_CLIENT_SECRET or API keys in wrangler.toml', () => {
    const toml = (env as unknown as TestEnv).TEST_WRANGLER_TOML;

    expect(toml).not.toMatch(/FIREBASE_CLIENT_SECRET/i);
    expect(toml).not.toMatch(/=\s*"sk-/);
    expect(toml).not.toMatch(/=\s*"AIza/);
  });
});
