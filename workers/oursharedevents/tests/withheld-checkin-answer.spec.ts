/**
 * The public check-in answer never gives back a count under 5 (OSE-1657, item 2).
 *
 * `POST /api/v2/events/:id/forms/checkin` takes no login. It answered with the
 * event's exact running total, and the door page printed it ("2 checked in"),
 * while every admin route floors the same number (`applyCountFloor`, K = 5). So
 * the first people to check in read 1, 2, 3: an exact small count, to anyone.
 *
 * The answer now has the shape the admin check-in count already has:
 * `{ ok, count, suppressed, floor }`, with `count: null` under 5. The door page
 * says "You're checked in" and adds the total only when it is published
 * ("You're checked in (12 checked in)."), with no "so far": a running tally on
 * an event page is what in-event-companion.spec.ts forbids.
 *
 * Owner question left open on the ticket: whether any number is wanted there
 * at all. This keeps the published total (5 or more), the same number an admin
 * reads, so the answer can only ever say what the floor already allows.
 *
 * @born-red OSE-1657 | method: written first and run on main at c2065af: the
 *   first four check-ins answered count 1, 2, 3, 4 and the door page script
 *   printed `body.count + ' checked in'`. Red: 3 of 3 (the fifth-check-in case
 *   too, because the answer had no `suppressed` or `floor`) | date: 2026-10-08
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
  test('the first four check-ins are told they worked, never how many came before', async () => {
    const id = 'evt_withheld_checkin_first4';
    await seedLiveEvent(id);
    for (let i = 1; i <= 4; i++) {
      const body = await checkIn(id);
      expect(body.ok).toBe(true);
      expect(body.count, `check-in ${i}`).toBeNull();
      expect(body.suppressed).toBe(true);
      expect(body.floor).toBe(5);
    }
  });

  test('guard: from the fifth on, the total is the one an admin reads', async () => {
    const id = 'evt_withheld_checkin_5';
    await seedLiveEvent(id);
    let body: Record<string, unknown> = {};
    for (let i = 1; i <= 6; i++) body = await checkIn(id);
    expect(body).toMatchObject({ ok: true, count: 6, suppressed: false, floor: 5 });
  });

  test('the door page prints the total only when it is published', async () => {
    const id = 'evt_withheld_checkin_page';
    await seedLiveEvent(id);
    const html = await (await SELF.fetch(`https://t.test/forms/${id}?type=checkin`)).text();
    expect(html).toContain('data-testid="checkin-count"');
    expect(html).not.toContain("body.count + ' checked in'");
    expect(html).toContain("You're checked in");
    expect(html).toMatch(/typeof body\.count === 'number'/);
  });
});
