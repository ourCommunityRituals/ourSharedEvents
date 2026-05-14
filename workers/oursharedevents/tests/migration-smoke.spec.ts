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
  'corridor_regulatory_status', // 0023
  'corridors', // 0010
  'event_templates', // 0014
  'event_type_registry', // 0023
  'events', // 0001
  'node_hierarchy', // 0010
  'poster_deployments', // 0003
  'scan_aggregates', // 0006
  'scans', // 0004
  'sponsor_areas', // 0020
  'sponsor_event_types', // 0019
  'sponsor_impressions', // 0022
  'sponsors', // 0002
  'subscribers', // 0008
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
  'idx_scans_anonymous', // OSE-199 anonymous lookups
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
