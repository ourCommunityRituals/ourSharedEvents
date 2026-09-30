/**
 * Admin events list — "Soonest first" (TRIANGLE next slice #4).
 *
 * Runs the real handler against D1 (workers pool): the ordering bands, that
 * nothing is dropped, that paging with the upcoming cursor walks the whole set
 * exactly once in order, that it composes with ?status= and brand scope, and
 * that bad sort / cursor values are refused rather than guessed at.
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { handleAdminListEvents, type EventsEnv } from '../src/handlers/events';
import { upcomingFloor, encodeUpcomingCursor } from '../src/lib/admin-events-upcoming';

const BRAND = 'ose-upcoming-list';
const ME = 'me@upcoming.test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const eventsEnv = env as unknown as EventsEnv;

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwtFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
}

interface Body {
  ok: boolean;
  code?: string;
  items: { id: string; start_date: string | null; status: string }[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
  filters?: { sort?: string };
}
async function list(query: string): Promise<{ status: number; body: Body }> {
  const res = await handleAdminListEvents(
    new Request(`https://x/api/v2/admin/events${query}`, {
      headers: { 'Cf-Access-Jwt-Assertion': jwtFor(ME) },
    }),
    eventsEnv
  );
  return { status: res.status, body: (await res.json()) as Body };
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function seed(
  id: string,
  start: string | null,
  status = 'active',
  startsAt: string | null = null
) {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, starts_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      BRAND,
      `Up ${id}`,
      `slug-${id}`,
      status,
      start,
      startsAt,
      `2026-01-01T00:00:${id.slice(-2)}Z`
    )
    .run();
}

// Expected "Soonest first" order for the seed below.
const EXPECTED = [
  'up-today-00', // band 0: today (the floor is "today somewhere", so today is upcoming)
  'up-soon-a-01', // band 0: +3 days, 18:00
  'up-soon-b-02', // band 0: +3 days, 20:00 (same date → starts_at breaks the tie)
  'up-later-03', // band 0: +40 days
  'up-undated-a-04', // band 1: no date, by id
  'up-undated-b-05',
  'up-past-recent-06', // band 2: -5 days (most recent past first)
  'up-past-old-07', // band 2: -60 days
];

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  // Inserted in a scrambled order, with created_at unrelated to start date, so
  // neither insertion order nor created_at can produce the expected order.
  await seed('up-past-old-07', day(-60));
  await seed('up-undated-b-05', null, 'draft');
  await seed('up-later-03', day(40));
  await seed('up-soon-b-02', day(3), 'active', `${day(3)}T20:00:00.000Z`);
  await seed('up-today-00', day(0));
  await seed('up-past-recent-06', day(-5), 'archived');
  await seed('up-undated-a-04', null, 'draft');
  await seed('up-soon-a-01', day(3), 'active', `${day(3)}T18:00:00.000Z`);
  eventsEnv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ [ME]: [BRAND] });
});

describe('admin list — ?sort=upcoming', () => {
  test('orders coming-up soonest first, then undated, then past most-recent first', async () => {
    const { status, body } = await list('?sort=upcoming');
    expect(status).toBe(200);
    expect(body.items.map((r) => r.id)).toEqual(EXPECTED);
    expect(body.filters?.sort).toBe('upcoming');
  });

  test('the default is unchanged: newest created first', async () => {
    const { body } = await list('');
    expect(body.items.map((r) => r.id)).toEqual(
      [...EXPECTED].sort((a, b) => b.slice(-2).localeCompare(a.slice(-2)))
    );
    expect(body.filters?.sort).toBe('created');
    expect((await list('?sort=created')).body.items.map((r) => r.id)).toEqual(
      body.items.map((r) => r.id)
    );
  });

  test.each([1, 2, 3])('paging with limit=%i walks the whole set once, in order', async (limit) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const q: string =
        `?sort=upcoming&limit=${limit}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const { status, body } = await list(q);
      expect(status).toBe(200);
      expect(body.items.length).toBeLessThanOrEqual(limit);
      seen.push(...body.items.map((r) => r.id));
      cursor = body.pagination.nextCursor;
      if (!body.pagination.hasMore) break;
      expect(cursor).toMatch(/^u1\./);
    }
    expect(seen).toEqual(EXPECTED);
  });

  test('composes with ?status= (a filter, not a reorder of something else)', async () => {
    const { body } = await list('?sort=upcoming&status=draft');
    expect(body.items.map((r) => r.id)).toEqual(['up-undated-a-04', 'up-undated-b-05']);
    const active = await list('?sort=upcoming&status=active');
    expect(active.body.items.map((r) => r.id)).toEqual([
      'up-today-00',
      'up-soon-a-01',
      'up-soon-b-02',
      'up-later-03',
      'up-past-old-07',
    ]);
  });

  test('an unknown sort is 400, not silently the default', async () => {
    const { status, body } = await list('?sort=title');
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_SORT');
  });

  test.each([
    ['a created_at cursor', '2026-01-01T00:00:05Z'],
    ['garbage after the prefix', 'u1.not-base64-json'],
    [
      'extra keys',
      encodeURIComponent('u1.' + b64url({ f: day(0), b: 0, d: day(0), s: '', i: 'x', z: 1 })),
    ],
    [
      'a bad band',
      encodeURIComponent('u1.' + b64url({ f: day(0), b: 7, d: day(0), s: '', i: 'x' })),
    ],
    [
      'SQL in the date',
      encodeURIComponent('u1.' + b64url({ f: day(0), b: 0, d: "1' OR 1=1 --", s: '', i: 'x' })),
    ],
  ])('an upcoming cursor that is %s is 400', async (_label, cursor) => {
    const { status, body } = await list(`?sort=upcoming&cursor=${cursor}`);
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_CURSOR');
  });

  test('the cursor carries its floor, so page two keeps page one’s bands', async () => {
    // A cursor minted "yesterday" (floor = yesterday) resuming after the
    // today row: every later row is still ordered against yesterday's floor.
    const cursor = encodeUpcomingCursor({
      f: upcomingFloor(new Date(Date.now() - 86_400_000)),
      b: 0,
      d: day(0),
      s: '',
      i: 'up-today-00',
    });
    const { status, body } = await list(`?sort=upcoming&cursor=${encodeURIComponent(cursor)}`);
    expect(status).toBe(200);
    expect(body.items.map((r) => r.id)).toEqual(EXPECTED.slice(1));
  });
});
