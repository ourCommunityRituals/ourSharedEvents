/**
 * QA Constraint Verification Tests — validates D1 schema enforcement.
 *
 * Gates:
 *   QA-1. Idempotency: re-run all migrations — zero errors, zero duplicate tables
 *   QA-2. Foreign key enforcement: INSERT with invalid references fails
 *   QA-3. UNIQUE constraints: duplicate slug, qr_token rejected
 *   QA-4. scan_aggregates empty on fresh deploy
 *   QA-5. Production DB isolation: binding mismatch caught
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function applyAllMigrations(): Promise<void> {
  const migrationsDir = join(__dirname, '..', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await env.DB.prepare(stmt).run();
    }
  }
}

// ── Setup: apply migrations + enable FK enforcement ──────────────────────────

beforeAll(async () => {
  await applyAllMigrations();
  // D1 (SQLite) requires explicit FK enforcement
  await env.DB.prepare('PRAGMA foreign_keys = ON').run();
});

// ── QA-1: Idempotency ────────────────────────────────────────────────────────

describe('QA-1: Migration idempotency', () => {
  test('re-running all 7 migrations produces zero errors and zero duplicate tables', async () => {
    // Run migrations a second time — CREATE IF NOT EXISTS should be safe
    await expect(applyAllMigrations()).resolves.not.toThrow();

    // Verify still exactly 7 application tables (no duplicates)
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    expect(names).toHaveLength(7);
  });

  test('re-running index migration produces zero errors and no duplicate indexes', async () => {
    // Indexes also use IF NOT EXISTS
    const indexSql = readFileSync(
      join(__dirname, '..', 'migrations', '0007_create_indexes.sql'),
      'utf8'
    );
    const statements = indexSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      await expect(env.DB.prepare(stmt).run()).resolves.not.toThrow();
    }

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
      // If we get here, FK enforcement is off — fail the test explicitly
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

    // Insert a valid event
    await env.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status)
       VALUES ('evt_fk_test', 'brand_1', 'FK Test Event', 'fk-test-event', 'active')`
    ).run();

    // Insert a valid poster_deployment referencing the event
    await env.DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token)
       VALUES ('pd_fk_test', 'evt_fk_test', 'qr_fk_test_token')`
    ).run();

    // Insert a valid scan referencing both
    await env.DB.prepare(
      `INSERT INTO scans (id, event_id, poster_deployment_id, scan_bucket)
       VALUES ('scan_fk_test', 'evt_fk_test', 'pd_fk_test', '2026-03-26T12')`
    ).run();

    // Verify the scan was inserted
    const result = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM scans WHERE id = 'scan_fk_test'"
    ).first<{ cnt: number }>();
    expect(result?.cnt).toBe(1);
  });
});

// ── QA-3: UNIQUE constraints ─────────────────────────────────────────────────

describe('QA-3: UNIQUE constraints', () => {
  test('events.slug UNIQUE — second INSERT with same slug returns constraint violation', async () => {
    // First insert
    await env.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug)
       VALUES ('evt_uniq_1', 'brand_1', 'Event One', 'unique-slug-test')`
    ).run();

    // Second insert with same slug — must fail
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
    // Ensure parent event exists
    await env.DB.prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug)
       VALUES ('evt_qr_uniq', 'brand_1', 'QR Test Event', 'qr-unique-test')`
    ).run();

    // First poster deployment
    await env.DB.prepare(
      `INSERT INTO poster_deployments (id, event_id, qr_token)
       VALUES ('pd_uniq_1', 'evt_qr_uniq', 'duplicate-qr-token')`
    ).run();

    // Second poster deployment with same qr_token — must fail
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
      `INSERT INTO sponsors (id, event_id, name, impression_token)
       VALUES ('spn_uniq_3', 'evt_spn_uniq', 'Sponsor C', 'imp_token_dup')`
    ).run();

    try {
      await env.DB.prepare(
        `INSERT INTO sponsors (id, event_id, name, impression_token)
         VALUES ('spn_uniq_4', 'evt_spn_uniq', 'Sponsor D', 'imp_token_dup')`
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
    const wranglerPath = join(__dirname, '..', 'wrangler.toml');
    const toml = readFileSync(wranglerPath, 'utf8');

    // Extract all database_name values
    const dbNames = [...toml.matchAll(/database_name\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );

    // Must have 3 distinct database names (local, staging, production)
    expect(dbNames.length).toBeGreaterThanOrEqual(3);
    const unique = new Set(dbNames);
    expect(unique.size).toBe(dbNames.length);

    // Verify naming convention
    expect(dbNames).toContain('ocr-db-local');
    expect(dbNames).toContain('ocr-db-staging');
    expect(dbNames).toContain('ocr-db-production');
  });

  test('wrangler.toml has separate database_id per environment', () => {
    const wranglerPath = join(__dirname, '..', 'wrangler.toml');
    const toml = readFileSync(wranglerPath, 'utf8');

    // Extract all database_id values
    const dbIds = [...toml.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );

    // Must have 3 distinct database IDs
    expect(dbIds.length).toBeGreaterThanOrEqual(3);
    const unique = new Set(dbIds);
    expect(unique.size).toBe(dbIds.length);
  });

  test('no FIREBASE_CLIENT_SECRET or API keys in wrangler.toml', () => {
    const wranglerPath = join(__dirname, '..', 'wrangler.toml');
    const toml = readFileSync(wranglerPath, 'utf8');

    expect(toml).not.toMatch(/FIREBASE_CLIENT_SECRET/i);
    // Ensure no hardcoded API keys (look for patterns like key = "sk-..." or "AIza...")
    expect(toml).not.toMatch(/=\s*"sk-/);
    expect(toml).not.toMatch(/=\s*"AIza/);
  });
});
