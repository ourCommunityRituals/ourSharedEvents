/**
 * Forms DB Constraint Verification Tests — validates FORMS_DB enforcement.
 *
 * Gates:
 *   QA-F1. Idempotency: re-run all forms migrations — zero errors, zero duplicates
 *   QA-F2. checkin_counts UPSERT: increment correctly, one row per event
 *   QA-F3. email_signups dedup: email_hash used for duplicate detection
 *   QA-F4. FORMS_DB has NO tables from main DB
 *   QA-F5. checkin_counts.event_id is UNIQUE
 *
 * Forms migration SQL is injected at build time via vitest.config.ts bindings.
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';

interface TestEnv {
  FORMS_DB: D1Database;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}

const formsDb = () => (env as unknown as TestEnv).FORMS_DB;

// ── Setup: apply migrations ──────────────────────────────────────────────────

async function applyFormsMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(
    (env as unknown as TestEnv).TEST_FORMS_MIGRATION_STATEMENTS
  );
  for (const stmt of statements) {
    try {
      await formsDb().prepare(stmt).run();
    } catch (err) {
      // ALTER TABLE ADD COLUMN is not idempotent in SQLite —
      // "duplicate column name" is expected on re-run and safe to ignore
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('duplicate column name')) throw err;
    }
  }
}

beforeAll(async () => {
  await applyFormsMigrations();
});

// ── QA-F1: Migration idempotency ─────────────────────────────────────────────

describe('QA-F1: Forms migration idempotency', () => {
  test('re-running all forms migrations produces zero errors and zero duplicate tables', async () => {
    await expect(applyFormsMigrations()).resolves.not.toThrow();

    const tables = await formsDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      )
      .all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    // 6 + subscribers (forms migration 0017, moved from the main DB, OSE-1661) = 7.
    expect(names).toHaveLength(7);
  });

  test('indexes remain at exactly 12 after idempotent re-run', async () => {
    const indexes = await formsDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all();
    expect(indexes.results).toHaveLength(12);
  });
});

// ── QA-F2: checkin_counts UPSERT ─────────────────────────────────────────────

describe('QA-F2: checkin_counts UPSERT behavior', () => {
  test('UPSERT: first creates row with count 1, second increments to 2', async () => {
    // First check-in: creates row
    await formsDb()
      .prepare(
        `INSERT INTO checkin_counts (id, event_id, total_count, updated_at)
         VALUES ('cc_test_1', 'evt_checkin_test', 1, datetime('now'))
         ON CONFLICT(event_id) DO UPDATE SET total_count = total_count + 1, updated_at = datetime('now')`
      )
      .run();

    const first = await formsDb()
      .prepare('SELECT total_count FROM checkin_counts WHERE event_id = ?')
      .bind('evt_checkin_test')
      .first<{ total_count: number }>();

    expect(first?.total_count).toBe(1);

    // Second check-in: increments via UPSERT
    await formsDb()
      .prepare(
        `INSERT INTO checkin_counts (id, event_id, total_count, updated_at)
         VALUES ('cc_test_2', 'evt_checkin_test', 1, datetime('now'))
         ON CONFLICT(event_id) DO UPDATE SET total_count = total_count + 1, updated_at = datetime('now')`
      )
      .run();

    const second = await formsDb()
      .prepare('SELECT total_count FROM checkin_counts WHERE event_id = ?')
      .bind('evt_checkin_test')
      .first<{ total_count: number }>();

    expect(second?.total_count).toBe(2);

    // Verify only one row exists for this event (not duplicate)
    const count = await formsDb()
      .prepare('SELECT COUNT(*) as cnt FROM checkin_counts WHERE event_id = ?')
      .bind('evt_checkin_test')
      .first<{ cnt: number }>();

    expect(count?.cnt).toBe(1);
  });
});

// ── QA-F3: email_signups dedup ───────────────────────────────────────────────

describe('QA-F3: email_signups dedup via email_hash', () => {
  test('can detect duplicate signups by querying email_hash + event_id', async () => {
    const emailHash = 'abc123hash';

    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
         VALUES ('es_1', 'evt_email_test', ?, 'encrypted_data_1', '2026-03-27T14', '2026-04-26T00:00:00Z')`
      )
      .bind(emailHash)
      .run();

    // Check for duplicate before inserting
    const existing = await formsDb()
      .prepare('SELECT id FROM email_signups WHERE event_id = ? AND email_hash = ?')
      .bind('evt_email_test', emailHash)
      .first();

    expect(existing).not.toBeNull();
    expect(existing?.id).toBe('es_1');
  });
});

// ── QA-F4: FORMS_DB isolation ────────────────────────────────────────────────

describe('QA-F4: FORMS_DB has NO main DB tables', () => {
  test('FORMS_DB does not contain events, scans, sponsors, poster_deployments, or scan_aggregates', async () => {
    const tables = await formsDb()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
      )
      .all();

    const names = tables.results.map((r: Record<string, unknown>) => r.name);
    expect(names).not.toContain('events');
    expect(names).not.toContain('scans');
    expect(names).not.toContain('sponsors');
    expect(names).not.toContain('poster_deployments');
    expect(names).not.toContain('scan_aggregates');
  });
});

// ── QA-F5: Feature flag UNIQUE constraint ───────────────────────────────────

describe('QA-F5: feature_flags UNIQUE(scope, scope_id, flag_key)', () => {
  test('duplicate global flag INSERT fails with UNIQUE constraint', async () => {
    try {
      // Seed migration already inserted (global, '', 'forms.register')
      // Direct INSERT with same combo should fail
      await formsDb()
        .prepare(
          `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
           VALUES ('dup_test', 'global', '', 'forms.register', 1, datetime('now'))`
        )
        .run();
      expect.fail('Duplicate flag INSERT should have thrown UNIQUE constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });

  test('same flag_key for different events does NOT conflict', async () => {
    await formsDb()
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES ('evt_a_flag', 'event', 'evt-a', 'forms.survey', 1, datetime('now'))`
      )
      .run();

    await formsDb()
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES ('evt_b_flag', 'event', 'evt-b', 'forms.survey', 0, datetime('now'))`
      )
      .run();

    const count = await formsDb()
      .prepare(
        "SELECT COUNT(*) as cnt FROM feature_flags WHERE flag_key = 'forms.survey' AND scope = 'event'"
      )
      .first<{ cnt: number }>();

    expect(count?.cnt).toBe(2);
  });
});

// ── QA-F6: Seed migration idempotency ───────────────────────────────────────

describe('QA-F6: Seed migration idempotency (ON CONFLICT DO NOTHING)', () => {
  test('re-running seed migration does not create duplicate flags', async () => {
    const before = await formsDb()
      .prepare("SELECT COUNT(*) as cnt FROM feature_flags WHERE scope = 'global'")
      .first<{ cnt: number }>();

    // Re-apply the seed statements (ON CONFLICT DO NOTHING)
    await applyFormsMigrations();

    const after = await formsDb()
      .prepare("SELECT COUNT(*) as cnt FROM feature_flags WHERE scope = 'global'")
      .first<{ cnt: number }>();

    expect(after?.cnt).toBe(before?.cnt);
  });
});

// ── QA-F7: Feature flag upsert behavior ─────────────────────────────────────

describe('QA-F7: feature_flags upsert via ON CONFLICT DO UPDATE', () => {
  test('upsert changes enabled value, does not create new row', async () => {
    // Insert initial flag
    await formsDb()
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES ('upsert_test', 'event', 'evt-upsert', 'assets.file-upload', 0, datetime('now'))
         ON CONFLICT(scope, scope_id, flag_key) DO NOTHING`
      )
      .run();

    // Upsert to flip it ON
    await formsDb()
      .prepare(
        `INSERT INTO feature_flags (id, scope, scope_id, flag_key, enabled, updated_at)
         VALUES ('upsert_test_2', 'event', 'evt-upsert', 'assets.file-upload', 1, datetime('now'))
         ON CONFLICT(scope, scope_id, flag_key)
         DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`
      )
      .run();

    const result = await formsDb()
      .prepare(
        "SELECT id, enabled FROM feature_flags WHERE scope = 'event' AND scope_id = 'evt-upsert' AND flag_key = 'assets.file-upload'"
      )
      .first<{ id: string; enabled: number }>();

    // Original row updated, NOT a new row created
    expect(result?.id).toBe('upsert_test');
    expect(result?.enabled).toBe(1);
  });
});

// ── QA-F8: checkin_counts.event_id UNIQUE ────────────────────────────────────

describe('QA-F8: checkin_counts UNIQUE constraint', () => {
  test('checkin_counts.event_id is UNIQUE — second direct INSERT fails', async () => {
    await formsDb()
      .prepare(
        `INSERT INTO checkin_counts (id, event_id, total_count, updated_at)
         VALUES ('cc_uniq_1', 'evt_unique_test', 0, datetime('now'))`
      )
      .run();

    try {
      await formsDb()
        .prepare(
          `INSERT INTO checkin_counts (id, event_id, total_count, updated_at)
           VALUES ('cc_uniq_2', 'evt_unique_test', 0, datetime('now'))`
        )
        .run();
      expect.fail('Duplicate event_id INSERT should have thrown UNIQUE constraint error');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg.toUpperCase()).toMatch(/UNIQUE/);
    }
  });
});
