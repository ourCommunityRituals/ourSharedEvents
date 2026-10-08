/**
 * The public check-in answer carries no count at all (OSE-1657, item 2).
 *
 * `POST /api/v2/events/:id/forms/checkin` takes no login. It answered with the
 * event's exact running total, and the door page printed it ("2 checked in"),
 * so the first people to check in read 1, 2, 3: an exact small count, to anyone.
 *
 * #884 floored that answer (a number from 5 on, null below). That still printed
 * a live tally on an attendee surface during the event ("12 checked in"), which
 * the founder decision of 2026-09-04 rules out: counts are post-event only. An
 * attendee deciding whether to come, or standing in the room, is never shown how
 * many others did; the platform counts the room for the host, the sponsor and
 * the SharedReport, never to persuade the room (pages.ts, scan-path-consistency
 * and public-event-stakeholder-surfaces specs). The owner confirmed the privacy
 * reading on 2026-10-08 and asked for the docs to decide it.
 *
 * So the answer is `{ ok: true }` at every total, and the door page says
 * "You're checked in." and nothing else. The count lives in the admin route
 * (`GET /api/v2/admin/events/:id/forms/checkin-count`, floored at K = 5) and in
 * the post-event recap.
 *
 * @born-red OSE-1657 | method: the first file (#884) was written first and run on
 *   main at c2065af: the first four check-ins answered 1, 2, 3, 4 (3 of 3 red).
 *   This revision was run on main at 087ba98 (#884 merged): the answer carried
 *   `count`, `suppressed` and `floor`, and the sixth answered 6; the door page
 *   read `body.count`. Red: 2 of 3 (the admin count is a guard) | date: 2026-10-08
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const BRAND = 'withheld-checkin-1657';

async function applyAll(): Promise<void> {
  for (const [db, key] of [
    [tenv().DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv().FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    for (const stmt of JSON.parse(tenv()[key]) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate column name|already exists|no such column/.test(msg)) continue;
        throw e;
      }
    }
  }
}

/** A live event, happening now, so the public check-in route takes taps. */
async function seedLiveEvent(id: string): Promise<void> {
  await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'Harbor Country Park', datetime('now','-1 hour'), datetime('now','+3 hours'), datetime('now'), datetime('now'))`
    )
    .bind(id, BRAND, `Check-in ${id}`, id)
    .run();
  await tenv().FORMS_DB.prepare('DELETE FROM checkin_counts WHERE event_id = ?').bind(id).run();
}

async function checkIn(id: string): Promise<Record<string, unknown>> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${id}/forms/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  await applyAll();
});

describe('OSE-1657 item 2 | the public check-in answer', () => {
  test('at any total, the answer says the check-in worked and nothing more', async () => {
    const id = 'evt_withheld_checkin_any';
    await seedLiveEvent(id);
    for (let i = 1; i <= 12; i++) {
      const body = await checkIn(id);
      expect(body, `check-in ${i}`).toEqual({ ok: true });
    }
  });

  test('guard: the host still reads the floored count on the admin route', async () => {
    const id = 'evt_withheld_checkin_admin';
    await seedLiveEvent(id);
    for (let i = 1; i <= 6; i++) await checkIn(id);
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${id}/forms/checkin-count`, {
      headers: { Authorization: `Bearer ${(env as unknown as { ADMIN_KEY: string }).ADMIN_KEY}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, count: 6, suppressed: false, floor: 5 });
  });

  test('the door page confirms the check-in and reads no count from the answer', async () => {
    const id = 'evt_withheld_checkin_page';
    await seedLiveEvent(id);
    const html = await (await SELF.fetch(`https://t.test/forms/${id}?type=checkin`)).text();
    expect(html).toContain('data-testid="checkin-count"');
    expect(html).toContain("You're checked in.");
    expect(html).not.toMatch(/body\.count/);
    expect(html).not.toMatch(/checked in so far|\d+ checked in/i);
  });
});
