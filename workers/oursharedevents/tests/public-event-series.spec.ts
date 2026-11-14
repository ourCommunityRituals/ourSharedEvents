/**
 * The public event response says which confirmed series an event sits on (OSE-2018).
 *
 *   GET /api/v2/events?brand=   { items, sponsor_titles, series: { <event id>: {...} } }
 *   GET /api/v2/events/:id      { item, series: {...} | null }
 *
 * ourWKRP builds the creator showcase from these two reads. Its rule "a
 * programme event sits on a declared series" needs to see the series; until
 * this change only an admin could.
 *
 * `series` is a SIBLING of the event, like `sponsor_titles`, so the public
 * event projection (the allowlist, the API snapshot, brain invariant 16) is
 * untouched. It is five fields, and it is there only for a `confirmed` series
 * whose anchor is in the event's own brand.
 *
 * @born-red OSE-2018 | method: written before lib/public-series.ts existed
 * (neither response had a `series` key), then four faults, one at a time: the
 * `confirmed` predicate removed; the anchor-brand predicate removed; the row
 * spread into the object; `series_id` added to the public column list.
 * date: 2026-11-13
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PUBLIC_EVENT_FIELDS } from '../src/lib/public-event-projection';
import { PUBLIC_SERIES_FIELDS } from '../src/lib/public-series';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-pubser-a';
const BRAND_B = 'brand-pubser-b';
const ON = 'evt-pubser-on';
const OFF = 'evt-pubser-off';
const PENDING = 'evt-pubser-pending';
const REJECTED = 'evt-pubser-rejected';
const FOREIGN = 'evt-pubser-foreign';
const B_ANCHOR = 'evt-pubser-b-anchor';

type Json = Record<string, any>;

let nextIp = 1;
async function get(path: string): Promise<{ status: number; json: Json }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      // Public reads are limited per caller: each call is its own caller.
      headers: { 'CF-Connecting-IP': `203.0.113.${nextIp++ % 250}` },
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, json: (await res.json()) as Json };
}

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

async function seedEvent(id: string, brand: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, 'active', 1, '2099-06-01', '2099-06-01', 'America/Chicago')`
  )
    .bind(id, brand, `Public series fixture ${id}`, id)
    .run();
}

async function seedSeries(id: string, anchor: string, state: string, event: string): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO event_series (id, venue_id, series_name, cadence, day_of_week, hour_of_day, state,
                               detected_at, confirmed_at, rejected_reason)
     VALUES (?, ?, ?, 'weekly', 1, 17, ?, '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 'duplicate')`
  )
    .bind(id, anchor, `Name of ${id}`, state)
    .run();
  await tenv.DB.prepare(`UPDATE events SET series_id = ? WHERE id = ?`).bind(id, event).run();
}

beforeAll(applyMigrations);

beforeEach(async () => {
  const db = tenv.DB;
  await db.prepare(`UPDATE events SET series_id = NULL WHERE id LIKE 'evt-pubser-%'`).run();
  await db.prepare(`DELETE FROM event_series WHERE id LIKE 'srs-pubser-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-pubser-%'`).run();
  for (const id of [ON, OFF, PENDING, REJECTED, FOREIGN]) await seedEvent(id, BRAND_A);
  await seedEvent(B_ANCHOR, BRAND_B);
  await seedSeries('srs-pubser-ok', ON, 'confirmed', ON);
  await seedSeries('srs-pubser-pending', PENDING, 'pending', PENDING);
  await seedSeries('srs-pubser-rejected', REJECTED, 'rejected', REJECTED);
  // A legacy cross-brand row: brand A's event on a series anchored in brand B.
  await seedSeries('srs-pubser-foreign', B_ANCHOR, 'confirmed', FOREIGN);
});

const EXPECTED = {
  id: 'srs-pubser-ok',
  name: 'Name of srs-pubser-ok',
  cadence: 'weekly',
  day_of_week: 1,
  hour_of_day: 17,
};

describe('GET /api/v2/events/:id carries the event’s confirmed series', () => {
  test('an event on a confirmed series carries exactly the five fields', async () => {
    const res = await get(`/api/v2/events/${ON}`);
    expect(res.status).toBe(200);
    expect(res.json.series).toEqual(EXPECTED);
  });

  test.each([
    ['on no series', OFF],
    ['on a pending suggestion', PENDING],
    ['on a rejected suggestion', REJECTED],
    ['on a series anchored in another brand', FOREIGN],
  ])('an event %s carries series: null', async (_label, id) => {
    const res = await get(`/api/v2/events/${id}`);
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('series', null);
  });

  test('the event item itself is unchanged: no series key, no series_id', async () => {
    const { json } = await get(`/api/v2/events/${ON}`);
    expect(json.item).not.toHaveProperty('series');
    expect(json.item).not.toHaveProperty('series_id');
  });
});

describe('GET /api/v2/events carries a series map beside the items', () => {
  test('only the event on a confirmed, same-brand series is in the map', async () => {
    const res = await get(`/api/v2/events?brand=${BRAND_A}`);
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: Json) => i.id).sort()).toEqual(
      [FOREIGN, OFF, ON, PENDING, REJECTED].sort()
    );
    expect(res.json.series).toEqual({ [ON]: EXPECTED });
  });

  test('another brand’s list never shows this brand’s series', async () => {
    const res = await get(`/api/v2/events?brand=${BRAND_B}`);
    expect(res.status).toBe(200);
    expect(res.json.series).toEqual({});
    expect(JSON.stringify(res.json)).not.toContain('srs-pubser');
  });

  test('no item carries a series key or series_id', async () => {
    const { json } = await get(`/api/v2/events?brand=${BRAND_A}`);
    for (const item of json.items) {
      expect(item).not.toHaveProperty('series');
      expect(item).not.toHaveProperty('series_id');
    }
  });
});

describe('what the public series object can never carry', () => {
  test('the field list is the five, and none is a state, a time, a reason or a count', () => {
    expect([...PUBLIC_SERIES_FIELDS]).toEqual([
      'id',
      'name',
      'cadence',
      'day_of_week',
      'hour_of_day',
    ]);
  });

  test('neither response leaks the lifecycle, the anchor or the audit times', async () => {
    const one = JSON.stringify((await get(`/api/v2/events/${ON}`)).json.series);
    const many = JSON.stringify((await get(`/api/v2/events?brand=${BRAND_A}`)).json.series);
    for (const text of [one, many]) {
      for (const banned of [
        'state',
        'venue_id',
        'anchor',
        'detected_at',
        'confirmed_at',
        'rejected_reason',
        'duplicate',
        'origin',
        'count',
      ]) {
        expect(text, banned).not.toContain(banned);
      }
    }
  });

  test('series_id is not a public event column', () => {
    expect(PUBLIC_EVENT_FIELDS.has('series_id')).toBe(false);
    expect(PUBLIC_EVENT_FIELDS.has('series')).toBe(false);
  });
});
