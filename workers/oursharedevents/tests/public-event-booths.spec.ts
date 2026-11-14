/**
 * The public event read carries the fair's stalls (OSE-1998, OSE ADR-034).
 *
 *   GET /api/v2/events/:id      { item, series, booths: [ {...}, ... ] }
 *   GET /api/v2/events?brand=   unchanged: no `booths` key
 *
 * `booths` is a SIBLING of the event, like `series`, so the public event
 * projection (the allowlist, the API snapshot, brain invariant 16) is untouched.
 * Each stall is six fields; only stalls in use are listed; the statement binds
 * the event's own brand; an event the public read refuses shows none. It is on
 * the single read only: a fair can hold hundreds of stalls and the list read
 * carries every event of a brand.
 *
 * @born-red OSE-1998 | method: written before handleGetEvent read
 * lib/public-booths.ts (the detail response had no `booths` key: 7 of 15 red;
 * the refusals and the list read already held), then four faults, one at a
 * time, each restored before the next:
 *   1. `sort` selected and spread into the mapper (the allowlist): 2 red;
 *   2. `AND b.is_active = 1` taken out of the list statement: 3 red;
 *   3. the brand predicate made always true (`e.brand_id = ? OR 1`): 1 red;
 *   4. ORDER BY swapped to `number, sort`: 2 red.
 * date: 2026-11-14
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { PUBLIC_EVENT_FIELDS } from '../src/lib/public-event-projection';
import {
  PUBLIC_BOOTH_FIELDS,
  fetchPublicBoothsOf,
  fetchPublicBoothByNumber,
} from '../src/lib/public-booths';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

const BRAND_A = 'brand-pubbth-a';
const BRAND_B = 'brand-pubbth-b';
const FAIR = 'evt-pubbth-fair';
const EMPTY = 'evt-pubbth-empty';
const BIG = 'evt-pubbth-big';
const OTHER = 'evt-pubbth-b';
const HIDDEN = {
  draft: 'evt-pubbth-draft',
  ready: 'evt-pubbth-ready',
  archived: 'evt-pubbth-archived',
} as const;

type Json = Record<string, any>;

let nextIp = 1;
async function get(path: string): Promise<{ status: number; json: Json }> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`https://ose.test${path}`, {
      // Public reads are limited per caller: each call is its own caller.
      headers: { 'CF-Connecting-IP': `198.51.100.${nextIp++ % 250}` },
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

async function seedEvent(id: string, brand: string, status = 'active'): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, ?, 1, '2099-06-01', '2099-06-01', 'America/Chicago')`
  )
    .bind(id, brand, `Public booths fixture ${id}`, id, status)
    .run();
}

interface BoothSeed {
  id: string;
  number: string;
  name: string;
  category?: string | null;
  hall?: [number, number] | null;
  active?: 0 | 1;
  sort?: number;
}

async function seedBooth(eventId: string, b: BoothSeed): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO event_booths (id, event_id, number, name, category, hall_x, hall_y, is_active, sort,
                               created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`
  )
    .bind(
      b.id,
      eventId,
      b.number,
      b.name,
      b.category ?? null,
      b.hall?.[0] ?? null,
      b.hall?.[1] ?? null,
      b.active ?? 1,
      b.sort ?? 0
    )
    .run();
}

beforeAll(applyMigrations);

beforeEach(async () => {
  const db = tenv.DB;
  await db.prepare(`DELETE FROM event_booths WHERE id LIKE 'bth-pubbth-%'`).run();
  await db.prepare(`DELETE FROM events WHERE id LIKE 'evt-pubbth-%'`).run();
  for (const id of [FAIR, EMPTY, BIG]) await seedEvent(id, BRAND_A);
  for (const [status, id] of Object.entries(HIDDEN)) await seedEvent(id, BRAND_A, status);
  await seedEvent(OTHER, BRAND_B);

  // The fair: sort decides first, then the number (as text, in any case).
  await seedBooth(FAIR, { id: 'bth-pubbth-10', number: '10', name: 'Ten Teas', category: 'food' });
  await seedBooth(FAIR, {
    id: 'bth-pubbth-2',
    number: '2',
    name: 'Two Looms',
    category: 'craft',
    hall: [0.25, 0.75],
  });
  await seedBooth(FAIR, { id: 'bth-pubbth-a', number: 'a1', name: 'Front Stall', sort: -1 });
  await seedBooth(FAIR, { id: 'bth-pubbth-b', number: 'B1', name: 'Back Stall', sort: 5 });
  // Out of use: never public.
  await seedBooth(FAIR, { id: 'bth-pubbth-off', number: 'X9', name: 'Gone Stall', active: 0 });
  // Stalls of events the public read refuses, and of another brand's fair.
  for (const id of Object.values(HIDDEN)) {
    await seedBooth(id, { id: `bth-pubbth-${id}`, number: '1', name: `Hidden ${id}` });
  }
  await seedBooth(OTHER, { id: 'bth-pubbth-other', number: '1', name: 'Other Brand Stall' });
});

describe('GET /api/v2/events/:id carries the fair’s stalls beside the item', () => {
  test('the stalls in use, in the organizer’s order: sort, then number', async () => {
    const res = await get(`/api/v2/events/${FAIR}`);
    expect(res.status).toBe(200);
    expect(res.json.booths.map((b: Json) => b.number)).toEqual(['a1', '10', '2', 'B1']);
  });

  test('each stall carries exactly the six public fields, with their values', async () => {
    const { json } = await get(`/api/v2/events/${FAIR}`);
    for (const b of json.booths)
      expect(Object.keys(b).sort()).toEqual([...PUBLIC_BOOTH_FIELDS].sort());
    expect(json.booths.find((b: Json) => b.number === '2')).toEqual({
      id: 'bth-pubbth-2',
      number: '2',
      name: 'Two Looms',
      category: 'craft',
      hall_x: 0.25,
      hall_y: 0.75,
    });
    expect(json.booths.find((b: Json) => b.number === 'a1')).toEqual({
      id: 'bth-pubbth-a',
      number: 'a1',
      name: 'Front Stall',
      category: null,
      hall_x: null,
      hall_y: null,
    });
  });

  test('a stall out of use is not listed', async () => {
    const { json } = await get(`/api/v2/events/${FAIR}`);
    expect(JSON.stringify(json)).not.toContain('Gone Stall');
    expect(json.booths.map((b: Json) => b.id)).not.toContain('bth-pubbth-off');
  });

  test('a fair with no stalls carries booths: []', async () => {
    const res = await get(`/api/v2/events/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('booths', []);
  });

  test('another brand’s fair carries only its own stalls', async () => {
    const { json } = await get(`/api/v2/events/${OTHER}`);
    expect(json.booths.map((b: Json) => b.name)).toEqual(['Other Brand Stall']);
    expect(JSON.stringify(json)).not.toContain('Two Looms');
  });

  test.each(Object.entries(HIDDEN))(
    'a %s event is refused, and its stalls are not in the answer',
    async (_status, id) => {
      const res = await get(`/api/v2/events/${id}`);
      expect(res.status).toBe(403);
      expect(res.json).not.toHaveProperty('booths');
      expect(JSON.stringify(res.json)).not.toContain('Hidden');
    }
  );

  test('200 stalls all come back, in order', async () => {
    for (let i = 0; i < 200; i++) {
      await seedBooth(BIG, {
        id: `bth-pubbth-big-${String(i).padStart(3, '0')}`,
        number: `S${String(i).padStart(3, '0')}`,
        name: `Stall number ${i}`,
        sort: 200 - i,
      });
    }
    const res = await get(`/api/v2/events/${BIG}`);
    expect(res.status).toBe(200);
    expect(res.json.booths).toHaveLength(200);
    // sort runs 200..1 as i runs 0..199, so the last seeded comes first.
    expect(res.json.booths[0].number).toBe('S199');
    expect(res.json.booths[199].number).toBe('S000');
  });

  test('the event item itself is unchanged: no booths key', async () => {
    const { json } = await get(`/api/v2/events/${FAIR}`);
    expect(json.item).not.toHaveProperty('booths');
    expect(PUBLIC_EVENT_FIELDS.has('booths')).toBe(false);
  });
});

describe('the list read stays lean', () => {
  test('GET /api/v2/events?brand= carries no booths key and no stall', async () => {
    const res = await get(`/api/v2/events?brand=${BRAND_A}`);
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: Json) => i.id)).toContain(FAIR);
    expect(res.json).not.toHaveProperty('booths');
    expect(JSON.stringify(res.json)).not.toContain('Two Looms');
  });
});

describe('what a public stall can never carry', () => {
  test('the field list is the six', () => {
    expect([...PUBLIC_BOOTH_FIELDS]).toEqual([
      'id',
      'number',
      'name',
      'category',
      'hall_x',
      'hall_y',
    ]);
  });

  test('the answer carries no state, order key, time, event or placement', async () => {
    const text = JSON.stringify((await get(`/api/v2/events/${FAIR}`)).json.booths);
    for (const banned of [
      'is_active',
      'sort',
      'created_at',
      'updated_at',
      'event_id',
      'booth_id',
      'h3',
      'lat',
      'lon',
      'count',
      '2026-11-0',
    ]) {
      expect(text, banned).not.toContain(banned);
    }
  });
});

describe('the reads bind the event’s own brand and fail to empty', () => {
  test('a stall is read only through its own event and brand', async () => {
    expect((await fetchPublicBoothsOf(tenv.DB, FAIR, BRAND_A)).length).toBe(4);
    expect(await fetchPublicBoothsOf(tenv.DB, FAIR, BRAND_B)).toEqual([]);
    expect(await fetchPublicBoothByNumber(tenv.DB, FAIR, BRAND_B, '2')).toBeNull();
    expect((await fetchPublicBoothByNumber(tenv.DB, FAIR, BRAND_A, 'A1'))?.id).toBe('bth-pubbth-a');
    expect(await fetchPublicBoothByNumber(tenv.DB, FAIR, BRAND_A, 'X9')).toBeNull();
  });

  test('a database that throws gives no stalls, never an error', async () => {
    const broken = {
      prepare() {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    expect(await fetchPublicBoothsOf(broken, FAIR, BRAND_A)).toEqual([]);
    expect(await fetchPublicBoothsOf(undefined, FAIR, BRAND_A)).toEqual([]);
    expect(await fetchPublicBoothsOf(tenv.DB, FAIR, '')).toEqual([]);
  });
});
