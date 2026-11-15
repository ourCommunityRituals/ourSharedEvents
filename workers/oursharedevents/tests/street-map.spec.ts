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
 *   - the switch: STREET_MAP exactly "on" draws; "off", no value or anything
 *     else is no layer, and the bucket is never asked (street-map CCR, R20)
 *   - fail soft: no binding, a bad archive name, a damaged archive or a slow
 *     read all leave the hexagons-only map, and never throw
 *   - never who: the archive is the only object read; town names are escaped;
 *     no event coordinate reaches the markup
 *   - the OpenStreetMap credit shows whenever the streets do
 *   - an archive with no tile in the frame is no layer (location-precision CCR,
 *     F41), and a planet-sized archive draws (two leaf levels, far offsets)
 *   - every tile of the frame, or no layer: one tile missing is hexagons only
 *     (street-map CCR 2026-11-15, R15)
 *   - a tile, or the tiles of a frame together, holding more than the Worker
 *     will decode is hexagons only (R2; the counting itself is in mvt.spec.ts)
 *   - the edges of the world: an area on the antimeridian, a pentagon, the far
 *     north (R49)
 */
// @born-red no tile in the frame, planet-sized archive | method: "an archive with no tile in the frame is no layer" seen failing before the guard in buildStreetLayer (it returned a layer of one blank rectangle); its control is the archive's own cells drawing, in the same case ("one tile of the frame is enough" was its control until 2026-11-15, when R15 made every tile of the frame the rule); the planet case seen failing on 4 of the 6 reader faults listed in pmtiles.spec.ts | date: 2026-11-09
// @born-red the switch (STREET_MAP) | method: six faults in loadStreetLayer (src/lib/street-map.ts), one at a time, each seen failing in "street map | the switch (STREET_MAP)": the switch line removed (19 tests failed, here and in map-areas.spec.ts and street-map-landing.spec.ts); any set value counted as on (17); the value trimmed and lower-cased before the compare (6: "ON", "On", " on", "on ", the non-string case and the landing's "ON"); the switch read after the bucket (19, on the count of reads alone); the compare turned round (72, "on: the layer is drawn" among them); STREET_MAP_ON set to 'true' (59, "the one value that draws" among them). Before any spec passed STREET_MAP, the switch alone failed 52 tests that draw | date: 2026-11-15
// @born-red every tile of the frame, the frame's decode limits, the edges of the world (street-map CCR 2026-11-15, R15, R2, R49) | method: 9 faults injected one at a time in src/lib/street-map.ts and one in src/lib/mvt.ts, each seen failing the case named for it in the PR's fault list. The first puts main's lines back (a tile that is there is drawn): the R15 case failed. With the frame limit not passed to the decoder, and with the tile limit taken out, the "one point more" archive of that case drew. The three edge cases pin what the frame already did, so their red is the injected fault alone | date: 2026-11-15
// @born-red a river is a line (the last survivor of street-map.ts in the mutation run) | method: `feat.type === 2` turned to `true` in drawStreetLayer (src/lib/street-map.ts), the mutant that survived on main (run 43731915136) and on PR 1295; "a river is a line in the water layer" seen failing on it (rivers: 6 points drawn, 2 wanted) while the other 229 cases of the four street specs stayed green, then the line put back | date: 2026-11-15
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cellToBoundary,
  cellToLatLng,
  getPentagons,
  gridDisk,
  isPentagon,
  latLngToCell,
} from 'h3-js';
import {
  DEFAULT_ARCHIVE,
  FRAME_LIMITS,
  MAX_LABELS,
  MAX_POINTS,
  MAX_TILES,
  MAX_ZOOM,
  MIN_ROAD_POINTS,
  MIN_STREET_ZOOM,
  POINT_SHARES,
  STREET_STYLE,
  STREET_TIMEOUT_MS,
  buildStreetLayer,
  cellsKey,
  drawStreetLayer,
  drawStreets,
  fitParts,
  frameForCells,
  frameZoom,
  layerShows,
  loadStreetLayer,
  STREET_MAP_ON,
  project,
  readStreetDrawing,
  spendPoints,
  thinLine,
  tilesFor,
  toWorld,
  type DrawnPoints,
  type StreetPart,
  type DecodedTile,
  type MapFrame,
} from '../src/lib/street-map';
import { decodeTile, MvtError, TILE_LIMITS } from '../src/lib/mvt';
import { MAP_STYLE, renderAttendeeMap, type AttendeeMapItem } from '../src/lib/attendee-map';
import { renderLandingArea } from '../src/lib/landing-area';
import {
  MAX_DIRECTORY_BYTES,
  MAX_TILE_UNPACKED_BYTES,
  resetPmtilesCache,
} from '../src/lib/pmtiles';
import {
  fakeBucket,
  memSource,
  paddedTile,
  planetArchive,
  pmtilesArchive,
  scriptedBucket,
  sparseBucket,
  sparseSource,
  tilesForCells,
  tilesOfFrame,
  type FixtureLayer,
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
    // The biggest are the last listed and the last by name, so it is size that
    // picks them, not the order they were read in or their names.
    const towns = Array.from({ length: 12 }, (_, i) =>
      town(
        `Town ${String(i).padStart(2, '0')}`,
        i + 1,
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
      expect(svg.includes(`Town ${String(i).padStart(2, '0')}`)).toBe(i >= 12 - MAX_LABELS);
    }
    expect(svg).not.toContain('Hood');
    // One name follows the next with nothing between them.
    expect(svg.match(/<\/text><text /g)).toHaveLength(MAX_LABELS - 1);
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

  // The archive is someone else's data. Nothing a tile says may become markup:
  // a name is text, a road kind picks one of three fixed classes or is dropped.
  it('security: a hostile tile adds no element, attribute, link or script to the layer', () => {
    const line = (kind: string) => ({
      type: 2,
      props: { kind, name: '"><script>alert(1)</script>', ref: 'javascript:alert(1)' },
      geometry: [
        [
          [0, 400],
          [2000, 400],
        ] as [number, number][],
      ],
    });
    const shape = (layers: DecodedTile['layers']) => {
      const svg = drawStreets(big, 0, tile(layers));
      return {
        svg,
        tags: [...new Set([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]))].sort(),
        attrs: [...new Set([...svg.matchAll(/\s([a-zA-Z-]+)="/g)].map((m) => m[1]))].sort(),
        classes: [...new Set([...svg.matchAll(/class="([^"]*)"/g)].map((m) => m[1]))].sort(),
      };
    };
    const clean = shape([
      { name: 'roads', extent: 4096, features: [line('highway')] },
      { name: 'places', extent: 4096, features: [town('Blue Island', 9, 300, 180)] },
    ]);
    const hostile = shape([
      {
        name: 'roads',
        extent: 4096,
        features: [
          line('highway'),
          line('highway" onload="alert(1)'),
          line('</path><script>alert(1)</script>'),
          line('__proto__'),
          line('constructor'),
        ],
      },
      {
        name: 'places',
        extent: 4096,
        // Short enough to be given room in the frame at 28 units a letter.
        features: [town('Tom & "Jerry" <b onclick=alert(1)>\'s', 9, 300, 180)],
      },
    ]);
    // The same elements, attributes and classes as a layer from honest data.
    expect(hostile.tags).toEqual(clean.tags);
    expect(hostile.attrs).toEqual(clean.attrs);
    expect(hostile.classes).toEqual(clean.classes);
    // Only the one known road kind was drawn; the four made-up kinds were dropped.
    expect(hostile.svg.match(/<path /g)).toHaveLength(clean.svg.match(/<path /g)!.length);
    // The name is there, as text.
    expect(hostile.svg).toContain('Tom &amp; &quot;Jerry&quot; &lt;b onclick=alert(1)&gt;');
    for (const bad of [
      '<script',
      '<b ',
      'javascript:',
      'href',
      'http',
      'onload="',
      '<image',
      '<use',
    ]) {
      expect(hostile.svg).not.toContain(bad);
    }
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

// The point budget (street-map CCR 2026-11-15, R7). On real tiles the old
// drawer paid water first, in tile order, and skipped any feature that cost
// more than what was left: 19 areas of Manhattan drew 8,999 points of water and
// one point of road. Each test below builds that shape of demand by hand.
describe('street map | the point budget', () => {
  // One z0 tile is 1024 units wide here: 4 tile units to an SVG unit.
  const big: MapFrame = { w: 600, h: 360, scale: 1024, x0: 0, y0: 0 };
  const U = 4;
  type Pt = [number, number];
  const road = (kind: string, ...geometry: Pt[][]) => ({ type: 2, props: { kind }, geometry });
  const lake = (...geometry: Pt[][]) => ({ type: 3, props: { kind: 'lake' }, geometry });
  const roads = (...features: ReturnType<typeof road>[]) => ({
    name: 'roads',
    extent: 4096,
    features,
  });
  const water = (...features: ReturnType<typeof lake>[]) => ({
    name: 'water',
    extent: 4096,
    features,
  });
  /** A line left to right at height y, a point every `step` units, swinging `swing` up and down. */
  const wavy = (y: number, points: number, swing: number, from = 0, to = 600): Pt[] =>
    Array.from({ length: points }, (_, i) => [
      Math.round(from + ((to - from) * i) / (points - 1)) * U,
      (y + (i % 2 ? swing : -swing)) * U,
    ]);
  /** A band of water under a wavy shore: `points` points and the closing one. */
  const band = (y: number, points: number): Pt[] => {
    const shore = wavy(y, points - 2, 1);
    return [...shore, [600 * U, (y + 3) * U], [0, (y + 3) * U], shore[0]!];
  };
  const at = (svg: string, cls: string): Pt[] => {
    const d = new RegExp(`<path class="${cls}" d="([^"]*)"`).exec(svg)?.[1] ?? '';
    return [...d.matchAll(/[ML](-?\d+) (-?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  };
  const count = (svg: string): number => svg.match(/[ML]-?\d/g)?.length ?? 0;

  it('a flood of water does not cost a highway one point', () => {
    // 60 bands of 400 points (24,000 asked for), listed before the one highway.
    const lakes = Array.from({ length: 60 }, (_, j) => lake(band(4 + j * 5, 400)));
    const highway = wavy(180, 500, 6);
    const svg = drawStreets(big, 0, [
      { x: 0, y: 0, layers: [water(...lakes), roads(road('highway', highway))] },
    ]);
    expect(at(svg, 'as-r as-3')).toEqual(highway.map(([x, y]) => [x / U, y / U]));
    expect(at(svg, 'as-w').length).toBeGreaterThan(0);
    expect(count(svg)).toBeLessThanOrEqual(MAX_POINTS);
  });

  it('one road feature larger than the whole budget is cut down, not left out', () => {
    // Protomaps stores the minor roads of a metro at zoom 12 as a few very large
    // features. 40 streets in one feature, 600 points each: 24,000 points.
    const streets = Array.from({ length: 40 }, (_, j) => wavy(8 + j * 8, 600, 1));
    const svg = drawStreets(big, 0, [
      { x: 0, y: 0, layers: [roads(road('minor_road', ...streets))] },
    ]);
    const drawn = at(svg, 'as-r as-1');
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(MAX_POINTS);
    // Every street is still there, end to end.
    const d = /<path class="as-r as-1" d="([^"]*)"/.exec(svg)![1]!;
    expect(d.match(/M/g)).toHaveLength(40);
    for (const line of d.split('M').slice(1)) {
      const xs = [...line.matchAll(/(?:^|L)(-?\d+) /g)].map((m) => Number(m[1]));
      expect(xs[0]).toBe(0);
      expect(xs.at(-1)).toBe(600);
    }
  });

  it('the last tile read is drawn as well as the first', () => {
    // Two tiles side by side, each asking for more highway than the budget.
    const half: MapFrame = { w: 600, h: 360, scale: 600, x0: 0, y0: 0 };
    const k = (2 * 4096) / 600; // tile units to an SVG unit at zoom 1
    const tileOf = (x: number): DecodedTile => ({
      x,
      y: 0,
      layers: [
        roads(
          ...Array.from({ length: 40 }, (_, j) =>
            road(
              'highway',
              Array.from({ length: 300 }, (_, i): Pt => [
                Math.round(i * k),
                Math.round((6 + j * 7 + (i % 2 ? 4 : -4)) * k),
              ])
            )
          )
        ),
      ],
    });
    const svg = drawStreets(half, 1, [tileOf(0), tileOf(1)]);
    const drawn = at(svg, 'as-r as-3');
    const right = drawn.filter(([x]) => x >= 300).length;
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(right).toBeGreaterThanOrEqual(drawn.length * 0.4);
    expect(drawn.length - right).toBeGreaterThanOrEqual(drawn.length * 0.4);
  });

  it('with every kind over its share, every kind is drawn, and the roads hold most of the points', () => {
    const many = (kind: string, y: number) =>
      Array.from({ length: 30 }, (_, j) => road(kind, wavy(y + j * 3, 600, 20)));
    const svg = drawStreets(big, 0, [
      {
        x: 0,
        y: 0,
        layers: [
          water(...Array.from({ length: 60 }, (_, j) => lake(band(4 + j * 5, 400)))),
          {
            name: 'water',
            extent: 4096,
            features: Array.from({ length: 30 }, (_, j) => ({
              type: 2,
              props: { kind: 'river' },
              geometry: [wavy(30 + j * 3, 600, 20)],
            })),
          },
          roads(...many('minor_road', 40), ...many('major_road', 140), ...many('highway', 240)),
        ],
      },
    ]);
    const n = (cls: string) => at(svg, cls).length;
    const road3 = n('as-r as-3');
    const road2 = n('as-r as-2');
    const road1 = n('as-r as-1');
    for (const got of [road3, road2, road1, n('as-w'), n('as-v')]) expect(got).toBeGreaterThan(0);
    expect(count(svg)).toBeLessThanOrEqual(MAX_POINTS);
    expect(road3 + road2 + road1).toBeGreaterThanOrEqual(MAX_POINTS * 0.5);
    expect(road3).toBeGreaterThanOrEqual(road1);
  });

  it('what fits is drawn as it was read: nothing is thinned to save points nobody needs', () => {
    const highway = wavy(100, 300, 1);
    const street = wavy(200, 300, 1);
    const svg = drawStreets(big, 0, [
      {
        x: 0,
        y: 0,
        layers: [
          water(lake(band(300, 200))),
          roads(road('highway', highway), road('minor_road', street)),
        ],
      },
    ]);
    expect(at(svg, 'as-r as-3')).toEqual(highway.map(([x, y]) => [x / U, y / U]));
    expect(at(svg, 'as-r as-1')).toEqual(street.map(([x, y]) => [x / U, y / U]));
    expect(at(svg, 'as-w')).toHaveLength(201);
  });

  /** Steps down and to the right, 20 units a step: no point of it lies near a straight run. */
  const stairs = (x: number, y: number, steps: number): Pt[] =>
    Array.from({ length: steps * 2 + 1 }, (_, i): Pt => [
      (x + Math.ceil(i / 2) * 20) * U,
      (y + Math.floor(i / 2) * 20) * U,
    ]);

  it('points the water was allowed and did not draw go to the roads', () => {
    // 320 streets that cannot be thinned, 31 points each: more than the budget.
    // Water that asks for 24,000 points and thins to far less than its share.
    const streets = Array.from({ length: 320 }, (_, j) =>
      road('minor_road', stairs((j % 40) * 7, Math.floor(j / 40) * 6, 15))
    );
    const lakes = Array.from({ length: 60 }, (_, j) => lake(band(4 + j * 5, 400)));
    const { svg, drawn } = drawStreetLayer(big, 0, [
      { x: 0, y: 0, layers: [water(...lakes), roads(...streets)] },
    ]);
    // Asked: 320 x 31 = 9,920 points of street. Sure of 20%, plus what nobody
    // else needs (the two other road kinds and the rivers ask for nothing).
    const sure = spendPoints({ highway: 0, major: 0, minor: 9920, water: 24060, rivers: 0 });
    expect(sure).toEqual({ highway: 0, major: 0, minor: 7650, water: 1350, rivers: 0 });
    expect(drawn.water).toBeLessThan(1350);
    expect(drawn.minor).toBe(MAX_POINTS - drawn.water);
    expect(count(svg)).toBe(MAX_POINTS);
  });

  it('points the highways were allowed and did not draw go to the major roads', () => {
    // Highways that ask for 24,000 points and thin to far less than they may
    // have; 320 major roads that cannot be thinned, 9,920 points.
    const highways = Array.from({ length: 40 }, (_, j) => road('highway', wavy(8 + j * 8, 600, 1)));
    const majors = Array.from({ length: 320 }, (_, j) =>
      road('major_road', stairs((j % 40) * 7, Math.floor(j / 40) * 6, 15))
    );
    const { svg, drawn } = drawStreetLayer(big, 0, [
      { x: 0, y: 0, layers: [roads(...majors, ...highways)] },
    ]);
    const sure = spendPoints({ highway: 24000, major: 9920, minor: 0, water: 0, rivers: 0 });
    expect(sure).toEqual({ highway: 6300, major: 2700, minor: 0, water: 0, rivers: 0 });
    expect(drawn.highway).toBeGreaterThan(0);
    expect(drawn.highway).toBeLessThan(6300);
    expect(drawn.major).toBe(MAX_POINTS - drawn.highway);
    expect(count(svg)).toBe(MAX_POINTS);
  });

  it('reports the points it drew, by kind', () => {
    const { svg, drawn } = drawStreetLayer(big, 0, [
      {
        x: 0,
        y: 0,
        layers: [
          water(lake(band(300, 200))),
          {
            name: 'water',
            extent: 4096,
            features: [{ type: 2, props: { kind: 'river' }, geometry: [wavy(250, 40, 2)] }],
          },
          roads(
            road('highway', wavy(100, 30, 1)),
            road('major_road', wavy(150, 20, 1)),
            road('medium_road', wavy(160, 10, 1)),
            road('minor_road', wavy(200, 50, 1)),
            road('path', wavy(220, 60, 1))
          ),
        ],
      },
    ]);
    expect(drawn).toEqual({ highway: 30, major: 30, minor: 50, water: 201, rivers: 40 });
    expect(at(svg, 'as-r as-3')).toHaveLength(30);
    expect(at(svg, 'as-r as-2')).toHaveLength(30);
    expect(at(svg, 'as-r as-1')).toHaveLength(50);
    expect(at(svg, 'as-w')).toHaveLength(201);
    expect(at(svg, 'as-v')).toHaveLength(40);
    expect(svg).toBe(
      drawStreets(big, 0, [
        {
          x: 0,
          y: 0,
          layers: [
            water(lake(band(300, 200))),
            {
              name: 'water',
              extent: 4096,
              features: [{ type: 2, props: { kind: 'river' }, geometry: [wavy(250, 40, 2)] }],
            },
            roads(
              road('highway', wavy(100, 30, 1)),
              road('major_road', wavy(150, 20, 1)),
              road('medium_road', wavy(160, 10, 1)),
              road('minor_road', wavy(200, 50, 1)),
              road('path', wavy(220, 60, 1))
            ),
          ],
        },
      ])
    );
  });

  it('a point said twice in a row is drawn once, and a part with nothing to draw is left out', () => {
    const { svg, drawn } = drawStreetLayer(big, 0, [
      {
        x: 0,
        y: 0,
        layers: [
          roads(
            // 40 and 41 tile units both round to SVG unit 10; so do 400 and 401 to 100.
            road('highway', [
              [40, 400],
              [41, 400],
              [41, 401],
              [400, 400],
              [400, 400],
            ]),
            // A road that is one SVG point.
            road('highway', [
              [800, 800],
              [801, 801],
            ])
          ),
          // A ring of two corners and its closing point holds no water.
          water(
            lake([
              [0, 0],
              [400, 0],
              [0, 0],
            ]),
            lake([
              [0, 0],
              [400, 0],
              [400, 400],
              [0, 0],
            ])
          ),
        ],
      },
    ]);
    expect(svg).toContain('<path class="as-r as-3" d="M10 100L100 100"/>');
    expect(svg).toContain('<path class="as-w" d="M0 0L100 0L100 100L0 0Z"/>');
    expect(drawn).toEqual({ highway: 2, major: 0, minor: 0, water: 4, rivers: 0 });
  });

  it('a part is kept when it touches the frame or its 12-unit margin, and dropped past it', () => {
    const line = (x0: number, y0: number, x1: number, y1: number) =>
      road('highway', [
        [x0 * U, y0 * U],
        [x1 * U, y1 * U],
      ]);
    const kept = (f: ReturnType<typeof line>) =>
      drawStreetLayer(big, 0, [{ x: 0, y: 0, layers: [roads(f)] }]).drawn.highway === 2;
    // Left and right of the frame (600 wide).
    expect(kept(line(-40, 50, -12, 60))).toBe(true);
    expect(kept(line(-40, 50, -13, 60))).toBe(false);
    expect(kept(line(612, 50, 640, 60))).toBe(true);
    expect(kept(line(613, 50, 640, 60))).toBe(false);
    // Above and below it (360 tall).
    expect(kept(line(50, -40, 60, -12))).toBe(true);
    expect(kept(line(50, -40, 60, -13))).toBe(false);
    expect(kept(line(50, 372, 60, 400))).toBe(true);
    expect(kept(line(50, 373, 60, 400))).toBe(false);
  });
});

describe('street map | the budget rules, one at a time', () => {
  const need = (highway: number, major: number, minor: number, water: number, rivers: number) => ({
    highway,
    major,
    minor,
    water,
    rivers,
  });

  it('the shares are paid roads first, add up to the whole, and give roads four fifths', () => {
    expect(POINT_SHARES.map(([kind]) => kind)).toEqual([
      'highway',
      'major',
      'minor',
      'water',
      'rivers',
    ]);
    expect(POINT_SHARES.reduce((s, [, share]) => s + share * 100, 0)).toBe(100);
    expect(POINT_SHARES.slice(0, 3).reduce((s, [, share]) => s + share * 100, 0)).toBe(80);
  });

  it('what fits is paid in full', () => {
    expect(spendPoints(need(100, 200, 300, 400, 50))).toEqual(need(100, 200, 300, 400, 50));
    expect(spendPoints(need(0, 0, 0, 0, 0))).toEqual(need(0, 0, 0, 0, 0));
    expect(spendPoints(need(9000, 0, 0, 0, 0))).toEqual(need(9000, 0, 0, 0, 0));
    expect(spendPoints(need(0, 0, 0, 9000, 0))).toEqual(need(0, 0, 0, 9000, 0));
  });

  it('with every kind over its share, each gets its share and no more', () => {
    expect(spendPoints(need(20000, 20000, 20000, 20000, 20000))).toEqual(
      need(2700, 2700, 1800, 1350, 450)
    );
    expect(MAX_POINTS).toBe(2700 + 2700 + 1800 + 1350 + 450);
    // The same rule at another size, shares rounded down.
    expect(spendPoints(need(999, 999, 999, 999, 999), 101)).toEqual(need(31, 30, 20, 15, 5));
  });

  it('what one kind leaves goes to the first kind in the order that still needs it', () => {
    // The Manhattan shape: water asks for everything, roads for more than is left.
    expect(spendPoints(need(100, 5000, 48000, 16000, 1400))).toEqual(
      need(100, 5000, 2100, 1350, 450)
    );
    // Highways take the spare before major roads, major roads before streets.
    expect(spendPoints(need(8000, 8000, 0, 0, 0))).toEqual(need(6300, 2700, 0, 0, 0));
    expect(spendPoints(need(0, 8000, 8000, 0, 0))).toEqual(need(0, 7200, 1800, 0, 0));
    // Streets before water, water before rivers.
    expect(spendPoints(need(0, 0, 8000, 8000, 0))).toEqual(need(0, 0, 7650, 1350, 0));
    expect(spendPoints(need(0, 0, 0, 9000, 9000))).toEqual(need(0, 0, 0, 8550, 450));
    // A kind is never paid more than it asked for.
    expect(spendPoints(need(0, 0, 0, 8000, 8000))).toEqual(need(0, 0, 0, 8000, 1000));
    // Never more than the whole.
    const all = spendPoints(need(3000, 100, 9000, 9000, 9000));
    expect(Object.values(all).reduce((s, v) => s + v, 0)).toBe(MAX_POINTS);
    expect(all).toEqual(need(3000, 100, 4100, 1350, 450));
  });

  it('thinning: a straight run becomes its two ends', () => {
    const run: [number, number][] = Array.from({ length: 50 }, (_, i) => [i * 3, 10]);
    expect(thinLine(run, 1)).toEqual([
      [0, 10],
      [147, 10],
    ]);
    // Three points on one run are two.
    expect(thinLine(run.slice(0, 3), 1)).toEqual([
      [0, 10],
      [6, 10],
    ]);
    // Two points, one point and none are returned as they came, as a copy.
    for (const short of [run.slice(0, 2), run.slice(0, 1), []]) {
      const out = thinLine(short, 5);
      expect(out).toEqual(short);
      expect(out).not.toBe(short);
    }
  });

  it('thinning: a corner is kept, at the point where the line leaves the run', () => {
    // Right along y=0 to (30,0), then straight down.
    const bend: [number, number][] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
      [30, 10],
      [30, 20],
      [30, 30],
    ];
    expect(thinLine(bend, 1)).toEqual([
      [0, 0],
      [30, 0],
      [30, 30],
    ]);
  });

  it('thinning: a point exactly the limit away is left out; one past it is kept', () => {
    const bump = (h: number): [number, number][] => [
      [0, 0],
      [10, 0],
      [20, h],
      [30, 0],
      [40, 0],
    ];
    // The run is y=0. A point 3 away, limit 3: inside. Then the last point stays.
    expect(thinLine(bump(3), 3)).toEqual([
      [0, 0],
      [40, 0],
    ]);
    expect(thinLine(bump(-3), 3)).toEqual([
      [0, 0],
      [40, 0],
    ]);
    // 4 away: outside, on either side. The point before it is kept, and the run
    // from there on is the line through that point and the one that left, which
    // the points after it leave in their turn.
    expect(thinLine(bump(4), 3)).toEqual(bump(4));
    expect(thinLine(bump(-4), 3)).toEqual(bump(-4));
    // A wider limit takes the bump as part of one run.
    expect(thinLine(bump(4), 4)).toEqual([
      [0, 0],
      [40, 0],
    ]);
  });

  it('thinning: distance is measured across the run, whichever way it points', () => {
    // A run along the diagonal; (20,26) is 6/sqrt(2) = 4.24 from it.
    const diag: [number, number][] = [
      [0, 0],
      [10, 10],
      [20, 26],
      [30, 30],
    ];
    expect(thinLine(diag, 5)).toEqual([
      [0, 0],
      [30, 30],
    ]);
    expect(thinLine(diag, 4)).toHaveLength(4);
    // A steep run: (2,100) is under 2 from the line through (0,0) and (0,50).
    expect(
      thinLine(
        [
          [0, 0],
          [0, 50],
          [2, 100],
          [0, 150],
        ],
        2
      )
    ).toHaveLength(2);
  });

  const part = (points: number, span: number, rank: number, x = 0): StreetPart => ({
    // Up and down by 100: nothing of it can be thinned at any step.
    pts: Array.from({ length: points }, (_, i) => [x + i * 30, i % 2 ? 100 : 0]),
    span,
    rank,
  });
  const sizes = (parts: StreetPart[]) => parts.map((p) => p.pts.length);

  it('fitting: parts that fit come back as they were, in their order', () => {
    const parts = [part(10, 5, 0), part(20, 9, 1), part(30, 1, 2)];
    const out = fitParts(parts, 60, false);
    expect(out).toEqual(parts);
    expect(out).not.toBe(parts);
    expect(fitParts([], 0, false)).toEqual([]);
  });

  it('fitting: one point over, and the parts are thinned by the first step that fits', () => {
    // 61 points along a line that wanders 2 units either side. Step 1 drops the
    // points that sit on a straight run; steps 2 and 3 drop no more; step 5 does.
    const wander: StreetPart = {
      pts: Array.from({ length: 61 }, (_, i) => [i * 10, [0, 2, 0, -2][i % 4]!]),
      span: 604,
      rank: 0,
    };
    expect(fitParts([wander], 61, false)[0]!.pts).toHaveLength(61);
    const thinned = fitParts([wander], 60, false);
    expect(thinned).toHaveLength(1);
    const at = (tol: number) => thinLine(wander.pts, tol).length;
    expect(at(1)).toBeLessThan(61);
    expect(thinned[0]!.pts.length).toBe(at(1));
    expect(thinned[0]!.pts[0]).toEqual([0, 0]);
    expect(thinned[0]!.pts.at(-1)).toEqual([600, 0]);
    expect(thinned[0]).toMatchObject({ span: 604, rank: 0 });
    // The gentlest step that fits is the one used. One point under what step 1
    // leaves: steps 2 and 3 leave as many, so it is step 5, not step 8.
    expect([at(2), at(3)]).toEqual([at(1), at(1)]);
    expect(at(5)).toBeLessThan(at(1));
    expect(at(8)).toBeLessThan(at(5));
    expect(fitParts([wander], at(1) - 1, false)[0]!.pts).toEqual(thinLine(wander.pts, 5));
    expect(fitParts([wander], at(5), false)[0]!.pts).toEqual(thinLine(wander.pts, 5));
    expect(fitParts([wander], at(5) - 1, false)[0]!.pts).toEqual(thinLine(wander.pts, 8));
  });

  it('fitting: past the coarsest step the widest parts are kept and the last line is cut at a point', () => {
    const parts = [part(10, 5, 0), part(20, 9, 1), part(30, 7, 2)];
    // 60 points asked, 45 allowed: span 9 whole (20), span 7 whole would be 50, so 25 of it.
    const out = fitParts(parts, 45, false);
    expect(sizes(out)).toEqual([20, 25]);
    expect(out[0]).toEqual(parts[1]);
    expect(out[1]!.pts).toEqual(parts[2]!.pts.slice(0, 25));
    // Exactly what whole parts cost: nothing is cut, and the next part is not started.
    expect(sizes(fitParts(parts, 50, false))).toEqual([20, 30]);
    // One point left is not a line.
    expect(sizes(fitParts(parts, 21, false))).toEqual([20]);
    // Two are.
    expect(sizes(fitParts(parts, 22, false))).toEqual([20, 2]);
    expect(sizes(fitParts(parts, 1, false))).toEqual([]);
  });

  it('fitting: equal parts are taken one from each tile before a second from any', () => {
    // Two tiles, three parts each, all as wide as each other; rank is the place in its tile.
    const a = [part(10, 5, 0, 0), part(10, 5, 1, 0), part(10, 5, 2, 0)];
    const b = [part(10, 5, 0, 1000), part(10, 5, 1, 1000), part(10, 5, 2, 1000)];
    const out = fitParts([...a, ...b], 40, false);
    expect(out).toEqual([a[0], b[0], a[1], b[1]]);
  });

  it('fitting: a ring is never cut short, and none is kept after a wider one was left out', () => {
    const ring = (points: number, span: number, rank: number): StreetPart => {
      const p = part(points - 1, span, rank);
      return { ...p, pts: [...p.pts, p.pts[0]!] };
    };
    const rings = [ring(30, 9, 0), ring(10, 5, 1), ring(40, 7, 2)];
    // 80 asked. 45 allowed: the widest (30) is in; the next widest (40) does not
    // fit and is not cut; the small one (10) would fit and is still left out.
    expect(sizes(fitParts(rings, 45, true))).toEqual([30]);
    expect(sizes(fitParts(rings, 70, true))).toEqual([30, 40]);
    expect(sizes(fitParts(rings, 29, true))).toEqual([]);
  });

  it('fitting: a ring thinned to less than three corners is dropped; a line of two points is not', () => {
    // A sliver: 40 points out along y=0 and back along y=1.
    const sliver: [number, number][] = [
      ...Array.from({ length: 20 }, (_, i): [number, number] => [i * 10, 0]),
      ...Array.from({ length: 20 }, (_, i): [number, number] => [190 - i * 10, 1]),
      [0, 0],
    ];
    const wide = part(20, 500, 1);
    const closedWide = { ...wide, pts: [...wide.pts, wide.pts[0]!] };
    expect(fitParts([{ pts: sliver, span: 191, rank: 0 }, closedWide], 30, true)).toEqual([
      closedWide,
    ]);
    // The same points as a line are a line still.
    const asLine = fitParts([{ pts: sliver, span: 191, rank: 0 }, wide], 30, false);
    expect(asLine).toHaveLength(2);
    expect(asLine[0]!.pts.length).toBeLessThan(10);
  });
});

// The whole file is mutated since 2026-11-15 (stryker.conf.mjs). These pin what
// the older cases left loose: the frame's edges, which tile zooms are read,
// what counts as a town name and where one may sit, which features are roads,
// and the markup to the character.
describe('street map | the frame, the names and the kinds, to the unit', () => {
  // One z0 tile is 4096 units wide here: a tile unit is an SVG unit.
  const one: MapFrame = { w: 600, h: 360, scale: 4096, x0: 0, y0: 0 };
  const tile = (layers: DecodedTile['layers']): DecodedTile[] => [{ x: 0, y: 0, layers }];
  const places = (...features: DecodedTile['layers'][number]['features']) =>
    tile([{ name: 'places', extent: 4096, features }]);
  const town = (name: unknown, rank: number, x: number, y: number) => ({
    type: 1,
    props: { kind: 'locality', name, population_rank: rank } as Record<string, never>,
    geometry: [[[x, y] as [number, number]]],
  });
  const names = (svg: string) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  /**
   * Half the width a name of `length` characters is given: 28 units a letter
   * (the size a narrow screen sets it in, lib/map-narrow-style.ts), 0.55 wide.
   */
  const half = (length: number) => (length * 28 * 0.55) / 2;

  it('the key of a set of cells is the cells in order, with commas', () => {
    expect(cellsKey(['87b', '87a', '87c'])).toBe('87a,87b,87c');
    expect(cellsKey(['87a', '87c', '87b'])).toBe(cellsKey(['87c', '87b', '87a']));
    expect(cellsKey([])).toBe('');
  });

  it('a wide frame is fitted by its width: the cells reach 8% in from each side', () => {
    const cells = [BLUE7, latLngToCell(BLUE.lat, BLUE.lon + 3, 7)];
    const f = frameForCells(cells);
    const xs = cells.flatMap((c) => cellToBoundary(c).map(([lat, lng]) => project(f, lat, lng)[0]));
    expect(Math.min(...xs)).toBeCloseTo(600 * 0.08, 6);
    expect(Math.max(...xs)).toBeCloseTo(600 * 0.92, 6);
  });

  it('the zoom read is never finer than the archive holds, nor than MAX_ZOOM', () => {
    const cell = frameForCells([BLUE7]);
    expect(frameZoom(cell)).toBeGreaterThanOrEqual(13);
    // An archive that stops at zoom 12: that is what is read.
    expect(tilesFor(cell, 0, 12).z).toBe(12);
    // A frame finer than zoom 14, an archive that holds 15: 14 is read.
    const fine: MapFrame = { w: 600, h: 360, scale: 256 * 2 ** 15, x0: 0.25, y0: 0.37 };
    expect(frameZoom(fine)).toBe(15);
    expect(tilesFor(fine, 0, 15).z).toBe(MAX_ZOOM);
  });

  it('the zoom read is never coarser than the archive holds, even past MAX_TILES', () => {
    // 19 areas are read at zoom 12; an archive that starts at 14 is read at 14.
    const wide = frameForCells(gridDisk(BLUE7, 2));
    expect(frameZoom(wide)).toBe(12);
    const r = tilesFor(wide, 14, 15);
    expect(r.z).toBe(14);
    expect((r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1)).toBeGreaterThan(MAX_TILES);
  });

  it('a frame over the edge of the world reads the last tile, not one past it', () => {
    // Zoom 2 has tiles 0 to 3. This frame starts in tile 3 and runs past the edge.
    expect(tilesFor({ w: 600, h: 360, scale: 1024, x0: 0.9, y0: 0.9 }, 0, 15)).toEqual({
      z: 2,
      xMin: 3,
      xMax: 3,
      yMin: 3,
      yMax: 3,
    });
  });

  it('towns of one size are named in the order of their names', () => {
    // Seven of one size, listed from G to A, room for all: A to F are named.
    const towns = ['G', 'F', 'E', 'D', 'C', 'B', 'A'].map((letter, i) =>
      town(`Town ${letter}`, 5, 80 + (i % 4) * 150, 70 + Math.floor(i / 4) * 110)
    );
    expect(names(drawStreets(one, 0, places(...towns))).sort()).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => `Town ${l}`)
    );
  });

  it('a name is a named point of kind locality, in English when the tile has it', () => {
    const svg = drawStreets(
      one,
      0,
      places(
        // English first.
        {
          type: 1,
          props: { kind: 'locality', name: 'Chicagou', 'name:en': 'Chicago', population_rank: 9 },
          geometry: [[[300, 60]]],
        },
        // A shape, not a point.
        {
          type: 3,
          props: { kind: 'locality', name: 'Shape', population_rank: 8 },
          geometry: [
            [
              [100, 150],
              [200, 150],
              [200, 180],
              [100, 150],
            ],
          ],
        },
        // A name that is not text, an empty name, and a point with no place.
        town(12345, 7, 300, 150),
        town('', 7, 300, 220),
        { type: 1, props: { kind: 'locality', name: 'Nowhere', population_rank: 7 }, geometry: [] },
        {
          type: 1,
          props: { kind: 'locality', name: 'Nopoint', population_rank: 7 },
          geometry: [[]],
        },
        // No size given: still named, after the ones that have one.
        { type: 1, props: { kind: 'locality', name: 'Unranked' }, geometry: [[[300, 300]]] }
      )
    );
    expect(names(svg)).toEqual(['Chicago', 'Unranked']);
  });

  it('a name is kept when its box just fits inside the frame, on each side, and dropped a hair past it', () => {
    // A length (no shorter than the longest tag below) whose half width adds
    // back exactly, so "just fits" is exact.
    const length = Array.from({ length: 19 }, (_, i) => i + 12).find(
      (n) => 600 - half(n) + half(n) === 600
    )!;
    expect(length).toBeGreaterThan(0);
    const h = half(length);
    const name = (tag: string) => tag.padEnd(length, 'x');
    const svg = drawStreets(
      one,
      0,
      places(
        // Past each edge by half a unit: listed first and biggest, so each would be drawn if kept.
        town(name('out-left'), 9, h - 0.5, 280),
        town(name('out-right'), 9, 600 - h + 0.5, 310),
        town(name('out-top'), 9, 300, 27.5),
        town(name('out-bottom'), 9, 300, 356.5),
        // Touching each edge: the box is 28 above the point and 4 below it.
        town(name('in-left'), 5, h, 100),
        town(name('in-right'), 5, 600 - h, 200),
        town(name('in-top'), 5, 300, 28),
        town(name('in-bottom'), 5, 300, 356)
      )
    );
    expect(names(svg).sort()).toEqual(
      ['in-bottom', 'in-left', 'in-right', 'in-top'].map(name).sort()
    );
  });

  it('names that touch do not overlap: one is drawn against each side of another', () => {
    // A length and a middle where "touching" is exact on the left and the right.
    let pick: { length: number; x: number } | null = null;
    for (let length = 5; length <= 16 && !pick; length++) {
      const h = half(length);
      for (let x = 290; x <= 310 && !pick; x++) {
        if (x - 2 * h + h === x - h && x + 2 * h - h === x + h) pick = { length, x };
      }
    }
    expect(pick).not.toBeNull();
    const { length, x } = pick!;
    const h = half(length);
    const name = (tag: string) => tag.padEnd(length, 'x');
    const svg = drawStreets(
      one,
      0,
      places(
        town(name('mid'), 9, x, 180),
        town(name('left'), 5, x - 2 * h, 180),
        town(name('right'), 5, x + 2 * h, 180),
        // 28 above the point and 4 below: 32 apart is edge to edge.
        town(name('up'), 5, x, 148),
        town(name('down'), 5, x, 212)
      )
    );
    expect(names(svg).sort()).toEqual(['down', 'left', 'mid', 'right', 'up'].map(name).sort());
    // One unit nearer on any side, and the smaller name gives way.
    for (const [tag, tx, ty] of [
      ['left', x - 2 * h + 1, 180],
      ['right', x + 2 * h - 1, 180],
      ['up', x, 149],
      ['down', x, 211],
    ] as const) {
      const near = drawStreets(
        one,
        0,
        places(town(name('mid'), 9, x, 180), town(name(tag), 5, tx, ty))
      );
      expect(names(near)).toEqual([name('mid')]);
    }
  });

  const line = (kind: string, ...pts: [number, number][]) => ({
    type: 2,
    props: { kind },
    geometry: [pts],
  });

  it('a road is a line in the roads layer: not a shape there, not a line elsewhere', () => {
    const { svg, drawn } = drawStreetLayer(one, 0, [
      {
        x: 0,
        y: 0,
        layers: [
          {
            name: 'roads',
            extent: 4096,
            features: [
              line('highway', [10, 10], [100, 10]),
              // A square by the road, of kind highway: a shape.
              {
                type: 3,
                props: { kind: 'highway' },
                geometry: [
                  [
                    [200, 200],
                    [300, 200],
                    [300, 300],
                    [200, 200],
                  ],
                ],
              },
            ],
          },
          // Layers the Worker does not ask for, should one reach the drawing.
          { name: 'transit', extent: 4096, features: [line('highway', [10, 50], [100, 50])] },
          { name: 'boundaries', extent: 4096, features: [line('major_road', [10, 90], [100, 90])] },
        ],
      },
    ]);
    expect(drawn).toEqual({ highway: 2, major: 0, minor: 0, water: 0, rivers: 0 });
    expect(svg).toContain('<path class="as-r as-3" d="M10 10L100 10"/>');
    expect(svg).not.toContain('as-r as-2');
  });

  it('a river is a line in the water layer: a run of points typed as a point, or not typed, is not one', () => {
    // The decoder takes a feature's type and its commands as the tile gives
    // them, so a run of points can arrive typed as a point (1) or untyped (0).
    const run = (type: number, y: number) => ({
      type,
      props: {},
      geometry: [
        [
          [10, y],
          [100, y],
        ] as [number, number][],
      ],
    });
    const { svg, drawn } = drawStreetLayer(one, 0, [
      {
        x: 0,
        y: 0,
        layers: [{ name: 'water', extent: 4096, features: [run(2, 50), run(1, 90), run(0, 130)] }],
      },
    ]);
    expect(drawn).toEqual({ highway: 0, major: 0, minor: 0, water: 0, rivers: 2 });
    expect(svg).toContain('<path class="as-v" d="M10 50L100 50"/>');
    expect(svg).not.toContain('L100 90');
    expect(svg).not.toContain('L100 130');
  });

  it('the markup, to the character: nothing where nothing was drawn, parts end to end', () => {
    const blank = '<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="3">';
    const land = '<rect class="as-l" width="600" height="360"/>';
    expect(drawStreetLayer(one, 3, [])).toEqual({
      svg: `${blank}${land}</g>`,
      drawn: { highway: 0, major: 0, minor: 0, water: 0, rivers: 0 },
    });
    // Zoom 0 again: two lines of one kind are one path, one after the other.
    const svg = drawStreets(one, 0, [
      {
        x: 0,
        y: 0,
        layers: [
          {
            name: 'roads',
            extent: 4096,
            features: [
              line('minor_road', [10, 10], [100, 10]),
              line('minor_road', [20, 30], [90, 40]),
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
                    [0, 100],
                    [50, 100],
                    [50, 150],
                    [0, 100],
                  ],
                  [
                    [200, 100],
                    [250, 100],
                    [250, 150],
                    [200, 100],
                  ],
                ],
              },
              {
                type: 2,
                props: {},
                geometry: [
                  [
                    [0, 300],
                    [600, 310],
                  ],
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(svg).toBe(
      '<g class="amap-s" aria-hidden="true" data-testid="amap-streets" data-z="0">' +
        land +
        '<path class="as-w" d="M0 100L50 100L50 150L0 100ZM200 100L250 100L250 150L200 100Z"/>' +
        '<path class="as-v" d="M0 300L600 310"/>' +
        '<path class="as-r as-1" d="M10 10L100 10M20 30L90 40"/>' +
        '</g>'
    );
  });

  /** Steps down and to the right, 20 units a step: none of its points can be thinned. */
  const stairs = (x: number, y: number, steps: number, k = 1): [number, number][] =>
    Array.from({ length: steps * 2 + 1 }, (_, i): [number, number] => [
      Math.round((x + Math.ceil(i / 2) * 20) * k),
      Math.round((y + Math.floor(i / 2) * 20) * k),
    ]);
  const starts = (svg: string, cls: string) =>
    [
      ...(new RegExp(`<path class="${cls}" d="([^"]*)"`).exec(svg)?.[1] ?? '').matchAll(
        /M(-?\d+) (-?\d+)/g
      ),
    ].map((m) => [Number(m[1]), Number(m[2])] as const);

  it('past the coarsest thinning, the roads that reach furthest are the ones drawn', () => {
    // 100 short roads, listed first, low and to the right; 300 long ones. The
    // long ones alone are over the budget, so no short one is drawn.
    const short = Array.from({ length: 100 }, (_, j) =>
      line('highway', ...stairs(480 + (j % 10), 250 + Math.floor(j / 10), 5))
    );
    const long = Array.from({ length: 300 }, (_, j) =>
      line('highway', ...stairs((j % 40) * 7, Math.floor(j / 40) * 6, 15))
    );
    const { svg, drawn } = drawStreetLayer(one, 0, [
      { x: 0, y: 0, layers: [{ name: 'roads', extent: 4096, features: [...short, ...long] }] },
    ]);
    expect(drawn.highway).toBe(MAX_POINTS);
    const from = starts(svg, 'as-r as-3');
    // 290 long roads whole (31 points each) and the first 10 points of one more.
    expect(from).toHaveLength(291);
    expect(from.filter(([x]) => x >= 480)).toEqual([]);
  });

  it('equal roads in two tiles: the first of each tile, then the second of each, to the budget', () => {
    // Zoom 1, two tiles side by side, 300 units each. 640 equal roads in each
    // (15 points a road): the budget holds 600 roads, so 300 from each tile,
    // and from each tile the first 300 listed.
    const two: MapFrame = { w: 600, h: 360, scale: 600, x0: 0, y0: 0 };
    const k = (2 * 4096) / 600;
    const tileOf = (x: number): DecodedTile => ({
      x,
      y: 0,
      layers: [
        {
          name: 'roads',
          extent: 4096,
          features: Array.from({ length: 640 }, (_, j) =>
            line('major_road', ...stairs((j % 20) * 7, Math.floor(j / 20) * 6, 7, k))
          ),
        },
      ],
    });
    const { svg, drawn } = drawStreetLayer(two, 1, [tileOf(0), tileOf(1)]);
    expect(drawn.major).toBe(MAX_POINTS);
    const from = starts(svg, 'as-r as-2');
    expect(from).toHaveLength(600);
    expect(from.filter(([x]) => x < 300)).toHaveLength(300);
    const has = (x: number, y: number) => from.some(([fx, fy]) => fx === x && fy === y);
    // Road 0 and road 299 of each tile are in; road 300 and road 639 are not.
    expect([has(0, 0), has(300, 0), has(133, 84), has(433, 84)]).toEqual([true, true, true, true]);
    expect([has(0, 90), has(300, 90), has(133, 186), has(433, 186)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

// The floor under a layer (street-map CCR 2026-11-15, R7 and R18). A layer that
// is shown turns on the OpenStreetMap credit, lightens the hexagons and, in the
// zoomed area, turns on the dots. So a layer with no road to steer by is not
// shown at all: the page keeps its hexagons.
describe('street map | a layer too thin to read is no layer', () => {
  const drawn = (over: Partial<DrawnPoints>): DrawnPoints => ({
    highway: 0,
    major: 0,
    minor: 0,
    water: 0,
    rivers: 0,
    ...over,
  });

  it('the rule: a highway or a major road, and MIN_ROAD_POINTS of road in all', () => {
    expect(MIN_ROAD_POINTS).toBe(100);
    expect(layerShows(drawn({}))).toBe(false);
    // Water is not a street map, however much of it.
    expect(layerShows(drawn({ water: 8999, rivers: 500 }))).toBe(false);
    // What the old drawer drew for 19 areas of Manhattan, and for Chicago with New York.
    expect(layerShows(drawn({ water: 8999, major: 1 }))).toBe(false);
    expect(layerShows(drawn({ water: 8990, highway: 10 }))).toBe(false);
    // Streets with no road to steer by.
    expect(layerShows(drawn({ minor: 5000 }))).toBe(false);
    // Either main kind will do, and the count is of all three kinds together.
    expect(layerShows(drawn({ highway: 1, minor: 99 }))).toBe(true);
    expect(layerShows(drawn({ major: 1, minor: 99 }))).toBe(true);
    expect(layerShows(drawn({ highway: 1, minor: 98 }))).toBe(false);
    expect(layerShows(drawn({ major: 1, minor: 98 }))).toBe(false);
    expect(layerShows(drawn({ highway: 50, major: 50 }))).toBe(true);
    expect(layerShows(drawn({ highway: 100 }))).toBe(true);
    expect(layerShows(drawn({ major: 100 }))).toBe(true);
    expect(layerShows(drawn({ highway: 99 }))).toBe(false);
    // Water does not count toward the roads.
    expect(layerShows(drawn({ highway: 99, water: 5000, rivers: 5000 }))).toBe(false);
    // The thinnest real place measured: farmland in Nebraska, one area.
    expect(layerShows(drawn({ major: 32, minor: 304, water: 9, rivers: 137 }))).toBe(true);
  });

  /** A line of `points` points across a tile, swinging so that none is thinned or merged. */
  const across = (kind: string, points: number, y: number): FixtureLayer['features'][number] => ({
    type: 2,
    props: { kind },
    parts: [
      Array.from({ length: points }, (_, i): [number, number] => [
        Math.round((4096 * i) / (points - 1)),
        y + (i % 2 ? 300 : 0),
      ]),
    ],
  });
  const pond: FixtureLayer = {
    name: 'water',
    features: [
      {
        type: 3,
        props: { kind: 'lake' },
        parts: [
          [
            [0, 0],
            [4096, 0],
            [4096, 4096],
            [0, 4096],
            [0, 0],
          ],
        ],
      },
    ],
  };
  const layerOf = async (layers: FixtureLayer[]) => {
    const { tiles } = tilesOfFrame([BLUE7], () => layers);
    const archive = await pmtilesArchive(tiles, { gzip: true });
    return {
      built: await buildStreetLayer(memSource(archive), [BLUE7]),
      loaded: await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) },
        [BLUE7]
      ),
    };
  };

  it('tiles with nothing in them: no layer', async () => {
    const { built, loaded } = await layerOf([]);
    expect(built).toBeNull();
    expect(loaded).toBeNull();
  });

  it('water and no road: no layer', async () => {
    const { built, loaded } = await layerOf([pond]);
    expect(built).toBeNull();
    expect(loaded).toBeNull();
  });

  it('streets and no highway or major road: no layer', async () => {
    const { built, loaded } = await layerOf([
      pond,
      { name: 'roads', features: [across('minor_road', 60, 1000), across('minor_road', 60, 2000)] },
    ]);
    expect(built).toBeNull();
    expect(loaded).toBeNull();
  });

  it('a stub of highway and nothing else: no layer', async () => {
    const { built } = await layerOf([{ name: 'roads', features: [across('highway', 4, 1000)] }]);
    expect(built).toBeNull();
  });

  it('roads to steer by: a layer, which says what it drew', async () => {
    const { built, loaded } = await layerOf([
      pond,
      { name: 'roads', features: [across('major_road', 20, 1000), across('minor_road', 20, 2000)] },
    ]);
    expect(built).not.toBeNull();
    expect(loaded).toEqual(built);
    const n = (cls: string) =>
      (new RegExp(`<path class="${cls}" d="([^"]*)"`).exec(built!.svg)?.[1]?.match(/[ML]/g) ?? [])
        .length;
    expect(built!.drawn).toEqual({
      highway: 0,
      major: n('as-r as-2'),
      minor: n('as-r as-1'),
      water: n('as-w'),
      rivers: 0,
    });
    expect(built!.drawn.major).toBeGreaterThan(0);
    expect(built!.drawn.major + built!.drawn.minor).toBeGreaterThanOrEqual(MIN_ROAD_POINTS);
  });
});

// Street-map CCR 2026-11-15, R20: the Worker had no switch. The archive in the
// bucket was the switch, so the owner's load put streets on every page at once
// and the way back was a dashboard action or the binding taken out.
describe('street map | the switch (STREET_MAP)', () => {
  /** A bucket holding a sound archive for BLUE7, and the layer it draws. */
  const loaded = async () => {
    const { tiles } = tilesForCells([BLUE7]);
    const archive = await pmtilesArchive(tiles, { gzip: true, leaf: true });
    const drawn = await buildStreetLayer(memSource(archive), [BLUE7]);
    resetPmtilesCache();
    return { bucket: fakeBucket(DEFAULT_ARCHIVE, archive), drawn: drawn! };
  };

  it('the one value that draws is "on"', () => {
    expect(STREET_MAP_ON).toBe('on');
  });

  it('on: the layer is drawn from the archive, as before there was a switch', async () => {
    const { bucket, drawn } = await loaded();
    const layer = await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [BLUE7]);
    expect(layer).toEqual(drawn);
    expect(layer!.svg).toContain('class="as-r as-3"');
    // Header and root, the leaf directory, the tiles.
    expect(bucket.gets).toHaveLength(3);
    expect(new Set(bucket.gets.map((g) => g.key))).toEqual(new Set([DEFAULT_ARCHIVE]));
  });

  it('off: no layer, and the bucket is never asked, with a sound archive under the key', async () => {
    const { bucket } = await loaded();
    expect(await loadStreetLayer({ STREET_MAP: 'off', MAP_TILES: bucket }, [BLUE7])).toBeNull();
    expect(bucket.gets).toHaveLength(0);
    // The same bucket, switched on, draws: off was the switch, not the archive.
    expect(await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [BLUE7])).not.toBeNull();
  });

  it('no value is off', async () => {
    const { bucket } = await loaded();
    expect(await loadStreetLayer({ MAP_TILES: bucket }, [BLUE7])).toBeNull();
    expect(
      await loadStreetLayer({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: DEFAULT_ARCHIVE }, [BLUE7])
    ).toBeNull();
    expect(bucket.gets).toHaveLength(0);
  });

  it.each(['', 'ON', 'On', ' on', 'on ', 'onn', 'o', 'true', '1', 'yes', 'enabled', 'of', 'off '])(
    'a value that is not exactly "on" is off: %j',
    async (value) => {
      const { bucket } = await loaded();
      expect(await loadStreetLayer({ STREET_MAP: value, MAP_TILES: bucket }, [BLUE7])).toBeNull();
      expect(bucket.gets).toHaveLength(0);
    }
  );

  it('a value that is not a string is off', async () => {
    const { bucket } = await loaded();
    for (const value of [true, 1, ['on'], { on: true }]) {
      expect(
        await loadStreetLayer({ STREET_MAP: value, MAP_TILES: bucket } as never, [BLUE7])
      ).toBeNull();
    }
    expect(bucket.gets).toHaveLength(0);
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

  // OSE-2039: the public area map frames an area's neighbours and numbers only
  // the area. Born red 2026-11-14: with `numbered` dropped on the way from
  // loadStreetLayer to drawStreets, the town over the neighbour was not drawn.
  it('town names keep clear of the numbered cells only, when fewer are numbered than framed', async () => {
    const neighbour = gridDisk(BLUE7, 1).find((c) => c !== BLUE7)!;
    const framed = [BLUE7, neighbour];
    const f = frameForCells(framed);
    const z = tilesFor(f, 0, 15).z;
    const n = 2 ** z;
    // A town at the middle of the neighbouring cell, where its number would be.
    const [wx, wy] = toWorld(...cellToLatLng(neighbour));
    const tx = Math.floor(wx * n);
    const ty = Math.floor(wy * n);
    const at: [number, number] = [
      Math.round((wx * n - tx) * 4096),
      Math.round((wy * n - ty) * 4096),
    ];
    const { tiles } = tilesForCells(framed, (x, y) =>
      x === tx && y === ty
        ? [
            {
              name: 'places',
              features: [{ type: 1, props: { kind: 'locality', name: 'Nexto' }, parts: [[at]] }],
            },
          ]
        : []
    );
    const archive = await pmtilesArchive(tiles, { gzip: true });

    // Every framed cell numbered (the landing map): the name gives way.
    const all = await buildStreetLayer(memSource(archive), framed);
    expect(all!.svg).not.toContain('Nexto');
    // Only the area numbered: the name over the neighbour is drawn.
    const one = await buildStreetLayer(memSource(archive), framed, undefined, undefined, [BLUE7]);
    expect(one!.svg).toContain('>Nexto</text>');
    // Same frame, same tiles, same key either way.
    expect(one!.cellsKey).toBe(all!.cellsKey);
    expect(one!.svg.replace(/<text[^>]*>Nexto<\/text>/, '')).toBe(all!.svg);

    // And through the loader, which is what the handler calls.
    const env = { STREET_MAP: 'on', MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) };
    expect((await loadStreetLayer(env, framed))!.svg).toBe(all!.svg);
    resetPmtilesCache();
    expect((await loadStreetLayer(env, framed, { numbered: [BLUE7] }))!.svg).toBe(one!.svg);
  });

  it('no binding, or no cells: null', async () => {
    expect(await loadStreetLayer(undefined, [BLUE7])).toBeNull();
    expect(await loadStreetLayer(null, [BLUE7])).toBeNull();
    // Switched on, with nothing bound to read from.
    expect(await loadStreetLayer({ STREET_MAP: 'on' }, [BLUE7])).toBeNull();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(0));
    expect(await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [])).toBeNull();
    expect(bucket.gets).toHaveLength(0);
  });

  it('reads only the configured archive, and refuses a name that is not one', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    const archive = await pmtilesArchive(tiles);
    const bucket = fakeBucket('region-2026.pmtiles', archive);
    const layer = await loadStreetLayer(
      { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: 'region-2026.pmtiles' },
      [BLUE7]
    );
    expect(layer?.svg).toContain('data-testid="amap-streets"');
    expect(new Set(bucket.gets.map((g) => g.key))).toEqual(new Set(['region-2026.pmtiles']));
    // Every read is a bounded byte range, never the whole object.
    expect(bucket.gets.every((g) => g.range && g.range.length <= 16384 + 1_000_000)).toBe(true);

    const bad = fakeBucket('../uploads/x', archive);
    expect(
      await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: bad, MAP_TILES_ARCHIVE: '../uploads/x' },
        [BLUE7]
      )
    ).toBeNull();
    expect(bad.gets).toHaveLength(0);
  });

  it('a missing or damaged archive: null', async () => {
    expect(
      await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: fakeBucket('other.pmtiles', new Uint8Array(200)) },
        [BLUE7]
      )
    ).toBeNull();
    const junk = new Uint8Array(4096).fill(7);
    expect(
      await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, junk) }, [
        BLUE7,
      ])
    ).toBeNull();
    const { tiles } = tilesForCells([BLUE7]);
    const archive = await pmtilesArchive(
      tiles.map((t) => ({ ...t, data: new Uint8Array([0x1a, 0xff]) }))
    );
    expect(
      await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, archive) }, [
        BLUE7,
      ])
    ).toBeNull();
  });

  // An archive that asks the Worker to hold more than the reader allows
  // (lib/pmtiles.ts, the limits) is a refused read, and a refused read is
  // hexagons only. Born red 2026-11-14: with the tile unpacked to any length the
  // archive with one tile a byte over its limit drew its streets; with the
  // root's stated length not checked, the last one asked the bucket for 2 MiB
  // and one byte.
  it('an archive past the reader limits: null, and nothing past a limit is asked for', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    // One tile of the frame is a good tile that unpacks to `size` bytes (a few
    // KB of gzip); the others are as they were.
    const withOneTileOf = (size: number) =>
      pmtilesArchive(
        tiles.map((t, i) => (i === 0 ? { ...t, data: paddedTile(t.data, size) } : t)),
        { gzip: true }
      );
    // At the limit it is a tile like any other, so what refuses the next
    // archive is the limit and not the padding.
    const atLimit = fakeBucket(DEFAULT_ARCHIVE, await withOneTileOf(MAX_TILE_UNPACKED_BYTES));
    const drawn = await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: atLimit }, [BLUE7], {
      timeoutMs: 60_000,
    });
    expect(drawn?.svg).toContain('<path');

    // One byte more in one tile, and the frame has no streets at all.
    resetPmtilesCache();
    const over = fakeBucket(DEFAULT_ARCHIVE, await withOneTileOf(MAX_TILE_UNPACKED_BYTES + 1));
    expect(
      await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: over }, [BLUE7], { timeoutMs: 60_000 })
    ).toBeNull();
    expect(over.gets.length).toBeGreaterThan(0);

    // The same tiles as they are, behind a root directory stated over its limit.
    // (The archive before it is kept under the same name: forget it.)
    resetPmtilesCache();
    const stated = await pmtilesArchive(tiles);
    new DataView(stated.buffer).setUint32(16, MAX_DIRECTORY_BYTES + 1, true);
    const second = fakeBucket(DEFAULT_ARCHIVE, stated);
    expect(await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: second }, [BLUE7])).toBeNull();
    expect(second.gets.map((g) => g.range?.length)).toEqual([16384]);
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
    expect(await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [BLUE7])).toBeNull();
    // It was read, and it is not a damaged file: its own cells draw.
    expect(bucket.gets.length).toBeGreaterThan(0);
    const own = await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [FAR7]);
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
    const env = { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: name };
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

  // Tiles that sit back to back in the file are one read, not one read each
  // (2026-11-10). In the planet build the 12 tiles of a zoomed area are back to
  // back; read one by one a first map cost 14 reads. Born red: on the reader
  // that read each tile by itself this case counted 14 reads from cold and 12 warm.
  it('a first map is three reads (header, leaf directory, the tiles together); the next map of the area is one', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    expect(tiles.length).toBeGreaterThan(6);
    const archive = await pmtilesArchive(tiles, { gzip: true, leaf: true });
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    const first = await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [BLUE7]);
    expect(first?.svg).toContain('data-testid="amap-streets"');
    expect(bucket.gets).toHaveLength(3);
    // The same drawing as when every tile is a read of its own (the tiles 1 MiB
    // apart in the file, past the gap that is read through).
    const apart = await planetArchive(
      tiles.map((t, i) => ({ ...t, at: i * 2 ** 20 })),
      { leafSize: 4, fanOut: 2, leafAt: 3 * 2 ** 20, dataAt: 5 * 2 ** 30 }
    );
    const apartSrc = sparseSource(apart.file);
    expect(await buildStreetLayer(apartSrc, [BLUE7])).toEqual(first);
    expect(apartSrc.reads.filter(([off]) => off >= 5 * 2 ** 30)).toHaveLength(tiles.length);
    expect(first!.svg.match(/M-?\d+ -?\d+L/g)!.length).toBeGreaterThanOrEqual(tiles.length);
    expect(await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [BLUE7])).toEqual(first);
    expect(bucket.gets).toHaveLength(4);
    // The one tile read is every tile's bytes and nothing else.
    const tileRead = bucket.gets[3]!.range!;
    expect(tileRead.length).toBeLessThan(archive.length);
    expect(tileRead.offset + tileRead.length).toBeLessThanOrEqual(archive.length);
  });

  // street-map CCR 2026-11-15, R15. Until then one tile of the frame was
  // enough for a layer, so a frame that reached past the archive's region drew
  // streets on one side and blank land on the other, under the credit. A build
  // that leaves no gap inside its region has gaps only at the edge of what was
  // cut. Born red 2026-11-15: with main's lines put back, the archives below
  // drew a layer.
  it('every tile of the frame, or no layer: with any one tile missing the map is hexagons only', async () => {
    const { r, tiles } = tilesForCells([BLUE7]);
    expect(tiles.length).toBeGreaterThan(1);
    // The control: with every tile, the same frame draws.
    const whole = await pmtilesArchive(tiles, { gzip: true });
    expect((await buildStreetLayer(memSource(whole), [BLUE7]))?.svg).toContain(
      'data-testid="amap-streets"'
    );
    for (let gone = 0; gone < tiles.length; gone++) {
      const archive = await pmtilesArchive(
        tiles.filter((_, i) => i !== gone),
        { gzip: true }
      );
      // Null, not an error: the archive is sound, it only ends here.
      expect(await readStreetDrawing(memSource(archive), [BLUE7]), `tile ${gone}`).toBeNull();
      expect(await buildStreetLayer(memSource(archive), [BLUE7]), `tile ${gone}`).toBeNull();
      resetPmtilesCache();
      const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
      expect(
        await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, [BLUE7]),
        `tile ${gone}`
      ).toBeNull();
      expect(bucket.gets.length).toBeGreaterThan(0);
    }
    // The tile under the middle of the frame alone, whose highway and street
    // cross the map: what used to be enough.
    const [wx, wy] = toWorld(...cellToLatLng(BLUE7));
    const mid = tiles.filter(
      (t) => t.x === Math.floor(wx * 2 ** r.z) && t.y === Math.floor(wy * 2 ** r.z)
    );
    expect(mid).toHaveLength(1);
    expect(await buildStreetLayer(memSource(await pmtilesArchive(mid)), [BLUE7])).toBeNull();
  });

  // street-map CCR 2026-11-15, R5. The public area map refused a frame wider
  // than a street map can show; the landing did not. The floor is the loader's,
  // so every caller has it.
  it('a frame wider than a street map can show reads nothing and is no layer', async () => {
    const framed = [BLUE7, FAR7];
    expect(frameZoom(frameForCells(framed))).toBeLessThan(MIN_STREET_ZOOM);
    const { tiles } = tilesForCells(framed);
    const archive = await pmtilesArchive(tiles, { gzip: true });
    // The tiles are there and they draw: only the width refuses them.
    expect(await buildStreetLayer(memSource(archive), framed)).not.toBeNull();
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    expect(await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, framed)).toBeNull();
    expect(bucket.gets).toHaveLength(0);
  });

  it('the floor is zoom 7: a frame read at zoom 7 draws, one read at zoom 6 does not', async () => {
    expect(MIN_STREET_ZOOM).toBe(7);
    /** Blue Island and an area due east of it, far enough for the frame to be read at `z`. */
    const pairAt = (z: number): string[] => {
      for (let d = 0.2; d < 30; d += 0.2) {
        const pair = [BLUE7, latLngToCell(BLUE.lat, BLUE.lon + d, 7)];
        if (frameZoom(frameForCells(pair)) === z) return pair;
      }
      throw new Error(`no pair of areas is read at zoom ${z}`);
    };
    for (const [z, draws] of [
      [8, true],
      [7, true],
      [6, false],
      [5, false],
    ] as const) {
      // Each archive is another file under the same name: forget the last one's directory.
      resetPmtilesCache();
      const framed = pairAt(z);
      const { r, tiles } = tilesForCells(framed);
      expect(r.z).toBeLessThanOrEqual(z);
      const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
      const layer = await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, framed);
      expect(layer !== null).toBe(draws);
      expect(bucket.gets.length > 0).toBe(draws);
    }
  });

  it('the zoom of a frame is the one whose tiles are about 256 units across in it', () => {
    const at = (scale: number) => frameZoom({ w: 600, h: 360, scale, x0: 0, y0: 0 });
    expect(at(256)).toBe(0);
    expect(at(256 * 2 ** 7)).toBe(7);
    // Rounded to the nearer zoom, in powers of two.
    expect(at(256 * 2 ** 6.49)).toBe(6);
    expect(at(256 * 2 ** 6.51)).toBe(7);
    expect(at(256 * 2 ** 12.3)).toBe(12);
  });

  it('a slow archive: null, on time', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    // Its own archive name. A read that times out is abandoned, not stopped: it
    // goes on in the background, and 200 ms later opens the archive again under
    // its name. Under the default name that handed this bucket's directories to
    // whichever later case read the default file next (seen in CI, 2026-11-10).
    const name = 'slow.pmtiles';
    const slow = fakeBucket(name, await pmtilesArchive(tiles), { delayMs: 200 });
    const t0 = Date.now();
    expect(
      await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: slow, MAP_TILES_ARCHIVE: name },
        [BLUE7],
        {
          timeoutMs: 50,
        }
      )
    ).toBeNull();
    expect(Date.now() - t0).toBeLessThan(180);
    // It was the read that was slow, not the name that was refused.
    expect(slow.gets.length).toBeGreaterThan(0);
    // The abandoned read ends here, not inside a later case (fakeBucket.settle).
    await slow.settle();
  });

  it('a slow archive, settled: the abandoned read starts no timer after its case', async () => {
    const { tiles } = tilesForCells([BLUE7]);
    const slow = fakeBucket('settled.pmtiles', await pmtilesArchive(tiles), { delayMs: 200 });
    expect(
      await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: slow, MAP_TILES_ARCHIVE: 'settled.pmtiles' },
        [BLUE7],
        {
          timeoutMs: 50,
        }
      )
    ).toBeNull();
    await slow.settle();
    // What the next case does: fake timers, then time passes. An unsettled read
    // lands its first range within 200 ms and asks for the next one on a fake
    // timer, which this count sees.
    const realSetTimeout = globalThis.setTimeout;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await new Promise((r) => realSetTimeout(r, 450));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The archive read, class by class (owner 2026-11-10): what a hand can mistype
// in MAP_TILES_ARCHIVE, what a hostile name may not reach, and how a read over
// the network goes wrong. Every one ends the same way: no layer, no throw, so
// the page draws its hexagons. Sunny and rainy cases are in the block above.
// street-map CCR 2026-11-15, R2. The reader limits a tile's bytes; the decoder
// (lib/mvt.ts) limits what one tile's bytes may become, and FRAME_LIMITS what
// the tiles of one frame may become together. Past either the read is refused,
// and a refused read is hexagons only. Born red 2026-11-15: with the frame
// limit not passed to the decoder, and with the tile limit taken out, the "one
// point more" archive of that case drew its streets.
describe('street map | more in the tiles than the Worker will decode', () => {
  // Two areas: a frame of at least three tiles, so the frame limit (two tiles'
  // worth) can be passed with every tile inside its own.
  const CELLS = [BLUE7, NORTH7];
  const WANTED = new Set(['water', 'roads', 'places']);
  const pointsIn = (data: Uint8Array): number =>
    decodeTile(data, WANTED)
      .flatMap((l) => l.features)
      .flatMap((f) => f.geometry)
      .reduce((n, part) => n + part.length, 0);
  /** A road of `n` points of a kind the map does not draw: decoded and counted, never drawn. */
  const filler = (n: number): FixtureLayer[] =>
    n === 0
      ? []
      : [
          {
            name: 'roads',
            features: [
              {
                type: 2,
                props: { kind: 'path' },
                parts: [
                  Array.from({ length: n }, (_, i): [number, number] => [i % 4096, (i * 7) % 4096]),
                ],
              },
            ],
          },
        ];
  /** The frame's tiles, each with `extra(i)` more points than the plain fixture tile. */
  const framed = (extra: (i: number) => number) => {
    const plain = tilesForCells(CELLS).tiles;
    const index = new Map(plain.map((t, i) => [`${t.x},${t.y}`, i]));
    return tilesForCells(CELLS, (x, y) => filler(extra(index.get(`${x},${y}`)!))).tiles;
  };
  const load = async (tiles: ReturnType<typeof framed>) => {
    resetPmtilesCache();
    const archive = await pmtilesArchive(tiles, { gzip: true });
    const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
    const layer = await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, CELLS, {
      timeoutMs: 60_000,
    });
    return { archive, bucket, layer };
  };

  it("a frame may hold twice what one tile may, and the limits are the source's", () => {
    expect(FRAME_LIMITS).toEqual({ features: 60_000, points: 300_000, props: 300_000 });
    expect(Object.isFrozen(FRAME_LIMITS)).toBe(true);
    for (const kind of ['features', 'points', 'props'] as const) {
      expect(FRAME_LIMITS[kind]).toBe(2 * TILE_LIMITS[kind]);
    }
  });

  it('the tiles of a frame together: exactly the frame limit is drawn, and one point more is hexagons only', async () => {
    const plain = tilesForCells(CELLS).tiles;
    const count = plain.length;
    expect(count).toBeGreaterThanOrEqual(3);
    const base = pointsIn(plain[0]!.data);
    expect(plain.every((t) => pointsIn(t.data) === base)).toBe(true);
    // The frame limit shared out evenly, the remainder on the last tile.
    const share = Math.floor(FRAME_LIMITS.points / count);
    const last = FRAME_LIMITS.points - share * (count - 1);
    const sharedOut = (over: number) =>
      framed((i) => (i === count - 1 ? last + over : share) - base);

    const atLimit = sharedOut(0);
    const each = atLimit.map((t) => pointsIn(t.data));
    expect(each.reduce((a, b) => a + b, 0)).toBe(FRAME_LIMITS.points);
    // No tile is near its own limit: what refuses the next archive is the frame's.
    expect(Math.max(...each)).toBeLessThan(TILE_LIMITS.points);
    const drawn = await load(atLimit);
    expect(drawn.layer?.svg).toContain('data-testid="amap-streets"');

    const over = await load(sharedOut(1));
    expect(over.layer).toBeNull();
    expect(over.bucket.gets.length).toBeGreaterThan(0);
    await expect(readStreetDrawing(memSource(over.archive), CELLS)).rejects.toThrow(
      new MvtError('too many points in one frame')
    );
  });

  it('one tile: exactly the tile limit is drawn, and one point more in it is hexagons only', async () => {
    const base = pointsIn(tilesForCells(CELLS).tiles[0]!.data);
    const oneTile = (over: number) =>
      framed((i) => (i === 0 ? TILE_LIMITS.points - base + over : 0));

    const atLimit = oneTile(0);
    expect(pointsIn(atLimit[0]!.data)).toBe(TILE_LIMITS.points);
    const drawn = await load(atLimit);
    expect(drawn.layer?.svg).toContain('data-testid="amap-streets"');

    const over = await load(oneTile(1));
    expect(over.layer).toBeNull();
    expect(over.bucket.gets.length).toBeGreaterThan(0);
    await expect(readStreetDrawing(memSource(over.archive), CELLS)).rejects.toThrow(
      new MvtError('too many points in one tile')
    );
  });
});

// street-map CCR 2026-11-15, R49. Three places where the frame's arithmetic
// could go wrong and no test stood: the antimeridian, the twelve pentagons, and
// the far north, where Web Mercator stretches and then ends. Each case pins
// what the frame does there today.
describe('street map | the edges of the world', () => {
  const finite = (f: MapFrame) => [f.scale, f.x0, f.y0].every(Number.isFinite);
  const tileCount = (r: ReturnType<typeof tilesFor>) =>
    (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
  const corners = (f: MapFrame, cell: string) =>
    cellToBoundary(cell).map(([lat, lng]) => project(f, lat, lng));
  const draws = async (cells: string[]) => {
    resetPmtilesCache();
    const { tiles } = tilesForCells(cells);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    return { bucket, layer: await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket }, cells) };
  };

  // The frame takes the least and the greatest longitude of the corners, so an
  // area with corners on both sides of 180° is framed as if it ran the long way
  // round. That is a frame far wider than a street map can show: nothing is
  // read and the map is hexagons only. (An unwrapped frame would draw this
  // area; this case is then the one to change.)
  it('an area on the antimeridian frames the whole world: nothing is read, hexagons only', async () => {
    // West of Semisopochnoi Island, Alaska.
    const cell = latLngToCell(52, 180, 7);
    const lngs = cellToBoundary(cell).map(([, lng]) => lng);
    expect(Math.min(...lngs)).toBeLessThan(-179.9);
    expect(Math.max(...lngs)).toBeGreaterThan(179.9);
    const f = frameForCells([cell]);
    expect(finite(f)).toBe(true);
    expect(frameZoom(f)).toBe(1);
    const r = tilesFor(f);
    expect(r).toEqual({ z: 1, xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
    const { bucket, layer } = await draws([cell]);
    expect(layer).toBeNull();
    expect(bucket.gets).toHaveLength(0);
    // Its neighbour a little to the east, wholly on one side, is framed alone and drawn.
    const east = latLngToCell(51.95, 179.6, 7);
    expect(frameZoom(frameForCells([east]))).toBe(13);
    expect((await draws([east])).layer?.svg).toContain('data-testid="amap-streets"');
  });

  it('a pentagon is framed by all of its corners, and drawn like any other area', async () => {
    // In the Norwegian Sea, 64.7° N 10.5° E. At resolution 7 its outline has ten points.
    const pent = getPentagons(7)[0]!;
    expect(isPentagon(pent)).toBe(true);
    const f = frameForCells([pent]);
    expect(finite(f)).toBe(true);
    const drawn = corners(f, pent);
    expect(drawn).toHaveLength(10);
    // Fitted with 8% of padding: the corners touch the padding on the tight
    // side and none is outside it.
    const xs = drawn.map((c) => c[0]);
    const ys = drawn.map((c) => c[1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(f.w * 0.08 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(f.w * 0.92 + 1e-6);
    expect(Math.min(...ys)).toBeCloseTo(f.h * 0.08, 6);
    expect(Math.max(...ys)).toBeCloseTo(f.h * 0.92, 6);
    expect(frameZoom(f)).toBe(13);
    expect(tileCount(tilesFor(f))).toBeLessThanOrEqual(MAX_TILES);
    const { layer } = await draws([pent]);
    expect(layer?.cellsKey).toBe(pent);
    expect(layer?.svg).toContain('data-testid="amap-streets"');
  });

  it('the far north: stretched but framed and drawn up to the Mercator limit, and held on the top row past it', async () => {
    // Utqiagvik, Alaska (71.3° N) and Alert, Nunavut (82.5° N): inside Web Mercator.
    for (const [lat, lng, zoom] of [
      [71.29, -156.79, 12],
      [82.5, -62.3, 11],
    ] as const) {
      const cell = latLngToCell(lat, lng, 7);
      const f = frameForCells([cell]);
      expect(finite(f), `${lat}`).toBe(true);
      // The same area is read two or three zooms further out than at Chicago's
      // latitude (14): the projection has stretched it.
      expect(frameZoom(f), `${lat}`).toBe(zoom);
      const ys = corners(f, cell).map((c) => c[1]);
      expect(Math.min(...ys), `${lat}`).toBeCloseTo(f.h * 0.08, 6);
      expect(Math.max(...ys), `${lat}`).toBeCloseTo(f.h * 0.92, 6);
      const r = tilesFor(f);
      expect(tileCount(r), `${lat}`).toBeLessThanOrEqual(MAX_TILES);
      expect(r.yMin, `${lat}`).toBeGreaterThan(0);
      expect((await draws([cell])).layer?.svg, `${lat}`).toContain('data-testid="amap-streets"');
    }
    // 89° N is past the limit (85.05°): every corner is held at the top edge of
    // the world, so the area has no height. The frame is still a frame, its
    // tiles are the top row, and the read is an ordinary read.
    const polar = latLngToCell(89, -62.3, 7);
    const f = frameForCells([polar]);
    expect(finite(f)).toBe(true);
    const ys = corners(f, polar).map((c) => c[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
    expect(ys[0]).toBeCloseTo(f.h / 2, 6);
    const r = tilesFor(f);
    expect([r.yMin, r.yMax]).toEqual([0, 0]);
    expect(r.xMin).toBeGreaterThanOrEqual(0);
    expect(tileCount(r)).toBeLessThanOrEqual(MAX_TILES);
    const { bucket, layer } = await draws([polar]);
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(layer?.svg).toContain('data-testid="amap-streets"');
  });
});

describe('street map | the archive read: fat fingers, security, network', () => {
  // The name wrangler.toml sets: the United States subset (owner 2026-11-10).
  const CONFIGURED = 'us-20261109.pmtiles';
  const sound = async (opts: { gzip?: boolean; leaf?: boolean } = { gzip: true, leaf: true }) =>
    pmtilesArchive(tilesForCells([BLUE7]).tiles, opts);
  const drawn = (layer: Awaited<ReturnType<typeof loadStreetLayer>>) =>
    layer?.svg.includes('data-testid="amap-streets"') === true;

  /** How many gets a first map costs, and which get is which. */
  async function dryRun(archive: Uint8Array) {
    const b = scriptedBucket(CONFIGURED, archive, () => 'ok');
    expect(
      drawn(
        await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: b, MAP_TILES_ARCHIVE: CONFIGURED }, [
          BLUE7,
        ])
      )
    ).toBe(true);
    resetPmtilesCache();
    return b.gets.length;
  }

  // ── fat fingers ────────────────────────────────────────────────────────────
  // The bucket holds a sound archive under the mistyped name itself, so a
  // reader that skipped the name rule would draw it.
  it.each([
    ['a capital letter', 'Us-20261109.pmtiles'],
    ['the extension in capitals', 'us-20261109.PMTILES'],
    ['a space in front', ' us-20261109.pmtiles'],
    ['a space after', 'us-20261109.pmtiles '],
    ['a line break after', 'us-20261109.pmtiles\n'],
    ['a tab after', 'us-20261109.pmtiles\t'],
    ['a space inside', 'us 20261109.pmtiles'],
    ['a comma for the full stop', 'us-20261109,pmtiles'],
    ['no extension', 'us-20261109'],
    ['the extension cut short', 'us-20261109.pmtile'],
    ['a second extension', 'us-20261109.pmtiles.bak'],
    ['only the extension', '.pmtiles'],
    ['a hyphen first', '-us-20261109.pmtiles'],
    ['the quotes kept', '"us-20261109.pmtiles"'],
    ['the bucket pasted in front', 'ose-map-tiles/us-20261109.pmtiles'],
    ['the rclone target pasted whole', 'r2:ose-map-tiles/us-20261109.pmtiles'],
    ['the download address pasted', 'https://build.protomaps.com/20261109.pmtiles'],
    ['spaces only', '   '],
  ])(
    'fat finger: %s is not an archive name: no layer, and the bucket is never asked',
    async (_, name) => {
      const bucket = fakeBucket(name, await sound());
      expect(
        await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: name }, [
          BLUE7,
        ])
      ).toBeNull();
      expect(bucket.gets).toHaveLength(0);
    }
  );

  it('fat finger: a well-formed name with the wrong date finds no object: no layer, one read, no throw', async () => {
    const bucket = fakeBucket(CONFIGURED, await sound());
    const env = { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: 'us-20261190.pmtiles' };
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(bucket.gets.map((g) => g.key)).toEqual(['us-20261190.pmtiles']);
    // Control: the right date draws from the same bucket.
    expect(drawn(await loadStreetLayer({ ...env, MAP_TILES_ARCHIVE: CONFIGURED }, [BLUE7]))).toBe(
      true
    );
  });

  it('edge: an empty setting reads the default regional file; a name of 89 characters draws and 90 does not', async () => {
    const archive = await sound();
    const byDefault = fakeBucket(DEFAULT_ARCHIVE, archive);
    expect(
      drawn(
        await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: byDefault, MAP_TILES_ARCHIVE: '' }, [
          BLUE7,
        ])
      )
    ).toBe(true);
    expect(new Set(byDefault.gets.map((g) => g.key))).toEqual(new Set([DEFAULT_ARCHIVE]));

    // One first character, up to 80 more, then ".pmtiles".
    const longest = `a${'b'.repeat(80)}.pmtiles`;
    const tooLong = `a${'b'.repeat(81)}.pmtiles`;
    expect(longest).toHaveLength(89);
    resetPmtilesCache();
    const ok = fakeBucket(longest, archive);
    expect(
      drawn(
        await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: ok, MAP_TILES_ARCHIVE: longest }, [
          BLUE7,
        ])
      )
    ).toBe(true);
    const over = fakeBucket(tooLong, archive);
    expect(
      await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: over, MAP_TILES_ARCHIVE: tooLong }, [
        BLUE7,
      ])
    ).toBeNull();
    expect(over.gets).toHaveLength(0);
  });

  it('edge: a read that has finished leaves no timer running, drawn or not', async () => {
    const archive = await sound();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const good = fakeBucket(CONFIGURED, archive);
      expect(
        drawn(
          await loadStreetLayer(
            { STREET_MAP: 'on', MAP_TILES: good, MAP_TILES_ARCHIVE: CONFIGURED },
            [BLUE7]
          )
        )
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      resetPmtilesCache();
      const junk = fakeBucket(CONFIGURED, new Uint8Array(4096).fill(7));
      expect(
        await loadStreetLayer(
          { STREET_MAP: 'on', MAP_TILES: junk, MAP_TILES_ARCHIVE: CONFIGURED },
          [BLUE7]
        )
      ).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('edge: the limit for the whole read is 1.5 s, and a read inside it draws', async () => {
    expect(STREET_TIMEOUT_MS).toBe(1500);
    const bucket = scriptedBucket(CONFIGURED, await sound(), () => ({ delayMs: 5 }));
    expect(
      drawn(
        await loadStreetLayer(
          { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED },
          [BLUE7]
        )
      )
    ).toBe(true);
  });

  // ── security ───────────────────────────────────────────────────────────────
  // MAP_TILES_ARCHIVE is a deploy setting, not visitor input. The rule still
  // holds against a hostile value: one object, by a plain name, and no other.
  it.each([
    ['a path up and out', '../uploads/x.pmtiles'],
    ['a path up and out, percent-encoded', '..%2fuploads%2fx.pmtiles'],
    ['a path through a folder', 'a/../planet.pmtiles'],
    ['a leading slash', '/planet.pmtiles'],
    ['a backslash path', '..\\uploads\\x.pmtiles'],
    ['a NUL before the extension', 'planet\u0000.pmtiles'],
    ['a NUL after the extension', 'planet.pmtiles\u0000'],
    ['a query string', 'planet.pmtiles?versionId=1'],
    ['a fragment', 'planet.pmtiles#x'],
    ['a percent-encoded letter', '%70lanet.pmtiles'],
    ['a Cyrillic letter that looks Latin', 'plаnet.pmtiles'],
    ['a full-width letter', 'ｐlanet.pmtiles'],
    ['a second line that is a good name', 'x\nplanet.pmtiles'],
    ['a good name on the first of two lines', 'planet.pmtiles\nx'],
  ])('security: %s is refused before any read', async (_, name) => {
    const bucket = fakeBucket(name, await sound());
    expect(
      await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: name }, [
        BLUE7,
      ])
    ).toBeNull();
    expect(bucket.gets).toHaveLength(0);
  });

  // Born red 2026-11-10: the road class was looked up on a plain object, so a
  // kind named after an Object property found Object's own member, not a class,
  // and the draw threw. Fail soft held (no layer, the page stood), but one odd
  // feature in one tile took the streets away from the whole area.
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'security: a road whose kind is "%s" is dropped, and the rest of the layer still draws',
    async (kind) => {
      const { tiles } = tilesForCells([BLUE7], () => [
        {
          name: 'roads',
          features: [
            {
              type: 2,
              props: { kind },
              parts: [
                [
                  [0, 1000],
                  [4096, 1000],
                ],
              ],
            },
          ],
        },
      ]);
      const honest = await loadStreetLayer(
        {
          STREET_MAP: 'on',
          MAP_TILES: fakeBucket(CONFIGURED, await sound()),
          MAP_TILES_ARCHIVE: CONFIGURED,
        },
        [BLUE7]
      );
      resetPmtilesCache();
      const bucket = fakeBucket(
        CONFIGURED,
        await pmtilesArchive(tiles, { gzip: true, leaf: true })
      );
      const layer = await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED },
        [BLUE7]
      );
      expect(drawn(layer)).toBe(true);
      // The odd road added nothing: the layer is the one honest tiles give.
      expect(layer).toEqual(honest);
    }
  );

  it('security: only MAP_TILES is read; a bucket bound beside it is never asked', async () => {
    const archive = await sound();
    const tilesBucket = fakeBucket(CONFIGURED, archive);
    const uploads = fakeBucket(CONFIGURED, archive);
    const env = {
      STREET_MAP: 'on',
      MAP_TILES: tilesBucket,
      MAP_TILES_ARCHIVE: CONFIGURED,
      UPLOADS_BUCKET: uploads,
    };
    expect(drawn(await loadStreetLayer(env, [BLUE7]))).toBe(true);
    expect(uploads.gets).toHaveLength(0);
    expect(new Set(tilesBucket.gets.map((g) => g.key))).toEqual(new Set([CONFIGURED]));
    // With no MAP_TILES, the other bucket is still not a fallback.
    resetPmtilesCache();
    expect(
      await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES_ARCHIVE: CONFIGURED, UPLOADS_BUCKET: uploads } as never,
        [BLUE7]
      )
    ).toBeNull();
    expect(uploads.gets).toHaveLength(0);
  });

  it('security: never who: the reads depend on the cells alone, and no read names a place finer than a tile', async () => {
    const a = fakeBucket(CONFIGURED, await sound());
    const b = fakeBucket(CONFIGURED, await sound());
    await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: a, MAP_TILES_ARCHIVE: CONFIGURED }, [
      BLUE7,
    ]);
    resetPmtilesCache();
    await loadStreetLayer({ STREET_MAP: 'on', MAP_TILES: b, MAP_TILES_ARCHIVE: CONFIGURED }, [
      BLUE7,
    ]);
    // Two cold isolates asked for the same area ask R2 for the same byte ranges.
    const ranges = (g: typeof a.gets) =>
      g.map((x) => `${x.range!.offset}+${x.range!.length}`).sort();
    expect(ranges(b.gets)).toEqual(ranges(a.gets));
    // A get carries a key and a byte range, nothing else.
    for (const g of a.gets) expect(Object.keys(g).sort()).toEqual(['key', 'range']);
  });

  // ── network ────────────────────────────────────────────────────────────────
  it('network: R2 fails on the first read: no layer, no throw; the next request opens the archive again and draws', async () => {
    const bucket = scriptedBucket(CONFIGURED, await sound(), (n) => (n === 0 ? 'throw' : 'ok'));
    const env = { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED };
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(bucket.gets).toHaveLength(1);
    expect(drawn(await loadStreetLayer(env, [BLUE7]))).toBe(true);
  });

  it.each([
    ['R2 fails', 'throw'],
    ['R2 says the object is gone', 'missing'],
    ['the body breaks after the answer began', 'body-fails'],
  ] as const)(
    'network: %s on the last tile read: no layer (nothing half-drawn); the next request draws',
    async (_, step) => {
      const archive = await sound();
      const last = (await dryRun(archive)) - 1;
      expect(last).toBeGreaterThan(1);
      const bucket = scriptedBucket(CONFIGURED, archive, (n) => (n === last ? step : 'ok'));
      const env = { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED };
      expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
      expect(bucket.gets).toHaveLength(last + 1);
      expect(drawn(await loadStreetLayer(env, [BLUE7]))).toBe(true);
    }
  );

  it.each([
    ['the header (100 of its 127 bytes)', 0, 100],
    ['the leaf directory (half of it)', 1, null],
    ['a tile (half of it)', -1, null],
  ] as const)('network: a short answer for %s is no layer, no throw', async (_, which, to) => {
    const archive = await sound();
    const count = await dryRun(archive);
    const at = which < 0 ? count + which : which;
    const bucket = scriptedBucket(CONFIGURED, archive, (n, range) =>
      n === at ? { shortTo: to ?? Math.floor(range!.length / 2) } : 'ok'
    );
    expect(
      await loadStreetLayer(
        { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED },
        [BLUE7]
      )
    ).toBeNull();
    expect(bucket.gets.length).toBeGreaterThan(at);
  });

  it('network: one late tile read makes the whole layer late: no layer, on time; the next request draws', async () => {
    // Not gzipped, so the read that is abandoned below has nothing to wait for
    // once its late answer lands, and ends inside this test (see the last lines).
    const archive = await sound({ gzip: false, leaf: true });
    const last = (await dryRun(archive)) - 1;
    const bucket = scriptedBucket(CONFIGURED, archive, (n) =>
      n === last ? { delayMs: 400 } : 'ok'
    );
    let landed!: () => void;
    const late = new Promise<void>((r) => (landed = r));
    const get = bucket.get.bind(bucket);
    bucket.get = async (k, o) => {
      const n = bucket.gets.length;
      const out = await get(k, o);
      if (n === last) landed();
      return out;
    };
    const env = { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED };
    const t0 = Date.now();
    expect(await loadStreetLayer(env, [BLUE7], { timeoutMs: 60 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(300);
    expect(drawn(await loadStreetLayer(env, [BLUE7], { timeoutMs: 2000 }))).toBe(true);
    // The first read was abandoned, not stopped. Wait for its late answer and
    // one turn of the event loop, so it draws here and not under a later test.
    await late;
    await new Promise<void>((r) => setTimeout(r, 0));
  });

  // 2026-11-15: each request reads for itself. A read in flight belongs to the
  // request that asked, and the Workers runtime drops it when that request ends,
  // so neither may wait on the other's (tests/street-map-runtime.spec.ts).
  it('network: two requests for one area in a cold isolate each read the header, and both draw', async () => {
    const bucket = scriptedBucket(CONFIGURED, await sound(), () => ({ delayMs: 5 }));
    const env = { STREET_MAP: 'on', MAP_TILES: bucket, MAP_TILES_ARCHIVE: CONFIGURED };
    const [one, two] = await Promise.all([
      loadStreetLayer(env, [BLUE7]),
      loadStreetLayer(env, [BLUE7]),
    ]);
    expect(drawn(one)).toBe(true);
    expect(two).toEqual(one);
    expect(bucket.gets.filter((g) => g.range!.offset === 0)).toHaveLength(2);
    // The directories are kept once whole: a third request reads the tiles only.
    const before = bucket.gets.length;
    expect(drawn(await loadStreetLayer(env, [BLUE7]))).toBe(true);
    expect(bucket.gets.length - before).toBe(1);
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
      { STREET_MAP: 'on', MAP_TILES: fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles)) },
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
    expect(out.html).toContain('href="https://www.openstreetmap.org/copyright/en"');
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
