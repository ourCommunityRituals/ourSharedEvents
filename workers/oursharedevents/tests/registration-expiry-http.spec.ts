/**
 * OSE-826 at the request path and the nightly job (workers pool).
 *
 * Owner decision 2026-11-13 ("Later of the two"): a registration expires 90
 * days after the person registers, or at the end of the day after its event,
 * whichever is later. The router reads the event's dates from the main
 * database and hands them to the registration handler (which never reads that
 * database: two-database isolation). The rule itself is pinned case by case in
 * registration-expiry.spec.ts.
 *
 *   W1  an event 200 days ahead: the stored expiry is the day after it
 *   W2  an event 10 days ahead: the stored expiry is 90 days from now
 *   W3  an event with only a start date: the start date counts
 *   W4  an event the main database does not know: 90 days from now
 *   W5  the nightly job keeps an early registration whose 90 days have passed
 *       while its event is still ahead, and deletes one whose event is over
 *
 * @born-red retention#OSE-826 | method: (1) the router passing null instead of
 *   the event's dates: W1 and W3 failed (expiry 90 days from now), W2, W4 and
 *   W5 stayed green; (2) registrationExpiresAt returning the old rule (now +
 *   90 days): W1, W3 and W5's early row failed | date: 2026-11-13
 */
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import worker from '../src/index';
import type { RouterEnv } from '../src/router';
import { REGISTRATION_TTL_DAYS, registrationExpiresAt } from '../src/lib/retention-windows';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const ADMIN_KEY = 'test-admin-key-e2e-2026';
const DAY = 24 * 60 * 60 * 1000;

async function applyMigrations(): Promise<void> {
  for (const [db, key] of [
    [tenv().DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv().FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    const stmts: string[] = JSON.parse(tenv()[key]);
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
        throw e;
      }
    }
  }
}

/** The YYYY-MM-DD date `days` from today (UTC). */
function dateFromToday(days: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

/** Midnight UTC two days after `date`: the end of the day after the event. */
function endOfDayAfter(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 2 * DAY).toISOString();
}

async function seedEvent(id: string, start: string | null, end: string | null): Promise<void> {
  await tenv()
    .DB.prepare(
      `INSERT OR REPLACE INTO events
         (id, brand_id, title, slug, status, location, start_date, end_date, created_at, updated_at)
       VALUES (?, 'test-brand', ?, ?, 'active', 'Test Venue', ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(id, `Test ${id}`, id, start, end)
    .run();
}

/** Register through the router; return the stored expiry and the time window around the call. */
async function register(
  eventId: string
): Promise<{ expiresAt: string; before: number; after: number }> {
  const before = Date.now();
  const res = await SELF.fetch(`https://t.test/api/v2/events/${eventId}/forms/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Early Bird' }),
  });
  const after = Date.now();
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  const row = await tenv()
    .FORMS_DB.prepare('SELECT expires_at FROM form_registrations WHERE id = ?')
    .bind(id)
    .first<{ expires_at: string }>();
  expect(row).not.toBeNull();
  return { expiresAt: row!.expires_at, before, after };
}

function expectNinetyDaysFrom(got: string, before: number, after: number): void {
  const t = Date.parse(got);
  expect(t).toBeGreaterThanOrEqual(before + REGISTRATION_TTL_DAYS * DAY);
  expect(t).toBeLessThanOrEqual(after + REGISTRATION_TTL_DAYS * DAY);
}

beforeAll(async () => {
  await applyMigrations();
  // forms.register on (mid tier), as forms-phase-required-gate.spec.ts does.
  const res = await SELF.fetch('https://t.test/api/v2/admin/flags/apply-tier', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'mid' }),
  });
  expect(res.status).toBe(200);
});

describe('OSE-826: a registration is kept until the day after its event', () => {
  test('W1: an event 200 days ahead stores the end of the day after it', async () => {
    const end = dateFromToday(200);
    await seedEvent('evt-826-far', dateFromToday(199), end);
    const { expiresAt } = await register('evt-826-far');
    expect(expiresAt).toBe(endOfDayAfter(end));
  });

  test('W2: an event 10 days ahead stores 90 days from now', async () => {
    await seedEvent('evt-826-near', dateFromToday(10), dateFromToday(10));
    const { expiresAt, before, after } = await register('evt-826-near');
    expectNinetyDaysFrom(expiresAt, before, after);
  });

  test('W3: an event with only a start date counts from that date', async () => {
    const start = `${dateFromToday(150)}T19:00:00Z`;
    await seedEvent('evt-826-start-only', start, null);
    const { expiresAt } = await register('evt-826-start-only');
    expect(expiresAt).toBe(endOfDayAfter(start.slice(0, 10)));
  });

  test('W4: an event the main database does not know stores 90 days from now', async () => {
    const { expiresAt, before, after } = await register('evt-826-unknown');
    expectNinetyDaysFrom(expiresAt, before, after);
  });

  test('W5: the nightly job keeps an early registration until its event is over', async () => {
    // Both rows were made 100 days ago, so their 90 days have passed.
    const madeAt = new Date(Date.now() - 100 * DAY);
    const early = {
      id: 'reg-826-early',
      event: 'evt-826-ahead',
      expires: registrationExpiresAt(madeAt, dateFromToday(30)),
    };
    const done = {
      id: 'reg-826-done',
      event: 'evt-826-over',
      expires: registrationExpiresAt(madeAt, dateFromToday(-20)),
    };
    for (const r of [early, done]) {
      await tenv()
        .FORMS_DB.prepare(
          `INSERT INTO form_registrations (id, event_id, registration_bucket, status, expires_at, created_at)
           VALUES (?, ?, '2026-08-05T10', 'confirmed', ?, ?)`
        )
        .bind(r.id, r.event, r.expires, madeAt.toISOString())
        .run();
    }

    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} },
      env as unknown as RouterEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    const left = await tenv()
      .FORMS_DB.prepare(`SELECT id FROM form_registrations WHERE id IN (?, ?)`)
      .bind(early.id, done.id)
      .all<{ id: string }>();
    expect((left.results ?? []).map((r) => r.id)).toEqual([early.id]);
  });
});
