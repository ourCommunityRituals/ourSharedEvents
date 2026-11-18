/**
 * An event's registrations have one count (OSE-1656).
 *
 * Two admin routes each publish a floored count of the same event's
 * registrations:
 *
 *   GET /api/v2/admin/events/:id/forms/registrations   → `count`
 *   GET /api/v2/admin/events/:id/stats                 → `stats.registrations`
 *
 * The first counted every row; the second counts confirmed rows that are not
 * past their retention date. Each was floored on its own, so both could be
 * published and differ by 1 to 4: with 8 rows of which 6 are counted, "8" and
 * "6" say that 2 registrations are expired or not confirmed, a group under the
 * floor. Now both read one definition (`lib/registration-count.ts`), so for
 * any event the two figures are the same value and there is nothing to
 * subtract. The event dashboard reads the same definition.
 *
 * The rows of the list (`items`) are the organizer's own first-party list and
 * stay exact; that is a separate, open owner decision and is not changed here.
 *
 * Placement: workers pool (real routes over D1). The node spec
 * `withheld-count-words.spec.ts` holds every COUNT in the source to the one
 * definition.
 *
 * @born-red OSE-1656 | method: written first and run on main at 52a4ca0, where
 *   the list read 8 beside the stats' 6 (9 beside 6 with a cancelled row, and 7 beside "withheld").
 *   Red: 3 of 4 (the all-counted case is a guard) | date: 2026-11-14
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, test } from 'vitest';
import { CORE_VALUES } from './helpers/core-values';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

beforeAll(async () => {
  const tenv = env as unknown as {
    TEST_MIGRATION_STATEMENTS: string;
    TEST_FORMS_MIGRATION_STATEMENTS: string;
  };
  const run = async (db: D1Database, stmts: string[]) => {
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  };
  await run(env.DB, JSON.parse(tenv.TEST_MIGRATION_STATEMENTS));
  await run(env.FORMS_DB, JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS));
});

async function createEvent(title: string): Promise<string> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/events', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attendance_mode: 'in_person',
      location: 'Test Hall',
      title,
      status: 'active',
      ...CORE_VALUES,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function seed(
  eventId: string,
  n: number,
  status = 'confirmed',
  expiresAt: string | null = null
) {
  for (let i = 0; i < n; i++) {
    await env.FORMS_DB.prepare(
      `INSERT INTO form_registrations (id, event_id, registration_bucket, status, attendee_email_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), eventId, 'bucket-a', status, crypto.randomUUID(), expiresAt)
      .run();
  }
}

type Floored = { count: number | null; suppressed: boolean; floor: number };

/** Every floored registrations figure an admin can read for one event. */
async function figures(eventId: string): Promise<Record<string, Floored>> {
  const get = async (path: string) => {
    const res = await SELF.fetch(`https://t.test/api/v2/admin/events/${eventId}${path}`, {
      headers: ADMIN,
    });
    expect(res.status, path).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };
  const list = await get('/forms/registrations');
  const stats = (await get('/stats')).stats as { registrations: Floored };
  return {
    list: {
      count: list.count as number | null,
      suppressed: list.suppressed as boolean,
      floor: list.floor as number,
    },
    stats: stats.registrations,
  };
}

const PAST = '2020-01-01 00:00:00';

describe('OSE-1656 | the list total and the stats figure cannot be subtracted', () => {
  test('6 counted and 2 past their retention date: both read 6, never 8 beside 6', async () => {
    const id = await createEvent('One count: expired rows');
    await seed(id, 6);
    await seed(id, 2, 'confirmed', PAST);
    const f = await figures(id);
    expect(f.stats).toEqual({ count: 6, suppressed: false, floor: 5 });
    expect(f.list).toEqual(f.stats);
  });

  test('6 counted, 2 expired and 1 not confirmed: still one figure', async () => {
    const id = await createEvent('One count: a cancelled row');
    await seed(id, 6);
    await seed(id, 2, 'confirmed', PAST);
    await seed(id, 1, 'cancelled');
    const f = await figures(id);
    expect(f.list).toEqual(f.stats);
    expect(f.list.count).toBe(6);
  });

  test('3 counted and 4 expired: both withheld, the list never reads 7', async () => {
    const id = await createEvent('One count: under the floor');
    await seed(id, 3);
    await seed(id, 4, 'confirmed', PAST);
    const f = await figures(id);
    expect(f.stats).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(f.list).toEqual(f.stats);
  });

  test('guard: 7 counted and nothing else, both read 7', async () => {
    const id = await createEvent('One count: all counted');
    await seed(id, 7);
    const f = await figures(id);
    expect(f.list).toEqual({ count: 7, suppressed: false, floor: 5 });
    expect(f.stats).toEqual(f.list);
  });
});
