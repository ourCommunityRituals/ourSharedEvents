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
 * Five things are pinned:
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
 *  4. What the log says, and an empty bucket (street-map CCR 2026-11-15, R4 and
 *     R5). Each try that reads the bucket writes one STREET_LAYER line to the
 *     isolate's console, the one Workers Logs keeps: drew, no-archive, timeout
 *     or error, with the surface that asked. An object that is not there is
 *     read once for the requests of a minute, both surfaces together; an object
 *     loaded meanwhile draws when that minute is up, in the same isolate, with
 *     no deploy. The clock is the runtime's `Date.now`, moved on by the test.
 *  5. One object for one opened archive (street-map scenario pass 2026-11-15,
 *     S12). What R2 answers to a ranged get with `onlyIf: { etagMatches }` is
 *     read here, from the runtime itself, because lib/pmtiles.ts stands on it.
 *     Then another object is put under the key between two requests, with
 *     nothing reset: the request after the swap is whole with hexagons only,
 *     for one read, and the one after it draws the new object's streets. And
 *     `MAP_TILES_ETAG`, the optional pin, through the Worker's own fetch.
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
// @born-red what the log says, and an empty bucket, in the runtime | method: 14 faults in src/lib/street-map.ts, src/lib/pmtiles.ts and the two handlers, one at a time, each seen failing here in workerd and put back. The emit call removed (the four cases of that block and "an object cut short"); a timeout said as error ("a lost race is a timeout in the log"); no-archive said as error ("R2 is read once" and "the object is loaded"); every error said as no-archive ("an object cut short"); reads not counted (3); the remembered miss not read by the loader, and the miss not remembered at all ("R2 is read once", "the object is loaded"); `surface` taken out of the area route's call (5) and of the landing's, and the landing saying the other surface (3 each); every throw of the read remembered as a miss ("an object cut short"); the miss marked before the read comes back ("a lost race is a timeout in the log", and the open-read and landing lost-race cases already here); the window twice as long, and never ending ("the object is loaded") | date: 2026-11-15
// @born-red one object for one opened archive, in the runtime | method: the reader of 44948a04 run under this spec: the two replaced-object cases, "every later read carries the etag", the MAP_TILES_ETAG case and the reworded cut-object case failed (5). Then 10 faults in src/lib/pmtiles.ts and src/lib/street-map.ts, one at a time, each failing at least one case here and put back: the loader's source, the leaf read or the tile read not handing the version on; a changed archive not forgotten; the etag never written; the pin not compared, not handed over, or compared the wrong way round; the no-body check removed; a changed object marked as missing. Three faults fail only in the Node specs (the root read past the first read, `OPENED.clear()`, and a condition on the first read): this pool's archive has its root in the first read, one key, and an R2 that takes an undefined etag as no condition. "what R2 answers to a ranged get with a condition" reads the runtime, not our code: it was seen failing with a quoted etag sent as the condition (workerd threw) | date: 2026-11-16
import { createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import worker from '../src/index';
import { MISS_MEMORY_MS, resetPmtilesCache } from '../src/lib/pmtiles';
import {
  DEFAULT_ARCHIVE,
  STREET_TIMEOUT_MS,
  resetStreetLayerCache,
  type StreetLayerLine,
} from '../src/lib/street-map';
import {
  pmtilesArchive,
  tilesForCells,
  tilesOfFrame,
  type FixtureTile,
} from './helpers/street-map-fixtures';

interface TestEnv {
  DB: D1Database;
  MAP_TILES: R2Bucket;
  MAP_TILES_ARCHIVE?: string;
  MAP_TILES_ETAG?: string;
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
 * Another build of the same two frames: a highway and a major road in every
 * tile and no minor road, where `archiveFor` has a highway and a minor road.
 * So a drawn layer says which object it came from.
 */
async function otherArchiveFor(frames: string[][]): Promise<Uint8Array> {
  const line = (at: (t: number) => [number, number]) =>
    Array.from({ length: 65 }, (_, i) => at(i * 64));
  const tiles = new Map<string, FixtureTile>();
  for (const cells of frames) {
    const made = tilesOfFrame(cells, () => [
      {
        name: 'roads',
        features: [
          { type: 2, props: { kind: 'highway' }, parts: [line((t) => [t, 1000])] },
          { type: 2, props: { kind: 'major_road' }, parts: [line((t) => [3000, t])] },
        ],
      },
    ]);
    for (const t of made.tiles) tiles.set(`${t.z}/${t.x}/${t.y}`, t);
  }
  return pmtilesArchive([...tiles.values()], { gzip: true, leaf: true });
}

let otherArchive: Uint8Array;
const MINOR = 'class="as-r as-1"';
const MAJOR = 'class="as-r as-2"';

/** The condition each of the Worker's reads carried, in order (undefined: none). */
const conditionsOf = (bucket: ReturnType<typeof watchBucket>): (string | undefined)[] =>
  bucket.mock.calls.map(
    ([, o]) => (o as { onlyIf?: { etagMatches?: string } } | undefined)?.onlyIf?.etagMatches
  );

/** One request through the Worker's fetch and router, with these values over the pool's own. */
async function withEnv(url: string, over: Partial<TestEnv>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url), { ...E, ...over } as never, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

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

/** Watch the isolate's console: the STREET_LAYER lines the Worker has written since. */
function watchLog(): () => StreetLayerLine[] {
  const log = vi.spyOn(console, 'log');
  return () =>
    log.mock.calls.flatMap(([text]) => {
      try {
        const line = JSON.parse(String(text)) as StreetLayerLine;
        return line.type === 'STREET_LAYER' ? [line] : [];
      } catch {
        return [];
      }
    });
}

/** Move the runtime's clock on by `ms` for the rest of the test. */
function clockOn(ms: number): void {
  const real = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => real() + ms);
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
  otherArchive = await otherArchiveFor([AROUND, [CELL]]);
});

beforeEach(async () => {
  // A cold isolate: nothing kept from the test before.
  resetPmtilesCache();
  resetStreetLayerCache();
  await E.MAP_TILES.put(KEY, archive);
});

afterEach(() => vi.restoreAllMocks());

// Leave the pool as it was found: other specs expect no archive and their own events.
afterAll(async () => {
  resetPmtilesCache();
  resetStreetLayerCache();
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

  // Base-map scenario pass 2026-11-15, S14 (gap G8): one draw of a frame serves
  // the requests that follow it in the isolate. Born red 2026-11-16: on the
  // loader of 5bef37cd this case counted one read, the tiles, and drew again.
  test('the next map of that area in the isolate reads nothing: the drawn layer is kept', async () => {
    const first = await areas();
    const lines = watchLog();
    const bucket = watchBucket();
    const { body } = await areas();
    expect(body.streets).not.toBeNull();
    expect(body.streets!.svg).toBe(first.body.streets!.svg);
    expect(bucket.mock.calls).toHaveLength(0);
    expect(lines()).toMatchObject([
      { outcome: 'drew', surface: 'map-areas', tiles: 0, r2Reads: 0 },
    ]);
  });

  test('with the drawn layer put aside, the next map of that area is one read: the directories are kept', async () => {
    await areas();
    resetStreetLayerCache();
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

  test('an object cut short in its tiles: hexagons only, and the whole object draws at the second request after it is put back', async () => {
    // The header says where the tiles start (bytes 56 to 63, little-endian).
    const tilesAt = new DataView(archive.buffer, archive.byteOffset).getUint32(56, true);
    await E.MAP_TILES.put(KEY, archive.subarray(0, tilesAt + 100));
    const lines = watchLog();
    const cut = await areas();
    expect(cut.status).toBe(200);
    expect(cut.body.areas).toHaveLength(1);
    expect(cut.body.streets).toBeNull();
    const page = await landing();
    expect(page.status).toBe(200);
    expect(page.html).toContain(HEXAGONS);
    expect(page.html).not.toContain(STREETS);
    // A damaged object is an error in the log, on each surface, and is not
    // taken for a missing one: no minute is waited out before the bucket is
    // asked again.
    expect(lines().map((l) => [l.outcome, l.surface])).toEqual([
      ['error', 'map-areas'],
      ['error', 'landing'],
    ]);
    // The whole object is another object under the key. The isolate holds the
    // cut one's directories, so the first request after the put finds it
    // changed, drops them and has no streets; the next opens the whole object
    // and draws (one object for one opened archive, below). Before 2026-11-16
    // the first request drew at once, from the cut object's directories.
    await E.MAP_TILES.put(KEY, archive);
    const changed = await areas();
    expect(changed.status).toBe(200);
    expect(changed.body.streets).toBeNull();
    expect((await areas()).body.streets).not.toBeNull();
    expect(lines().map((l) => l.outcome)).toEqual(['error', 'error', 'error', 'drew']);
  });
});

describe('the street layer in the Workers runtime | what the log says, and an empty bucket', () => {
  test('a layer that is drawn is one line, with the surface that asked', async () => {
    const lines = watchLog();
    expect((await areas()).body.streets).not.toBeNull();
    expect((await landing()).html).toContain(STREETS);
    expect(lines()).toHaveLength(2);
    const [route, page] = lines();
    // Cold: the header, the leaf directory, the tiles.
    expect(route).toMatchObject({ outcome: 'drew', surface: 'map-areas', r2Reads: 3 });
    // Another frame of the same archive: the directories are kept.
    expect(page).toMatchObject({ outcome: 'drew', surface: 'landing', r2Reads: 1 });
    for (const line of [route!, page!]) {
      expect(Object.keys(line)).toEqual([
        'type',
        'outcome',
        'surface',
        'z',
        'tiles',
        'r2Reads',
        'ms',
      ]);
      expect(line.z).toBeGreaterThanOrEqual(7);
      expect(line.tiles).toBeGreaterThan(0);
      expect(line.ms).toBeGreaterThanOrEqual(0);
    }
    // No cell is in it.
    expect(JSON.stringify(lines())).not.toContain(CELL);
  });

  test('no object under the key: R2 is read once for the requests of the window, and the log says no-archive once', async () => {
    await E.MAP_TILES.delete(KEY);
    const bucket = watchBucket();
    const lines = watchLog();
    for (let n = 0; n < 2; n++) {
      const route = await areas();
      expect(route.status).toBe(200);
      expect(route.body.areas).toHaveLength(1);
      expect(route.body.streets).toBeNull();
    }
    // The other surface, in the same isolate, does not ask either.
    const page = await landing();
    expect(page.status).toBe(200);
    expect(page.html).toContain(HEXAGONS);
    expect(page.html).not.toContain(STREETS);
    expect(bucket.mock.calls).toHaveLength(1);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      type: 'STREET_LAYER',
      outcome: 'no-archive',
      surface: 'map-areas',
      z: null,
      tiles: 0,
      r2Reads: 1,
    });
  });

  test('the object is loaded: hexagons only for the rest of the window, then streets, with no deploy', async () => {
    expect(MISS_MEMORY_MS).toBe(60_000);
    await E.MAP_TILES.delete(KEY);
    const bucket = watchBucket();
    const lines = watchLog();
    expect((await areas()).body.streets).toBeNull();
    expect(bucket.mock.calls).toHaveLength(1);
    // The owner's load lands.
    await E.MAP_TILES.put(KEY, archive);
    // Inside the window the isolate does not look, on either surface.
    expect((await areas()).body.streets).toBeNull();
    expect((await landing()).html).not.toContain(STREETS);
    expect(bucket.mock.calls).toHaveLength(1);
    // The window is up. Nothing else changed: the same isolate, the same Worker.
    clockOn(MISS_MEMORY_MS);
    const route = await areas();
    expect(route.body.streets).not.toBeNull();
    expect(route.body.streets!.svg).toContain(STREETS);
    expect(bucket.mock.calls).toHaveLength(4);
    expect((await landing()).html).toContain(STREETS);
    expect(lines().map((l) => [l.outcome, l.surface])).toEqual([
      ['no-archive', 'map-areas'],
      ['drew', 'map-areas'],
      ['drew', 'landing'],
    ]);
  });

  test('a lost race is a timeout in the log, and is not taken for a missing object', async () => {
    const bucket = watchBucket({ call: READ.open.call, ms: LATE_MS });
    const lines = watchLog();
    expect((await areas()).body.streets).toBeNull();
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ outcome: 'timeout', surface: 'map-areas', r2Reads: 1 });
    expect(lines()[0]!.ms).toBeGreaterThanOrEqual(STREET_TIMEOUT_MS);
    // Asked again at once, and drawn.
    const before = bucket.mock.calls.length;
    expect((await areas()).body.streets).not.toBeNull();
    expect(bucket.mock.calls.length - before).toBe(READ.open.readsAfter);
    expect(lines().map((l) => l.outcome)).toEqual(['timeout', 'drew']);
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

describe('the street layer in the Workers runtime | one object for one opened archive', () => {
  test('what R2 answers to a ranged get with a condition, in this runtime', async () => {
    const put = await E.MAP_TILES.put('condition-probe.bin', new Uint8Array([1, 2, 3, 4, 5, 6]));
    try {
      const range = { offset: 2, length: 3 };
      // The etag is the unquoted one; httpEtag is the same in quotes.
      expect(put.httpEtag).toBe(`"${put.etag}"`);
      const same = await E.MAP_TILES.get('condition-probe.bin', {
        range,
        onlyIf: { etagMatches: put.etag },
      });
      expect(same!.etag).toBe(put.etag);
      expect([...new Uint8Array(await (same as R2ObjectBody).arrayBuffer())]).toEqual([3, 4, 5]);
      // Another etag: the object's record, its own etag on it, and no body.
      const other = await E.MAP_TILES.get('condition-probe.bin', {
        range,
        onlyIf: { etagMatches: 'another-etag' },
      });
      expect(other).not.toBeNull();
      expect(other!.etag).toBe(put.etag);
      expect('body' in other!).toBe(false);
      expect((other as { arrayBuffer?: unknown }).arrayBuffer).toBeUndefined();
      // A quoted etag is refused outright, so the reader must send `etag`.
      await expect(
        E.MAP_TILES.get('condition-probe.bin', { range, onlyIf: { etagMatches: put.httpEtag } })
      ).rejects.toThrow(/should not be wrapped in quotes/);
      // A key that is not there is null, condition or no condition.
      expect(
        await E.MAP_TILES.get('condition-probe-none.bin', {
          range,
          onlyIf: { etagMatches: put.etag },
        })
      ).toBeNull();
    } finally {
      await E.MAP_TILES.delete('condition-probe.bin');
    }
  });

  test('the first read carries no condition, and every later read carries the etag of the object it came from', async () => {
    const etag = (await E.MAP_TILES.head(KEY))!.etag;
    const bucket = watchBucket();
    expect((await areas()).body.streets).not.toBeNull();
    expect(conditionsOf(bucket)).toEqual([undefined, etag, etag]);
    // The next request finds the archive open: its one read is held to it too.
    // The kept layer is put aside: this is about the reader (kept layers: street-layer-kept.spec.ts).
    resetStreetLayerCache();
    expect((await areas()).body.streets).not.toBeNull();
    expect(conditionsOf(bucket)).toEqual([undefined, etag, etag, etag]);
  });

  test('the area route: the object replaced between two requests is hexagons only for one request, then the new streets', async () => {
    const lines = watchLog();
    const first = await areas();
    expect(first.body.streets!.svg).toContain(MINOR);
    expect(first.body.streets!.svg).not.toContain(MAJOR);
    const was = (await E.MAP_TILES.head(KEY))!.etag;

    // Another object under the same key. Nothing the isolate keeps is reset.
    const now = (await E.MAP_TILES.put(KEY, otherArchive)).etag;
    expect(now).not.toBe(was);
    // The kept layer is put aside: this is about the reader (kept layers: street-layer-kept.spec.ts).
    resetStreetLayerCache();
    const bucket = watchBucket();
    const swapped = await areas();
    expect(swapped.status).toBe(200);
    expect(swapped.body.ok).toBe(true);
    expect(swapped.body.areas).toHaveLength(1);
    expect(swapped.body.around).toHaveLength(6);
    expect(swapped.body.streets).toBeNull();
    // One read, the tiles, asked for under the old etag. No request was added.
    expect(conditionsOf(bucket)).toEqual([was]);

    const next = await areas();
    expect(next.status).toBe(200);
    expect(next.body.streets).not.toBeNull();
    expect(next.body.streets!.svg).toContain(MAJOR);
    expect(next.body.streets!.svg).not.toContain(MINOR);
    // The new object from its first byte: header, leaf directory, tiles.
    expect(conditionsOf(bucket)).toEqual([was, undefined, now, now]);
    expect(lines().map((l) => l.outcome)).toEqual(['drew', 'error', 'drew']);
  });

  test('the landing: the object replaced between two pages is one page without streets, then the new streets', async () => {
    const first = await landing();
    expect(first.html).toContain(STREETS);
    expect(first.html).toContain(MINOR);
    await E.MAP_TILES.put(KEY, otherArchive);
    // The kept layer is put aside: this is about the reader (kept layers: street-layer-kept.spec.ts).
    resetStreetLayerCache();
    const swapped = await landing();
    expect(swapped.status).toBe(200);
    expect(swapped.html).toContain(HEXAGONS);
    expect(swapped.html).not.toContain(STREETS);
    expect(swapped.html).not.toContain('data-testid="amap-credit"');
    const next = await landing();
    expect(next.status).toBe(200);
    expect(next.html).toContain(STREETS);
    expect(next.html).toContain(MAJOR);
    expect(next.html).not.toContain(MINOR);
  });

  test('MAP_TILES_ETAG is not set in the pool, as in every environment today', () => {
    expect(E.MAP_TILES_ETAG).toBeUndefined();
  });

  test('MAP_TILES_ETAG names another object: hexagons only, one read a request; naming this one, or empty, draws', async () => {
    const etag = (await E.MAP_TILES.head(KEY))!.etag;
    const bucket = watchBucket();
    for (const round of [1, 2]) {
      const res = await withEnv(AREAS, { MAP_TILES_ETAG: 'another-object' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as AreasBody;
      expect(body.areas).toHaveLength(1);
      expect(body.streets).toBeNull();
      expect(bucket.mock.calls).toHaveLength(round);
    }
    const page = await withEnv(LANDING, { MAP_TILES_ETAG: 'another-object' });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(HEXAGONS);
    expect(html).not.toContain(STREETS);

    for (const value of [etag, '']) {
      const res = await withEnv(AREAS, { MAP_TILES_ETAG: value });
      const body = (await res.json()) as AreasBody;
      expect(body.streets, `MAP_TILES_ETAG="${value}"`).not.toBeNull();
      expect(body.streets!.svg).toContain(MINOR);
    }
  });
});
