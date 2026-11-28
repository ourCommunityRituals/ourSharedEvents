/**
 * A booth is part of a fair (OSE-1998, OSE ADR-034 decisions 1 and 5).
 *
 *   GET    /api/v2/admin/events/:id/booths            the event's booths, active first
 *   POST   /api/v2/admin/events/:id/booths            add one booth
 *   POST   /api/v2/admin/events/:id/booths/bulk       add many, all or nothing
 *   PUT    /api/v2/admin/events/:id/booths/:boothId   change one booth
 *   DELETE /api/v2/admin/events/:id/booths/:boothId   take it out of use (soft)
 *   + `booth_id` on poster deployments (create, update, admin reads)
 *
 * Rules held here, each watched failing first:
 *   1. a booth of another event, or of another brand, answers exactly as a
 *      missing one does, and is never changed;
 *   2. a booth never holds a person: no person column, no person field in a
 *      body, no contact detail in its name;
 *   3. a booth is never removed; its placements keep pointing at it;
 *   4. a placement may point only at a booth in use of its own event;
 *   5. the /q scan path and scan counting do not change.
 *
 * @born-red OSE-1998 | method: run with the booth routes taken out of the router
 * (60 of 92 red; the rest are 404 walls, held by fault 1), then one fault at a
 * time, each restored before the next:
 *   1. `AND event_id = ?` taken out of the booth lookup (boothOfEvent): 6 red;
 *   2a. the unknown-field refusal switched off: 8 red;
 *   2b. the email/phone check on the name switched off: 7 red;
 *   2c. a `contact_email` column added to 0109: 2 red (the schema gates);
 *   3. DELETE turned into `DELETE FROM event_booths`: 3 red;
 *   4a. `event_id` taken out of activeBoothOfEvent: 3 red;
 *   4b. `is_active = 1` taken out of activeBoothOfEvent: 2 red;
 *   5. `booth_id` added to the /q placement SELECT in qr-scan.ts: 1 red;
 *   6. the bulk check against the event's existing numbers removed: 1 red;
 *   7. the bulk cap raised by one: 1 red;
 *   8. event_booths left out of the event hard-delete cascade: 1 red;
 *   9. the PUT/DELETE booth audit call removed: 2 red.
 * date: 2026-11-14
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import {
  BOOTH_BULK_MAX,
  BOOTH_CATEGORIES,
  BOOTH_COLUMNS,
  BOOTH_WRITE_KEYS,
  parseBoothBulk,
  parseBoothCreate,
} from '../src/lib/event-booths';
import { classifyColumn } from './helpers/identity-columns';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-bth-a';
const BRAND_B = 'brand-bth-b';
const OWNER_A = 'owner-bth-a@example.com';
const OWNER_B = 'owner-bth-b@example.com';

const A1 = 'evt-bth-a1'; // the fair
const A2 = 'evt-bth-a2'; // another event of the same brand
const B1 = 'evt-bth-b1'; // another brand's fair

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function asEmail(email: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    'Cf-Access-Jwt-Assertion': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      email,
      iat: now - 10,
      exp: now + 3600,
    })}.sig`,
    // A signed-in person is a browser on the admin site (admin write guard).
    'Sec-Fetch-Site': 'same-origin',
  };
}
const A = asEmail(OWNER_A);
const B = asEmail(OWNER_B);
/** Automation with ADMIN_SCOPE_ALL (set by the workers vitest config): skips the router wall. */
const KEY = { Authorization: 'Bearer test-admin-key-e2e-2026' };

type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; json: Json }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* an empty or non-JSON body reads as {} */
  }
  return { status: res.status, json };
}

const boothsPath = (eventId: string, tail = '') => `/api/v2/admin/events/${eventId}/booths${tail}`;

async function applyMigrations(): Promise<void> {
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

type Row = Record<string, unknown>;
const all = async (sql: string, ...binds: unknown[]) =>
  (
    await tenv.DB.prepare(sql)
      .bind(...binds)
      .all<Row>()
  ).results;
const boothRows = (eventId?: string) =>
  eventId
    ? all('SELECT * FROM event_booths WHERE event_id = ? ORDER BY id', eventId)
    : all(`SELECT * FROM event_booths WHERE event_id LIKE 'evt-bth-%' ORDER BY id`);

async function seedEvent(id: string, brand: string) {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'active', 'Eagles Hall', '2026-12-05T15:00:00.000Z', '2026-12-05T21:00:00.000Z', 'America/Chicago')`
  )
    .bind(id, brand, `Booth fixture ${id}`, id)
    .run();
}

async function seedBooth(id: string, eventId: string, number: string, isActive = 1) {
  await tenv.DB.prepare(
    `INSERT INTO event_booths (id, event_id, number, name, is_active) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, eventId, number, `Stall ${number}`, isActive)
    .run();
}

async function seedPlacement(id: string, eventId: string, boothId: string | null) {
  await tenv.DB.prepare(
    `INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, is_active, booth_id)
     VALUES (?, ?, ?, 'Table card', 1, ?)`
  )
    .bind(id, eventId, `qrt_${id}`, boothId)
    .run();
}

/** A response body with its per-request fields taken out, for "same as missing". */
const same = (json: Json) => {
  const { requestId: _r, timestamp: _t, ...rest } = json;
  return rest;
};

beforeAll(async () => {
  await applyMigrations();
  for (const [email, brand] of [
    [OWNER_A, BRAND_A],
    [OWNER_B, BRAND_B],
  ]) {
    await tenv.DB.prepare(
      `INSERT OR IGNORE INTO admin_brand_memberships (email, brand_id, role) VALUES (?, ?, 'brand_owner')`
    )
      .bind(email, brand)
      .run();
  }
});

beforeEach(async () => {
  const db = tenv.DB;
  await db.prepare(`DELETE FROM scan_placement_events WHERE event_id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM scan_node_returns WHERE event_id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM poster_deployments WHERE event_id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM event_booths WHERE event_id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM shortlinks WHERE event_id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM event_codes WHERE event_id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-bth-%'`).run();
  await db.prepare(`DELETE FROM admin_audit_log WHERE resource_id LIKE 'evt-bth-%'`).run();
  await seedEvent(A1, BRAND_A);
  await seedEvent(A2, BRAND_A);
  await seedEvent(B1, BRAND_B);
});

const STALL = { number: 'A12', name: 'Hilltop Honey', category: 'food', hall_x: 0.25, hall_y: 0.5 };

// ── create ────────────────────────────────────────────────────────────────────

describe('create: one booth under its event', () => {
  test('201: the booth is saved, trimmed, and answered field by field', async () => {
    const res = await call('POST', boothsPath(A1), A, {
      ...STALL,
      number: '  A12 ',
      name: '  Hilltop   Honey ',
      sort: 3,
    });
    expect(res.status).toBe(201);
    expect(res.json.booth).toMatchObject({
      event_id: A1,
      number: 'A12',
      name: 'Hilltop Honey',
      category: 'food',
      hall_x: 0.25,
      hall_y: 0.5,
      is_active: true,
      sort: 3,
    });
    expect(res.json.id).toBe(res.json.booth.id);
    expect(Object.keys(res.json.booth).sort()).toEqual([...BOOTH_COLUMNS].sort());
    const [row] = await boothRows(A1);
    expect(row).toMatchObject({ id: res.json.id, number: 'A12', name: 'Hilltop Honey' });
  });

  test('only a number and a name are needed; the rest default', async () => {
    const res = await call('POST', boothsPath(A1), A, { number: '7', name: 'Rye & Co' });
    expect(res.status).toBe(201);
    expect(res.json.booth).toMatchObject({
      category: null,
      hall_x: null,
      hall_y: null,
      sort: 0,
      is_active: true,
    });
  });

  test.each([
    ['no number', { ...STALL, number: undefined }, 'INVALID_NUMBER'],
    ['a blank number', { ...STALL, number: '   ' }, 'INVALID_NUMBER'],
    ['a number longer than 20', { ...STALL, number: 'x'.repeat(21) }, 'INVALID_NUMBER'],
    ['a number that is not text', { ...STALL, number: 12 }, 'INVALID_NUMBER'],
    ['a control character in the number', { ...STALL, number: 'A\u000012' }, 'INVALID_NUMBER'],
    ['no name', { ...STALL, name: undefined }, 'INVALID_NAME'],
    ['a blank name', { ...STALL, name: ' ' }, 'INVALID_NAME'],
    ['a name longer than 120', { ...STALL, name: 'x'.repeat(121) }, 'INVALID_NAME'],
    ['a control character in the name', { ...STALL, name: 'Honey\u0007' }, 'INVALID_NAME'],
    ['an email address as the name', { ...STALL, name: 'jo@hilltop.example' }, 'INVALID_NAME'],
    ['an email inside the name', { ...STALL, name: 'Honey (ask jo@x.io)' }, 'INVALID_NAME'],
    ['a phone number as the name', { ...STALL, name: '(312) 555-0142' }, 'INVALID_NAME'],
    ['a phone number inside the name', { ...STALL, name: 'Honey 312 555 0142' }, 'INVALID_NAME'],
    ['a category not on the list', { ...STALL, category: 'jewellery' }, 'INVALID_CATEGORY'],
    ['hall_x above 1', { ...STALL, hall_x: 1.5 }, 'INVALID_HALL_POSITION'],
    ['hall_y below 0', { ...STALL, hall_y: -0.1 }, 'INVALID_HALL_POSITION'],
    ['hall_x without hall_y', { ...STALL, hall_y: undefined }, 'INVALID_HALL_POSITION'],
    ['a latitude-sized hall_x', { ...STALL, hall_x: 41.88 }, 'INVALID_HALL_POSITION'],
    ['a sort that is not whole', { ...STALL, sort: 1.5 }, 'INVALID_SORT'],
    ['an email field', { ...STALL, email: 'jo@hilltop.example' }, 'UNKNOWN_FIELD'],
    ['a phone field', { ...STALL, phone: '3125550142' }, 'UNKNOWN_FIELD'],
    ['a contact_name field', { ...STALL, contact_name: 'Jo' }, 'UNKNOWN_FIELD'],
    ['a notes field', { ...STALL, notes: 'pays cash' }, 'UNKNOWN_FIELD'],
    ['an event_id field', { ...STALL, event_id: B1 }, 'UNKNOWN_FIELD'],
    ['a body that is a list', [STALL], 'INVALID_BODY'],
  ])('400 for %s, and nothing is written', async (_label, body, code) => {
    const res = await call('POST', boothsPath(A1), A, body);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(code);
    expect(await boothRows()).toHaveLength(0);
  });

  test('a trading name with digits, an ampersand and an accent is fine', async () => {
    for (const [number, name] of [
      ['1', 'Since 1998 Bakery'],
      ['2', 'Café Ñandú & Sons'],
      ['3', 'Unit 4B — Prints'],
    ]) {
      const res = await call('POST', boothsPath(A1), A, { number, name });
      expect(res.status, name).toBe(201);
    }
  });

  test('every listed category is accepted', async () => {
    for (const [i, category] of BOOTH_CATEGORIES.entries()) {
      const res = await call('POST', boothsPath(A1), A, { number: `C${i}`, name: 'X', category });
      expect(res.status, category).toBe(201);
    }
  });

  test('anonymous is 401 and writes nothing', async () => {
    const res = await call('POST', boothsPath(A1), { 'Sec-Fetch-Site': 'same-origin' }, STALL);
    expect(res.status).toBe(401);
    expect(await boothRows()).toHaveLength(0);
  });

  test('an unknown event is 404', async () => {
    const res = await call('POST', boothsPath('evt-bth-none'), KEY, STALL);
    expect(res.status).toBe(404);
    expect(await boothRows()).toHaveLength(0);
  });
});

describe('a number is used once per event', () => {
  test('a second booth with the same number is 409, in any case', async () => {
    expect((await call('POST', boothsPath(A1), A, STALL)).status).toBe(201);
    for (const number of ['A12', 'a12', ' a12 ']) {
      const again = await call('POST', boothsPath(A1), A, { ...STALL, number, name: 'Other' });
      expect(again.status, number).toBe(409);
      expect(again.json.code).toBe('DUPLICATE_NUMBER');
    }
    expect(await boothRows(A1)).toHaveLength(1);
  });

  test('the same number in another event is fine', async () => {
    expect((await call('POST', boothsPath(A1), A, STALL)).status).toBe(201);
    expect((await call('POST', boothsPath(A2), A, STALL)).status).toBe(201);
  });

  test('a booth out of use keeps its number', async () => {
    await seedBooth('bth-old', A1, 'A12', 0);
    const res = await call('POST', boothsPath(A1), A, STALL);
    expect(res.status).toBe(409);
  });

  test('the database refuses a clash the handler did not see (UNIQUE, NOCASE)', async () => {
    await seedBooth('bth-1', A1, 'B7');
    await expect(seedBooth('bth-2', A1, 'b7')).rejects.toThrow(/UNIQUE/);
  });
});

// ── list ──────────────────────────────────────────────────────────────────────

describe('list: the event’s booths, in use first', () => {
  test('in use first, then by sort, then by number; another event’s booths never appear', async () => {
    await tenv.DB.prepare(
      `INSERT INTO event_booths (id, event_id, number, name, sort, is_active) VALUES
         ('bth-l1', ?, 'B2', 'Two', 1, 1),
         ('bth-l2', ?, 'B1', 'One', 1, 1),
         ('bth-l3', ?, 'A9', 'Nine', 0, 1),
         ('bth-l4', ?, 'A1', 'Gone', 0, 0),
         ('bth-other', ?, 'A0', 'Elsewhere', 0, 1)`
    )
      .bind(A1, A1, A1, A1, A2)
      .run();
    const res = await call('GET', boothsPath(A1), A);
    expect(res.status).toBe(200);
    expect(res.json.event_id).toBe(A1);
    expect(res.json.booths.map((b: Json) => b.id)).toEqual([
      'bth-l3',
      'bth-l2',
      'bth-l1',
      'bth-l4',
    ]);
    expect(res.json.booths[3].is_active).toBe(false);
  });

  test('another brand’s owner gets the 404 an unknown event gets', async () => {
    await seedBooth('bth-a', A1, 'A1');
    const cross = await call('GET', boothsPath(A1), B);
    const unknown = await call('GET', boothsPath('evt-bth-none'), B);
    expect(cross.status).toBe(404);
    expect(cross.json.booths).toBeUndefined();
    expect(JSON.stringify(cross.json)).not.toContain('Stall A1');
    expect(same(cross.json).code).toBe(same(unknown.json).code);
  });
});

// ── bulk ──────────────────────────────────────────────────────────────────────

describe('bulk: many booths, all or nothing', () => {
  const list = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ number: `S${i + 1}`, name: `Stall ${i + 1}` }));

  test('201: every booth is saved and answered', async () => {
    const res = await call('POST', boothsPath(A1, '/bulk'), A, { booths: list(3) });
    expect(res.status).toBe(201);
    expect(res.json.created).toBe(3);
    expect(res.json.booths.map((b: Json) => b.number).sort()).toEqual(['S1', 'S2', 'S3']);
    expect(await boothRows(A1)).toHaveLength(3);
  });

  test(`${BOOTH_BULK_MAX} booths in one request is fine`, async () => {
    const res = await call('POST', boothsPath(A1, '/bulk'), A, { booths: list(BOOTH_BULK_MAX) });
    expect(res.status).toBe(201);
    expect(res.json.created).toBe(BOOTH_BULK_MAX);
    expect(await boothRows(A1)).toHaveLength(BOOTH_BULK_MAX);
  });

  test(`${BOOTH_BULK_MAX + 1} is refused, and nothing is written`, async () => {
    const res = await call('POST', boothsPath(A1, '/bulk'), A, {
      booths: list(BOOTH_BULK_MAX + 1),
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('TOO_MANY_BOOTHS');
    expect(await boothRows()).toHaveLength(0);
  });

  test.each([
    ['no list', {}, 'INVALID_BOOTHS'],
    ['an empty list', { booths: [] }, 'INVALID_BOOTHS'],
    ['a field beside the list', { booths: list(1), event_id: B1 }, 'UNKNOWN_FIELD'],
  ])('400 for %s', async (_label, body, code) => {
    const res = await call('POST', boothsPath(A1, '/bulk'), A, body);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(code);
    expect(await boothRows()).toHaveLength(0);
  });

  test('one bad row refuses the list: every refused row is named, nothing is written', async () => {
    const booths = [
      { number: 'S1', name: 'Fine' },
      { number: 'S2', name: 'call 312-555-0142' },
      { number: 'S3', name: 'Fine too' },
      { number: 's1', name: 'Same number as row 0' },
      { number: 'S5', name: 'Fine', contact_email: 'x@y.z' },
      { number: '', name: 'No number' },
    ];
    const res = await call('POST', boothsPath(A1, '/bulk'), A, { booths });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('BOOTHS_REFUSED');
    expect(res.json.created).toBe(0);
    expect(res.json.failed.map((f: Json) => [f.index, f.code])).toEqual([
      [0, 'DUPLICATE_NUMBER'],
      [1, 'INVALID_NAME'],
      [3, 'DUPLICATE_NUMBER'],
      [4, 'UNKNOWN_FIELD'],
      [5, 'INVALID_NUMBER'],
    ]);
    expect(await boothRows()).toHaveLength(0);
  });

  test('a number the event already has refuses the list (409), naming the row', async () => {
    await seedBooth('bth-have', A1, 'S2');
    const res = await call('POST', boothsPath(A1, '/bulk'), A, { booths: list(3) });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('BOOTHS_REFUSED');
    expect(res.json.failed).toEqual([
      expect.objectContaining({ index: 1, number: 'S2', code: 'DUPLICATE_NUMBER' }),
    ]);
    expect(await boothRows(A1)).toHaveLength(1);
  });

  test('another brand’s owner cannot add booths to this event', async () => {
    const res = await call('POST', boothsPath(A1, '/bulk'), B, { booths: list(2) });
    expect(res.status).toBe(404);
    expect(await boothRows()).toHaveLength(0);
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('update: a booth of this event only', () => {
  test('200: what the body names changes, and nothing else', async () => {
    await seedBooth('bth-u', A1, 'A1');
    const res = await call('PUT', boothsPath(A1, '/bth-u'), A, {
      name: 'Renamed Stall',
      category: 'craft',
      hall_x: 0,
      hall_y: 1,
      sort: 9,
    });
    expect(res.status).toBe(200);
    expect(res.json.booth).toMatchObject({
      id: 'bth-u',
      number: 'A1',
      name: 'Renamed Stall',
      category: 'craft',
      hall_x: 0,
      hall_y: 1,
      sort: 9,
      is_active: true,
    });
  });

  test('clearing: category and the hall spot can be set back to null', async () => {
    await call('POST', boothsPath(A1), A, STALL);
    const [row] = await boothRows(A1);
    const res = await call('PUT', boothsPath(A1, `/${row.id}`), A, {
      category: null,
      hall_x: null,
      hall_y: null,
    });
    expect(res.status).toBe(200);
    expect(res.json.booth).toMatchObject({ category: null, hall_x: null, hall_y: null });
  });

  test('a booth out of use can be put back in use', async () => {
    await seedBooth('bth-u', A1, 'A1', 0);
    const res = await call('PUT', boothsPath(A1, '/bth-u'), A, { is_active: true });
    expect(res.status).toBe(200);
    expect(res.json.booth.is_active).toBe(true);
  });

  test('renumbering onto another booth’s number is 409; onto its own (any case) is fine', async () => {
    await seedBooth('bth-u1', A1, 'A1');
    await seedBooth('bth-u2', A1, 'A2');
    const clash = await call('PUT', boothsPath(A1, '/bth-u1'), A, { number: 'a2' });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe('DUPLICATE_NUMBER');
    const own = await call('PUT', boothsPath(A1, '/bth-u1'), A, { number: 'a1' });
    expect(own.status).toBe(200);
    expect(own.json.booth.number).toBe('a1');
  });

  test.each([
    ['an empty body', {}, 'NO_FIELDS'],
    ['only hall_x', { hall_x: 0.5 }, 'INVALID_HALL_POSITION'],
    ['is_active as a number', { is_active: 0 }, 'INVALID_IS_ACTIVE'],
    ['a person field', { owner_name: 'Jo' }, 'UNKNOWN_FIELD'],
    ['an email as the name', { name: 'jo@hilltop.example' }, 'INVALID_NAME'],
  ])('400 for %s, and the booth is unchanged', async (_label, body, code) => {
    await seedBooth('bth-u', A1, 'A1');
    const before = await boothRows(A1);
    const res = await call('PUT', boothsPath(A1, '/bth-u'), A, body);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(code);
    expect(await boothRows(A1)).toEqual(before);
  });
});

// ── the wall: another event, another brand, no such booth ─────────────────────

describe('a booth of another event or brand answers as a missing one, and is never changed', () => {
  beforeEach(async () => {
    await seedBooth('bth-a1', A1, 'A1');
    await seedBooth('bth-a2', A2, 'A1');
    await seedBooth('bth-b1', B1, 'A1');
  });

  for (const [method, body] of [
    ['PUT', { name: 'Hijacked' }],
    ['DELETE', undefined],
  ] as const) {
    test(`${method}: a booth of another event of the same brand is the missing-booth 404`, async () => {
      const before = await boothRows();
      const wrongEvent = await call(method, boothsPath(A1, '/bth-a2'), A, body);
      const missing = await call(method, boothsPath(A1, '/bth-nobody'), A, body);
      expect(wrongEvent.status).toBe(404);
      expect(same(wrongEvent.json)).toEqual(same(missing.json));
      expect(same(missing.json)).toMatchObject({ code: 'BOOTH_NOT_FOUND' });
      expect(await boothRows()).toEqual(before);
    });

    test(`${method}: another brand’s booth under your own event is the missing-booth 404`, async () => {
      const before = await boothRows();
      const crossBooth = await call(method, boothsPath(A1, '/bth-b1'), A, body);
      const missing = await call(method, boothsPath(A1, '/bth-nobody'), A, body);
      expect(crossBooth.status).toBe(404);
      expect(same(crossBooth.json)).toEqual(same(missing.json));
      expect(await boothRows()).toEqual(before);
    });

    test(`${method}: another brand’s event in the path is the unknown-event 404`, async () => {
      const before = await boothRows();
      const cross = await call(method, boothsPath(B1, '/bth-b1'), A, body);
      const unknown = await call(method, boothsPath('evt-bth-none', '/bth-b1'), A, body);
      expect(cross.status).toBe(404);
      expect(same(cross.json).code).toBe(same(unknown.json).code);
      expect(same(cross.json).error.replace(B1, 'X')).toBe(
        same(unknown.json).error.replace('evt-bth-none', 'X')
      );
      expect(await boothRows()).toEqual(before);
    });

    test(`${method}: the data half holds for automation too (key actor, every brand in scope)`, async () => {
      const before = await boothRows();
      const res = await call(method, boothsPath(A1, '/bth-b1'), KEY, body);
      expect(res.status).toBe(404);
      expect(res.json.code).toBe('BOOTH_NOT_FOUND');
      expect(await boothRows()).toEqual(before);
    });
  }

  test('the bulk path segment is never a booth id', async () => {
    const res = await call('PUT', boothsPath(A1, '/bulk'), A, { name: 'X' });
    expect(res.status).toBe(404);
  });
});

// ── deactivate ────────────────────────────────────────────────────────────────

describe('delete: a booth is taken out of use, never removed', () => {
  test('the row stays with is_active 0, and its placements keep pointing at it', async () => {
    await seedBooth('bth-d', A1, 'D1');
    await seedPlacement('pd-bth-d1', A1, 'bth-d');
    await seedPlacement('pd-bth-d2', A1, 'bth-d');
    const res = await call('DELETE', boothsPath(A1, '/bth-d'), A);
    expect(res.status).toBe(200);
    expect(res.json.booth).toMatchObject({ id: 'bth-d', is_active: false });
    expect(res.json.placements_kept).toBe(2);
    expect((await boothRows(A1))[0]).toMatchObject({ id: 'bth-d', is_active: 0 });
    const placements = await all(
      `SELECT booth_id, is_active FROM poster_deployments WHERE id LIKE 'pd-bth-d%' ORDER BY id`
    );
    expect(placements).toEqual([
      { booth_id: 'bth-d', is_active: 1 },
      { booth_id: 'bth-d', is_active: 1 },
    ]);
  });

  test('a booth with no placement is kept the same way', async () => {
    await seedBooth('bth-d', A1, 'D1');
    expect((await call('DELETE', boothsPath(A1, '/bth-d'), A)).status).toBe(200);
    expect(await boothRows(A1)).toHaveLength(1);
  });

  test('deleting twice is the same answer, still nothing removed', async () => {
    await seedBooth('bth-d', A1, 'D1');
    await call('DELETE', boothsPath(A1, '/bth-d'), A);
    const again = await call('DELETE', boothsPath(A1, '/bth-d'), A);
    expect(again.status).toBe(200);
    expect(await boothRows(A1)).toHaveLength(1);
  });
});

// ── poster deployments: booth_id ──────────────────────────────────────────────

describe('a placement may point at a booth in use of its own event', () => {
  const create = (eventId: string, booth_id: unknown, headers = A) =>
    call('POST', `/api/v2/admin/events/${eventId}/poster-deployments`, headers, {
      placement_label: 'Table card',
      booth_id,
    });
  const placements = (eventId: string) =>
    all('SELECT id, booth_id FROM poster_deployments WHERE event_id = ? ORDER BY id', eventId);

  beforeEach(async () => {
    await seedBooth('bth-p', A1, 'P1');
    await seedBooth('bth-p-off', A1, 'P2', 0);
    await seedBooth('bth-p-a2', A2, 'P1');
    await seedBooth('bth-p-b1', B1, 'P1');
  });

  test('create with a booth of the event: saved, and both admin reads say so', async () => {
    const res = await create(A1, 'bth-p');
    expect(res.status).toBe(201);
    expect(res.json.booth_id).toBe('bth-p');
    expect(await placements(A1)).toEqual([{ id: res.json.id, booth_id: 'bth-p' }]);
    const one = await call('GET', `/api/v2/admin/poster-deployments/${res.json.id}`, A);
    expect(one.json.item.booth_id).toBe('bth-p');
    const list = await call('GET', `/api/v2/admin/events/${A1}/poster-deployments`, A);
    expect(list.json.items.map((i: Json) => i.booth_id)).toEqual(['bth-p']);
  });

  test('create with no booth, or null, is a placement with none', async () => {
    expect((await create(A1, undefined)).json.booth_id).toBeNull();
    expect((await create(A1, null)).json.booth_id).toBeNull();
  });

  test.each([
    ['a booth of another event', 'bth-p-a2'],
    ['a booth of another brand', 'bth-p-b1'],
    ['a booth out of use', 'bth-p-off'],
    ['no such booth', 'bth-nobody'],
  ])('create with %s is the same 404, and nothing is created', async (_label, boothId) => {
    const res = await create(A1, boothId);
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ code: 'BOOTH_NOT_FOUND', error: 'Booth not found' });
    expect(await placements(A1)).toEqual([]);
  });

  test('a booth_id that is not an id is 400', async () => {
    for (const bad of [12, 'has space', { id: 'bth-p' }]) {
      const res = await create(A1, bad);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('INVALID_BOOTH_ID');
    }
    expect(await placements(A1)).toEqual([]);
  });

  test('update: set, refuse another event’s booth, keep, and clear', async () => {
    await seedPlacement('pd-bth-u', A1, null);
    const put = (booth_id: unknown) =>
      call('PUT', '/api/v2/admin/poster-deployments/pd-bth-u', A, { booth_id });
    expect((await put('bth-p')).status).toBe(200);
    expect(await placements(A1)).toEqual([{ id: 'pd-bth-u', booth_id: 'bth-p' }]);

    for (const other of ['bth-p-a2', 'bth-p-b1', 'bth-p-off']) {
      const res = await put(other);
      expect(res.status, other).toBe(404);
      expect(res.json.code).toBe('BOOTH_NOT_FOUND');
    }
    expect(await placements(A1)).toEqual([{ id: 'pd-bth-u', booth_id: 'bth-p' }]);

    // The booth goes out of use; re-sending the booth the placement already has still saves.
    await call('DELETE', boothsPath(A1, '/bth-p'), A);
    expect((await put('bth-p')).status).toBe(200);

    expect((await put(null)).status).toBe(200);
    expect(await placements(A1)).toEqual([{ id: 'pd-bth-u', booth_id: null }]);
  });

  test('another brand’s owner cannot point your placement anywhere', async () => {
    await seedPlacement('pd-bth-x', A1, null);
    const res = await call('PUT', '/api/v2/admin/poster-deployments/pd-bth-x', B, {
      booth_id: 'bth-p-b1',
    });
    expect(res.status).toBe(404);
    expect(await placements(A1)).toEqual([{ id: 'pd-bth-x', booth_id: null }]);
  });
});

// ── the scan path does not change ─────────────────────────────────────────────

describe('/q and scan counting are untouched by booths', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15';
  const scan = (token: string) =>
    call('GET', `/q/${token}`, { 'User-Agent': IPHONE, 'CF-IPCountry': 'US' });

  test('a placement on a booth scans exactly as one without a booth', async () => {
    await seedBooth('bth-q', A1, 'Q1');
    await seedPlacement('pd-bth-q1', A1, 'bth-q');
    await seedPlacement('pd-bth-q2', A1, null);
    const withBooth = await scan('qrt_pd-bth-q1');
    const without = await scan('qrt_pd-bth-q2');
    expect(withBooth.status).toBe(without.status);
    const rows = await all(
      `SELECT poster_deployment_id FROM scan_placement_events WHERE event_id = ? ORDER BY poster_deployment_id`,
      A1
    );
    expect(rows).toEqual([
      { poster_deployment_id: 'pd-bth-q1' },
      { poster_deployment_id: 'pd-bth-q2' },
    ]);
    const cols = (await all(`PRAGMA table_info(scan_placement_events)`)).map((c) => c.name);
    expect(cols).not.toContain('booth_id');
  });

  test('a placement on a booth out of use still scans', async () => {
    await seedBooth('bth-q', A1, 'Q1', 0);
    await seedPlacement('pd-bth-q1', A1, 'bth-q');
    await scan('qrt_pd-bth-q1');
    expect(
      await all(`SELECT poster_deployment_id FROM scan_placement_events WHERE event_id = ?`, A1)
    ).toHaveLength(1);
  });

  // Stamp passport (owner 2026-11-28): the scan path reads a booth in one
  // place only, lib/passport.ts's passportStopSql, to choose where a stop's
  // code lands. It never writes one and no scan row carries one (above).
  test('the scan path source never reads a booth except through the passport landing', () => {
    const sources: Record<string, string> = JSON.parse(tenv.TEST_SOURCE_FILES_JSON);
    const scanFiles = Object.entries(sources).filter(([p]) =>
      /src\/handlers\/qr-scan\.ts$|src\/lib\/scan-/.test(p)
    );
    expect(scanFiles.length).toBeGreaterThan(0);
    for (const [path, content] of scanFiles) {
      expect(content, path).not.toMatch(/booth/i);
    }
    const passport = Object.entries(sources).find(([p]) => /src\/lib\/passport\.ts$/.test(p));
    expect(passport, 'src/lib/passport.ts').toBeTruthy();
    const sql = passport![1];
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b[^']*\bevent_booths\b/i);
    expect(sql).not.toMatch(/scan_placement_events/);
  });
});

// ── the schema ────────────────────────────────────────────────────────────────

describe('the event_booths table holds no person', () => {
  const columns = async (table: string) =>
    (await all(`PRAGMA table_info(${table})`)).map((c) => String(c.name));

  test('its columns are exactly the reviewed list', async () => {
    expect(await columns('event_booths')).toEqual([...BOOTH_COLUMNS]);
  });

  test('no column name suggests a person', async () => {
    const PERSON = /email|phone|mobile|contact|owner|person|vendor_name|first|last|note|address/i;
    for (const name of await columns('event_booths')) {
      expect(name, name).not.toMatch(PERSON);
      expect(classifyColumn(name), name).toEqual([]);
    }
  });

  test('no write key suggests a person either', () => {
    for (const key of new Set(Object.values(BOOTH_WRITE_KEYS).flat())) {
      expect(key).not.toMatch(/email|phone|contact|owner|person|note/i);
    }
  });

  test('poster_deployments.booth_id points at event_booths', async () => {
    const fks = await all(`PRAGMA foreign_key_list(poster_deployments)`);
    expect(fks).toContainEqual(
      expect.objectContaining({ table: 'event_booths', from: 'booth_id', to: 'id' })
    );
    const boothFks = await all(`PRAGMA foreign_key_list(event_booths)`);
    expect(boothFks).toContainEqual(
      expect.objectContaining({ table: 'events', from: 'event_id', to: 'id' })
    );
  });

  test('the database refuses a hall spot outside the plan', async () => {
    for (const [x, y] of [
      [1.01, 0.5],
      [0.5, -0.01],
    ]) {
      await expect(
        tenv.DB.prepare(
          `INSERT INTO event_booths (id, event_id, number, name, hall_x, hall_y) VALUES (?, ?, ?, 'X', ?, ?)`
        )
          .bind(`bth-h-${x}-${y}`, A1, `H${x}${y}`, x, y)
          .run()
      ).rejects.toThrow(/CHECK/);
    }
  });

  test('the indexes exist', async () => {
    const names = (await all(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map(
      (r) => r.name
    );
    expect(names).toContain('idx_event_booths_event_id');
    expect(names).toContain('idx_poster_deployments_booth_id');
  });
});

// ── audit ─────────────────────────────────────────────────────────────────────

describe('every write is audited, in the event’s brand', () => {
  const audit = (action: string, id: string) =>
    all(
      `SELECT outcome, resource_type, actor, brand_id FROM admin_audit_log WHERE action = ? AND resource_id = ?`,
      action,
      id
    );

  test('create, bulk, update and deactivate each leave one success row', async () => {
    const made = await call('POST', boothsPath(A1), A, STALL);
    await call('POST', boothsPath(A2, '/bulk'), A, { booths: [{ number: '1', name: 'One' }] });
    await call('PUT', boothsPath(A1, `/${made.json.id}`), A, { name: 'Renamed' });
    await call('DELETE', boothsPath(A1, `/${made.json.id}`), A);
    for (const [action, id] of [
      ['CREATE_BOOTH', A1],
      ['CREATE_BOOTHS_BULK', A2],
      ['UPDATE_BOOTH', A1],
      ['DEACTIVATE_BOOTH', A1],
    ]) {
      const rows = await audit(action, id);
      expect(rows, action).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        outcome: 'success',
        resource_type: 'event',
        actor: OWNER_A,
        brand_id: BRAND_A,
      });
    }
  });

  test('a refused write is audited as denied, never as a success', async () => {
    await call('POST', boothsPath(A1), A, { ...STALL, name: 'jo@x.io' });
    await call('PUT', boothsPath(A1, '/bth-nobody'), A, { name: 'X' });
    expect((await audit('CREATE_BOOTH', A1)).map((r) => r.outcome)).toEqual(['denied']);
    expect((await audit('UPDATE_BOOTH', A1)).map((r) => r.outcome)).toEqual(['denied']);
  });

  test('a read is not audited', async () => {
    await call('GET', boothsPath(A1), A);
    expect(await all(`SELECT 1 FROM admin_audit_log WHERE resource_id = ?`, A1)).toEqual([]);
  });
});

// ── the event hard-delete still works with booths ─────────────────────────────

describe('an event with booths and booth placements can still be deleted when it has no scans', () => {
  test('the cascade clears placements, then booths, then the event', async () => {
    await seedBooth('bth-del', A2, 'Z1');
    await seedPlacement('pd-bth-del', A2, 'bth-del');
    const res = await call('DELETE', `/api/v2/admin/events/${A2}`, A);
    expect(res.status).toBe(200);
    expect(await boothRows(A2)).toEqual([]);
    expect(await all(`SELECT id FROM events WHERE id = ?`, A2)).toEqual([]);
  });
});

// ── the pure parser ───────────────────────────────────────────────────────────

describe('the pure parser', () => {
  test('the category list is the eight agreed, in one place', () => {
    expect([...BOOTH_CATEGORIES]).toEqual([
      'food',
      'craft',
      'art',
      'books',
      'clothing',
      'services',
      'community',
      'other',
    ]);
  });

  test('a name is trimmed and its spaces collapsed; a number is trimmed only', () => {
    const ok = parseBoothCreate({ number: ' A 1 ', name: '  Two   words ' });
    expect(ok.ok && [ok.value.number, ok.value.name]).toEqual(['A 1', 'Two words']);
  });

  test('a bulk list reports duplicates by index, in any case, and saves none', () => {
    const r = parseBoothBulk({
      booths: [
        { number: 'X', name: 'a' },
        { number: 'y', name: 'b' },
        { number: 'Y', name: 'c' },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failed?.map((f) => f.index)).toEqual([1, 2]);
  });
});
