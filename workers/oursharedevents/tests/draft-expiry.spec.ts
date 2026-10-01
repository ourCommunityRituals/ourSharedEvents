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

  test('AUD-3 B: each archived draft gets its own DRAFT_EXPIRED row, attributed to its brand', async () => {
    await seed('dx-brand-a', 'draft', OLD);
    await seed('dx-brand-keep', 'draft', new Date().toISOString());
    await runDraftExpiry(expiryEnv());
    const rows = await db()
      .prepare(
        "SELECT resource_id, brand_id, actor FROM admin_audit_log WHERE action = 'DRAFT_EXPIRED' AND resource_id LIKE 'dx-brand-%'"
      )
      .all<{ resource_id: string; brand_id: string | null; actor: string }>();
    expect(rows.results).toEqual([
      { resource_id: 'dx-brand-a', brand_id: BRAND, actor: 'system:lifecycle' },
    ]);
  });

  test('a 200-draft sweep stays far inside the D1 per-invocation query budget', async () => {
    await db()
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 199)
         INSERT INTO events (id, brand_id, title, slug, status, created_at, updated_at)
         SELECT 'dx-bulk-' || i, ?, 'Bulk ' || i, 'slug-dx-bulk-' || i, 'draft', ?, ? FROM n`
      )
      .bind(BRAND, OLD, OLD)
      .run();
    let prepares = 0;
    const counted = new Proxy(db(), {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            prepares++;
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const r = await runDraftExpiry({ ...expiryEnv(), DB: counted } as never);
    expect(r.archived).toBeGreaterThanOrEqual(200);
    expect(prepares).toBeLessThan(20); // 2 reads + 2 per 90-draft chunk + 1 summary
    const audited = await db()
      .prepare(
        "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'DRAFT_EXPIRED' AND resource_id LIKE 'dx-bulk-%' AND brand_id = ?"
      )
      .bind(BRAND)
      .first<{ n: number }>();
    expect(audited?.n).toBe(200);
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

  test('the summary names only drafts actually archived, not one edited mid-run', async () => {
    await seed('dx-race-a', 'draft', OLD);
    await seed('dx-race-b', 'draft', OLD);
    // Edit dx-race-b between the SELECT and the UPDATE: the UPDATE's WHERE
    // skips it, so it must not appear in the audit as archived.
    const racing = new Proxy(db(), {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (/^\s*UPDATE events/.test(sql)) {
              return {
                bind: (...args: unknown[]) => ({
                  all: async () => {
                    await target
                      .prepare(
                        "UPDATE events SET updated_at = datetime('now') WHERE id = 'dx-race-b'"
                      )
                      .run();
                    return target
                      .prepare(sql)
                      .bind(...args)
                      .all();
                  },
                }),
              };
            }
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const r = await runDraftExpiry({ ...expiryEnv(), DB: racing } as never);
    expect(r.archived).toBe(1);
    expect(await statusOf('dx-race-b')).toBe('draft');
    const row = await db()
      .prepare(
        "SELECT details FROM admin_audit_log WHERE action = 'DRAFT_EXPIRY' ORDER BY rowid DESC LIMIT 1"
      )
      .first<{ details: string }>();
    expect(JSON.parse(row!.details).ids).toEqual(['dx-race-a']);
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
