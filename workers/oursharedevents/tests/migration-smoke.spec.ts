/**
 * OSE-209 / OPS-1 — Post-migration smoke test
 *
 * Locks in the canonical post-migration shape of both D1 databases so any
 * accidental change to the migration set (new table added without rollback
 * docs, index dropped, trigger introduced) surfaces in CI within ms.
 *
 * Companion runbook: migrations/ROLLBACK_PLAN.md
 *
 * Runtime budget: under 200ms (pure PRAGMA / sqlite_master queries). The
 * miniflare worker bootstrap is amortised once via beforeAll, then every
 * assertion is a single sqlite_master read.
 *
 * What this DOESN'T cover (intentionally):
 *   - idempotency under re-run (already covered by constraints.spec.ts QA-1)
 *   - foreign-key constraint enforcement (constraints.spec.ts QA-2)
 *   - column-level PII guarantees (forms-security.spec.ts, subscribers.spec.ts)
 *   - DB↔FORMS_DB cross-contamination (architecture.spec.ts)
 *
 * This file is the migration-fleet smoke — the others are deeper drilldowns.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// ─────────────────────────────────────────────────────────────────────────────
// Canonical expected schema set — change here when a migration adds/removes
// anything, and keep ROLLBACK_PLAN.md in sync. CI failure here means the
// migration fleet drifted from documented state — either the migration is
// new (update both files) or the plan got out of date.
// ─────────────────────────────────────────────────────────────────────────────

const DB_TABLES = [
  'admin_audit_log', // 0026
  'admin_brand_memberships', // 0050 (OSE-666/B2 identity→brand+role membership)
  'anon_id_returns', // 0031 (OSE-272 SharedReport pipeline)
  'bigquery_export_state', // 0035 (OSE-272 Session 4 BigQuery export watermark)
  'business_type_category_map', // 0059 (OSE-730 Sponsor Onboarding — step-5 smart default)
  'campaigns', // 0039 (campaigns metadata table — enterprise sponsor comparison)
  'category_registry', // 0058 (OSE-729 Sponsor Onboarding — canonical category lookup)
  'corridor_density_baseline', // 0032 (OSE-272 SharedReport pipeline)
  'corridor_density_snapshots', // 0044 (OER longitudinal archive — append-only)
  'corridor_readiness_latch', // 0082 (VISION §6.2b corridor readiness latch)
  'corridor_regulatory_status', // 0023
  'corridors', // 0010
  'event_series', // 0033 (OSE-272 SharedReport pipeline)
  'event_templates', // 0014
  'event_type_category_registry', // 0076 (OSE-1344 — Category → Type picker lookup)
  'event_type_registry', // 0023
  'events', // 0001 + 0034 series_id column
  'export_manifest', // 0043 (OSE-556 D1→OCR export audit)
  'node_hierarchy', // 0010
  'poster_deployments', // 0003
  'report_access_log', // 0043 (OSE-557 SharedReport access logging)
  'scan_aggregates', // 0006
  'scan_node_returns', // 0062 (OSE-798 A1 — session side of the split scan path; no placement id)
  'scan_placement_events', // 0062 (OSE-798 A1 — placement side; no session-derived column)
  'security_alerts', // 0042 (OSE-558 security observability)
  'security_metrics', // 0042 (OSE-558 security observability)
  'shortlinks', // 0030 (OSE-240)
  'sponsor_areas', // 0020 (0067: FK repointed to sponsor_business)
  'sponsor_asset', // 0066 (OSE-799 A2 — durable creative, one row per format)
  'sponsor_asset_draft', // 0054 (OSE-725 Sponsor Onboarding — per-format render inputs)
  'sponsor_business', // 0065 (OSE-799 A2 — durable sponsor identity)
  'sponsor_business_draft', // 0053 (OSE-724 Sponsor Onboarding — resolver-invisible draft)
  'sponsor_event_types', // 0019 (0067: FK repointed to sponsor_business)
  'sponsor_impressions', // 0022 (0067: FK repointed to sponsor_business)
  'sponsor_placement', // 0067 (OSE-799 A2 — per-event attachment; replaces sponsors)
  'subscribers', // 0008
  'template_event_types', // 0056 (OSE-727 Sponsor Onboarding — template×registry clearance join)
] as const;

const FORMS_DB_TABLES = [
  'checkin_counts', // 0002
  'email_signups', // 0004
  'feature_flags', // 0006
  'form_registrations', // 0001
  'form_surveys', // 0003
  'pii_audit_log', // 0009
] as const;

// Migration 0025 documents (in its body) that triggers were removed from D1
// because wrangler's migration parser breaks on `;`-containing trigger
// bodies. State-machine enforcement moved to the app layer. If a trigger
// ever appears here, the migration that introduced it must justify
// re-introducing the runtime fragility.
const EXPECTED_TRIGGER_COUNT_DB = 0;
const EXPECTED_TRIGGER_COUNT_FORMS_DB = 0;

// A few representative indexes whose presence proves the post-launch
// performance contract. NOT an exhaustive list — constraints.spec.ts QA-1
// already asserts the total count is exactly 33 for DB. This list catches
// the case where someone renames or accidentally drops a critical index.
const CRITICAL_DB_INDEXES = [
  'idx_events_brand_status',
  'idx_events_slug',
  'idx_poster_deployments_qr_token', // QR scan lookup hot path
  'idx_spe_event_poster', // OSE-798 poster scan-volume lookup (replaced idx_scans_anonymous)
  'idx_admin_audit_log_created_at', // OSE-212 audit feed pagination
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Setup — apply both DBs' migrations once
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of main) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue; // 0028 idempotent re-run
      throw e;
    }
  }
  const forms: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of forms) {
    try {
      await tenv().FORMS_DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

async function listObjects(db: D1Database, type: 'table' | 'index' | 'trigger'): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = ?
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'
         AND name NOT LIKE 'd1_%'
       ORDER BY name`
    )
    .bind(type)
    .all<{ name: string }>();
  return (result.results ?? []).map((r) => r.name);
}

// ═════════════════════════════════════════════════════════════════════════════
// Tables — exact name set
// ═════════════════════════════════════════════════════════════════════════════

describe('OSE-209 smoke: DB tables match canonical set', () => {
  // @born-red TL-031 | method: design-time-negative-assertion | date: 2026-08-03
  test(`DB contains exactly ${DB_TABLES.length} tables, names match`, async () => {
    const actual = await listObjects(tenv().DB, 'table');
    expect(actual).toEqual([...DB_TABLES]);
  });
});

describe('OSE-209 smoke: FORMS_DB tables match canonical set', () => {
  test(`FORMS_DB contains exactly ${FORMS_DB_TABLES.length} tables, names match`, async () => {
    const actual = await listObjects(tenv().FORMS_DB, 'table');
    expect(actual).toEqual([...FORMS_DB_TABLES]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Triggers — none expected per migration 0025
// ═════════════════════════════════════════════════════════════════════════════

describe('OSE-209 smoke: no D1 triggers (state-machine moved to app layer per 0025)', () => {
  test('DB has zero triggers', async () => {
    const triggers = await listObjects(tenv().DB, 'trigger');
    expect(triggers).toHaveLength(EXPECTED_TRIGGER_COUNT_DB);
  });

  test('FORMS_DB has zero triggers', async () => {
    const triggers = await listObjects(tenv().FORMS_DB, 'trigger');
    expect(triggers).toHaveLength(EXPECTED_TRIGGER_COUNT_FORMS_DB);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Indexes — critical names present
// ═════════════════════════════════════════════════════════════════════════════

describe('OSE-209 smoke: critical DB indexes present', () => {
  test('every CRITICAL_DB_INDEXES name exists', async () => {
    const allIndexes = await listObjects(tenv().DB, 'index');
    for (const required of CRITICAL_DB_INDEXES) {
      expect(allIndexes, `missing index ${required}`).toContain(required);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Structured CI log — one JSON summary line for observability
// ═════════════════════════════════════════════════════════════════════════════

describe('OSE-209 smoke: structured summary log', () => {
  test('emits machine-readable summary for CI observability', async () => {
    const dbTables = await listObjects(tenv().DB, 'table');
    const formsTables = await listObjects(tenv().FORMS_DB, 'table');
    const dbIdx = await listObjects(tenv().DB, 'index');
    const formsIdx = await listObjects(tenv().FORMS_DB, 'index');
    const dbTriggers = await listObjects(tenv().DB, 'trigger');
    const formsTriggers = await listObjects(tenv().FORMS_DB, 'trigger');

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        type: 'OSE_209_MIGRATION_SMOKE',
        db: {
          tables: dbTables.length,
          indexes: dbIdx.length,
          triggers: dbTriggers.length,
        },
        forms_db: {
          tables: formsTables.length,
          indexes: formsIdx.length,
          triggers: formsTriggers.length,
        },
        timestamp: new Date().toISOString(),
      })
    );

    // Sanity: these are non-zero for both DBs (proves migrations ran)
    expect(dbTables.length).toBeGreaterThan(0);
    expect(formsTables.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OSE-1419 — a fresh database starts with zero events
//
// 0013 seeds test-event-001 into every database, production included. 0086
// removes it wherever nothing references it. A rebuilt production D1 must not
// list a test event on /events or in /sitemap.xml.
// ─────────────────────────────────────────────────────────────────────────────

const SEED_ID = 'test-event-001';

function removalStatement(): string {
  const main: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  const stmt = main.find((s) => /DELETE\s+FROM\s+events/i.test(s) && s.includes(SEED_ID));
  if (!stmt) throw new Error('0086 DELETE of test-event-001 not found in the migration set');
  return stmt;
}

async function seedTestEvent(): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, start_date, end_date)
       VALUES (?, 'root', 'Community Game Night', 'community-game-night', 'active',
               '2026-05-01', '2026-05-01')`
    )
    .bind(SEED_ID)
    .run();
}

async function eventCount(): Promise<number> {
  const row = await tenv().DB.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>();
  return row?.n ?? -1;
}

describe('OSE-1419 | migrations leave a fresh database with zero events', () => {
  test('all migrations applied to an empty DB -> SELECT COUNT(*) FROM events = 0', async () => {
    expect(await eventCount()).toBe(0);
  });

  test('0086 keeps test-event-001 while another row references it (staging)', async () => {
    const db = tenv().DB;
    await seedTestEvent();
    await db
      .prepare(
        `INSERT OR IGNORE INTO shortlinks (code, event_id, kind, clicks, created_at)
         VALUES ('Ose1419', ?, 'public', 0, datetime('now'))`
      )
      .bind(SEED_ID)
      .run();
    try {
      await db.prepare(removalStatement()).run();
      const kept = await db.prepare('SELECT id FROM events WHERE id = ?').bind(SEED_ID).first();
      expect(kept).not.toBeNull();
    } finally {
      await db.prepare(`DELETE FROM shortlinks WHERE code = 'Ose1419'`).run();
      await db.prepare('DELETE FROM events WHERE id = ?').bind(SEED_ID).run();
    }
  });

  test('0086 removes an unreferenced test-event-001 and is idempotent', async () => {
    const db = tenv().DB;
    await seedTestEvent();
    await db.prepare(removalStatement()).run();
    await db.prepare(removalStatement()).run(); // a second run finds nothing to delete
    const gone = await db.prepare('SELECT id FROM events WHERE id = ?').bind(SEED_ID).first();
    expect(gone).toBeNull();
    expect(await eventCount()).toBe(0);
  });
});
