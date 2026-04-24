/**
 * Forms DB Schema Verification Tests — validates FORMS_DB (separate from main DB).
 *
 * Gates:
 *   F1. All 4 forms tables exist in FORMS_DB
 *   F2. Column counts match spec per table
 *   F3. PII firewall: checkin_counts has NO PII columns
 *   F4. DB isolation: FORMS_DB has NO tables from main DB (events, scans, etc.)
 *   F5. Index verification: all 7 forms indexes exist
 *
 * Forms migration SQL is injected at build time via vitest.config.ts bindings.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  'form_registrations',
  'checkin_counts',
  'form_surveys',
  'email_signups',
  'feature_flags',
  'pii_audit_log',
] as const;

const EXPECTED_INDEXES = [
  'idx_form_registrations_event',
  'idx_form_registrations_expires',
  'idx_checkin_counts_event',
  'idx_form_surveys_event',
  'idx_form_surveys_pii',
  'idx_email_signups_event',
  'idx_email_signups_retention',
  'idx_feature_flags_lookup',
  // Anonymous ID (migration 0008)
  'idx_registrations_anon',
  'idx_surveys_anon',
  // PII audit log (migration 0009)
  'idx_pii_audit_log_phase',
  'idx_pii_audit_log_event',
] as const;

const EXPECTED_COLUMN_COUNTS: Record<string, number> = {
  form_registrations: 12, // +consent_type (migration 0012)
  checkin_counts: 5,
  form_surveys: 9, // +consent_type (migration 0012)
  email_signups: 10, // +consent_type (migration 0012)
};

// Tables that must NEVER exist in FORMS_DB (they belong in main DB)
const FORBIDDEN_TABLES = [
  'events',
  'sponsors',
  'poster_deployments',
  'scans',
  'scan_aggregates',
] as const;

// ── Apply migrations before tests ────────────────────────────────────────────

async function applyFormsMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const statements: string[] = JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    await (env as unknown as TestEnv).FORMS_DB.prepare(stmt).run();
  }
}

beforeAll(async () => {
  await applyFormsMigrations();
});

// ── Gate F1: Table existence ─────────────────────────────────────────────────

describe('Gate F1: Forms table existence', () => {
  test('all 5 forms tables exist post-migration', async () => {
    const tables = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    EXPECTED_TABLES.forEach((t) => expect(names).toContain(t));
  });

  test('each forms table returns 0 rows (empty, not missing) — except feature_flags (seeded)', async () => {
    for (const table of EXPECTED_TABLES) {
      const result = await (env as unknown as TestEnv).FORMS_DB.prepare(
        `SELECT COUNT(*) as cnt FROM ${table}`
      ).first<{ cnt: number }>();
      if (table === 'feature_flags') {
        // Seed migration 0007 inserts 17 free-tier flags; 0011 adds 5 regulatory phase flags
        expect(result?.cnt).toBe(22);
      } else {
        expect(result?.cnt).toBe(0);
      }
    }
  });
});

// ── Gate F2: Column counts ───────────────────────────────────────────────────

describe('Gate F2: Forms column counts', () => {
  for (const [table, expectedCount] of Object.entries(EXPECTED_COLUMN_COUNTS)) {
    test(`${table} has ${expectedCount} columns`, async () => {
      const info = await (env as unknown as TestEnv).FORMS_DB.prepare(
        `PRAGMA table_info(${table})`
      ).all();
      expect(info.results.length).toBe(expectedCount);
    });
  }
});

// ── Gate F3: PII firewall ────────────────────────────────────────────────────

describe('Gate F3: PII firewall', () => {
  test('checkin_counts has NO PII columns — zero personal data', async () => {
    const info = await (env as unknown as TestEnv).FORMS_DB.prepare(
      'PRAGMA table_info(checkin_counts)'
    ).all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);

    // checkin_counts should only have: id, event_id, total_count, updated_at
    expect(cols).not.toContain('attendee_name');
    expect(cols).not.toContain('attendee_email');
    expect(cols).not.toContain('attendee_email_hash');
    expect(cols).not.toContain('email');
    expect(cols).not.toContain('name');
    expect(cols).not.toContain('ip_address');
    expect(cols).not.toContain('user_agent');

    expect(cols).toContain('event_id');
    expect(cols).toContain('total_count');
  });

  test('form_surveys has pii_scrubbed flag', async () => {
    const info = await (env as unknown as TestEnv).FORMS_DB.prepare(
      'PRAGMA table_info(form_surveys)'
    ).all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).toContain('pii_scrubbed');
  });
});

// ── Gate F4: DB isolation ────────────────────────────────────────────────────

describe('Gate F4: DB isolation', () => {
  test('FORMS_DB has NO tables from the main anonymous scan system', async () => {
    const tables = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    FORBIDDEN_TABLES.forEach((t) => {
      expect(names).not.toContain(t);
    });
  });
});

// ── Gate F5: Index verification ──────────────────────────────────────────────

describe('Gate F5: Forms index verification', () => {
  test('all 12 forms indexes exist', async () => {
    const indexes = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).all();

    const names = indexes.results.map((r: Record<string, unknown>) => r.name);
    expect(names.length).toBe(12);
    EXPECTED_INDEXES.forEach((idx) => expect(names).toContain(idx));
  });
});

// ── Gate F6: Free tier seed data integrity ──────────────────────────────────

describe('Gate F6: Free tier seed data integrity', () => {
  test('exactly 22 global flags seeded with correct defaults', async () => {
    const flags = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT flag_key, enabled FROM feature_flags WHERE scope = 'global' ORDER BY flag_key"
    ).all();

    expect(flags.results).toHaveLength(22);

    // Verify the exact expected state — this is the contract
    const expected: Record<string, number> = {
      'analytics.shared-report': 0,
      'assets.custom-qr': 0,
      'assets.file-upload': 0,
      'branding.color-palette': 0,
      'branding.custom-domain': 0,
      'branding.white-label': 0,
      'config.event-settings': 0,
      'config.self-serve': 0,
      'forms.checkin': 1,
      'forms.email-signup': 0,
      'forms.register': 1,
      'forms.survey': 0,
      'regulatory.phase1.enabled': 1,
      'regulatory.phase2.commerce': 0,
      'regulatory.phase3.licensed': 0,
      'regulatory.phase4.hipaa': 0,
      'regulatory.phase5.coppa': 0,
      'report.advanced-metrics': 0,
      'report.custom-window': 0,
      'report.export-json': 1,
      'report.export-pdf': 0,
      'report.portfolio': 0,
    };

    for (const row of flags.results) {
      const key = row.flag_key as string;
      expect(expected).toHaveProperty(key);
      expect(row.enabled).toBe(expected[key]);
    }
  });

  test('feature_flags table has 6 columns: id, scope, scope_id, flag_key, enabled, updated_at', async () => {
    const info = await (env as unknown as TestEnv).FORMS_DB.prepare(
      'PRAGMA table_info(feature_flags)'
    ).all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).toHaveLength(6);
    expect(cols).toContain('id');
    expect(cols).toContain('scope');
    expect(cols).toContain('scope_id');
    expect(cols).toContain('flag_key');
    expect(cols).toContain('enabled');
    expect(cols).toContain('updated_at');
  });
});
