/**
 * OSE-2197 — a public event answer carries the event's cell, never its stored point.
 *
 * Owner, 2026-11-19: "It should resolve to the H3." "This is the whole point of
 * the H3 layer." "The entire data set should be resolving to the H3 layer and
 * the map item, and then use the address as a secondary source."
 *
 * Events are stored with `lat`, `lon`, `h3_res9` and `h3_res7`. The public
 * answers used to hand out the point (the projection listed `lat`/`lon`, and the
 * map read put them on every pin). Each answer is read here for a placed,
 * listed event and for a live event that is off the map and reached by its
 * link, and three things are asserted of every one:
 *
 *   1. no coordinate (tests/helpers/coordinate-findings.ts: a coordinate-named
 *      field, a number shaped like one, or a pair in text), and the stored
 *      point's digits nowhere in the text;
 *   2. the event's place is its res-7 cell, where the answer gives one;
 *   3. no cell finer than res 7 anywhere: the API keeps the precision it had
 *      and gains none (the stored res-9 cell stays on the server).
 *
 * ONE NARROW EXCEPTION (OSE-2196, owner 2026-11-19: "it should go to the Res9 if
 * possible"; a maps link cannot take a hexagon): the poster bundle's
 * `directions.query` is what the poster's Google / Apple Maps buttons search,
 * and for a routable event it is the point of the event's OWN res-9 cell
 * (lib/cell-point.ts cellPoint, else its res-7 area's when it has no res-9
 * cell). That one path may hold that one value, worked out here from the
 * seeded cell alone, never from the stored point. Any other coordinate, any
 * other path, any other value (the stored point, the res-7 point when a res-9
 * cell exists) still fails, and an event that is not routable carries no
 * directions at all. The event page's Directions are OSE-2196's
 * (tests/routable-directions.spec.ts, tests/no-stored-point.property.spec.ts).
 *
 * Not here: the SharedReport, which needs a signed link and reads cells only
 * (lib/shared-report-builder.ts selects no point). The T0 gate is
 * tests/e2e/0-architecture/public-event-coordinates.invariant.spec.ts; on
 * staging, Bruno reads the same answers (bruno/ose-api/…/OSE-2197 …).
 *
 * Runtime-bound (SELF.fetch, env.DB, the real routes) → workers pool.
 *
 * @born-red OSE-2197 | method: three faults injected one at a time, each put
 *   back: `lat` and `lon` restored to PUBLIC_EVENT_COLUMNS (the list, read,
 *   off-map read and poster bundle cases ran red, and both projection cases in
 *   public-event-projection.spec.ts); `lat`/`lon` restored on the map item from
 *   the row (the map case ran red, with three in events-map*.spec.ts);
 *   `h3_res9` added to PUBLIC_EVENT_COLUMNS (the same four answers ran red on
 *   "no cell finer than res 7"). The calendar case stayed green under the first
 *   fault: the feed writes its own fields from the projected event and never
 *   had a GEO line, so it is a guard, not a regression test | date: 2026-11-19
 * @born-red OSE-2196 poster-bundle exception | method: each fault alone, this
 *   file run, put back. main at f3492f4a (the allowance absent) failed the
 *   listed poster-bundle case on `$.directions.query`. Then: the res-7 point
 *   preferred to the res-9 one (lib/cell-point.ts), the listed case red;
 *   directions sent for an off-map event, the off-map case red; a second field
 *   carrying the point, the listed case red; the filter widened to drop every
 *   pair, and the exact-value check removed, the "one path and one value" case
 *   red each time | date: 2026-11-20
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { cellToLatLng, getResolution, isValidCell, latLngToCell } from 'h3-js';
import { coordinateFindings } from './helpers/coordinate-findings';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const ORIGIN = 'https://localhost';
const BRAND = 'root';

// More decimals than any date, id or price, so their digits can be searched for.
const LAT = 41.657312;
const LON = -87.680647;
const RES9 = latLngToCell(LAT, LON, 9);
const RES7 = latLngToCell(LAT, LON, 7);
const LISTED = 'evt-ose2197-listed';
/**
 * The one value the poster bundle's directions.query may hold for these events:
 * the res-9 cell's point as cellPoint writes it (five decimals), from the cell
 * id alone (OSE-2196).
 */
const RES9_POINT = cellToLatLng(RES9)
  .map((v) => v.toFixed(5))
  .join(',');
const DIRECTIONS_FINDING = '$.directions.query: text holds a coordinate pair';
const OFF_MAP = 'evt-ose2197-offmap';

async function applyAll(db: D1Database, statementsJson: string): Promise<void> {
  for (const stmt of JSON.parse(statementsJson) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (
        m.includes('duplicate column name') ||
        m.includes('already exists') ||
        m.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/** One placed event, as the admin create path stores it: the point and both cells. */
async function seed(id: string, published: 0 | 1): Promise<void> {
  await E.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
                         location, where_address, lat, lon, h3_res9, h3_res7, place_kind,
                         attendance_mode, listed_from, qr_verified, settings_json,
                         created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'Rock Island Public House',
             '13328 Olde Western Ave, Blue Island, IL 60406', ?, ?, ?, ?, 'business',
             'in_person', datetime('now', '-1 day'), 1, '{"useSponsors":true}',
             datetime('now'), datetime('now'))`
  )
    .bind(id, BRAND, `OSE-2197 ${id}`, id, published, inDays(3), inDays(3), LAT, LON, RES9, RES7)
    .run();
}

beforeAll(async () => {
  await applyAll(E.DB, E.TEST_MIGRATION_STATEMENTS);
  await applyAll(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  await seed(LISTED, 1);
  await seed(OFF_MAP, 0);
});

async function read(path: string): Promise<{ status: number; text: string; json: unknown }> {
  const res = await SELF.fetch(`${ORIGIN}${path}`);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

/** Every string in `value` that is an H3 cell, with its resolution. */
function cellsIn(value: unknown, out: { cell: string; res: number }[] = []) {
  if (typeof value === 'string' && isValidCell(value)) {
    out.push({ cell: value, res: getResolution(value) });
  } else if (Array.isArray(value)) {
    for (const v of value) cellsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) cellsIn(v, out);
  }
  return out;
}

/**
 * The three assertions every public JSON answer is held to. `allowRes9Point`
 * is passed for the poster bundle of a routable event only: then, and only
 * then, `$.directions.query` may hold exactly RES9_POINT (OSE-2196).
 */
function expectNoPoint(
  path: string,
  answer: { text: string; json: unknown },
  opts: { allowRes9Point?: boolean } = {}
): void {
  let findings = coordinateFindings(answer.json);
  if (opts.allowRes9Point) {
    const query = (answer.json as { directions?: { query?: unknown } } | null)?.directions?.query;
    expect(query, `${path}: directions.query is the res-9 cell's own point`).toBe(RES9_POINT);
    findings = findings.filter((f) => f !== DIRECTIONS_FINDING);
  }
  expect(findings, path).toEqual([]);
  expect(answer.text, `${path} carries the stored latitude`).not.toContain(String(LAT));
  expect(answer.text, `${path} carries the stored longitude`).not.toContain(String(LON));
  const finer = cellsIn(answer.json).filter((c) => c.res > 7);
  expect(finer, `${path} carries a cell finer than res 7`).toEqual([]);
  expect(answer.text, `${path} carries the stored res-9 cell`).not.toContain(RES9);
}

describe('OSE-2197 | the public event answers carry the cell, never the point', () => {
  test('GET /api/v2/events: the listed event, by its res-7 cell', async () => {
    const r = await read(`/api/v2/events?brand=${BRAND}`);
    expect(r.status).toBe(200);
    const items = (r.json as { items: Record<string, unknown>[] }).items;
    const mine = items.find((i) => i.id === LISTED)!;
    expect(mine, 'the seeded event is listed').toBeTruthy();
    expect(mine.h3_res7).toBe(RES7);
    expect(mine).not.toHaveProperty('lat');
    expect(mine).not.toHaveProperty('lon');
    expectNoPoint('list', r);
  });

  test('GET /api/v2/events/:id: the listed event, by its res-7 cell', async () => {
    const r = await read(`/api/v2/events/${LISTED}`);
    expect(r.status).toBe(200);
    const item = (r.json as { item: Record<string, unknown> }).item;
    expect(item.h3_res7).toBe(RES7);
    expect(item.where_address).toBe('13328 Olde Western Ave, Blue Island, IL 60406');
    expectNoPoint('read', r);
  });

  test('GET /api/v2/events/:id: a live event off the map, reached by its link, carries no point either', async () => {
    const r = await read(`/api/v2/events/${OFF_MAP}`);
    expect(r.status).toBe(200);
    expect((r.json as { item: { id: string } }).item.id).toBe(OFF_MAP);
    expectNoPoint('off-map read', r);
  });

  test('GET /api/v2/events/map: each pin is its res-7 cell, as asked for', async () => {
    const r = await read(`/api/v2/events/map?cell=${RES7}&brand=${BRAND}`);
    expect(r.status).toBe(200);
    const items = (r.json as { items: Record<string, unknown>[] }).items;
    const mine = items.find((i) => i.id === LISTED)!;
    expect(mine, 'the seeded event is on the map').toBeTruthy();
    expect(mine.h3_res7).toBe(RES7);
    expect(items.map((i) => i.id)).not.toContain(OFF_MAP);
    expectNoPoint('map', r);
  });

  test('GET /api/v2/events/:id/poster-bundle: the event it prints carries no point; its directions only the res-9 cell point', async () => {
    const r = await read(`/api/v2/events/${LISTED}/poster-bundle`);
    expect(r.status).toBe(200);
    expect((r.json as { event: { h3_res7: string } }).event.h3_res7).toBe(RES7);
    expectNoPoint('poster-bundle', r, { allowRes9Point: true });
  });

  test('GET /api/v2/events/:id/poster-bundle: an event off the map carries no point and no directions', async () => {
    const r = await read(`/api/v2/events/${OFF_MAP}/poster-bundle`);
    expect(r.status).toBe(200);
    const body = r.json as { routable: unknown; directions: unknown };
    expect(body.routable).toBe(false);
    expect(body.directions).toBeNull();
    expectNoPoint('off-map poster-bundle', r);
  });

  test('the poster-bundle exception is that one path and that one value', () => {
    const answer = (json: unknown) => ({ text: JSON.stringify(json), json });
    const ok = { event: { h3_res7: RES7 }, directions: { query: RES9_POINT } };
    // The allowed shape passes.
    expectNoPoint('allowed', answer(ok), { allowRes9Point: true });
    const res7Point = cellToLatLng(RES7)
      .map((v) => v.toFixed(5))
      .join(',');
    const refused: Array<[string, unknown]> = [
      ['the stored point', { ...ok, directions: { query: `${LAT},${LON}` } }],
      ['the res-7 point although a res-9 cell exists', { ...ok, directions: { query: res7Point } }],
      ['the point in another field', { ...ok, event: { h3_res7: RES7, note: RES9_POINT } }],
      ['a second pair beside it', { ...ok, directions: { query: RES9_POINT, other: RES9_POINT } }],
      ['the point without the allowance', ok],
    ];
    for (const [why, json] of refused) {
      const allow = why !== 'the point without the allowance';
      expect(() => expectNoPoint(why, answer(json), { allowRes9Point: allow }), why).toThrow();
    }
  });

  test('GET /api/v2/events/:id/display-config: no point', async () => {
    const r = await read(`/api/v2/events/${LISTED}/display-config`);
    expect(r.status).toBe(200);
    expectNoPoint('display-config', r);
  });

  test('GET /api/v2/events/:id/sponsors and sponsor-bundle: no point', async () => {
    for (const path of [
      `/api/v2/events/${LISTED}/sponsors`,
      `/api/v2/events/${LISTED}/sponsor-bundle`,
    ]) {
      const r = await read(path);
      expect(r.status, path).toBe(200);
      expectNoPoint(path, r);
    }
  });

  test('GET /brands/:brand/calendar.ics: the feed built from the projection holds no point', async () => {
    const r = await read(`/brands/${BRAND}/calendar.ics`);
    expect(r.status).toBe(200);
    expect(r.text).toContain(LISTED);
    expect(r.text).not.toContain(String(LAT));
    expect(r.text).not.toContain(String(LON));
    expect(r.text).not.toMatch(/^GEO[:;]/m);
  });
});
