/**
 * OSE-203 / BE-14 — Scheduled PII cleanup cron lifecycle tests
 *
 * L2: integration via direct worker.scheduled call (miniflare D1 + execution context)
 *   Phase 1: expired form_registrations deleted, live rows preserved
 *   Phase 2: form_surveys with pii_scrubbed=0 get string fields scrubbed
 *   Phase 3: expired email_signups deleted, live rows preserved
 *   Audit:   pii_audit_log entries written after each scheduled run
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';

// ── DB setup ───────────────────────────────────────────────────────────────────

async function applyMigrations(): Promise<void> {
  const mainStmts: string[] = JSON.parse((env as Record<string, string>).TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try {
      await (env as Record<string, D1Database>).DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }

  const formsStmts: string[] = JSON.parse(
    (env as Record<string, string>).TEST_FORMS_MIGRATION_STATEMENTS
  );
  for (const stmt of formsStmts) {
    try {
      await (env as Record<string, D1Database>).FORMS_DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});

function formsDb(): D1Database {
  return (env as Record<string, D1Database>).FORMS_DB;
}

async function triggerScheduled(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(
    { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
    env as unknown as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
}

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

// ── Phase 1: Delete expired form_registrations ─────────────────────────────────

describe('lifecycle — phase 1: expired registrations', () => {
  test('deletes registrations where expires_at is past, preserves future ones', async () => {
    const expiredId = `p1-exp-${crypto.randomUUID()}`;
    const liveId = `p1-live-${crypto.randomUUID()}`;

    await formsDb()
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status, expires_at)
         VALUES (?, 'lc-test', '2020-01', 'confirmed', ?)`
      )
      .bind(expiredId, PAST)
      .run();

    await formsDb()
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status, expires_at)
         VALUES (?, 'lc-test', '2026-04', 'confirmed', ?)`
      )
      .bind(liveId, FUTURE)
      .run();

    await triggerScheduled();

    const expired = await formsDb()
      .prepare('SELECT id FROM form_registrations WHERE id = ?')
      .bind(expiredId)
      .first();
    const live = await formsDb()
      .prepare('SELECT id FROM form_registrations WHERE id = ?')
      .bind(liveId)
      .first();

    expect(expired).toBeNull();
    expect(live).not.toBeNull();
  });

  test('preserves registrations with no expires_at', async () => {
    const id = `p1-noexp-${crypto.randomUUID()}`;
    await formsDb()
      .prepare(
        `INSERT INTO form_registrations (id, event_id, registration_bucket, status)
         VALUES (?, 'lc-test', '2026-04', 'confirmed')`
      )
      .bind(id)
      .run();

    await triggerScheduled();

    const row = await formsDb()
      .prepare('SELECT id FROM form_registrations WHERE id = ?')
      .bind(id)
      .first();
    expect(row).not.toBeNull();
  });
});

// ── Phase 2: Scrub PII from surveys ───────────────────────────────────────────

describe('lifecycle — phase 2: survey PII scrub', () => {
  test('replaces non-safe string fields with [SCRUBBED], preserves numbers', async () => {
    const id = `p2-scrub-${crypto.randomUUID()}`;
    const responses = {
      name: 'Alice Smith',
      feedback: 'Great event!',
      rating: 5,
      score: 9,
      overall: 'excellent',
    };

    await formsDb()
      .prepare(
        `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
         VALUES (?, 'lc-test', ?, '2026-04', 0)`
      )
      .bind(id, JSON.stringify(responses))
      .run();

    await triggerScheduled();

    const row = await formsDb()
      .prepare('SELECT responses_json, pii_scrubbed FROM form_surveys WHERE id = ?')
      .bind(id)
      .first<{ responses_json: string; pii_scrubbed: number }>();

    expect(row).not.toBeNull();
    expect(row!.pii_scrubbed).toBe(1);

    const scrubbed = JSON.parse(row!.responses_json) as Record<string, unknown>;
    expect(scrubbed.name).toBe('[SCRUBBED]');
    expect(scrubbed.feedback).toBe('[SCRUBBED]');
    expect(scrubbed.rating).toBe(5);
    expect(scrubbed.score).toBe(9);
    // 'overall' key matches SAFE_KEY_PATTERNS — preserved as-is
    expect(scrubbed.overall).toBe('excellent');
  });

  test('does not re-scrub surveys already marked pii_scrubbed = 1', async () => {
    const id = `p2-already-${crypto.randomUUID()}`;
    const responses = { name: 'Bob Jones', rating: 4 };

    await formsDb()
      .prepare(
        `INSERT INTO form_surveys (id, event_id, responses_json, submitted_bucket, pii_scrubbed)
         VALUES (?, 'lc-test', ?, '2026-04', 1)`
      )
      .bind(id, JSON.stringify(responses))
      .run();

    await triggerScheduled();

    const row = await formsDb()
      .prepare('SELECT responses_json FROM form_surveys WHERE id = ?')
      .bind(id)
      .first<{ responses_json: string }>();

    const data = JSON.parse(row!.responses_json) as Record<string, unknown>;
    expect(data.name).toBe('Bob Jones');
  });
});

// ── Phase 3: Delete expired email_signups ─────────────────────────────────────

describe('lifecycle — phase 3: expired email signups', () => {
  test('deletes signups where retention_expires_at is past, preserves future ones', async () => {
    const expiredId = `p3-exp-${crypto.randomUUID()}`;
    const liveId = `p3-live-${crypto.randomUUID()}`;

    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
         VALUES (?, 'lc-test', 'hash-exp', 'enc-exp', '2020-01', ?)`
      )
      .bind(expiredId, PAST)
      .run();

    await formsDb()
      .prepare(
        `INSERT INTO email_signups (id, event_id, email_hash, email_encrypted, signup_bucket, retention_expires_at)
         VALUES (?, 'lc-test', 'hash-live', 'enc-live', '2026-04', ?)`
      )
      .bind(liveId, FUTURE)
      .run();

    await triggerScheduled();

    const expired = await formsDb()
      .prepare('SELECT id FROM email_signups WHERE id = ?')
      .bind(expiredId)
      .first();
    const live = await formsDb()
      .prepare('SELECT id FROM email_signups WHERE id = ?')
      .bind(liveId)
      .first();

    expect(expired).toBeNull();
    expect(live).not.toBeNull();
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('lifecycle — pii_audit_log', () => {
  test('writes audit log entries with triggered_by = scheduled after each run', async () => {
    const countBefore = await formsDb()
      .prepare(`SELECT COUNT(*) as n FROM pii_audit_log WHERE triggered_by = 'scheduled'`)
      .first<{ n: number }>();

    await triggerScheduled();

    const countAfter = await formsDb()
      .prepare(`SELECT COUNT(*) as n FROM pii_audit_log WHERE triggered_by = 'scheduled'`)
      .first<{ n: number }>();

    expect(countAfter?.n ?? 0).toBeGreaterThan(countBefore?.n ?? 0);
  });
});
