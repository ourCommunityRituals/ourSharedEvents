/**
 * Street map under the hexagons (lib/street-map.ts) and its place in the
 * attendee map and the landing (lib/attendee-map.ts, lib/landing-area.ts).
 *
 * Node-clean: pure render over in-memory archives and a fake R2 bucket.
 * Registered in vitest.node-specs.mjs.
 *
 * What these pin:
 *   - the frame is Web Mercator from the cell ids, and the hexagons and the
 *     streets share it (a road through a cell's centre passes under its number)
 *   - the tile read is bounded (zoom, tile count, point budget, labels)
 *   - fail soft: no binding, a bad archive name, a damaged archive or a slow
 *     read all leave the hexagons-only map, and never throw
 *   - never who: the archive is the only object read; town names are escaped;
 *     no event coordinate reaches the markup
 *   - the OpenStreetMap credit shows whenever the streets do
 *   - an archive with no tile in the frame is no layer (location-precision CCR,
 *     F41), and a planet-sized archive draws (two leaf levels, far offsets)
 */
// @born-red no tile in the frame, planet-sized archive | method: "an archive with no tile in the frame is no layer" seen failing before the guard in buildStreetLayer (it returned a layer of one blank rectangle); "one tile of the frame is enough" is its control; the planet case seen failing on 4 of the 6 reader faults listed in pmtiles.spec.ts | date: 2026-11-09
import { describe, it, expect, beforeEach } from 'vitest';
import { cellToLatLng, latLngToCell } from 'h3-js';
import {
  DEFAULT_ARCHIVE,
  MAX_LABELS,
  MAX_POINTS,
  MAX_TILES,
  MAX_ZOOM,
  STREET_STYLE,
  buildStreetLayer,
  cellsKey,
  drawStreets,
  frameForCells,
  loadStreetLayer,
  project,
  tilesFor,
  toWorld,
  type DecodedTile,
  type MapFrame,
} from '../src/lib/street-map';
import { MAP_STYLE, renderAttendeeMap, type AttendeeMapItem } from '../src/lib/attendee-map';
import { renderLandingArea } from '../src/lib/landing-area';
import { resetPmtilesCache } from '../src/lib/pmtiles';
import {
  fakeBucket,
  memSource,
  planetArchive,
  pmtilesArchive,
  sparseBucket,
  tilesForCells,
} from './helpers/street-map-fixtures';

const NOW = Date.parse('2026-09-13T00:00:00.000Z');
// Blue Island, IL and a second area a few km north.
const BLUE = { lat: 41.6573, lon: -87.68 };
const NORTH = { lat: 41.75, lon: -87.66 };
const BLUE7 = latLngToCell(BLUE.lat, BLUE.lon, 7);
const NORTH7 = latLngToCell(NORTH.lat, NORTH.lon, 7);
// Los Angeles: no tile in common with the Chicago cells at any zoom the map reads.
const FAR7 = latLngToCell(34.05, -118.25, 7);

beforeEach(() => resetPmtilesCache());

const items = (n: number, cell = BLUE7): AttendeeMapItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${cell.slice(-3)}${i}`,
    name: `Event ${i}`,
    startDateISO: '2026-09-20T18:00:00.000Z',
    phase: 'pre_event',
    h3_res7: cell,
    venue: 'Eagles Hall',
    location: '13000 Western Ave, Blue Island, IL 60406',
    lat: BLUE.lat + 0.00123,
    lon: BLUE.lon - 0.00456,
  })) as AttendeeMapItem[];

describe('street map | frame', () => {
  it('fits the cells inside the frame, in Web Mercator', () => {
    const f = frameForCells([BLUE7, NORTH7]);
    for (const c of [BLUE7, NORTH7]) {
      const [x, y] = project(f, ...cellToLatLng(c));
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(f.w);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(f.h);
    }
    // North is up: the northern cell is drawn higher.
    expect(project(f, ...cellToLatLng(NORTH7))[1]).toBeLessThan(
      project(f, ...cellToLatLng(BLUE7))[1]
    );
    // Mercator, not a flat lat/lon: a degree of latitude is taller than it is at the equator.
    const [, y0] = toWorld(41, 0);
    const [, y1] = toWorld(42, 0);
    const [, e0] = toWorld(0, 0);
    const [, e1] = toWorld(1, 0);
    expect(y0 - y1).toBeGreaterThan((e0 - e1) * 1.3);
  });

  it('one cell is centred', () => {
    const f = frameForCells([BLUE7]);
    const [x, y] = project(f, ...cellToLatLng(BLUE7));
    expect(Math.abs(x - f.w / 2)).toBeLessThan(f.w * 0.05);
    expect(Math.abs(y - f.h / 2)).toBeLessThan(f.h * 0.05);
  });

  it('reads at most MAX_TILES tiles, never past MAX_ZOOM', () => {
    for (const cells of [[BLUE7], [BLUE7, NORTH7], [BLUE7, latLngToCell(43.0, -88.0, 7)]]) {
      const r = tilesFor(frameForCells(cells), 0, 15);
      expect(r.z).toBeLessThanOrEqual(MAX_ZOOM);
      expect((r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1)).toBeLessThanOrEqual(MAX_TILES);
    }
    // One res-7 cell is read at street detail.
    expect(tilesFor(frameForCells([BLUE7]), 0, 15).z).toBeGreaterThanOrEqual(12);
  });

  it('steps out a zoom when the natural one needs more than MAX_TILES', () => {
    // At z14 a tile is about 182 units here; starting 0.9 into a tile column and
    // 0.5 into a row, 600 × 360 spans 5 × 3 = 15 tiles.
    const n = 2 ** 14;
    const f: MapFrame = { w: 600, h: 360, scale: 256 * 2 ** 13.51, x0: 4096.9 / n, y0: 6062.5 / n };
    expect((600 / (f.scale / n) + 0.9) | 0).toBeGreaterThanOrEqual(4);
    const r = tilesFor(f, 0, 15);
    expect(r.z).toBe(13);
    expect((r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1)).toBeLessThanOrEqual(MAX_TILES);
  });
});

describe('street map | drawing', () => {
  const f: MapFrame = { w: 600, h: 360, scale: 256, x0: 0, y0: 0 };
  const tile = (layers: DecodedTile['layers']): DecodedTile[] => [{ x: 0, y: 0, layers }];

  it('draws water first, then minor, major and highway roads, and skips paths', () => {
    const svg = drawStreets(
      f,
      0,
      tile([
        {
          name: 'roads',
          extent: 4096,
          features: [
            {
              type: 2,
              props: { kind: 'highway' },
              geometry: [
                [
                  [0, 100],
                  [4096, 100],
                ],
              ],
            },
            {
              type: 2,
              props: { kind: 'major_road' },
              geometry: [
                [
                  [0, 200],
                  [4096, 200],
                ],
              ],
            },
            {
              type: 2,
              props: { kind: 'minor_road' },
              geometry: [
                [
                  [0, 300],
                  [4096, 300],
                ],
              ],
            },
            {
              type: 2,
              props: { kind: 'path' },
              geometry: [
                [
                  [0, 400],
                  [4096, 400],
                ],
              ],
            },
          ],
        },
        {
          name: 'water',
          extent: 4096,
          features: [
            {
              type: 3,
              props: {},
              geometry: [
                [
                  [0, 0],
                  [4096, 0],
                  [4096, 50],
                  [0, 0],
                ],
              ],
            },
          ],
        },
      ])
    );
    const order = [
      'class="as-w"',
      'class="as-r as-1"',
      'class="as-r as-2"',
      'class="as-r as-3"',
    ].map((c) => svg.indexOf(c));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(svg).not.toContain('M0 25');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('drops what lies outside the frame', () => {
    // One z0 tile is 1024 units wide here: x 3000..4000 of 4096 is 750..1000, past 600.
    const svg = drawStreets(
      { w: 600, h: 360, scale: 1024, x0: 0, y0: 0 },
      0,
      tile([
        {
          name: 'roads',
          extent: 4096,
          features: [
            {
              type: 2,
              props: { kind: 'highway' },
              geometry: [
                [
                  [3000, 10],
                  [4000, 10],
                ],
              ],
            },
          ],
        },
      ])
    );
    expect(svg).not.toContain('class="as-r as-3"');
  });

  it('keeps the point budget in a dense tile', () => {
    const dense = Array.from({ length: 400 }, (_, i) => ({
      type: 2,
      props: { kind: 'minor_road' },
      geometry: [
        Array.from({ length: 60 }, (_, k) => [k * 40, i * 5 + (k % 2) * 4] as [number, number]),
      ],
    }));
    const svg = drawStreets(f, 0, tile([{ name: 'roads', extent: 4096, features: dense }]));
    const points = svg.match(/[ML]-?\d/g)?.length ?? 0;
    expect(points).toBeGreaterThan(0);
    expect(points).toBeLessThanOrEqual(MAX_POINTS);
  });

  // A frame where one z0 tile is 1024 units wide: tile unit × 0.25 = SVG unit.
  const big: MapFrame = { w: 600, h: 360, scale: 1024, x0: 0, y0: 0 };
  const town = (name: string, rank: number, x: number, y: number) => ({
    type: 1,
    props: { kind: 'locality', name, population_rank: rank },
    geometry: [[[x * 4, y * 4] as [number, number]]],
  });

  it('town names: biggest first, at most MAX_LABELS, only towns', () => {
    // 12 towns on a grid with room for every one: only the 6 biggest are drawn.
    const towns = Array.from({ length: 12 }, (_, i) =>
      town(
        `Town ${String(i).padStart(2, '0')}`,
        20 - i,
        70 + (i % 4) * 150,
        70 + Math.floor(i / 4) * 110
      )
    );
    towns.push({
      ...town('Hood', 99, 300, 330),
      props: { kind: 'neighbourhood', name: 'Hood', population_rank: 99 },
    });
    const svg = drawStreets(big, 0, tile([{ name: 'places', extent: 4096, features: towns }]));
    expect(svg.match(/<text /g)).toHaveLength(MAX_LABELS);
    for (let i = 0; i < 12; i++) {
      expect(svg.includes(`Town ${String(i).padStart(2, '0')}`)).toBe(i < MAX_LABELS);
    }
    expect(svg).not.toContain('Hood');
  });

  it('town names are escaped, kept inside the frame, and do not overlap', () => {
    const svg = drawStreets(
      big,
      0,
      tile([
        {
          name: 'places',
          extent: 4096,
          features: [
            town('<script>x</script>', 9, 300, 180),
            town('Overlap', 8, 310, 185),
            town('Edge of the frame', 7, 5, 100),
          ],
        },
      ])
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(svg).not.toContain('Overlap');
    expect(svg).not.toContain('Edge of the frame');
  });

  it('a town name does not sit on a hexagon number', () => {
    const cellF = frameForCells([BLUE7]);
    const [cx, cy] = project(cellF, ...cellToLatLng(BLUE7));
    const n = 2 ** 14;
    const [wx, wy] = [cellF.x0 + cx / cellF.scale, cellF.y0 + cy / cellF.scale];
    const tx = Math.floor(wx * n);
    const ty = Math.floor(wy * n);
    const at: [number, number] = [
      Math.round((wx * n - tx) * 4096),
      Math.round((wy * n - ty) * 4096),
    ];
    const svg = drawStreets(
      cellF,
      14,
      [
        {
          x: tx,
          y: ty,
          layers: [
            {
              name: 'places',
              extent: 4096,
              features: [
                { type: 1, props: { kind: 'locality', name: 'Middle' }, geometry: [[at]] },
              ],
            },
          ],
        },
      ],
      [BLUE7]
    );
    expect(svg).not.toContain('Middle');
  });
});

describe('street map | loading (fail soft)', () => {
  it('builds the layer from the archive the frame needs', async () => {
    const { r, tiles } = tilesForCells([BLUE7]);
    const src = memSource(await pmtilesArchive(tiles, { gzip: true, leaf: true }));
    const layer = await buildStreetLayer(src, [BLUE7]);
    expect(layer.cellsKey).toBe(cellsKey([BLUE7]));
    expect(layer.svg).toContain(`data-z="${r.z}"`);
    expect(layer.svg).toContain('class="as-r as-3"');
    expect(layer.svg).toContain('class="as-r as-1"');
    expect(layer.svg).toContain('class="as-w"');
    // A highway across the middle of each tile row: the middle row passes near the centre.
    expect(layer.svg).toMatch(/class="as-r as-3" d="M-?\d+ \d+L/);
  });

  it('no binding, or no cells: null', async () => {
    expect(await loadStreetLayer(undefined, [BLUE7])).toBeNull();
    expect(await loadStreetLayer({}, [BLUE7])).toBeNull();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(0));
    expect(await loadStreetLayer({ MAP_TILES: bucket }, [])).toBeNull();
    expect(bucket.gets).toHaveLength(0);
  });

  it('reads only the configured archive, and refuses a name that is not one', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    const archive = await pmtilesArchive(tiles);
    const bucket = fakeBucket('region-2026.pmtiles', archive);
    const layer = await loadStreetLayer(
      { MAP_TILES: bucket, MAP_TILES_ARCHIVE: 'region-2026.pmtiles' },
      [BLUE7]
    );
    expect(layer?.svg).toContain('data-testid="amap-streets"');
    expect(new Set(bucket.gets.map((g) => g.key))).toEqual(new Set(['region-2026.pmtiles']));
    // Every read is a bounded byte range, never the whole object.
    expect(bucket.gets.every((g) => g.range && g.range.length <= 16384 + 1_000_000)).toBe(true);

    const bad = fakeBucket('../uploads/x', archive);
    expect(
      await loadStreetLayer({ MAP_TILES: bad, MAP_TILES_ARCHIVE: '../uploads/x' }, [BLUE7])
    ).toBeNull();
    expect(bad.gets).toHaveLength(0);
  });

  it('a missing or damaged archive: null', async () => {
    expect(
      await loadStreetLayer({ MAP_TILES: fakeBucket('other.pmtiles', new Uint8Array(200)) }, [
        BLUE7,
      ])
    ).toBeNull();
    const junk = new Uint8Array(4096).fill(7);
    expect(
      await loadStreetLayer({ MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, junk) }, [BLUE7])
    ).toBeNull();
    const { tiles } = tilesForCells([BLUE7]);
    const archive = await pmtilesArchive(
      tiles.map((t) => ({ ...t, data: new Uint8Array([0x1a, 0xff]) }))
    );
    expect(
      await loadStreetLayer({ MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) }, [BLUE7])
    ).toBeNull();
  });

  // Born red 2026-11-09 (location-precision CCR, F41): before the guard in
  // buildStreetLayer this returned a layer of one blank rectangle, and the
  // zoomed area drew its dots on it.
  it('an archive with no tile in the frame is no layer', async () => {
    // A sound archive, with tiles, for another part of the world.
    const { tiles } = tilesForCells([FAR7]);
    const archive = await pmtilesArchive(tiles, { gzip: true, leaf: true });
    expect(await buildStreetLayer(memSource(archive), [BLUE7])).toBeNull();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    expect(await loadStreetLayer({ MAP_TILES: bucket }, [BLUE7])).toBeNull();
    // It was read, and it is not a damaged file: its own cells draw.
    expect(bucket.gets.length).toBeGreaterThan(0);
    const own = await loadStreetLayer({ MAP_TILES: bucket }, [FAR7]);
    expect(own?.svg).toContain('data-testid="amap-streets"');
  });

  // The whole-planet build's layout, without the planet (helpers: planetArchive):
  // every tile two leaf directories down, tile bytes more than 128 GiB in.
  it('draws from a planet-sized archive, and asks R2 for the exact far offsets', async () => {
    const GIB = 2 ** 30;
    const { tiles } = tilesForCells([BLUE7]);
    const { file, dirs } = await planetArchive(
      tiles.map((t, i) => ({ ...t, at: 128 * GIB + i * 2 ** 20 })),
      { leafSize: 4, fanOut: 2, leafAt: 3 * 2 ** 20, dataAt: 5 * GIB }
    );
    const name = 'planet-20261109.pmtiles';
    const bucket = sparseBucket(name, file);
    const env = { MAP_TILES: bucket, MAP_TILES_ARCHIVE: name };
    const layer = await loadStreetLayer(env, [BLUE7]);
    expect(layer?.svg).toContain('class="as-r as-3"');
    expect(layer?.svg).toContain('class="as-w"');
    const tileGets = bucket.gets.filter((g) => g.range!.offset >= 5 * GIB);
    expect(tileGets).toHaveLength(tiles.length);
    for (const g of tileGets) {
      expect(g.range!.offset).toBeGreaterThan(2 ** 37);
      expect(Number.isInteger(g.range!.offset)).toBe(true);
      expect((g.range!.offset - 133 * GIB) % 2 ** 20).toBe(0);
    }
    // The first map pays for the header and the directories on the way down.
    const first = bucket.gets.length;
    expect(first).toBeGreaterThan(tiles.length + 2);
    expect(first).toBeLessThanOrEqual(1 + dirs.length + tiles.length);
    // The next map of the same area, in the same isolate, reads only its tiles.
    expect(await loadStreetLayer(env, [BLUE7])).toEqual(layer);
    expect(bucket.gets.length - first).toBe(tiles.length);
  });

  it('one tile of the frame is enough for a layer', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    expect(tiles.length).toBeGreaterThan(1);
    const layer = await buildStreetLayer(memSource(await pmtilesArchive(tiles.slice(0, 1))), [
      BLUE7,
    ]);
    expect(layer?.svg).toContain('data-testid="amap-streets"');
  });

  it('a slow archive: null, on time', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    const slow = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles), { delayMs: 200 });
    const t0 = Date.now();
    expect(await loadStreetLayer({ MAP_TILES: slow }, [BLUE7], { timeoutMs: 50 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(180);
  });
});

describe('street map | on the attendee map', () => {
  async function layerFor(cells: string[]) {
    const { tiles } = tilesForCells(cells, () => [
      {
        name: 'places',
        features: [
          { type: 1, props: { kind: 'locality', name: 'Calumet <Park>' }, parts: [[[400, 400]]] },
        ],
      },
    ]);
    return loadStreetLayer(
      { MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles)) },
      cells
    );
  }

  it('draws the streets under the hexagons, with the OpenStreetMap credit', async () => {
    const streets = await layerFor([BLUE7]);
    expect(streets).not.toBeNull();
    const out = renderAttendeeMap(items(5), { now: NOW, streets });
    expect(out.state).toBe('map');
    const svgAt = out.html.indexOf('data-testid="amap-svg"');
    const streetsAt = out.html.indexOf('data-testid="amap-streets"');
    const hexAt = out.html.indexOf('data-testid="amap-area"');
    expect(svgAt).toBeGreaterThan(-1);
    expect(streetsAt).toBeGreaterThan(svgAt);
    expect(hexAt).toBeGreaterThan(streetsAt);
    expect(out.html).toContain(STREET_STYLE);
    expect(out.html).toContain('data-testid="amap-credit"');
    expect(out.html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(out.html).not.toContain('Calumet <Park>');
  });

  it('without streets, the map is as before: no credit, no street style', () => {
    const out = renderAttendeeMap(items(5), { now: NOW });
    expect(out.html).not.toContain('amap-streets');
    expect(out.html).not.toContain('data-testid="amap-credit"');
    expect(out.html).not.toContain(STREET_STYLE);
  });

  it('a layer drawn for other cells is not used (the frames would not match)', async () => {
    const streets = await layerFor([BLUE7, NORTH7]);
    const out = renderAttendeeMap(items(5), { now: NOW, streets });
    expect(out.html).not.toContain('amap-streets');
  });

  it('hexagons are lighter over streets, so the streets read through', async () => {
    const streets = await layerFor([BLUE7]);
    const op = (html: string) => Number(/fill-opacity="([\d.]+)"/.exec(html)![1]);
    expect(op(renderAttendeeMap(items(5), { now: NOW, streets }).html)).toBeLessThan(
      op(renderAttendeeMap(items(5), { now: NOW }).html)
    );
  });

  it('no event coordinate reaches the markup', async () => {
    const streets = await layerFor([BLUE7]);
    const html = renderAttendeeMap(items(5), { now: NOW, streets }).html;
    for (const v of [BLUE.lat + 0.00123, BLUE.lon - 0.00456]) {
      expect(html).not.toContain(v.toFixed(4));
    }
  });

  it('both style blocks stay under the 400-char design-check budget', () => {
    expect(MAP_STYLE.length).toBeLessThan(400);
    expect(STREET_STYLE.length).toBeLessThan(400);
    expect(STREET_STYLE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('the landing reports the cells it drew and takes the streets for them', async () => {
    const many = items(10);
    const first = renderLandingArea(many, { now: NOW });
    expect(first.mapCells).toEqual([BLUE7]);
    const streets = await layerFor(first.mapCells!);
    const second = renderLandingArea(many, { now: NOW, streets });
    expect(second.html).toContain('data-testid="amap-streets"');
    expect(second.html).toContain('data-testid="amap-credit"');
  });
});
