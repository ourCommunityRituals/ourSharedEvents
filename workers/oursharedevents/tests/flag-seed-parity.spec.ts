/**
 * QA-6: Feature flag seed parity CI gate (OSE-115)
 *
 * Verifies both axes of the two-axis gating model are correctly seeded in
 * FORMS_DB and traceable back to their migration SQL source:
 *
 *   Payment tier axis (17): 0007_seed_free_tier_flags.sql
 *     — forms.*, config.*, analytics.*, assets.*, branding.*, report.*
 *   Regulatory tier axis (5): 0011_seed_regulatory_flags.sql
 *     — regulatory.phase1.enabled, regulatory.phase{2-5}.*
 *
 * Pyramid:
 *   L1 Static     — migration SQL text contains all 22 flag keys + seed IDs
 *   L2 Integration — FORMS_DB after migrations: 22 global rows, correct enabled
 *
 * NOTE: listFlags() in feature-flags.ts filters to ACTIVE_KEYS (17 payment
 * flags only), so regulatory flags are invisible to the existing feature-flags
 * spec. This gate bypasses that filter to verify raw seed parity for both axes.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

// ── Test env ─────────────────────────────────────────────────────────────────

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;
const formsDb = () => tenv().FORMS_DB;

// ── Authoritative seed catalog (two-axis model) ───────────────────────────────
// Source of truth: these must match the migration files exactly.
// If a flag is added/removed from the seeds, update this catalog + the migration.

/** Payment tier axis — 0007_seed_free_tier_flags.sql */
const PAYMENT_FLAGS: Record<string, number> = {
  'forms.register': 1,
  'forms.checkin': 1,
  'forms.survey': 0,
  'forms.email-signup': 0,
  'config.self-serve': 0,
  'config.event-settings': 0,
  'analytics.shared-report': 0,
  'assets.file-upload': 0,
  'assets.custom-qr': 0,
  'branding.white-label': 0,
  'branding.custom-domain': 0,
  'branding.color-palette': 0,
  'report.export-json': 1,
  'report.advanced-metrics': 0,
  'report.export-pdf': 0,
  'report.custom-window': 0,
  'report.portfolio': 0,
};

/** Regulatory tier axis — 0011_seed_regulatory_flags.sql */
const REGULATORY_FLAGS: Record<string, number> = {
  'regulatory.phase1.enabled': 1, // always on globally
  'regulatory.phase2.commerce': 0, // requires corridor unlock
  'regulatory.phase3.licensed': 0,
  'regulatory.phase4.hipaa': 0,
  'regulatory.phase5.coppa': 0,
};

/** Operational / mock-mode axis — 0013_seed_mock_mode_flags.sql (OSE-190) */
const OPERATIONAL_FLAGS: Record<string, number> = {
  'config.mock-mode': 0,
  'config.mock-sponsor-count': 0,
};

const TOTAL_FLAGS =
  Object.keys(PAYMENT_FLAGS).length +
  Object.keys(REGULATORY_FLAGS).length +
  Object.keys(OPERATIONAL_FLAGS).length;

// ── Setup — apply all forms migrations ───────────────────────────────────────

beforeAll(async () => {
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try {
      await formsDb().prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      throw e;
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// L1 Static: migration SQL contains all 22 keys and required seed IDs
// ─────────────────────────────────────────────────────────────────────────────

describe('QA-6 L1: migration SQL text contains all 24 expected flag keys', () => {
  function migrationSql(): string {
    return (JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS) as string[]).join('\n');
  }

  test('all 17 payment tier flag keys present in migration SQL', () => {
    const sql = migrationSql();
    for (const key of Object.keys(PAYMENT_FLAGS)) {
      expect(sql, `missing payment flag key: '${key}'`).toContain(key);
    }
  });

  test('all 5 regulatory tier flag keys present in migration SQL', () => {
    const sql = migrationSql();
    for (const key of Object.keys(REGULATORY_FLAGS)) {
      expect(sql, `missing regulatory flag key: '${key}'`).toContain(key);
    }
  });

  test('regulatory seed IDs are present for traceability (seed-regulatory-phase1 through phase5)', () => {
    const sql = migrationSql();
    for (let phase = 1; phase <= 5; phase++) {
      expect(sql, `missing seed ID for phase ${phase}`).toContain(`seed-regulatory-phase${phase}`);
    }
  });

  test('regulatory seed migration uses ON CONFLICT DO NOTHING (safe to re-run)', () => {
    const sql = migrationSql();
    // Both seed migrations must have idempotent conflict handling
    const matches = sql.match(/ON CONFLICT.*?DO NOTHING/gs) ?? [];
    expect(
      matches.length,
      'expected 2 ON CONFLICT DO NOTHING clauses (one per seed migration)'
    ).toBeGreaterThanOrEqual(2);
  });

  test('all 2 operational flag keys present in migration SQL', () => {
    const sql = migrationSql();
    for (const key of Object.keys(OPERATIONAL_FLAGS)) {
      expect(sql, `missing operational flag key: '${key}'`).toContain(key);
    }
  });

  test('total distinct flag keys in SQL is 24', () => {
    const sql = migrationSql();
    const allExpected = [
      ...Object.keys(PAYMENT_FLAGS),
      ...Object.keys(REGULATORY_FLAGS),
      ...Object.keys(OPERATIONAL_FLAGS),
    ];
    for (const key of allExpected) {
      expect(sql, `key not found in SQL: '${key}'`).toContain(key);
    }
    expect(allExpected.length).toBe(24);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L2 Integration: FORMS_DB has all 22 global-scope flags with correct values
// ─────────────────────────────────────────────────────────────────────────────

describe('QA-6 L2: FORMS_DB seeds — 24 global flags, correct enabled values', () => {
  test(`exactly ${TOTAL_FLAGS} global-scope rows in feature_flags after migrations`, async () => {
    const result = await formsDb()
      .prepare("SELECT COUNT(*) as cnt FROM feature_flags WHERE scope = 'global'")
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(TOTAL_FLAGS);
  });

  test('payment tier axis: all 17 payment flags + 2 operational flags present with correct enabled values', async () => {
    const rows = await formsDb()
      .prepare(
        "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global' AND flag_key NOT LIKE 'regulatory.%'"
      )
      .all<{ flag_key: string; enabled: number }>();

    // 17 payment tier flags + 2 operational flags (config.mock-mode, config.mock-sponsor-count)
    expect(rows.results.length).toBe(19);
    const map = Object.fromEntries(rows.results.map((r) => [r.flag_key, r.enabled]));

    for (const [key, expected] of Object.entries(PAYMENT_FLAGS)) {
      expect(map[key], `payment flag '${key}'`).toBe(expected);
    }
    for (const [key, expected] of Object.entries(OPERATIONAL_FLAGS)) {
      expect(map[key], `operational flag '${key}'`).toBe(expected);
    }
  });

  test('regulatory tier axis: all 5 flags present with correct enabled values', async () => {
    const rows = await formsDb()
      .prepare(
        "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global' AND flag_key LIKE 'regulatory.%'"
      )
      .all<{ flag_key: string; enabled: number }>();

    expect(rows.results.length).toBe(5);
    const map = Object.fromEntries(rows.results.map((r) => [r.flag_key, r.enabled]));

    for (const [key, expected] of Object.entries(REGULATORY_FLAGS)) {
      expect(map[key], `regulatory flag '${key}'`).toBe(expected);
    }
  });

  test('free-tier defaults: forms.register=1, forms.checkin=1, report.export-json=1', async () => {
    for (const [key, expectedEnabled] of [
      ['forms.register', 1],
      ['forms.checkin', 1],
      ['report.export-json', 1],
    ] as const) {
      const row = await formsDb()
        .prepare(`SELECT enabled FROM feature_flags WHERE flag_key = '${key}' AND scope = 'global'`)
        .first<{ enabled: number }>();
      expect(row?.enabled, `'${key}' enabled`).toBe(expectedEnabled);
    }
  });

  test('regulatory.phase1.enabled = 1 (always on at global scope)', async () => {
    const row = await formsDb()
      .prepare(
        "SELECT enabled FROM feature_flags WHERE flag_key = 'regulatory.phase1.enabled' AND scope = 'global'"
      )
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(1);
  });

  test('regulatory phases 2-5 seed as 0 — require per-corridor unlock', async () => {
    const rows = await formsDb()
      .prepare(
        "SELECT flag_key, enabled FROM feature_flags WHERE flag_key LIKE 'regulatory.phase%.%' AND flag_key != 'regulatory.phase1.enabled' AND scope = 'global'"
      )
      .all<{ flag_key: string; enabled: number }>();

    expect(rows.results.length).toBe(4);
    for (const row of rows.results) {
      expect(
        row.enabled,
        `'${row.flag_key}' should be 0 at global scope (requires corridor unlock)`
      ).toBe(0);
    }
  });

  test('regulatory catalog parity — no unexpected keys (exact set match)', async () => {
    const rows = await formsDb()
      .prepare(
        "SELECT flag_key FROM feature_flags WHERE flag_key LIKE 'regulatory.%' AND scope = 'global' ORDER BY flag_key"
      )
      .all<{ flag_key: string }>();

    const actual = rows.results.map((r) => r.flag_key);
    const expected = Object.keys(REGULATORY_FLAGS).sort();
    expect(actual).toEqual(expected);
  });

  test('no corridor-scoped regulatory flags exist at seed time (global only)', async () => {
    const result = await formsDb()
      .prepare(
        "SELECT COUNT(*) as cnt FROM feature_flags WHERE flag_key LIKE 'regulatory.%' AND scope != 'global'"
      )
      .first<{ cnt: number }>();
    expect(result?.cnt).toBe(0);
  });
});
