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
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // ALTER TABLE ADD COLUMN is not idempotent in SQLite —
      // "duplicate column" on re-run means the column already exists, which is fine.
      if (msg.includes('duplicate column name')) continue;
      // OSE-207 / migration 0028: ALTER TABLE DROP COLUMN is the symmetric case.
      // "no such column" on re-run means the column has already been dropped.
      // SQLite < 3.44 lacks DROP COLUMN IF EXISTS, so we treat it the same way.
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare('PRAGMA foreign_keys = ON').run();
});

// ── QA-1: Idempotency ────────────────────────────────────────────────────────

describe('QA-1: Migration idempotency', () => {
  test('re-running all migrations produces zero errors and zero duplicate tables', async () => {
    // Run migrations a second time — CREATE IF NOT EXISTS / DROP IF EXISTS should be safe
    await expect(applyMigrations()).resolves.not.toThrow();

    // 16 tables: admin_audit_log (OSE-212), corridors, event_template_*,
    // events, node_hierarchy, poster_deployments, scan_aggregates, scans,
    // shortlinks (OSE-240, migration 0030), sponsors, sponsor_areas,
    // sponsor_event_types, sponsor_impressions, subscribers,
    // event_type_registry, corridor_regulatory_status
    // (checkins/registrations dropped by migration 0009, moved to FORMS_DB)
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    // 16 (pre-OSE-272) + 3 (anon_id_returns, corridor_density_baseline,
    // event_series — OSE-272 Session 2) + 1 (bigquery_export_state —
    // OSE-272 Session 4) + 1 (campaigns — migration 0039) = 21
    // + 2 (security_alerts, security_metrics — migration 0042)
    // + 2 (report_access_log, export_manifest — migration 0043) = 25
    // + 1 (corridor_density_snapshots — migration 0044) = 26
    // + 1 (admin_brand_memberships — migration 0050, OSE-666/B2) = 27.
    // + 1 (sponsor_business_draft — migration 0053, OSE-724 Sponsor Onboarding) = 28.
    // + 1 (sponsor_asset_draft — migration 0054, OSE-725 Sponsor Onboarding) = 29.
    // + 1 (template_event_types — migration 0056, OSE-727 Sponsor Onboarding) = 30.
    // + 1 (category_registry — migration 0058, OSE-729 Sponsor Onboarding) = 31.
    expect(names).toHaveLength(31);
  });

  test('indexes remain at exactly 63 after idempotent re-run', async () => {
    // 33 (pre-OSE-240) + 2 (idx_shortlinks_*, OSE-240) + 4 (OSE-272 Session 2:
    // idx_anon_id_returns_venue_visit, idx_event_series_venue_state,
    // idx_event_series_venue_dow_hour, idx_events_series_start) + 1
    // (idx_sponsors_is_local, OSE-330 Phase 2 — Local Sponsor Covenant
    // enforcement, migration 0036) + 2 (idx_campaigns_brand_id,
    // idx_sponsors_campaign_id — migrations 0039/0040) = 42
    // + 4 (idx_security_metrics_*, idx_security_alerts_* — migration 0042)
    // + 6 (idx_report_access_log_*, idx_export_manifest_* — migration 0043) = 52
    // + 2 (idx_cds_corridor_dow_hour, idx_cds_snapshot_date — migration 0044) = 54
    // + 1 (idx_sponsor_impressions_h3_res7 — migration 0048, OSE-635) = 55
    // + 1 (idx_admin_brand_memberships_email — migration 0050, OSE-666/B2) = 56.
    // + 1 (idx_events_data_class — migration 0052, OSE-606/608) = 57.
    // + 3 (idx_sponsor_business_draft_brand/_event/_status — migration 0053,
    //   OSE-724 Sponsor Onboarding) = 60.
    // + 1 (idx_sponsor_asset_draft_token — migration 0054, OSE-725) = 61.
    // + 2 (idx_template_event_types_template/_uec — migration 0056, OSE-727) = 63.
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all();
    expect(indexes.results).toHaveLength(63);
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
      expect.fail('INSERT with invalid event_id should have thrown FK constraint error');
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
      expect.fail('INSERT with invalid event_id should have thrown FK constraint error');
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
      expect.fail('Duplicate impression_token INSERT should have thrown UNIQUE constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });
});

// ── QA-4: scan_aggregates empty on fresh deploy ──────────────────────────────

describe('QA-4: scan_aggregates fresh state', () => {
  test('scan_aggregates has zero rows on fresh deploy — no data until scheduled Worker runs', async () => {
    const result = await env.DB.prepare('SELECT COUNT(*) as cnt FROM scan_aggregates').first<{
      cnt: number;
    }>();
    expect(result?.cnt).toBe(0);
  });
});

// ── QA-5: Production DB isolation ────────────────────────────────────────────

describe('QA-5: Production DB isolation', () => {
  test('wrangler.toml has separate database_name per environment — no cross-env contamination', () => {
    const toml = (env as unknown as TestEnv).TEST_WRANGLER_TOML;

    const dbNames = [...toml.matchAll(/database_name\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

    // 6 databases: 3 for DB (local/staging/prod) + 3 for FORMS_DB (local/staging/prod)
    expect(dbNames.length).toBeGreaterThanOrEqual(6);
    const unique = new Set(dbNames);
    expect(unique.size).toBe(dbNames.length);

    // Main DB
    expect(dbNames).toContain('ocr-db-local');
    expect(dbNames).toContain('ocr-db-staging');
    expect(dbNames).toContain('ocr-db-production');

    // Forms DB (separate)
    expect(dbNames).toContain('ocr-forms-db-local');
    expect(dbNames).toContain('ocr-forms-db-staging');
    expect(dbNames).toContain('ocr-forms-db-production');
  });

  test('wrangler.toml has separate database_id per environment', () => {
    const toml = (env as unknown as TestEnv).TEST_WRANGLER_TOML;

    const dbIds = [...toml.matchAll(/database_id\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

    // 6 database IDs: 3 for DB + 3 for FORMS_DB
    expect(dbIds.length).toBeGreaterThanOrEqual(6);
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
