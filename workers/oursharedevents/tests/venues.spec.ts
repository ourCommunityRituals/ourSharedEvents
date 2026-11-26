/**
 * A venue someone owns, and the roll-up of everything held there (OSE-2221).
 *
 * Owner, 2026-11-23: a bar owner has several event operators on the property,
 * each its own brand, and sees all the activity there and the sponsorship it
 * carries. Operators on the property use the platform; an existing
 * arrangement can be grandfathered (listed, never counted). A company can own
 * a venue: ownership is a brand, so a parent reaches its venues down the brand
 * tree.
 *
 * What this holds:
 *   - the owner makes a venue in its own brand only; never the public or
 *     platform brand; never a brand outside its scope;
 *   - an event counts at a venue only when its own admin holds it there AND
 *     the venue lists its brand on the platform (or it is the owner's brand
 *     or a brand below it);
 *   - an unlisted brand and a grandfathered one cannot hold an event there;
 *   - unlisting an operator takes its events out of the roll-up at once;
 *   - the roll-up is floored per part, and its lines add up to its total;
 *   - an operator never reads the roll-up or changes the venue's list: 404,
 *     the same as an unknown venue;
 *   - a parent company reaches the venue a venture owns, and its own;
 *   - every write is audited against the venue's brand.
 *
 * @born-red OSE-2221 | method: (1) countingSets returned every operator,
 *   grandfathered included; (2) handleSetEventVenue skipped the listing check;
 *   (3) ownedVenue skipped the scope check | date: 2026-11-24 | verified: (1)
 *   turned the grandfathered and unlisting tests red, (2) the unlisted-brand
 *   and grandfathered-hold tests, (3) the operator-reads-rollup and
 *   other-company tests; the rest stayed green.
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { seedPosterHour } from './helpers/seed-poster-hours';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const routerEnv = env as unknown as RouterEnv;

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function as(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    'Sec-Fetch-Site': 'same-origin',
  };
}

async function call(
  method: string,
  path: string,
  email: string,
  body?: unknown
): Promise<Response> {
  const headers = as(email);
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const ctx = createExecutionContext();
  const res = await route(new Request(`https://ose.test${path}`, init), routerEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// The bar, its company, a venture of the company, three operators and a
// stranger. All emails are @example.com so they clear the admin allowlist.
const CO = 'vn-co'; // the company that owns bars
const BAR = 'vn-bar'; // a venture of the company: the bar itself
const TRIVIA = 'vn-trivia';
const LEAGUE = 'vn-league';
const DJ = 'vn-dj'; // grandfathered: runs its own app
const OTHER = 'vn-other';

const CO_ADMIN = 'co@example.com';
const BAR_ADMIN = 'bar@example.com';
const TRIVIA_ADMIN = 'trivia@example.com';
const LEAGUE_ADMIN = 'league@example.com';
const DJ_ADMIN = 'dj@example.com';
const OTHER_ADMIN = 'other@example.com';
const PLATFORM_ADMIN = 'platform@example.com'; // the operator of the platform (OSE-2234)

async function event(id: string, brand: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status) VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(id, brand, `E ${id}`, `slug-${id}`)
    .run();
}

async function hostOf(eventId: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT host_venue_id FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ host_venue_id: string | null }>();
  return r?.host_venue_id ?? null;
}

interface Rollup {
  totals: { events: number; poster_scans: { count: number | null } };
  by_operator: Array<{
    brand: string;
    role: string;
    events: number;
    poster_scans: { count: number | null };
  }>;
  grandfathered: string[];
}

async function rollup(venue: string, email = BAR_ADMIN): Promise<Rollup> {
  const res = await call('GET', `/api/v2/admin/venues/${venue}/rollup`, email);
  expect(res.status).toBe(200);
  return (await res.json()) as Rollup;
}

let venue = '';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    `INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES (?, ?)
     ON CONFLICT(brand_id) DO NOTHING`
  )
    .bind(BAR, CO)
    .run();
  (routerEnv as { ADMIN_BRAND_MEMBERSHIP?: string }).ADMIN_BRAND_MEMBERSHIP = JSON.stringify({
    [CO_ADMIN]: [CO],
    [BAR_ADMIN]: [BAR],
    [TRIVIA_ADMIN]: [TRIVIA],
    [LEAGUE_ADMIN]: [LEAGUE],
    [DJ_ADMIN]: [DJ],
    [OTHER_ADMIN]: [OTHER],
    [PLATFORM_ADMIN]: ['ose-platform'],
  });
  for (const [id, b] of [
    ['vn-e-bar', BAR],
    ['vn-e-trivia', TRIVIA],
    ['vn-e-league', LEAGUE],
    ['vn-e-dj', DJ],
    ['vn-e-other', OTHER],
  ] as const)
    await event(id, b);
  // Scans: 7 + 6 at the trivia night (two poster-hours), 8 at the league,
  // 3 at the bar's own night (under the floor), 9 at the DJ.
  await seedPosterHour(env.DB, 'vn-e-trivia', 20, 7);
  await seedPosterHour(env.DB, 'vn-e-trivia', 21, 6);
  await seedPosterHour(env.DB, 'vn-e-league', 19, 8);
  await seedPosterHour(env.DB, 'vn-e-bar', 18, 3);
  await seedPosterHour(env.DB, 'vn-e-dj', 22, 9);
});

describe('the owner makes a venue in its own brand only', () => {
  test('the bar makes its venue', async () => {
    const res = await call('POST', '/api/v2/admin/venues', BAR_ADMIN, {
      brand_id: BAR,
      name: 'The Corner Tap',
    });
    expect(res.status).toBe(201);
    venue = ((await res.json()) as { id: string }).id;
    expect(venue).toMatch(/^ven_[a-f0-9]{32}$/);
  });

  test('never in a brand outside scope, the public brand or the platform brand', async () => {
    for (const brand of [OTHER, 'root', 'ose-platform']) {
      const res = await call('POST', '/api/v2/admin/venues', BAR_ADMIN, {
        brand_id: brand,
        name: 'X',
      });
      expect(res.status, brand).toBe(403);
    }
  });

  test('the write is audited against the venue, carrying its brand', async () => {
    const row = await env.DB.prepare(
      `SELECT outcome, brand_id FROM admin_audit_log
        WHERE action = 'CREATE_VENUE' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
    )
      .bind(venue)
      .first<{ outcome: string; brand_id: string | null }>();
    expect(row).toEqual({ outcome: 'success', brand_id: BAR });
  });
});

describe('an event counts only when both sides put it there', () => {
  test('the venue lists two operators on the platform, and one grandfathered', async () => {
    for (const [brand, status] of [
      [TRIVIA, 'on_platform'],
      [LEAGUE, 'on_platform'],
      [DJ, 'grandfathered'],
    ]) {
      const res = await call('PUT', `/api/v2/admin/venues/${venue}/operators`, BAR_ADMIN, {
        brand_id: brand,
        status,
      });
      expect(res.status, brand).toBe(200);
    }
  });

  test('each listed operator, and the bar, holds its own event at the venue', async () => {
    for (const [ev, who] of [
      ['vn-e-trivia', TRIVIA_ADMIN],
      ['vn-e-league', LEAGUE_ADMIN],
      ['vn-e-bar', BAR_ADMIN],
    ]) {
      const res = await call('PUT', `/api/v2/admin/events/${ev}/venue`, who, { venue_id: venue });
      expect(res.status, ev).toBe(200);
      expect(await hostOf(ev)).toBe(venue);
    }
  });

  test('an unlisted brand cannot hold its event there', async () => {
    const res = await call('PUT', '/api/v2/admin/events/vn-e-other/venue', OTHER_ADMIN, {
      venue_id: venue,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('VENUE_NOT_LISTED');
    expect(await hostOf('vn-e-other')).toBeNull();
  });

  test('a grandfathered operator cannot hold its event there either', async () => {
    const res = await call('PUT', '/api/v2/admin/events/vn-e-dj/venue', DJ_ADMIN, {
      venue_id: venue,
    });
    expect(res.status).toBe(403);
    expect(await hostOf('vn-e-dj')).toBeNull();
  });

  test("no one holds another brand's event at the venue (the event guard answers 404)", async () => {
    const res = await call('PUT', '/api/v2/admin/events/vn-e-league/venue', TRIVIA_ADMIN, {
      venue_id: null,
    });
    expect(res.status).toBe(404);
    expect(await hostOf('vn-e-league')).toBe(venue);
  });
});

describe('the roll-up: floored per part, lines add up', () => {
  test('the bar sees each operator, its own night, and the grandfathered one listed', async () => {
    // Even if the DJ's event were held at the venue it would not count.
    await env.DB.prepare('UPDATE events SET host_venue_id = ? WHERE id = ?')
      .bind(venue, 'vn-e-dj')
      .run();
    const r = await rollup(venue);
    const lines = Object.fromEntries(r.by_operator.map((l) => [l.brand, l]));
    expect(Object.keys(lines).sort()).toEqual([BAR, LEAGUE, TRIVIA].sort());
    expect(lines[BAR].role).toBe('owner');
    expect(lines[TRIVIA].role).toBe('operator');
    // 7 → 5, 6 → 5: each poster-hour rounded before it joins the sum.
    expect(lines[TRIVIA].poster_scans.count).toBe(10);
    expect(lines[LEAGUE].poster_scans.count).toBe(5);
    // 3 is under the floor: withheld, never 0 and never 3.
    expect(lines[BAR].poster_scans.count).toBeNull();
    expect(r.totals.poster_scans.count).toBe(15);
    expect(r.totals.events).toBe(3);
    expect(r.grandfathered).toEqual([DJ]);
    const sum = r.by_operator.reduce((s, l) => s + (l.poster_scans.count ?? 0), 0);
    expect(sum).toBe(r.totals.poster_scans.count);
  });

  test('unlisting an operator takes its events out at once', async () => {
    const del = await call(
      'DELETE',
      `/api/v2/admin/venues/${venue}/operators/${LEAGUE}`,
      BAR_ADMIN
    );
    expect(del.status).toBe(200);
    const r = await rollup(venue);
    expect(r.by_operator.map((l) => l.brand)).not.toContain(LEAGUE);
    expect(r.totals.poster_scans.count).toBe(10);
    // Put it back for the tests below.
    await call('PUT', `/api/v2/admin/venues/${venue}/operators`, BAR_ADMIN, { brand_id: LEAGUE });
  });

  test('a parent company reaches the venue its venture owns', async () => {
    const r = await rollup(venue, CO_ADMIN);
    expect(r.totals.poster_scans.count).toBe(15);
  });
});

describe('nobody else reaches the venue', () => {
  test('an operator never reads the roll-up or edits the list: 404', async () => {
    expect((await call('GET', `/api/v2/admin/venues/${venue}/rollup`, TRIVIA_ADMIN)).status).toBe(
      404
    );
    const put = await call('PUT', `/api/v2/admin/venues/${venue}/operators`, TRIVIA_ADMIN, {
      brand_id: OTHER,
    });
    expect(put.status).toBe(404);
    const del = await call(
      'DELETE',
      `/api/v2/admin/venues/${venue}/operators/${LEAGUE}`,
      TRIVIA_ADMIN
    );
    expect(del.status).toBe(404);
  });

  test("another company's 404 is the same as an unknown venue's", async () => {
    const mine = await call('GET', `/api/v2/admin/venues/${venue}/rollup`, OTHER_ADMIN);
    const none = await call(
      'GET',
      `/api/v2/admin/venues/ven_${'0'.repeat(32)}/rollup`,
      OTHER_ADMIN
    );
    expect(mine.status).toBe(404);
    expect(none.status).toBe(404);
    const a = (await mine.json()) as Record<string, unknown>;
    const b = (await none.json()) as Record<string, unknown>;
    expect({ ...a, requestId: '' }).toEqual({ ...b, requestId: '' });
  });

  test('an operator finds the venue in its list, the stranger does not', async () => {
    const mine = (await (await call('GET', '/api/v2/admin/venues', TRIVIA_ADMIN)).json()) as {
      venues: Array<{ id: string; role: string; status?: string }>;
    };
    expect(mine.venues).toContainEqual(
      expect.objectContaining({ id: venue, role: 'operator', status: 'on_platform' })
    );
    const other = (await (await call('GET', '/api/v2/admin/venues', OTHER_ADMIN)).json()) as {
      venues: unknown[];
    };
    expect(other.venues).toEqual([]);
  });

  test('the roll-up names no event and no person', async () => {
    const res = await call('GET', `/api/v2/admin/venues/${venue}/rollup`, BAR_ADMIN);
    const text = await res.text();
    expect(text).not.toMatch(/vn-e-|title|email|anon/i);
  });
});

describe('the voting room-size ceiling: set by the platform only (OSE-2234, owner 2026-11-26)', () => {
  const path = () => `/api/v2/admin/venues/${venue}/room-ceiling`;
  const row = () =>
    env.DB.prepare('SELECT room_kind, room_cap FROM venues WHERE id = ?')
      .bind(venue)
      .first<{ room_kind: string | null; room_cap: number | null }>();

  test("the venue's owner, an operator and a stranger cannot set it: the 404 of no route", async () => {
    for (const who of [BAR_ADMIN, CO_ADMIN, TRIVIA_ADMIN, OTHER_ADMIN]) {
      const res = await call('PUT', path(), who, { room_kind: 'outdoor', room_cap: 50000 });
      expect(res.status, who).toBe(404);
    }
    expect(await row()).toEqual({ room_kind: null, room_cap: null });
  });

  test('a platform admin sets indoors to the fire-marshal capacity, audited', async () => {
    const res = await call('PUT', path(), PLATFORM_ADMIN, { room_kind: 'indoor', room_cap: 120 });
    expect(res.status).toBe(200);
    expect(await row()).toEqual({ room_kind: 'indoor', room_cap: 120 });
    const audit = await env.DB.prepare(
      `SELECT outcome FROM admin_audit_log
        WHERE action = 'SET_VENUE_ROOM_CEILING' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
    )
      .bind(venue)
      .first<{ outcome: string }>();
    expect(audit?.outcome).toBe('success');
  });

  test('indoors needs a number; outdoors takes a permit limit or none; anything else is refused', async () => {
    const put = async (body: unknown) => {
      const res = await call('PUT', path(), PLATFORM_ADMIN, body);
      return { status: res.status, code: ((await res.json()) as { code?: string }).code };
    };
    expect(await put({ room_kind: 'indoor' })).toMatchObject({
      status: 400,
      code: 'ROOM_CAP_NEEDED',
    });
    expect(await put({ room_kind: 'indoor', room_cap: 9 })).toMatchObject({
      status: 400,
      code: 'INVALID_ROOM_CAP',
    });
    expect(await put({ room_kind: 'indoor', room_cap: 12.5 })).toMatchObject({ status: 400 });
    expect(await put({ room_kind: 'tent', room_cap: 100 })).toMatchObject({
      status: 400,
      code: 'INVALID_ROOM_KIND',
    });
    expect(await put({ room_kind: 'outdoor', room_cap: null, note: 'x' })).toMatchObject({
      status: 400,
      code: 'UNKNOWN_FIELD',
    });
    expect(await row()).toEqual({ room_kind: 'indoor', room_cap: 120 });
    expect(await put({ room_kind: 'outdoor', room_cap: 2000 })).toMatchObject({ status: 200 });
    expect(await row()).toEqual({ room_kind: 'outdoor', room_cap: 2000 });
    expect(await put({ room_kind: 'outdoor', room_cap: null })).toMatchObject({ status: 200 });
    expect(await row()).toEqual({ room_kind: 'outdoor', room_cap: null });
  });

  test('an unknown venue is 404 for the platform too', async () => {
    const res = await call(
      'PUT',
      `/api/v2/admin/venues/ven_${'0'.repeat(32)}/room-ceiling`,
      PLATFORM_ADMIN,
      { room_kind: 'outdoor', room_cap: null }
    );
    expect(res.status).toBe(404);
  });
});
