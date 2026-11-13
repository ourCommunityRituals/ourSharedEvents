/**
 * A series an organizer declares (OSE ADR-028).
 *
 *   GET    /api/v2/admin/events/:id/series           the event's series + the brand's suggestions
 *   POST   /api/v2/admin/events/:id/series           declare a series anchored on this event
 *   PUT    /api/v2/admin/events/:id/series           attach this event to a confirmed series
 *   DELETE /api/v2/admin/events/:id/series           detach it
 *   POST   /api/v2/admin/events/:id/series/confirm   accept a detector suggestion
 *   POST   /api/v2/admin/events/:id/series/reject    turn one down
 *
 * Until this story a series row was written only by the nightly detector, only
 * after 3 or more events at one venue, weekday and hour, and no route could
 * confirm one. A new programme had no series, and an online one never could.
 *
 * Three rules the owner named, each with a test that was watched failing first:
 *   1. another brand's event can never join a series;
 *   2. a series never carries a per-attendee field;
 *   3. promoting a trial changes no past date or count.
 *
 * @born-red showcase S15 | method: written before the routes existed (every
 * request answered 404), then each of the three rules was broken on purpose in
 * the handler and its test watched red:
 *   1. the brand predicate taken out of the event lookup and the attach UPDATE,
 *      then out of the series lookup, then out of the suggestions list;
 *   2. the unknown-field refusal taken out of the body parser; the row spread
 *      into the response; a column dropped from the reviewed list (the same as
 *      the table growing one); the name and reason checks switched off;
 *   3. `start_date = date(start_date, '+1 day')` added to the attach UPDATE; then
 *      `updated_at`; then a scan_aggregates write added to promotion.
 * Ten faults, one at a time; each turned between 1 and 6 tests red.
 * date: 2026-11-13
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { detectEventSeriesClusters } from '../src/lib/shared-report';
import {
  SERIES_COLUMNS,
  SERIES_WRITE_KEYS,
  parseDeclare,
  parseReject,
  projectSeries,
} from '../src/lib/event-series';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-ser-a';
const BRAND_B = 'brand-ser-b';
const OWNER_A = 'owner-ser-a@example.com';
const OWNER_B = 'owner-ser-b@example.com';

// Brand A: three tries of one online room (no venue at all), and a spare.
const A1 = 'evt-ser-a1';
const A2 = 'evt-ser-a2';
const A3 = 'evt-ser-a3';
const A4 = 'evt-ser-a4';
const B1 = 'evt-ser-b1';
const ALL = [A1, A2, A3, A4, B1];

const DECLARE = { name: 'The daily room', cadence: 'weekly', day_of_week: 1, hour_of_day: 17 };

// Keys that would make a series person-shaped.
const BANNED_KEY =
  /^(anon_id_hash|anonymous_id|anon_id|ip|ip_hash|user_agent|user_agent_hash|session|session_id|device|device_id|fingerprint|email|phone|name_of_attendee|attendee|attendees|registrant|lat|lon|latitude|longitude)$/i;

function bannedKeysIn(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => bannedKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(BANNED_KEY.test(k) ? [`${path}.${k}`] : []),
      ...bannedKeysIn(v, `${path}.${k}`),
    ]);
  }
  return [];
}

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

const seriesPath = (id: string, tail = '') => `/api/v2/admin/events/${id}/series${tail}`;
const A = asEmail(OWNER_A);
const B = asEmail(OWNER_B);

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
const seriesIdOf = async (eventId: string) =>
  (await all('SELECT series_id FROM events WHERE id = ?', eventId))[0]?.series_id ?? null;
const seriesRows = () => all('SELECT * FROM event_series ORDER BY id');

/** Mondays at 17:00 UTC, `weeks` weeks after 2026-09-07. All in the past. */
const monday = (weeks: number) =>
  new Date(Date.UTC(2026, 8, 7 + 7 * weeks, 17, 0, 0)).toISOString();

async function seedEvent(id: string, brand: string, start: string, location: string | null) {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'archived', ?, ?, ?, 'America/Chicago')`
  )
    .bind(id, brand, `Series fixture ${id}`, id, location, start, start)
    .run();
}

async function seedPending(id: string, anchor: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO event_series (id, venue_id, series_name, cadence, day_of_week, hour_of_day, state, detected_at)
     VALUES (?, ?, 'Monday 5 PM (auto-detected)', 'weekly', 1, 17, 'pending', '2026-10-01T00:00:00.000Z')`
  )
    .bind(id, anchor)
    .run();
}

/** Everything about the past that promotion must leave alone. */
async function pastSnapshot(): Promise<string> {
  const events = (await all(`SELECT * FROM events WHERE id LIKE 'evt-ser-%' ORDER BY id`)).map(
    ({ series_id: _joined, ...rest }) => rest
  );
  const buckets = await all(
    `SELECT * FROM scan_aggregates WHERE event_id LIKE 'evt-ser-%' ORDER BY id`
  );
  const links = await all(`SELECT * FROM shortlinks WHERE event_id LIKE 'evt-ser-%' ORDER BY code`);
  return JSON.stringify({ events, buckets, links });
}

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
  await db.prepare(`UPDATE events SET series_id = NULL WHERE id LIKE 'evt-ser-%'`).run();
  await db.prepare(`DELETE FROM event_series`).run();
  await db.prepare(`DELETE FROM scan_aggregates WHERE event_id LIKE 'evt-ser-%'`).run();
  await db.prepare(`DELETE FROM shortlinks WHERE event_id LIKE 'evt-ser-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-ser-%'`).run();
  await db.prepare(`DELETE FROM admin_audit_log WHERE resource_id LIKE 'evt-ser-%'`).run();

  // Online: no venue string at all, so the detector can never see these.
  await seedEvent(A1, BRAND_A, monday(0), null);
  await seedEvent(A2, BRAND_A, monday(1), null);
  await seedEvent(A3, BRAND_A, monday(2), null);
  await seedEvent(A4, BRAND_A, monday(3), 'Eagles Hall');
  await seedEvent(B1, BRAND_B, monday(1), null);
  let n = 0;
  for (const [id, people] of [
    [A1, 6],
    [A2, 9],
    [A3, 14],
    [B1, 77],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO scan_aggregates (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, '2026-09-07', NULL, ?, ?, '2026-09-08T00:00:00.000Z')`
      )
      .bind(`sa-${id}`, id, people * 2, people)
      .run();
    await db
      .prepare(`INSERT INTO shortlinks (code, event_id, clicks) VALUES (?, ?, ?)`)
      .bind(`ser-${n++}`, id, people + 3)
      .run();
  }
});

describe('declare: a series anchored on an event, with no venue', () => {
  test('201: the series is confirmed at once, and its anchor event sits on it', async () => {
    const res = await call('POST', seriesPath(A1), A, DECLARE);
    expect(res.status).toBe(201);
    expect(res.json.series).toMatchObject({
      name: 'The daily room',
      cadence: 'weekly',
      day_of_week: 1,
      hour_of_day: 17,
      state: 'confirmed',
      origin: 'declared',
      anchor_event_id: A1,
    });
    expect(res.json.attached).toEqual([A1]);
    expect(await seriesIdOf(A1)).toBe(res.json.series.id);

    const [row] = await seriesRows();
    expect(row).toMatchObject({ venue_id: A1, state: 'confirmed', detected_at: null });
    expect(row.confirmed_at).toBeTruthy();
  });

  test('the anchor has no location: an online programme can have a series', async () => {
    expect((await all('SELECT location FROM events WHERE id = ?', A1))[0].location).toBeNull();
    expect((await call('POST', seriesPath(A1), A, DECLARE)).status).toBe(201);
  });

  test('an event already on a series is not declared again', async () => {
    await call('POST', seriesPath(A1), A, DECLARE);
    const again = await call('POST', seriesPath(A1), A, DECLARE);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('ALREADY_IN_SERIES');
    expect(await seriesRows()).toHaveLength(1);
  });

  test.each([
    ['no name', { ...DECLARE, name: ' ' }, 'INVALID_NAME'],
    ['a name longer than 80', { ...DECLARE, name: 'x'.repeat(81) }, 'INVALID_NAME'],
    ['a cadence OSE does not have', { ...DECLARE, cadence: 'daily' }, 'INVALID_CADENCE'],
    ['day 7', { ...DECLARE, day_of_week: 7 }, 'INVALID_DAY'],
    ['hour 24', { ...DECLARE, hour_of_day: 24 }, 'INVALID_HOUR'],
    ['an hour as text', { ...DECLARE, hour_of_day: '17' }, 'INVALID_HOUR'],
    ['event_ids that is not a list', { ...DECLARE, event_ids: A2 }, 'INVALID_EVENT_IDS'],
  ])('400 for %s, and nothing is written', async (_label, body, code) => {
    const res = await call('POST', seriesPath(A1), A, body);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(code);
    expect(await seriesRows()).toHaveLength(0);
    expect(await seriesIdOf(A1)).toBeNull();
  });

  test('anonymous is 401 and writes nothing', async () => {
    const res = await call('POST', seriesPath(A1), { 'Sec-Fetch-Site': 'same-origin' }, DECLARE);
    expect(res.status).toBe(401);
    expect(await seriesRows()).toHaveLength(0);
  });
});

describe('a declared series feeds the SharedReport trend exactly as a detected one does', () => {
  async function trendOf(eventId: string) {
    const r = await buildSharedReport(tenv.DB, eventId);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('report did not build');
    return r.report.headcount_trend;
  }

  test('the same events give the same trend points, whichever way the series began', async () => {
    const declared = await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: [A2, A3] });
    expect(declared.status).toBe(201);
    const fromDeclared = await trendOf(A2);
    expect(fromDeclared.series_id).toBe(declared.json.series.id);
    expect(fromDeclared.series_name).toBe('The daily room');
    expect(fromDeclared.instances.map((i) => [i.event_id, i.distinct_scanners])).toEqual([
      [A1, 6],
      [A2, 9],
      [A3, 14],
    ]);

    // The same three events on a series the detector found and an organizer accepted.
    await tenv.DB.prepare(`UPDATE events SET series_id = NULL WHERE id LIKE 'evt-ser-%'`).run();
    await tenv.DB.prepare(`DELETE FROM event_series`).run();
    await seedPending('evtsrs_detected', A1);
    const confirmed = await call('POST', seriesPath(A1, '/confirm'), A, {
      series_id: 'evtsrs_detected',
      event_ids: [A1, A2, A3],
    });
    expect(confirmed.status).toBe(200);
    const fromDetected = await trendOf(A2);
    expect(fromDetected.instances).toEqual(fromDeclared.instances);
  });

  test('the nightly detector does not suggest again what an organizer declared', async () => {
    // Three recent events at one venue, weekday and hour: the detector's own trigger.
    const recent = (weeksAgo: number) => {
      const d = new Date(Date.now() - weeksAgo * 7 * 86_400_000);
      d.setUTCHours(19, 0, 0, 0);
      return d.toISOString();
    };
    for (const [i, id] of ['evt-ser-r1', 'evt-ser-r2', 'evt-ser-r3'].entries()) {
      await seedEvent(id, BRAND_A, recent(i + 1), 'Eagles Hall');
      await tenv.DB.prepare(`UPDATE events SET status = 'active' WHERE id = ?`).bind(id).run();
    }
    const day = new Date(recent(1)).getUTCDay();
    const res = await call('POST', seriesPath('evt-ser-r1'), A, {
      ...DECLARE,
      day_of_week: day,
      hour_of_day: 19,
    });
    expect(res.status).toBe(201);

    await detectEventSeriesClusters(tenv as never);
    expect((await seriesRows()).map((r) => r.state)).toEqual(['confirmed']);
  });
});

describe('BORN RED 1: another brand’s event can never join a series', () => {
  test('declare naming another brand’s event is refused whole: no series, nothing attached', async () => {
    const res = await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: [A2, B1] });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('EVENT_NOT_FOUND');
    expect(await seriesRows()).toHaveLength(0);
    for (const id of ALL) expect(await seriesIdOf(id)).toBeNull();
  });

  test('"not yours" reads exactly like "does not exist"', async () => {
    const foreign = await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: [B1] });
    const unknown = await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: ['evt-nope'] });
    const strip = ({ requestId: _r, timestamp: _t, ...rest }: Json) => rest;
    expect(foreign.status).toBe(unknown.status);
    expect(strip(foreign.json)).toEqual(strip(unknown.json));
  });

  test('brand A cannot reach brand B’s event to attach it', async () => {
    const made = await call('POST', seriesPath(A1), A, DECLARE);
    const res = await call('PUT', seriesPath(B1), A, { series_id: made.json.series.id });
    expect(res.status).toBe(404);
    expect(await seriesIdOf(B1)).toBeNull();
  });

  test('brand B cannot attach its own event to brand A’s series', async () => {
    const made = await call('POST', seriesPath(A1), A, DECLARE);
    const res = await call('PUT', seriesPath(B1), B, { series_id: made.json.series.id });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('SERIES_NOT_FOUND');
    expect(await seriesIdOf(B1)).toBeNull();
  });

  test('confirming a suggestion cannot pull in another brand’s event, and it stays pending', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('POST', seriesPath(A4, '/confirm'), A, {
      series_id: 'evtsrs_p1',
      event_ids: [A4, B1],
    });
    expect(res.status).toBe(404);
    expect((await seriesRows())[0].state).toBe('pending');
    expect(await seriesIdOf(A4)).toBeNull();
    expect(await seriesIdOf(B1)).toBeNull();
  });

  test('brand B can neither confirm nor reject brand A’s suggestion', async () => {
    await seedPending('evtsrs_p1', A4);
    for (const tail of ['/confirm', '/reject']) {
      const res = await call('POST', seriesPath(B1, tail), B, { series_id: 'evtsrs_p1' });
      expect(res.status).toBe(404);
      expect(res.json.code).toBe('SERIES_NOT_FOUND');
    }
    expect((await seriesRows())[0].state).toBe('pending');
  });

  test('brand B’s list of suggestions never shows brand A’s', async () => {
    await seedPending('evtsrs_p1', A4);
    const mine = await call('GET', seriesPath(A1), A);
    expect(mine.json.suggestions.map((s: Json) => s.id)).toEqual(['evtsrs_p1']);
    const theirs = await call('GET', seriesPath(B1), B);
    expect(theirs.status).toBe(200);
    expect(theirs.json.suggestions).toEqual([]);
    expect(JSON.stringify(theirs.json)).not.toContain('evt-ser-a');
  });

  test('a report for brand B never carries brand A’s declared series', async () => {
    await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: [A2, A3] });
    const r = await buildSharedReport(tenv.DB, B1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.headcount_trend.series_id).toBeNull();
    expect(JSON.stringify(r.report)).not.toContain('The daily room');
  });
});

describe('BORN RED 2: a series never carries a per-attendee field', () => {
  test('event_series has exactly the reviewed columns, and none is person-shaped', async () => {
    const cols = (await all(`PRAGMA table_info(event_series)`)).map((c) => String(c.name));
    expect(cols.sort()).toEqual([...SERIES_COLUMNS].sort());
    expect(cols.filter((c) => BANNED_KEY.test(c))).toEqual([]);
  });

  test('no write accepts a person-shaped key', () => {
    const accepted = Object.values(SERIES_WRITE_KEYS).flat();
    expect(accepted.filter((k) => BANNED_KEY.test(k))).toEqual([]);
  });

  test.each([['email'], ['anon_id_hash'], ['attendees'], ['phone'], ['notes']])(
    'declare refuses the field %s, and nothing is written',
    async (key) => {
      const res = await call('POST', seriesPath(A1), A, {
        ...DECLARE,
        [key]: 'someone@example.com',
      });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('UNKNOWN_FIELD');
      expect(await seriesRows()).toHaveLength(0);
    }
  );

  test('attach, confirm and reject refuse an extra field too', async () => {
    const made = await call('POST', seriesPath(A1), A, DECLARE);
    await seedPending('evtsrs_p1', A4);
    const extra = { email: 'someone@example.com' };
    for (const [method, tail, body] of [
      ['PUT', '', { series_id: made.json.series.id, ...extra }],
      ['POST', '/confirm', { series_id: 'evtsrs_p1', ...extra }],
      ['POST', '/reject', { series_id: 'evtsrs_p1', ...extra }],
    ] as const) {
      const res = await call(method, seriesPath(A4, tail), A, body);
      expect(res.status, `${method} ${tail}`).toBe(400);
      expect(res.json.code).toBe('UNKNOWN_FIELD');
    }
    expect(await seriesIdOf(A4)).toBeNull();
    expect((await seriesRows()).find((r) => r.id === 'evtsrs_p1')?.state).toBe('pending');
  });

  test.each([
    ['an email', 'Ask someone@example.com'],
    ['a phone number', 'Call 708 555 0134'],
  ])('a name that holds %s is refused', async (_label, name) => {
    const res = await call('POST', seriesPath(A1), A, { ...DECLARE, name });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_NAME');
  });

  test('a rejection reason is a fixed word, never free text', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('POST', seriesPath(A4, '/reject'), A, {
      series_id: 'evtsrs_p1',
      reason: 'Ask Dana, she runs it',
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_REASON');
    expect(parseReject({ series_id: 's', reason: 'duplicate' }).ok).toBe(true);
  });

  test('no response carries a person-shaped key', async () => {
    await seedPending('evtsrs_p1', A4);
    const bodies = [
      (await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: [A2] })).json,
      (await call('GET', seriesPath(A1), A)).json,
      (await call('POST', seriesPath(A4, '/confirm'), A, { series_id: 'evtsrs_p1' })).json,
      (await call('DELETE', seriesPath(A2), A)).json,
    ];
    for (const body of bodies) {
      expect(body.ok).toBe(true);
      expect(bannedKeysIn(body)).toEqual([]);
    }
  });

  test('the response is built field by field: a new column on the row does not travel', () => {
    const view = projectSeries({
      id: 's',
      venue_id: 'e',
      series_name: 'n',
      cadence: 'weekly',
      day_of_week: 1,
      hour_of_day: 17,
      state: 'confirmed',
      detected_at: null,
      confirmed_at: 't',
      rejected_reason: null,
      anon_id_hash: 'must-not-travel',
    } as never);
    expect(JSON.stringify(view)).not.toContain('must-not-travel');
  });
});

describe('BORN RED 3: promoting a trial changes no past date or count', () => {
  test('its past events join the series, and every date, count and click is as it was', async () => {
    const before = await pastSnapshot();
    const reportBefore = await buildSharedReport(tenv.DB, A1);

    // A3 is the latest try. The organizer decides it works: A1 and A2 join.
    const res = await call('POST', seriesPath(A3), A, { ...DECLARE, event_ids: [A1, A2] });
    expect(res.status).toBe(201);
    expect([...res.json.attached].sort()).toEqual([A1, A2, A3]);
    for (const id of [A1, A2, A3]) expect(await seriesIdOf(id)).toBe(res.json.series.id);

    expect(await pastSnapshot()).toBe(before);

    const reportAfter = await buildSharedReport(tenv.DB, A1);
    expect(reportBefore.ok && reportAfter.ok).toBe(true);
    if (!reportBefore.ok || !reportAfter.ok) return;
    expect(reportAfter.report.distinct_scanners).toEqual(reportBefore.report.distinct_scanners);
    // The trend starts from the first try, in date order.
    expect(reportAfter.report.headcount_trend.instances.map((i) => i.event_id)).toEqual([
      A1,
      A2,
      A3,
    ]);
  });

  test('promoting through a detector suggestion leaves the past alone too', async () => {
    await seedPending('evtsrs_p1', A1);
    const before = await pastSnapshot();
    const res = await call('POST', seriesPath(A1, '/confirm'), A, {
      series_id: 'evtsrs_p1',
      event_ids: [A1, A2, A3],
    });
    expect(res.status).toBe(200);
    expect(await pastSnapshot()).toBe(before);
  });

  test('attach and detach move one event and touch nothing else', async () => {
    const made = await call('POST', seriesPath(A1), A, DECLARE);
    const before = await pastSnapshot();
    expect((await call('PUT', seriesPath(A2), A, { series_id: made.json.series.id })).status).toBe(
      200
    );
    expect(await seriesIdOf(A2)).toBe(made.json.series.id);
    expect(await pastSnapshot()).toBe(before);
    expect((await call('DELETE', seriesPath(A2), A)).status).toBe(200);
    expect(await seriesIdOf(A2)).toBeNull();
    expect(await pastSnapshot()).toBe(before);
  });

  test('a past event that already sits on another series is not moved by promotion', async () => {
    const first = await call('POST', seriesPath(A1), A, DECLARE);
    const res = await call('POST', seriesPath(A3), A, { ...DECLARE, event_ids: [A1] });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('ALREADY_IN_SERIES');
    expect(await seriesIdOf(A1)).toBe(first.json.series.id);
    expect(await seriesIdOf(A3)).toBeNull();
    expect(await seriesRows()).toHaveLength(1);
  });
});

describe('confirm or reject a detector suggestion', () => {
  test('GET lists the brand’s suggestions and the event’s own series', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('GET', seriesPath(A4), A);
    expect(res.status).toBe(200);
    expect(res.json.series).toBeNull();
    expect(res.json.suggestions).toEqual([
      expect.objectContaining({
        id: 'evtsrs_p1',
        state: 'pending',
        origin: 'detected',
        anchor_event_id: A4,
      }),
    ]);
  });

  test('confirm: pending becomes confirmed, keeps its origin, and may take a new name', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('POST', seriesPath(A4, '/confirm'), A, {
      series_id: 'evtsrs_p1',
      name: 'Monday bocce',
      event_ids: [A4],
    });
    expect(res.status).toBe(200);
    expect(res.json.series).toMatchObject({
      state: 'confirmed',
      origin: 'detected',
      name: 'Monday bocce',
    });
    expect(res.json.attached).toEqual([A4]);
    expect(await seriesIdOf(A4)).toBe('evtsrs_p1');
    expect((await call('GET', seriesPath(A4), A)).json.suggestions).toEqual([]);
  });

  test('confirm alone attaches nothing: a suggestion is a prompt, never a promotion', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('POST', seriesPath(A4, '/confirm'), A, { series_id: 'evtsrs_p1' });
    expect(res.status).toBe(200);
    expect(res.json.attached).toEqual([]);
    expect(await seriesIdOf(A4)).toBeNull();
  });

  test('reject: pending becomes rejected with its reason, and cannot be joined', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('POST', seriesPath(A4, '/reject'), A, {
      series_id: 'evtsrs_p1',
      reason: 'not_recurring',
    });
    expect(res.status).toBe(200);
    expect(res.json.series).toMatchObject({ state: 'rejected', rejected_reason: 'not_recurring' });
    const attach = await call('PUT', seriesPath(A4), A, { series_id: 'evtsrs_p1' });
    expect(attach.status).toBe(409);
    expect(attach.json.code).toBe('SERIES_NOT_CONFIRMED');
    expect(await seriesIdOf(A4)).toBeNull();
  });

  test('only a pending suggestion can be confirmed or rejected', async () => {
    const made = await call('POST', seriesPath(A1), A, DECLARE);
    for (const tail of ['/confirm', '/reject']) {
      const res = await call('POST', seriesPath(A1, tail), A, { series_id: made.json.series.id });
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('SERIES_NOT_PENDING');
    }
    expect((await seriesRows())[0].state).toBe('confirmed');
  });

  test('a pending series cannot be joined before it is confirmed', async () => {
    await seedPending('evtsrs_p1', A4);
    const res = await call('PUT', seriesPath(A4), A, { series_id: 'evtsrs_p1' });
    expect(res.status).toBe(409);
    expect(await seriesIdOf(A4)).toBeNull();
  });
});

describe('every write is audited, in the event’s brand', () => {
  const audit = (action: string, id: string) =>
    all(
      `SELECT outcome, resource_type, actor, brand_id FROM admin_audit_log WHERE action = ? AND resource_id = ?`,
      action,
      id
    );

  test('declare, attach, detach, confirm and reject each leave one success row', async () => {
    const made = await call('POST', seriesPath(A1), A, DECLARE);
    await call('PUT', seriesPath(A2), A, { series_id: made.json.series.id });
    await call('DELETE', seriesPath(A2), A);
    await seedPending('evtsrs_p1', A4);
    await seedPending('evtsrs_p2', A4);
    await call('POST', seriesPath(A4, '/confirm'), A, { series_id: 'evtsrs_p1' });
    await call('POST', seriesPath(A4, '/reject'), A, { series_id: 'evtsrs_p2' });

    for (const [action, id] of [
      ['DECLARE_SERIES', A1],
      ['ATTACH_SERIES_EVENT', A2],
      ['DETACH_SERIES_EVENT', A2],
      ['CONFIRM_SERIES', A4],
      ['REJECT_SERIES', A4],
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
    await call('POST', seriesPath(A1), A, { ...DECLARE, event_ids: [B1] });
    const rows = await audit('DECLARE_SERIES', A1);
    expect(rows.map((r) => r.outcome)).toEqual(['denied']);
  });
});

describe('the pure parser', () => {
  test('event_ids are de-duplicated and capped at 100', () => {
    const ok = parseDeclare({ ...DECLARE, event_ids: ['a', 'a', 'b'] });
    expect(ok.ok && ok.value.event_ids).toEqual(['a', 'b']);
    const many = Array.from({ length: 101 }, (_, i) => `e${i}`);
    expect(parseDeclare({ ...DECLARE, event_ids: many }).ok).toBe(false);
  });

  test('a name is trimmed and its spaces collapsed', () => {
    const ok = parseDeclare({ ...DECLARE, name: '  The   daily room ' });
    expect(ok.ok && ok.value.name).toBe('The daily room');
  });

  test('a body that is not an object is refused', () => {
    for (const body of [null, [], 'x', 3]) expect(parseDeclare(body).ok).toBe(false);
  });
});
