/**
 * Stale-draft expiry (lib/draft-expiry.ts) — "a draft nobody touched is noise".
 *
 * Behavioural coverage against miniflare D1:
 *   - untouched drafts past the window are ARCHIVED (never deleted)
 *   - a draft edited inside the window is left alone (updated_at is the clock)
 *   - ready / active / archived rows are never touched
 *   - a future-dated draft is skipped (waiting, not abandoned) and counted
 *   - DRAFT_EXPIRY_DAYS=0 turns the sweep off; unset means the 30-day default
 *   - one admin_audit_log row per run names what moved
 *   - the job is wired into the scheduled() cron alongside the other lifecycles
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';
import {
  runDraftExpiry,
  resolveDraftExpiryDays,
  DEFAULT_DRAFT_EXPIRY_DAYS,
  type DraftExpiryEnv,
} from '../src/lib/draft-expiry';

const BRAND = 'ose-draft-expiry';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  FORMS_DB: D1Database;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const [db, key] of [
    [tenv.DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv.FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    const stmts: string[] = JSON.parse((tenv as unknown as Record<string, string>)[key]);
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  }
}

const db = () => (env as unknown as TestEnv).DB;

async function seed(
  id: string,
  status: string,
  updatedAt: string,
  startDate: string | null = null
): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, BRAND, `Expiry ${id}`, `slug-${id}`, status, startDate, updatedAt, updatedAt)
    .run();
}

async function statusOf(id: string): Promise<string | undefined> {
  const row = await db()
    .prepare('SELECT status FROM events WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();
  return row?.status;
}

const OLD = '2020-01-01T00:00:00.000Z'; // far past any window
const FRESH = new Date().toISOString(); // inside any window

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(async () => {
  await db().prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  await db().prepare("DELETE FROM admin_audit_log WHERE action = 'DRAFT_EXPIRY'").run();
});

describe('resolveDraftExpiryDays', () => {
  test('unset / blank → the 30-day default', () => {
    expect(resolveDraftExpiryDays(undefined)).toBe(DEFAULT_DRAFT_EXPIRY_DAYS);
    expect(resolveDraftExpiryDays('')).toBe(30);
    expect(resolveDraftExpiryDays('  ')).toBe(30);
  });
  test('0, negative, junk → off (0)', () => {
    expect(resolveDraftExpiryDays('0')).toBe(0);
    expect(resolveDraftExpiryDays('-5')).toBe(0);
    expect(resolveDraftExpiryDays('forever')).toBe(0);
  });
  test('a positive integer is honoured', () => {
    expect(resolveDraftExpiryDays('7')).toBe(7);
  });
});

describe('runDraftExpiry', () => {
  const expiryEnv = (days?: string): DraftExpiryEnv => ({ DB: db(), DRAFT_EXPIRY_DAYS: days });

  test('archives an untouched draft past the window; never deletes it', async () => {
    await seed('dx-stale', 'draft', OLD);
    const r = await runDraftExpiry(expiryEnv());
    expect(r.enabled).toBe(true);
    expect(r.archived).toBe(1);
    expect(await statusOf('dx-stale')).toBe('archived');
  });

  test('a draft touched inside the window is left alone', async () => {
    await seed('dx-fresh', 'draft', FRESH);
    const r = await runDraftExpiry(expiryEnv());
    expect(r.archived).toBe(0);
    expect(await statusOf('dx-fresh')).toBe('draft');
  });

  test('ready / active / archived rows are never touched, however old', async () => {
    await seed('dx-ready', 'ready', OLD);
    await seed('dx-active', 'active', OLD);
    await seed('dx-archived', 'archived', OLD);
    await runDraftExpiry(expiryEnv());
    expect(await statusOf('dx-ready')).toBe('ready');
    expect(await statusOf('dx-active')).toBe('active');
    expect(await statusOf('dx-archived')).toBe('archived');
  });

  test('a future-dated draft is skipped (waiting, not abandoned) and counted', async () => {
    await seed('dx-future', 'draft', OLD, '2099-06-01');
    await seed('dx-past-dated', 'draft', OLD, '2020-06-01');
    const r = await runDraftExpiry(expiryEnv());
    expect(await statusOf('dx-future')).toBe('draft');
    expect(await statusOf('dx-past-dated')).toBe('archived');
    expect(r.skippedFutureDated).toBe(1);
    expect(r.archived).toBe(1);
  });

  test('the window is configurable: a 1-day window catches a 2-day-old draft', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    await seed('dx-2d', 'draft', twoDaysAgo);
    expect((await runDraftExpiry(expiryEnv('30'))).archived).toBe(0);
    expect(await statusOf('dx-2d')).toBe('draft');
    expect((await runDraftExpiry(expiryEnv('1'))).archived).toBe(1);
    expect(await statusOf('dx-2d')).toBe('archived');
  });

  test('DRAFT_EXPIRY_DAYS=0 turns the sweep off and says so in the audit log', async () => {
    await seed('dx-off', 'draft', OLD);
    const r = await runDraftExpiry(expiryEnv('0'));
    expect(r.enabled).toBe(false);
    expect(r.archived).toBe(0);
    expect(await statusOf('dx-off')).toBe('draft');
    const audit = await db()
      .prepare(
        "SELECT details FROM admin_audit_log WHERE action = 'DRAFT_EXPIRY' ORDER BY rowid DESC LIMIT 1"
      )
      .first<{ details: string }>();
    expect(JSON.parse(audit!.details).outcomeRaw).toBe('noop');
  });

  test('one audit row per run names the archived ids (never-who: system actor only)', async () => {
    await seed('dx-audit-a', 'draft', OLD);
    await seed('dx-audit-b', 'draft', OLD);
    await runDraftExpiry(expiryEnv());
    const rows = await db()
      .prepare(
        "SELECT actor, resource_type, outcome, details FROM admin_audit_log WHERE action = 'DRAFT_EXPIRY'"
      )
      .all<{ actor: string; resource_type: string; outcome: string; details: string }>();
    expect(rows.results?.length).toBe(1);
    const row = rows.results![0];
    expect(row.actor).toBe('system:lifecycle');
    expect(row.resource_type).toBe('event');
    expect(row.outcome).toBe('success');
    const details = JSON.parse(row.details);
    expect(details.archived).toBe(2);
    expect(details.days).toBe(30);
    expect([...details.ids].sort()).toEqual(['dx-audit-a', 'dx-audit-b']);
  });

  test('the archived draft can be reopened — expiry is reversible', async () => {
    await seed('dx-reopen', 'draft', OLD);
    await runDraftExpiry(expiryEnv());
    expect(await statusOf('dx-reopen')).toBe('archived');
    // archived → draft is a valid edge in the state machine.
    await db().prepare("UPDATE events SET status = 'draft' WHERE id = ?").bind('dx-reopen').run();
    expect(await statusOf('dx-reopen')).toBe('draft');
  });
});

describe('scheduled() wiring', () => {
  test('the daily cron runs the sweep', async () => {
    await seed('dx-cron', 'draft', OLD);
    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
      env as unknown as RouterEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(await statusOf('dx-cron')).toBe('archived');
  });
});
