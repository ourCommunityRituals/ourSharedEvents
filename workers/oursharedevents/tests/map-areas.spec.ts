/**
 * OSE-2039 — GET /api/v2/map/areas, the drawn map for a list of areas
 * (handlers/map-areas.ts, OSE ADR-031).
 *
 * Node-clean: the handler is called directly and the R2 binding is a fake
 * bucket. Registered in vitest.node-specs.mjs. The route itself (the limit, the
 * method, no cookie) is in map-areas-route.spec.ts, in the workers pool.
 *
 * What these pin:
 *   - a coordinate-shaped parameter is refused before anything is read
 *   - resolution 7 only, a valid cell only, 12 cells at most
 *   - the frame and the outlines are the ones the landing map draws
 *   - the streets come with their CSS and the OpenStreetMap credit
 *   - a frame too wide for a street map reads no tile
 *   - no archive, or a broken one: 200, hexagons only
 *   - no database is touched
 */
// @born-red coordinates refused in any case | method: `name.toLowerCase()` replaced by `name` in handleMapAreas; "in any letter case" failed on ?LAT= (200, not 400) | date: 2026-11-14
// @born-red resolution 7 only | method: the getResolution check removed; "a finer or coarser cell is refused" failed (200 for a res-9 cell) | date: 2026-11-14
// @born-red 12 cells at most | method: the `cells.length > MAX_AREA_CELLS` check removed; "a 13th cell is refused; 12 are drawn" failed (200 for 13 cells). The first cut of this test read the limit from the constant and stayed green with the constant at 13, so the number is now written out | date: 2026-11-14
// @born-red a wide frame reads no tile | method: the frameZoom guard removed; "a frame too wide for a street map reads no tile" failed (the bucket was read) | date: 2026-11-14
// @born-red fail soft | method: loadStreetLayer replaced by buildStreetLayer in the handler, so a bad or missing archive throws; "a broken archive is still a 200, with the same hexagons" and "no binding: 200, hexagons only, kept briefly" failed | date: 2026-11-14
// @born-red the around frame | method: the frame fitted to the areas alone, then the streets loaded for the areas alone; "around=1 fits the frame to the neighbours and returns their outlines" and "with around=1 the streets are drawn for the wider frame" failed | date: 2026-11-14
// @born-red no database | method: `await (env as any).DB.prepare('SELECT 1')` added to the handler; "no database binding is touched" failed | date: 2026-11-14
import { describe, it, expect, beforeEach } from 'vitest';
import { cellToBoundary, cellToLatLng, cellToParent, gridDisk, latLngToCell } from 'h3-js';
import {
  MAX_AREA_CELLS,
  MIN_STREET_ZOOM,
  frameZoom,
  handleMapAreas,
  type DrawnArea,
  type DrawnCell,
} from '../src/handlers/map-areas';
import { resetPmtilesCache } from '../src/lib/pmtiles';
import {
  DEFAULT_ARCHIVE,
  MAP_H,
  MAP_W,
  STREET_STYLE,
  frameForCells,
  project,
} from '../src/lib/street-map';
import { fakeBucket, pmtilesArchive, tilesForCells } from './helpers/street-map-fixtures';

const BLUE7 = latLngToCell(41.6573, -87.68, 7);
const NORTH7 = latLngToCell(41.75, -87.66, 7);
const LOS_ANGELES7 = latLngToCell(34.05, -118.25, 7);
const ORIGIN = 'https://t.test';

interface Body {
  ok: boolean;
  status: number;
  code?: string;
  frame: { projection: string; w: number; h: number; scale: number; x0: number; y0: number };
  areas: DrawnArea[];
  around: DrawnCell[];
  streets: { svg: string; css: string; credit: { html: string; osm: string } } | null;
}

async function get(query: string, env: Record<string, unknown> = {}) {
  const res = await handleMapAreas(new Request(`${ORIGIN}/api/v2/map/areas${query}`), env as never);
  return { res, body: (await res.json()) as Body };
}

/** A bucket holding a street archive with a tile for every tile the frame reads. */
async function streetBucket(framed: string[]) {
  const { r, tiles } = tilesForCells(framed);
  return { r, bucket: fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true })) };
}

const pointsOf = (cell: string, framed: string[]) => {
  const f = frameForCells(framed, MAP_W, MAP_H);
  return cellToBoundary(cell)
    .map(([lat, lng]) => project(f, lat, lng))
    .map(([x, y]) => `${Number(x.toFixed(1))},${Number(y.toFixed(1))}`)
    .join(' ');
};

beforeEach(() => resetPmtilesCache());

describe('public area map | what is refused', () => {
  it('a coordinate-shaped parameter is refused, and nothing is read', async () => {
    for (const name of ['lat', 'lon', 'lng', 'latitude', 'longitude', 'coords', 'position']) {
      const bucket = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(200));
      const { res, body } = await get(`?cells=${BLUE7}&${name}=41.65`, { MAP_TILES: bucket });
      expect(res.status, name).toBe(400);
      expect(body.code, name).toBe('COORDINATES_NOT_ACCEPTED');
      expect(bucket.gets, name).toHaveLength(0);
    }
  });

  it('in any letter case', async () => {
    for (const name of ['LAT', 'Lon', 'LNG', 'Latitude']) {
      const { res, body } = await get(`?cells=${BLUE7}&${name}=41.65`);
      expect(res.status, name).toBe(400);
      expect(body.code, name).toBe('COORDINATES_NOT_ACCEPTED');
    }
  });

  it('the cells are required', async () => {
    for (const q of ['', '?cells=', '?cell=' + BLUE7]) {
      const { res, body } = await get(q);
      expect(res.status, q).toBe(400);
      expect(body.code, q).toBe('CELLS_REQUIRED');
    }
  });

  it('a value that is not a cell is refused', async () => {
    for (const bad of ['x', '41.65,-87.68', `${BLUE7},`, `${BLUE7},nope`, '872664c1affffffz']) {
      const { res, body } = await get(`?cells=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(body.code, bad).toBe('CELL_INVALID');
    }
  });

  it('a finer or coarser cell is refused', async () => {
    const block = latLngToCell(41.6573, -87.68, 9);
    const metro = cellToParent(BLUE7, 6);
    for (const cell of [block, metro, `${BLUE7},${block}`]) {
      const { res, body } = await get(`?cells=${cell}`);
      expect(res.status, cell).toBe(400);
      expect(body.code, cell).toBe('CELL_RESOLUTION');
    }
  });

  it('a 13th cell is refused; 12 are drawn', async () => {
    // The number is written out: a test that reads the constant moves with it.
    expect(MAX_AREA_CELLS).toBe(12);
    const many = gridDisk(BLUE7, 2);
    const twelve = await get(`?cells=${many.slice(0, 12).join(',')}`);
    expect(twelve.res.status).toBe(200);
    expect(twelve.body.areas).toHaveLength(12);
    const thirteen = await get(`?cells=${many.slice(0, 13).join(',')}`);
    expect(thirteen.res.status).toBe(400);
    expect(thirteen.body.code).toBe('TOO_MANY_CELLS');
    // A very long list is refused before any cell in it is looked at.
    const long = await get(`?cells=${Array(500).fill(BLUE7).join(',')}`);
    expect(long.res.status).toBe(400);
    expect(long.body.code).toBe('TOO_MANY_CELLS');
  });

  it("'around' is 0 or 1", async () => {
    for (const bad of ['2', 'yes', '']) {
      const { res, body } = await get(`?cells=${BLUE7}&around=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(body.code, bad).toBe('AROUND_INVALID');
    }
    expect((await get(`?cells=${BLUE7}&around=0`)).body.around).toEqual([]);
  });

  it('a refusal is not cached', async () => {
    const { res } = await get('?cells=x');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('public area map | the frame and the hexagons', () => {
  it('the frame is the one the landing map draws for the same cells', async () => {
    const { res, body } = await get(`?cells=${BLUE7},${NORTH7}`);
    expect(res.status).toBe(200);
    const f = frameForCells([BLUE7, NORTH7], MAP_W, MAP_H);
    expect(body.frame).toEqual({
      projection: 'web-mercator',
      w: MAP_W,
      h: MAP_H,
      scale: f.scale,
      x0: f.x0,
      y0: f.y0,
    });
  });

  it('each area is numbered in the order given, with its outline and its middle', async () => {
    const { body } = await get(`?cells=${NORTH7},${BLUE7}`);
    expect(body.areas.map((a) => [a.cell, a.n])).toEqual([
      [NORTH7, 1],
      [BLUE7, 2],
    ]);
    const framed = [NORTH7, BLUE7];
    expect(body.areas[0]!.points).toBe(pointsOf(NORTH7, framed));
    expect(body.areas[1]!.points).toBe(pointsOf(BLUE7, framed));
    const f = frameForCells(framed, MAP_W, MAP_H);
    const [cx, cy] = project(f, ...cellToLatLng(BLUE7));
    expect(body.areas[1]!.centre).toEqual([Number(cx.toFixed(1)), Number(cy.toFixed(1))]);
    // Six corners, every one inside the frame.
    for (const a of body.areas) {
      const pts = a.points.split(' ').map((p) => p.split(',').map(Number));
      expect(pts).toHaveLength(6);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(MAP_W);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(MAP_H);
      }
    }
  });

  it('a cell given twice is one area', async () => {
    const { body } = await get(`?cells=${BLUE7},${BLUE7}&cells=${BLUE7}`);
    expect(body.areas.map((a) => a.cell)).toEqual([BLUE7]);
  });

  it('around=1 fits the frame to the neighbours and returns their outlines', async () => {
    const alone = await get(`?cells=${BLUE7}`);
    expect(alone.body.around).toEqual([]);

    const { body } = await get(`?cells=${BLUE7}&around=1`);
    const ring = gridDisk(BLUE7, 1).filter((c) => c !== BLUE7);
    expect(body.around.map((c) => c.cell).sort()).toEqual([...ring].sort());
    const framed = [BLUE7, ...body.around.map((c) => c.cell)];
    const f = frameForCells(framed, MAP_W, MAP_H);
    expect(body.frame.scale).toBe(f.scale);
    expect(body.frame.scale).toBeLessThan(alone.body.frame.scale);
    expect(body.areas[0]!.points).toBe(pointsOf(BLUE7, framed));
    expect(body.around[0]!.points).toBe(pointsOf(body.around[0]!.cell, framed));
    // An area is never also its own neighbour.
    const two = await get(`?cells=${BLUE7},${ring[0]}&around=1`);
    const own = new Set(two.body.areas.map((a) => a.cell));
    expect(two.body.around.some((c) => own.has(c.cell))).toBe(false);
  });

  it('the answer holds only the frame, the cells and the streets', async () => {
    const { res, body } = await get(`?cells=${BLUE7}&around=1`);
    expect(Object.keys(body).sort()).toEqual(
      ['areas', 'around', 'frame', 'ok', 'status', 'streets'].sort()
    );
    expect(Object.keys(body.areas[0]!).sort()).toEqual(['cell', 'centre', 'n', 'points']);
    expect(Object.keys(body.around[0]!).sort()).toEqual(['cell', 'points']);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('public area map | the streets', () => {
  it('draws the street layer in the same frame, with its CSS and the credit', async () => {
    const { r, bucket } = await streetBucket([BLUE7, NORTH7]);
    const { res, body } = await get(`?cells=${BLUE7},${NORTH7}`, { MAP_TILES: bucket });
    expect(res.status).toBe(200);
    const streets = body.streets!;
    expect(streets.svg.startsWith('<g class="amap-s"')).toBe(true);
    expect(streets.svg.endsWith('</g>')).toBe(true);
    expect(streets.svg).toContain(`data-z="${r.z}"`);
    expect(streets.svg).toContain(`<rect class="as-l" width="${MAP_W}" height="${MAP_H}"/>`);
    expect(streets.svg).toMatch(/<path class="as-r as-3" d="M/);
    // The same rules the landing puts beside its street layer, without the tags.
    expect(`<style>${streets.css}</style>`).toBe(STREET_STYLE);
    expect(streets.credit.osm).toBe('https://www.openstreetmap.org/copyright/en');
    expect(streets.credit.html).toContain(`<a href="${streets.credit.osm}">OpenStreetMap</a>`);
    expect(streets.credit.html).toContain('<a href="https://protomaps.com">Protomaps</a>');
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400'
    );
    // Only the street archive was read, from the street bucket.
    expect(new Set(bucket.gets.map((g) => g.key))).toEqual(new Set([DEFAULT_ARCHIVE]));
  });

  it('with around=1 the streets are drawn for the wider frame', async () => {
    const framed = [BLUE7, ...gridDisk(BLUE7, 1).filter((c) => c !== BLUE7)];
    const { r, bucket } = await streetBucket(framed);
    const { body } = await get(`?cells=${BLUE7}&around=1`, { MAP_TILES: bucket });
    expect(body.streets!.svg).toContain(`data-z="${r.z}"`);
    expect(frameZoom(frameForCells(framed, MAP_W, MAP_H))).toBe(r.z);
  });

  it('no binding: 200, hexagons only, kept briefly', async () => {
    const { res, body } = await get(`?cells=${BLUE7}`);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.streets).toBeNull();
    expect(body.areas).toHaveLength(1);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('a broken archive is still a 200, with the same hexagons', async () => {
    const plain = await get(`?cells=${BLUE7},${NORTH7}`);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(500).fill(1));
    const { res, body } = await get(`?cells=${BLUE7},${NORTH7}`, { MAP_TILES: bucket });
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(res.status).toBe(200);
    expect(body.streets).toBeNull();
    expect(body.areas).toEqual(plain.body.areas);
    expect(body.frame).toEqual(plain.body.frame);
  });

  it('an archive with no tile for the frame: hexagons only, no credit', async () => {
    const { bucket } = await streetBucket([LOS_ANGELES7]);
    const { res, body } = await get(`?cells=${BLUE7}`, { MAP_TILES: bucket });
    expect(res.status).toBe(200);
    expect(body.streets).toBeNull();
  });

  it('a frame too wide for a street map reads no tile', async () => {
    const framed = [BLUE7, LOS_ANGELES7];
    expect(frameZoom(frameForCells(framed, MAP_W, MAP_H))).toBeLessThan(MIN_STREET_ZOOM);
    const { bucket } = await streetBucket(framed);
    const { res, body } = await get(`?cells=${framed.join(',')}`, { MAP_TILES: bucket });
    expect(res.status).toBe(200);
    expect(body.streets).toBeNull();
    expect(body.areas).toHaveLength(2);
    expect(bucket.gets).toHaveLength(0);
  });

  it('a metro-wide list of areas is still a street map', async () => {
    // Blue Island to the far north side: about 45 km.
    const far = latLngToCell(42.06, -87.69, 7);
    const framed = [BLUE7, far];
    expect(frameZoom(frameForCells(framed, MAP_W, MAP_H))).toBeGreaterThanOrEqual(MIN_STREET_ZOOM);
    const { bucket } = await streetBucket(framed);
    const { body } = await get(`?cells=${framed.join(',')}`, { MAP_TILES: bucket });
    expect(body.streets).not.toBeNull();
  });
});

describe('public area map | nothing about anyone', () => {
  it('no database binding is touched', async () => {
    const touched: string[] = [];
    const trap = (name: string) =>
      new Proxy(
        {},
        {
          get(_t, prop) {
            touched.push(`${name}.${String(prop)}`);
            throw new Error(`${name} was read`);
          },
        }
      );
    const { bucket } = await streetBucket([BLUE7]);
    const { res, body } = await get(`?cells=${BLUE7}`, {
      MAP_TILES: bucket,
      DB: trap('DB'),
      FORMS_DB: trap('FORMS_DB'),
    });
    expect(res.status).toBe(200);
    expect(body.streets).not.toBeNull();
    expect(touched).toEqual([]);
  });

  it('the answer is the same whoever asks', async () => {
    const { bucket } = await streetBucket([BLUE7]);
    const ask = async (headers: Record<string, string>) =>
      (
        await handleMapAreas(
          new Request(`${ORIGIN}/api/v2/map/areas?cells=${BLUE7}`, { headers }),
          { MAP_TILES: bucket } as never
        )
      ).text();
    const a = await ask({});
    const b = await ask({
      'CF-Connecting-IP': '203.0.113.9',
      'CF-IPCountry': 'US',
      'CF-IPLatitude': '41.6',
      'CF-IPLongitude': '-87.6',
      Cookie: 'ose_anon=abc',
      'Accept-Language': 'es',
    });
    expect(b).toBe(a);
  });
});
