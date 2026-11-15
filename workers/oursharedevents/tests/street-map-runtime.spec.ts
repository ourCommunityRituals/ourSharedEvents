/**
 * The street layer through the Workers runtime (workers pool, workerd).
 *
 * Every other street-map spec runs in the Node project, where there is no R2,
 * no request boundary and Node's own gzip. Here a synthetic archive sits in the
 * pool's R2 under `MAP_TILES`, and the Worker draws from it the way a deployed
 * one does: `SELF.fetch` gives each request its own I/O context in one shared
 * isolate, the reads are ranged R2 reads, and directories and tiles are
 * unpacked by the runtime's `DecompressionStream`.
 *
 * Three things are pinned:
 *
 *  1. The public area route and the landing draw streets from the archive, and
 *     stay whole when the object is missing or cut short.
 *  2. A lost race. A read that has not come back when its request ends is
 *     dropped by the runtime with that request, and its promise never settles.
 *     Nothing kept between requests may wait on it: the next request reads
 *     again and draws (street-map scenario pass 2026-11-15, S10).
 *  3. The switch (street-map CCR 2026-11-15, R20). The pool's own `STREET_MAP`
 *     is "on" (the top-level [vars] of wrangler.toml), which is why everything
 *     above draws. With it off, through the Worker's own fetch and router, both
 *     surfaces answer hexagons only and R2 is not asked, with the archive there.
 *
 * The slow read is the bucket's own `get`, held back by a timer that belongs to
 * the request that asked: when that request ends, the runtime drops the timer
 * and the read with it. Nothing here resolves or rejects it by hand.
 */
// @born-red a lost race | method: the reader of 79647f2d (a pending promise kept in OPENED and in each leaf slot of src/lib/pmtiles.ts) run under this spec; the open, the leaf and the landing lost-race cases failed (the next request waited 1.5 s and had no streets) | date: 2026-11-15
// @born-red drawing from R2 in the runtime | method: `decompress` in src/lib/pmtiles.ts returning gzip bytes as they are; the route, the landing and the one-read cases failed | date: 2026-11-15
// @born-red a missing or cut object leaves the page whole | method: the catch in `loadStreetLayer` (src/lib/street-map.ts) rethrowing; "no object under the key" and "an object cut short" failed | date: 2026-11-15
// @born-red directories kept between requests | method: `OPENED.set` removed from `open` in src/lib/pmtiles.ts; "the next map of that area is one read" and the read counts after a lost leaf and a lost tile read failed | date: 2026-11-15
// @born-red the switch in the runtime | method: the switch line removed from loadStreetLayer; both "off" cases failed (the route and the landing drew streets). The top-level STREET_MAP in wrangler.toml set to "off"; "the pool runs with the switch on" and the nine cases that draw failed | date: 2026-11-15
import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import worker from '../src/index';
import { resetPmtilesCache } from '../src/lib/pmtiles';
import { DEFAULT_ARCHIVE, STREET_TIMEOUT_MS } from '../src/lib/street-map';
import { pmtilesArchive, tilesForCells, type FixtureTile } from './helpers/street-map-fixtures';

interface TestEnv {
  DB: D1Database;
  MAP_TILES: R2Bucket;
  MAP_TILES_ARCHIVE?: string;
  STREET_MAP?: string;
  TEST_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv;
const KEY = E.MAP_TILES_ARCHIVE || DEFAULT_ARCHIVE;

const ORIGIN = 'https://t.test';
const CELL = latLngToCell(41.6573, -87.68, 7);
/** What the area route frames for `?cells=CELL&around=1`. */
const AROUND = [CELL, ...gridDisk(CELL, 1).filter((c) => c !== CELL)];
const AREAS = `${ORIGIN}/api/v2/map/areas?cells=${CELL}&around=1`;
const LANDING = `${ORIGIN}/`;

/**
 * The archive's three reads, in the order a cold isolate makes them, and how
 * many reads the request after a lost one makes: what was read whole before the
 * loss is kept, and the lost read and everything after it are read again.
 */
const READ = {
  open: { call: 1, readsAfter: 3 },
  leaf: { call: 2, readsAfter: 2 },
  tiles: { call: 3, readsAfter: 1 },
} as const;
/**
 * Longer than the street limit, and short enough that a read the runtime had
 * kept alive would be back well inside the next request's own limit. So a next
 * request with no streets means the read never came back at all.
 */
const LATE_MS = STREET_TIMEOUT_MS + 300;

/** One archive holding the tiles of each of these frames, gzipped, behind a leaf directory. */
async function archiveFor(frames: string[][]): Promise<Uint8Array> {
  const tiles = new Map<string, FixtureTile>();
  for (const cells of frames) {
    for (const t of tilesForCells(cells).tiles) tiles.set(`${t.z}/${t.x}/${t.y}`, t);
  }
  return pmtilesArchive([...tiles.values()], { gzip: true, leaf: true });
}

let archive: Uint8Array;

/**
 * Watch the Worker's reads of the bucket. `slow` holds read number `call` back
 * by `ms`, inside the request that made it.
 */
function watchBucket(slow?: { call: number; ms: number }) {
  const real = E.MAP_TILES.get.bind(E.MAP_TILES) as (
    key: string,
    options?: R2GetOptions
  ) => Promise<R2ObjectBody | null>;
  let calls = 0;
  return vi.spyOn(E.MAP_TILES, 'get').mockImplementation((async (
    key: string,
    options?: R2GetOptions
  ) => {
    calls += 1;
    if (slow && calls === slow.call) await new Promise((r) => setTimeout(r, slow.ms));
    return real(key, options);
  }) as never);
}

interface AreasBody {
  ok: boolean;
  areas: { cell: string }[];
  around: unknown[];
  streets: { svg: string; css: string; credit: { html: string } } | null;
}

async function areas(): Promise<{ status: number; body: AreasBody }> {
  const res = await SELF.fetch(AREAS);
  return { status: res.status, body: (await res.json()) as AreasBody };
}

async function landing(): Promise<{ status: number; html: string }> {
  const res = await SELF.fetch(LANDING);
  return { status: res.status, html: await res.text() };
}

const STREETS = 'data-testid="amap-streets"';
const HEXAGONS = 'data-testid="amap-area"';

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(m)) continue;
      throw e;
    }
  }
  // Ten listed events in one area: the landing leads with its map at ten (LIST_MAX).
  const [lat, lon] = cellToLatLng(CELL);
  const soon = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  for (let n = 1; n <= 10; n++) {
    const id = `street-runtime-${n}`;
    await E.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, timezone, lat, lon, h3_res9, h3_res7, created_at, updated_at)
       VALUES (?, 'root', ?, ?, 'active', 1, 'A hall', ?, 'America/Chicago', ?, ?, ?, ?,
               datetime('now'), datetime('now'))`
    )
      .bind(id, `Street runtime ${n}`, id, soon, lat, lon, latLngToCell(lat, lon, 9), CELL)
      .run();
  }
  archive = await archiveFor([AROUND, [CELL]]);
});

beforeEach(async () => {
  // A cold isolate: nothing kept from the test before.
  resetPmtilesCache();
  await E.MAP_TILES.put(KEY, archive);
});

afterEach(() => vi.restoreAllMocks());

// Leave the pool as it was found: other specs expect no archive and their own events.
afterAll(async () => {
  resetPmtilesCache();
  await E.MAP_TILES.delete(KEY);
  await E.DB.prepare("DELETE FROM events WHERE id LIKE 'street-runtime-%'").run();
});

describe('the street layer in the Workers runtime | drawing from R2', () => {
  test('the area route draws streets from the archive: three ranged reads, gzip unpacked by the runtime', async () => {
    const bucket = watchBucket();
    const { status, body } = await areas();
    expect(status).toBe(200);
    expect(body.areas).toHaveLength(1);
    expect(body.around).toHaveLength(6);
    expect(body.streets).not.toBeNull();
    expect(body.streets!.svg).toContain(STREETS);
    // The fixture's highway and its minor road, drawn as roads.
    expect(body.streets!.svg).toContain('class="as-r as-3"');
    expect(body.streets!.svg).toContain('class="as-r as-1"');
    expect(body.streets!.credit.html).toContain('OpenStreetMap');
    // Header and root directory, the leaf directory, the tiles in one read.
    expect(bucket.mock.calls.map(([key]) => key)).toEqual([KEY, KEY, KEY]);
    const ranges = bucket.mock.calls.map(([, o]) => (o as { range: { offset: number } }).range);
    expect(ranges[0]).toEqual({ offset: 0, length: 16_384 });
    expect(ranges.every((r) => typeof r.offset === 'number')).toBe(true);
  });

  test('the next map of that area in the isolate is one read: the directories are kept', async () => {
    await areas();
    const bucket = watchBucket();
    const { body } = await areas();
    expect(body.streets).not.toBeNull();
    expect(bucket.mock.calls).toHaveLength(1);
  });

  test('the landing draws the streets under its hexagons, with the credit', async () => {
    const { status, html } = await landing();
    expect(status).toBe(200);
    expect(html).toContain(HEXAGONS);
    expect(html).toContain(STREETS);
    // Streets first inside the map, hexagons over them.
    expect(html.indexOf(STREETS)).toBeLessThan(html.indexOf(HEXAGONS));
    expect(html).toContain('data-testid="amap-credit"');
  });

  test('no object under the key: both surfaces answer whole, hexagons only', async () => {
    await E.MAP_TILES.delete(KEY);
    const route = await areas();
    expect(route.status).toBe(200);
    expect(route.body.areas).toHaveLength(1);
    expect(route.body.streets).toBeNull();
    const page = await landing();
    expect(page.status).toBe(200);
    expect(page.html).toContain(HEXAGONS);
    expect(page.html).not.toContain(STREETS);
    expect(page.html).not.toContain('data-testid="amap-credit"');
  });

  test('an object cut short in its tiles: hexagons only, and the whole object draws again', async () => {
    // The header says where the tiles start (bytes 56 to 63, little-endian).
    const tilesAt = new DataView(archive.buffer, archive.byteOffset).getUint32(56, true);
    await E.MAP_TILES.put(KEY, archive.subarray(0, tilesAt + 100));
    const cut = await areas();
    expect(cut.status).toBe(200);
    expect(cut.body.areas).toHaveLength(1);
    expect(cut.body.streets).toBeNull();
    const page = await landing();
    expect(page.status).toBe(200);
    expect(page.html).toContain(HEXAGONS);
    expect(page.html).not.toContain(STREETS);
    await E.MAP_TILES.put(KEY, archive);
    expect((await areas()).body.streets).not.toBeNull();
  });
});

describe('the street layer in the Workers runtime | the switch (STREET_MAP)', () => {
  /** One request through the Worker's fetch and router, with this value of the switch. */
  async function through(url: string, value: string | undefined): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url), { ...E, STREET_MAP: value } as never, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  test('the pool runs with the switch on, from wrangler.toml', () => {
    expect(E.STREET_MAP).toBe('on');
  });

  test('off: the area route answers streets: null and R2 is not asked, with the archive there', async () => {
    const bucket = watchBucket();
    for (const value of ['off', undefined, 'true']) {
      const res = await through(AREAS, value);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AreasBody;
      expect(body.ok).toBe(true);
      expect(body.areas).toHaveLength(1);
      expect(body.around).toHaveLength(6);
      expect(body.streets).toBeNull();
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    }
    expect(bucket.mock.calls).toHaveLength(0);
    // The same request with the switch on draws, from the same object.
    const on = (await (await through(AREAS, 'on')).json()) as AreasBody;
    expect(on.streets).not.toBeNull();
    expect(on.streets!.svg).toContain(STREETS);
    expect(bucket.mock.calls.length).toBeGreaterThan(0);
  });

  test('off: the landing is whole, hexagons only, with no credit, and R2 is not asked', async () => {
    const bucket = watchBucket();
    const res = await through(LANDING, 'off');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(HEXAGONS);
    expect(html).not.toContain(STREETS);
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(bucket.mock.calls).toHaveLength(0);
    const on = await (await through(LANDING, 'on')).text();
    expect(on).toContain(STREETS);
    expect(on).toContain('data-testid="amap-credit"');
  });
});

describe('the street layer in the Workers runtime | a lost race', () => {
  test('a read that is slow and still inside the limit draws', async () => {
    watchBucket({ call: READ.open.call, ms: 200 });
    expect((await areas()).body.streets).not.toBeNull();
  });

  for (const [what, { call, readsAfter }] of Object.entries(READ)) {
    test(`the ${what} read does not come back before its request ends: hexagons only, and the next request draws`, async () => {
      const bucket = watchBucket({ call, ms: LATE_MS });
      const lost = await areas();
      expect(lost.status).toBe(200);
      expect(lost.body.areas).toHaveLength(1);
      expect(lost.body.streets).toBeNull();
      const before = bucket.mock.calls.length;
      const next = await areas();
      expect(next.status).toBe(200);
      expect(next.body.streets).not.toBeNull();
      expect(next.body.streets!.svg).toContain(STREETS);
      expect(bucket.mock.calls.length - before).toBe(readsAfter);
    });
  }

  test('the landing loses the race: the page is whole without streets, and the next page has them', async () => {
    watchBucket({ call: READ.open.call, ms: LATE_MS });
    const lost = await landing();
    expect(lost.status).toBe(200);
    expect(lost.html).toContain(HEXAGONS);
    expect(lost.html).not.toContain(STREETS);
    const next = await landing();
    expect(next.status).toBe(200);
    expect(next.html).toContain(STREETS);
  });
});
