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
] as const;

const EXPECTED_INDEXES = [
  'idx_form_registrations_event',
  'idx_form_registrations_expires',
  'idx_checkin_counts_event',
  'idx_form_surveys_event',
  'idx_form_surveys_pii',
  'idx_email_signups_event',
  'idx_email_signups_retention',
] as const;

const EXPECTED_COLUMN_COUNTS: Record<string, number> = {
  form_registrations: 9,
  checkin_counts: 4,
  form_surveys: 6,
  email_signups: 7,
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
  test('all 4 forms tables exist post-migration', async () => {
    const tables = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    EXPECTED_TABLES.forEach((t) => expect(names).toContain(t));
  });

  test('each forms table returns 0 rows (empty, not missing)', async () => {
    for (const table of EXPECTED_TABLES) {
      const result = await (env as unknown as TestEnv).FORMS_DB.prepare(
        `SELECT COUNT(*) as cnt FROM ${table}`,
      ).first<{ cnt: number }>();
      expect(result?.cnt).toBe(0);
    }
  });
});

// ── Gate F2: Column counts ───────────────────────────────────────────────────

describe('Gate F2: Forms column counts', () => {
  for (const [table, expectedCount] of Object.entries(EXPECTED_COLUMN_COUNTS)) {
    test(`${table} has ${expectedCount} columns`, async () => {
      const info = await (env as unknown as TestEnv).FORMS_DB.prepare(
        `PRAGMA table_info(${table})`,
      ).all();
      expect(info.results.length).toBe(expectedCount);
    });
  }
});

// ── Gate F3: PII firewall ────────────────────────────────────────────────────

describe('Gate F3: PII firewall', () => {
  test('checkin_counts has NO PII columns — zero personal data', async () => {
    const info = await (env as unknown as TestEnv).FORMS_DB.prepare(
      'PRAGMA table_info(checkin_counts)',
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
      'PRAGMA table_info(form_surveys)',
    ).all();
    const cols = info.results.map((r: Record<string, unknown>) => r.name);
    expect(cols).toContain('pii_scrubbed');
  });
});

// ── Gate F4: DB isolation ────────────────────────────────────────────────────

describe('Gate F4: DB isolation', () => {
  test('FORMS_DB has NO tables from the main anonymous scan system', async () => {
    const tables = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    FORBIDDEN_TABLES.forEach((t) => {
      expect(names).not.toContain(t);
    });
  });
});

// ── Gate F5: Index verification ──────────────────────────────────────────────

describe('Gate F5: Forms index verification', () => {
  test('all 7 forms indexes exist', async () => {
    const indexes = await (env as unknown as TestEnv).FORMS_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
    ).all();

    const names = indexes.results.map((r: Record<string, unknown>) => r.name);
    expect(names.length).toBe(7);
    EXPECTED_INDEXES.forEach((idx) => expect(names).toContain(idx));
  });
});
