/**
 * An event's place is looked up when it is saved, so the zip search finds it
 * (owner report 2026-10-11).
 *
 * `/?zip=60406` lists an event only when its map cell (h3_res7) is near the
 * zip. Neither create form sent coordinates, so on staging 3 of 174 live events
 * had a cell and "Criu De Sheela" at Rock Island Public House (Blue Island,
 * 60406) did not show for 60406. Now:
 *
 *   - create and update look the place up (street address, else place name),
 *     and keep the answer only when Google names a spot, never a city, a zip
 *     or a part match;
 *   - a lookup that is not set up, fails or finds nothing never fails the save;
 *   - a changed place drops the old point first;
 *   - the nightly job looks up at most 25 older events a night, each once.
 *
 * Google is never called: every test stubs `fetch` and reads the URL it got.
 *
 * @born-red event place lookup | method: each test was run against main at
 *   c49b5647 (no lookup on save, no place_checked_at column, no nightly job)
 *   and failed | date: 2026-10-11
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { handleCreateEvent, handleUpdateEvent, type EventsEnv } from '../src/handlers/events';
import { latLngToCell } from 'h3-js';
import {
  lookUpEventPlace,
  runEventPlaceBackfill,
  PLACE_BACKFILL_MAX,
} from '../src/lib/event-place';
import { fetchPlaceLinks } from '../src/lib/map-place-links';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv & EventsEnv;
const KEYED = { ...(env as unknown as EventsEnv), GOOGLE_MAPS_API_KEY: 'test-maps-key' };
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
  'Sec-Fetch-Site': 'same-origin',
};

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Rock Island Public House, Blue Island IL (60406): the coordinates the poster
// tests use for it, in res-7 cell 872664544ffffff.
const RIPH = { lat: 41.6565, lng: -87.681 };

function google(results: unknown[], status = results.length ? 'OK' : 'ZERO_RESULTS') {
  return new Response(JSON.stringify({ status, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
const spot = (types: string[], extra: Record<string, unknown> = {}) =>
  google([
    {
      geometry: { location: RIPH },
      formatted_address: '13328 Olde Western Ave, Blue Island, IL 60406, USA',
      types,
      ...extra,
    },
  ]);

/** Stub fetch with one answer; return the URLs it was asked for. */
function stubGoogle(answer: () => Response): string[] {
  const urls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return answer();
  });
  return urls;
}

const row = (id: string) =>
  E.DB.prepare(
    'SELECT lat, lon, h3_res7, h3_res9, place_kind, place_checked_at, location, where_address FROM events WHERE id = ?'
  )
    .bind(id)
    .first<Record<string, unknown>>();

async function create(env: EventsEnv, body: Record<string, unknown>) {
  const res = await handleCreateEvent(
    new Request('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({
        attendance_mode: 'in_person',
        location: 'Test Hall',
        start_date: '2026-12-05',
        ...body,
      }),
    }),
    env
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; place: string };
}

async function update(env: EventsEnv, id: string, body: Record<string, unknown>) {
  const res = await handleUpdateEvent(
    new Request(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify(body),
    }),
    env,
    id
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { place?: string };
}

describe('the lookup keeps a spot and nothing wider', () => {
  test('a business or street address is kept, with its coordinates', async () => {
    for (const [types, kind] of [
      [['establishment', 'point_of_interest'], 'business'],
      [['point_of_interest'], 'business'],
      [['street_address'], 'address'],
      [['premise'], 'address'],
      [['intersection'], 'address'],
    ] as const) {
      const r = await lookUpEventPlace(KEYED, null, 'Rock Island Public House', async () =>
        spot([...types])
      );
      expect(r, types.join()).toEqual({ found: true, lat: RIPH.lat, lon: RIPH.lng, kind });
    }
  });

  test('a city, a zip or a street is not kept: the place would be wrong', async () => {
    for (const types of [['locality', 'political'], ['postal_code'], ['route'], ['neighborhood']]) {
      const r = await lookUpEventPlace(KEYED, null, 'Rock Island Public House', async () =>
        spot(types)
      );
      expect(r, types.join()).toEqual({ found: false, reason: 'NOT_A_SPOT' });
    }
  });

  test('a part match is not kept, even on a business type', async () => {
    const r = await lookUpEventPlace(KEYED, null, 'The Pub', async () =>
      spot(['establishment'], { partial_match: true })
    );
    expect(r).toEqual({ found: false, reason: 'NOT_A_SPOT' });
  });

  test('the street address is asked for before the place name', async () => {
    const urls = stubGoogle(() => spot(['street_address']));
    await lookUpEventPlace(KEYED, '13328 Olde Western Ave, Blue Island', 'RIPH');
    expect(new URL(urls[0]).searchParams.get('address')).toBe(
      '13328 Olde Western Ave, Blue Island'
    );
  });

  test('no answer, no key, no text and an error each say so, and none throws', async () => {
    expect(await lookUpEventPlace(KEYED, null, 'Nowhere', async () => google([]))).toEqual({
      found: false,
      reason: 'NOT_FOUND',
    });
    expect(
      await lookUpEventPlace(KEYED, null, 'X', async () => new Response('', { status: 500 }))
    ).toEqual({ found: false, reason: 'LOOKUP_FAILED' });
    expect(await lookUpEventPlace(E, null, 'X', async () => spot(['premise']))).toEqual({
      found: false,
      reason: 'NOT_SET_UP',
    });
    expect(await lookUpEventPlace(KEYED, '  ', null)).toEqual({ found: false, reason: 'NO_TEXT' });
  });
});

describe('saving an event looks its place up once', () => {
  test('create: the place is found, so the event has a cell and says on_map', async () => {
    const urls = stubGoogle(() => spot(['establishment', 'point_of_interest']));
    const { id, place } = await create(KEYED, {
      title: 'Criu De Sheela',
      location: 'Rock Island Public House, Blue Island',
    });
    expect(place).toBe('on_map');
    expect(urls).toHaveLength(1);
    const r = (await row(id))!;
    expect(r.lat).toBe(RIPH.lat);
    expect(r.lon).toBe(RIPH.lng);
    expect(r.h3_res7).toBe('872664544ffffff');
    expect(r.place_kind).toBe('business');
    expect(typeof r.place_checked_at).toBe('string');
  });

  test('create: a city answer leaves no point, stamps the check and says not_found', async () => {
    stubGoogle(() => spot(['locality', 'political']));
    const { id, place } = await create(KEYED, { title: 'Bar night', location: 'Rock Island' });
    expect(place).toBe('not_found');
    const r = (await row(id))!;
    expect(r.lat).toBeNull();
    expect(r.h3_res7).toBeNull();
    expect(r.place_kind).toBeNull();
    expect(typeof r.place_checked_at).toBe('string');
  });

  test('create: without the Maps key nothing is asked and the check stays open', async () => {
    const urls = stubGoogle(() => spot(['premise']));
    const { id, place } = await create(E, {
      title: 'No key',
      location: 'Rock Island Public House',
    });
    expect(place).toBe('not_looked_up');
    expect(urls).toHaveLength(0);
    expect((await row(id))!.place_checked_at).toBeNull();
  });

  test('create: Google erroring never fails the save, and the check stays open', async () => {
    stubGoogle(() => new Response('', { status: 503 }));
    const { id, place } = await create(KEYED, { title: 'Flaky', location: 'Somewhere' });
    expect(place).toBe('not_looked_up');
    expect((await row(id))!.place_checked_at).toBeNull();
  });

  test('create: coordinates sent with the event are used and Google is not asked', async () => {
    const urls = stubGoogle(() => spot(['premise']));
    const { id, place } = await create(KEYED, {
      title: 'Has coords',
      location: 'Anywhere',
      lat: RIPH.lat,
      lon: RIPH.lng,
    });
    expect(place).toBe('on_map');
    expect(urls).toHaveLength(0);
    expect((await row(id))!.h3_res7).toBe('872664544ffffff');
    // Not looked up, so no kind: the zoomed map puts it at its block.
    expect((await row(id))!.place_kind).toBeNull();
  });

  test('create: a street address is kept as an address, so its dot is a block', async () => {
    stubGoogle(() => spot(['street_address']));
    const { id } = await create(KEYED, { title: 'Backyard', location: '1 Home St, Blue Island' });
    expect((await row(id))!.place_kind).toBe('address');
  });

  test('update: a changed place drops the old point and is looked up again', async () => {
    stubGoogle(() => spot(['establishment']));
    const { id } = await create(KEYED, { title: 'Moves', location: 'Rock Island Public House' });
    vi.restoreAllMocks();
    const urls = stubGoogle(() => google([]));
    const out = await update(KEYED, id, { location: 'A bar that is not on any map' });
    expect(out.place).toBe('not_found');
    expect(urls).toHaveLength(1);
    const r = (await row(id))!;
    expect(r.lat).toBeNull();
    expect(r.h3_res7).toBeNull();
    expect(r.place_kind).toBeNull();
    expect(r.location).toBe('A bar that is not on any map');
  });

  test('update: a changed place drops the old kind even when Google is down', async () => {
    stubGoogle(() => spot(['establishment']));
    const { id } = await create(KEYED, {
      title: 'Was a bar',
      location: 'Rock Island Public House',
    });
    expect((await row(id))!.place_kind).toBe('business');
    vi.restoreAllMocks();
    stubGoogle(() => new Response('', { status: 503 }));
    const out = await update(KEYED, id, { location: '1 Home St, Blue Island' });
    expect(out.place).toBe('not_looked_up');
    const r = (await row(id))!;
    expect(r.lat).toBeNull();
    // The old business kind must not ride along to the new place.
    expect(r.place_kind).toBeNull();
  });

  test('update: the same place text, or another field, costs no lookup', async () => {
    stubGoogle(() => spot(['establishment']));
    const { id } = await create(KEYED, { title: 'Stays', location: 'Rock Island Public House' });
    vi.restoreAllMocks();
    const urls = stubGoogle(() => spot(['premise']));
    const same = await update(KEYED, id, { location: 'Rock Island Public House', title: 'Stays!' });
    expect(same.place).toBeUndefined();
    expect(urls).toHaveLength(0);
    expect((await row(id))!.h3_res7).toBe('872664544ffffff');
  });
});

/** Empty the nightly queues other tests may have left, so a run sees only its own rows. */
async function emptyQueue() {
  await E.DB.prepare(
    "UPDATE events SET place_checked_at = 'earlier' WHERE place_checked_at IS NULL"
  ).run();
  await E.DB.prepare(
    "UPDATE events SET place_kind = 'address' WHERE place_kind IS NULL AND lat IS NOT NULL"
  ).run();
}

describe('the nightly job looks up older events, each once, a few a night', () => {
  async function seedOld(id: string, overrides: Record<string, unknown> = {}) {
    const v = {
      status: 'active',
      start_date: '2099-01-01',
      location: 'Rock Island Public House',
      place_checked_at: null,
      ...overrides,
    };
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, location, place_checked_at, created_at, updated_at)
       VALUES (?, 'root', ?, ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, id, id, v.status, v.start_date, v.location, v.place_checked_at)
      .run();
  }

  test('only upcoming, unarchived, never-checked events with place text are asked', async () => {
    // Empty the queue other tests may have left so this run sees only these rows.
    await emptyQueue();
    await seedOld('evt-pl-due');
    await seedOld('evt-pl-past', { start_date: '2001-01-01' });
    await seedOld('evt-pl-archived', { status: 'archived' });
    await seedOld('evt-pl-checked', { place_checked_at: '2026-10-01T00:00:00Z' });
    await seedOld('evt-pl-blank', { location: '   ' });
    const urls = stubGoogle(() => spot(['establishment']));
    const out = await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(1);
    expect(out).toMatchObject({ checked: 1, found: 1 });
    expect((await row('evt-pl-due'))!.h3_res7).toBe('872664544ffffff');
    for (const id of ['evt-pl-past', 'evt-pl-archived', 'evt-pl-checked', 'evt-pl-blank']) {
      expect((await row(id))!.h3_res7, id).toBeNull();
    }
    // Asked once: the next night asks nothing.
    expect((await runEventPlaceBackfill(KEYED)).checked).toBe(0);
    expect(urls).toHaveLength(1);
  });

  test('at most 25 a night, and a place not found is not asked again', async () => {
    // 25 lookups is the nightly spend this change is held to (about 13 cents at
    // Google's list price); raising it is a cost decision, not a refactor.
    expect(PLACE_BACKFILL_MAX).toBe(25);
    await emptyQueue();
    for (let i = 0; i < 30; i++) {
      await seedOld(`evt-pl-cap-${String(i).padStart(2, '0')}`);
    }
    const urls = stubGoogle(() => google([]));
    await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(25);
    await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(30);
    await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(30);
  });

  test('without the Maps key the nightly job asks nothing and stamps nothing', async () => {
    await seedOld('evt-pl-nokey');
    const urls = stubGoogle(() => spot(['premise']));
    await runEventPlaceBackfill(E);
    expect(urls).toHaveLength(0);
    expect((await row('evt-pl-nokey'))!.place_checked_at).toBeNull();
  });
});

describe('the nightly job fills the place kind of events placed before kinds were kept', () => {
  async function seedPlaced(id: string, overrides: Record<string, unknown> = {}) {
    const v = {
      start_date: '2099-01-01',
      place_checked_at: '2026-10-01T00:00:00Z',
      place_kind: null,
      ...overrides,
    };
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, location,
         lat, lon, h3_res9, h3_res7, place_kind, place_checked_at, created_at, updated_at)
       VALUES (?, 'root', ?, ?, 'active', 1, ?, 'Rock Island Public House', 41.65, -87.68,
         'kept-res9', 'kept-res7', ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, id, id, v.start_date, v.place_kind, v.place_checked_at)
      .run();
  }

  test('a business answer stores the kind and never moves the event', async () => {
    await emptyQueue();
    await seedPlaced('evt-kind-biz');
    const urls = stubGoogle(() => spot(['establishment']));
    const out = await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(1);
    expect(out.kinds).toBe(1);
    const r = (await row('evt-kind-biz'))!;
    expect(r.place_kind).toBe('business');
    // Google answered RIPH's point; the stored point and cells stay as they were.
    expect([r.lat, r.lon, r.h3_res9, r.h3_res7]).toEqual([41.65, -87.68, 'kept-res9', 'kept-res7']);
    // Filled once: the next night asks nothing.
    await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(1);
  });

  test('an answer that names no spot stores address and keeps the point', async () => {
    await emptyQueue();
    await seedPlaced('evt-kind-none');
    stubGoogle(() => google([]));
    await runEventPlaceBackfill(KEYED);
    const r = (await row('evt-kind-none'))!;
    expect(r.place_kind).toBe('address');
    expect(r.lat).toBe(41.65);
  });

  test('Google down leaves the kind open for the next night', async () => {
    await emptyQueue();
    await seedPlaced('evt-kind-down');
    stubGoogle(() => new Response('', { status: 503 }));
    await runEventPlaceBackfill(KEYED);
    expect((await row('evt-kind-down'))!.place_kind).toBeNull();
  });

  test('events placed from coordinates, past or already kinded are not asked', async () => {
    await emptyQueue();
    await seedPlaced('evt-kind-coords', { place_checked_at: null });
    await seedPlaced('evt-kind-past', { start_date: '2001-01-01' });
    await seedPlaced('evt-kind-done', { place_kind: 'business' });
    const urls = stubGoogle(() => spot(['establishment']));
    await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(0);
    expect((await row('evt-kind-coords'))!.place_kind).toBeNull();
  });

  test('kinds use only what the night has left after never-looked-up events', async () => {
    await emptyQueue();
    await seedPlaced('evt-kind-wait');
    for (let i = 0; i < PLACE_BACKFILL_MAX; i++) {
      await E.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, location, created_at, updated_at)
         VALUES (?, 'root', 'q', ?, 'active', 1, '2099-01-01', 'Rock Island Public House', datetime('now'), datetime('now'))`
      )
        .bind(`evt-kind-q-${i}`, `q-${i}`)
        .run();
    }
    const urls = stubGoogle(() => google([]));
    await runEventPlaceBackfill(KEYED);
    expect(urls).toHaveLength(PLACE_BACKFILL_MAX);
    expect((await row('evt-kind-wait'))!.place_kind).toBeNull();
    await runEventPlaceBackfill(KEYED);
    expect((await row('evt-kind-wait'))!.place_kind).toBe('address');
  });
});

describe('the zip search then finds the event', () => {
  test('/?zip=60406 lists an event at Rock Island Public House once its place is found', async () => {
    stubGoogle(() => spot(['establishment', 'point_of_interest']));
    await create(KEYED, {
      title: 'Zip Night At RIPH',
      location: 'Rock Island Public House, Blue Island',
      status: 'active',
      is_published: true,
      start_date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
    });
    vi.restoreAllMocks();
    const html = await (await SELF.fetch('https://t.test/?zip=60406')).text();
    expect(html).toContain('Zip Night At RIPH');
  });
});

// The Worker has no street map bound here, as on staging and production today,
// so the zoomed page is the place list and the panels, with no dot map
// (OSE-1894). The dots themselves are in map-zoom.spec.ts (node project).
//
// @born-red zoomed page through the Worker | method: 8 faults injected one at
//   a time (a panel printing its event's latitude, dots drawn with no street
//   map, the panels not rendered, the link read skipped, check-in allowed as a
//   link, the share code not read, a link read that also counts a tap, the
//   Share script dropped); each turned a test here red | date: 2026-11-09
describe('a tapped hexagon: /?area= zooms into its events (owner, 2026-11-09)', () => {
  const CELL = '872664544ffffff';
  const soon = () => new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);

  /** The zoomed part of the page: the map's wrapper, up to the card list. */
  function zoomOf(html: string): string {
    const from = html.indexOf('data-testid="amap-wrap"');
    return from < 0 ? '' : html.slice(from, html.indexOf('data-testid="area-list"', from));
  }

  /** The panel holding this event: its place number, its meta line, its markup. */
  function placeOf(html: string, name: string): { n: string; meta: string; html: string } | null {
    for (const m of zoomOf(html).matchAll(
      /<section class="amap-p[^"]*"[^>]*data-n="(\d+)">(.*?)<\/section>/gs
    )) {
      if (m[2]!.includes(name)) {
        return {
          n: m[1]!,
          meta: /data-testid="amap-panel-meta">([^<]*)</.exec(m[2]!)?.[1] ?? '',
          html: m[2]!,
        };
      }
    }
    return null;
  }

  /** One event's card in its panel. */
  function cardOf(panel: string, id: string): string {
    return (
      new RegExp('<article[^>]*data-event-id="' + id + '".*?</article>', 's').exec(panel)?.[0] ?? ''
    );
  }

  async function biz(title: string) {
    stubGoogle(() => spot(['establishment']));
    const made = await create(KEYED, {
      title,
      location: 'Rock Island Public House',
      status: 'active',
      is_published: true,
      start_date: soon(),
    });
    vi.restoreAllMocks();
    return made;
  }

  test('a business and a home on one block are one place, on the block, never the doorstep', async () => {
    await biz('Zoom Biz Night');
    stubGoogle(() => spot(['street_address']));
    await create(KEYED, {
      title: 'Zoom Backyard',
      location: '1 Home St, Blue Island',
      status: 'active',
      is_published: true,
      start_date: soon(),
    });
    vi.restoreAllMocks();

    const html = await (await SELF.fetch('https://t.test/?area=' + CELL)).text();
    expect(html).toContain('data-zoom="' + CELL + '"');
    // Both were looked up at one point: one res-9 block, so one place. It holds
    // a home, so it is not marked as a business, and it says only "this block".
    const shop = placeOf(html, 'Zoom Biz Night');
    const home = placeOf(html, 'Zoom Backyard');
    expect(shop).not.toBeNull();
    expect(home?.n).toBe(shop!.n);
    expect(shop!.meta).toContain('somewhere on this block');
    // Place, not person (invariant 3): the point the lookup returned is in the
    // database and nowhere on the zoomed page, for the business either.
    const saved = await E.DB.prepare(
      "SELECT lat, lon FROM events WHERE title = 'Zoom Biz Night'"
    ).first<{ lat: number; lon: number }>();
    expect(saved).toEqual({ lat: RIPH.lat, lon: RIPH.lng });
    const zoom = zoomOf(html);
    expect(zoom).not.toContain(String(RIPH.lat));
    expect(zoom).not.toContain(String(RIPH.lng));
    // The list row and the panel are the same numbered place.
    expect(zoom).toContain(
      '<a class="amap-zoom" href="#amap-dot-' + shop!.n + '" data-testid="amap-place-link">'
    );
    expect(zoom).toContain('<span class="amap-t" id="amap-dot-' + shop!.n + '"></span>');
  });

  test('no street map is bound: the places are a list with their panels, and no dot is drawn', async () => {
    const made = await biz('Zoom No Tiles');
    const html = await (await SELF.fetch('https://t.test/?area=' + CELL)).text();
    const zoom = zoomOf(html);
    expect(zoom).toContain('data-testid="amap-no-tiles"');
    expect(zoom).not.toContain('<svg');
    expect(zoom).not.toContain('data-testid="amap-dot"');
    expect(zoom).not.toContain('data-testid="amap-zone"');
    const place = placeOf(html, 'Zoom No Tiles');
    expect(place).not.toBeNull();
    const card = cardOf(place!.html, made.id);
    // The card's own buttons: the event page, its form, and the page's Share.
    expect(card).toMatch(
      new RegExp('<a class="cta" href="/events/' + made.id + '[^"]*" data-testid="amap-open"')
    );
    expect(card).toContain('href="/events/' + made.id + '/register" data-testid="amap-register"');
    expect(card).toMatch(
      /data-testid="share-btn" type="button" data-share-url="https:\/\/t\.test\//
    );
    // One Share script for every card, with the page's CSP nonce on it.
    expect(html.match(/<script[^>]*data-testid="share-script"/g)).toHaveLength(1);
    expect(html).toMatch(/<script nonce="[^"]+" data-testid="share-script">/);
    // One h1 on the page; a panel title is an h2.
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(zoom).toMatch(/<h2 class="amap-ph" id="amap-ph-\d+">/);
  });

  test("a panel offers the organizer's own links straight to their targets, and reading them counts nothing", async () => {
    const made = await biz('Zoom Links Night');
    const other = await biz('Zoom No Links');
    const add = (code: string, kind: string, target: string, position: number | null) =>
      E.DB.prepare(
        'INSERT INTO shortlinks (code, event_id, kind, target_url, poster_position) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(code, made.id, kind, target, position)
        .run();
    await add('zmDon1', 'donation', 'https://give.example/zoom?a=1&b=2', 2);
    await add('zmTix1', 'tickets', 'https://tix.example/zoom', 1);
    await add('zmChk1', 'checkin', 'https://t.test/events/' + made.id + '/checkin', 3);
    await add('zmPub1', 'public', 'https://t.test/events/' + made.id, 4);
    await add('zmOff1', 'menu', 'https://menu.example/zoom', null);
    await add('zmBad1', 'website', 'http://plain.example/zoom', 5);
    await E.DB.prepare('INSERT OR IGNORE INTO event_codes (code, event_id) VALUES (?, ?)')
      .bind('ZMK234', made.id)
      .run();
    const code = (await E.DB.prepare('SELECT code FROM event_codes WHERE event_id = ?')
      .bind(made.id)
      .first<{ code: string }>())!.code;

    // The read itself, against the real tables.
    const links = await fetchPlaceLinks(E.DB, [made.id, other.id, 'evt-not-there']);
    expect(links.get(made.id)).toEqual({
      shareCode: code,
      links: [
        { kind: 'tickets', href: 'https://tix.example/zoom' },
        { kind: 'donation', href: 'https://give.example/zoom?a=1&b=2' },
      ],
    });
    expect(links.get(other.id)?.links ?? []).toEqual([]);
    expect(links.has('evt-not-there')).toBe(false);

    // The page: the same links on that event's card, in poster order.
    const html = await (await SELF.fetch('https://t.test/?area=' + CELL)).text();
    const card = cardOf(placeOf(html, 'Zoom Links Night')!.html, made.id);
    expect(
      [...card.matchAll(/data-testid="amap-link" data-kind="([a-z]+)"/g)].map((m) => m[1])
    ).toEqual(['tickets', 'donation']);
    expect(card).toContain(
      'href="https://give.example/zoom?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow"'
    );
    expect(card).toContain('data-share-url="https://t.test/e/' + code + '"');
    expect(cardOf(placeOf(html, 'Zoom No Links')!.html, other.id)).not.toContain('amap-link');
    // Never the tracked short links, never check-in, never an off-poster or plain-http target.
    const zoom = zoomOf(html);
    for (const m of zoom.matchAll(/href="([^"]*)"/g)) {
      expect(m[1], m[1]).not.toMatch(/^\/(q|s|e|r|c)\//);
      expect(m[1], m[1]).not.toMatch(/checkin/);
    }
    expect(zoom).not.toContain('menu.example');
    expect(zoom).not.toContain('plain.example');
    for (const short of ['zmDon1', 'zmTix1', 'zmChk1', 'zmPub1']) expect(zoom).not.toContain(short);

    // A map view is not a tap on a poster code and not a share open: nothing was counted.
    const clicks = await E.DB.prepare(
      'SELECT COALESCE(SUM(clicks), 0) AS n FROM shortlinks WHERE event_id = ?'
    )
      .bind(made.id)
      .first<{ n: number }>();
    expect(clicks!.n).toBe(0);
    const opens = await E.DB.prepare(
      'SELECT COUNT(*) AS n FROM share_opens_daily WHERE event_id = ?'
    )
      .bind(made.id)
      .first<{ n: number }>();
    expect(opens!.n).toBe(0);
  });

  test('the zoomed page keeps the search in its way back, and only that area is listed', async () => {
    await biz('Zoom Keeps Zip');
    const html = await (
      await SELF.fetch('https://t.test/?zip=60406&area=' + CELL + '&x=<b>')
    ).text();
    expect(html).toContain('data-testid="amap-back"');
    expect(html).toMatch(/href="\/\?zip=60406" data-testid="amap-back"/);
    expect(html).not.toMatch(/(?:\?|&amp;|&)x=/);
    expect(html).toContain('Zoom Keeps Zip');
  });

  test('anything but a res-7 cell is ignored: no zoom, never a finer area', async () => {
    // An event in the area, so a cell that slipped through would draw a zoomed
    // view (and the control below proves the real cell does).
    await biz('Zoom Refusal Control');
    const ok = await (await SELF.fetch('https://t.test/?area=' + CELL)).text();
    expect(ok).toContain('data-zoom="' + CELL + '"');
    expect(ok).toContain('data-testid="amap-back"');
    expect(ok).toContain('data-testid="amap-panel"');

    const res9 = latLngToCell(RIPH.lat, RIPH.lng, 9);
    for (const v of [res9, 'not-a-cell', '41.65,-87.68', '00' + CELL, ' ' + CELL]) {
      const html = await (await SELF.fetch('https://t.test/?area=' + encodeURIComponent(v))).text();
      expect(html, v).not.toContain('data-zoom=');
      expect(html, v).not.toContain('data-testid="amap-panel"');
      expect(html, v).not.toContain('data-testid="amap-place-link"');
      // Every zoomed view, the empty one too, has the way back; a refused cell has none.
      expect(html, v).not.toContain('data-testid="amap-back"');
    }
  });
});
