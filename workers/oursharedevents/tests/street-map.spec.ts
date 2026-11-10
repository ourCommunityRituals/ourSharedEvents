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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cellToLatLng, latLngToCell } from 'h3-js';
import {
  DEFAULT_ARCHIVE,
  MAX_LABELS,
  MAX_POINTS,
  MAX_TILES,
  MAX_ZOOM,
  STREET_STYLE,
  STREET_TIMEOUT_MS,
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
  scriptedBucket,
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
        features: [town('Tom & "Jerry" <b onmouseover=alert(1)>\'s', 9, 300, 180)],
      },
    ]);
    // The same elements, attributes and classes as a layer from honest data.
    expect(hostile.tags).toEqual(clean.tags);
    expect(hostile.attrs).toEqual(clean.attrs);
    expect(hostile.classes).toEqual(clean.classes);
    // Only the one known road kind was drawn; the four made-up kinds were dropped.
    expect(hostile.svg.match(/<path /g)).toHaveLength(clean.svg.match(/<path /g)!.length);
    // The name is there, as text.
    expect(hostile.svg).toContain('Tom &amp; &quot;Jerry&quot; &lt;b onmouseover=alert(1)&gt;');
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
    // Its own archive name. A read that times out is abandoned, not stopped: it
    // goes on in the background, and 200 ms later opens the archive again under
    // its name. Under the default name that handed this bucket's directories to
    // whichever later case read the default file next (seen in CI, 2026-11-10).
    const name = 'slow.pmtiles';
    const slow = fakeBucket(name, await pmtilesArchive(tiles), { delayMs: 200 });
    const t0 = Date.now();
    expect(
      await loadStreetLayer({ MAP_TILES: slow, MAP_TILES_ARCHIVE: name }, [BLUE7], {
        timeoutMs: 50,
      })
    ).toBeNull();
    expect(Date.now() - t0).toBeLessThan(180);
    // It was the read that was slow, not the name that was refused.
    expect(slow.gets.length).toBeGreaterThan(0);
  });
});

// The archive read, class by class (owner 2026-11-10): what a hand can mistype
// in MAP_TILES_ARCHIVE, what a hostile name may not reach, and how a read over
// the network goes wrong. Every one ends the same way: no layer, no throw, so
// the page draws its hexagons. Sunny and rainy cases are in the block above.
describe('street map | the archive read: fat fingers, security, network', () => {
  const PLANET = 'planet-20261109.pmtiles';
  const sound = async (opts: { gzip?: boolean; leaf?: boolean } = { gzip: true, leaf: true }) =>
    pmtilesArchive(tilesForCells([BLUE7]).tiles, opts);
  const drawn = (layer: Awaited<ReturnType<typeof loadStreetLayer>>) =>
    layer?.svg.includes('data-testid="amap-streets"') === true;

  /** How many gets a first map costs, and which get is which. */
  async function dryRun(archive: Uint8Array) {
    const b = scriptedBucket(PLANET, archive, () => 'ok');
    expect(drawn(await loadStreetLayer({ MAP_TILES: b, MAP_TILES_ARCHIVE: PLANET }, [BLUE7]))).toBe(
      true
    );
    resetPmtilesCache();
    return b.gets.length;
  }

  // ── fat fingers ────────────────────────────────────────────────────────────
  // The bucket holds a sound archive under the mistyped name itself, so a
  // reader that skipped the name rule would draw it.
  it.each([
    ['a capital letter', 'Planet-20261109.pmtiles'],
    ['the extension in capitals', 'planet-20261109.PMTILES'],
    ['a space in front', ' planet-20261109.pmtiles'],
    ['a space after', 'planet-20261109.pmtiles '],
    ['a line break after', 'planet-20261109.pmtiles\n'],
    ['a tab after', 'planet-20261109.pmtiles\t'],
    ['a space inside', 'planet 20261109.pmtiles'],
    ['a comma for the full stop', 'planet-20261109,pmtiles'],
    ['no extension', 'planet-20261109'],
    ['the extension cut short', 'planet-20261109.pmtile'],
    ['a second extension', 'planet-20261109.pmtiles.bak'],
    ['only the extension', '.pmtiles'],
    ['a hyphen first', '-planet-20261109.pmtiles'],
    ['the quotes kept', '"planet-20261109.pmtiles"'],
    ['the bucket pasted in front', 'ose-map-tiles-staging/planet-20261109.pmtiles'],
    ['the rclone target pasted whole', 'r2:ose-map-tiles-staging/planet-20261109.pmtiles'],
    ['the download address pasted', 'https://build.protomaps.com/20261109.pmtiles'],
    ['spaces only', '   '],
  ])(
    'fat finger: %s is not an archive name: no layer, and the bucket is never asked',
    async (_, name) => {
      const bucket = fakeBucket(name, await sound());
      expect(
        await loadStreetLayer({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: name }, [BLUE7])
      ).toBeNull();
      expect(bucket.gets).toHaveLength(0);
    }
  );

  it('fat finger: a well-formed name with the wrong date finds no object: no layer, one read, no throw', async () => {
    const bucket = fakeBucket(PLANET, await sound());
    const env = { MAP_TILES: bucket, MAP_TILES_ARCHIVE: 'planet-20261190.pmtiles' };
    expect(await loadStreetLayer(env, [BLUE7])).toBeNull();
    expect(bucket.gets.map((g) => g.key)).toEqual(['planet-20261190.pmtiles']);
    // Control: the right date draws from the same bucket.
    expect(drawn(await loadStreetLayer({ ...env, MAP_TILES_ARCHIVE: PLANET }, [BLUE7]))).toBe(true);
  });

  it('edge: an empty setting reads the default regional file; a name of 89 characters draws and 90 does not', async () => {
    const archive = await sound();
    const byDefault = fakeBucket(DEFAULT_ARCHIVE, archive);
    expect(
      drawn(await loadStreetLayer({ MAP_TILES: byDefault, MAP_TILES_ARCHIVE: '' }, [BLUE7]))
    ).toBe(true);
    expect(new Set(byDefault.gets.map((g) => g.key))).toEqual(new Set([DEFAULT_ARCHIVE]));

    // One first character, up to 80 more, then ".pmtiles".
    const longest = `a${'b'.repeat(80)}.pmtiles`;
    const tooLong = `a${'b'.repeat(81)}.pmtiles`;
    expect(longest).toHaveLength(89);
    resetPmtilesCache();
    const ok = fakeBucket(longest, archive);
    expect(
      drawn(await loadStreetLayer({ MAP_TILES: ok, MAP_TILES_ARCHIVE: longest }, [BLUE7]))
    ).toBe(true);
    const over = fakeBucket(tooLong, archive);
    expect(
      await loadStreetLayer({ MAP_TILES: over, MAP_TILES_ARCHIVE: tooLong }, [BLUE7])
    ).toBeNull();
    expect(over.gets).toHaveLength(0);
  });

  it('edge: a read that has finished leaves no timer running, drawn or not', async () => {
    const archive = await sound();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const good = fakeBucket(PLANET, archive);
      expect(
        drawn(await loadStreetLayer({ MAP_TILES: good, MAP_TILES_ARCHIVE: PLANET }, [BLUE7]))
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      resetPmtilesCache();
      const junk = fakeBucket(PLANET, new Uint8Array(4096).fill(7));
      expect(
        await loadStreetLayer({ MAP_TILES: junk, MAP_TILES_ARCHIVE: PLANET }, [BLUE7])
      ).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('edge: the limit for the whole read is 1.5 s, and a read inside it draws', async () => {
    expect(STREET_TIMEOUT_MS).toBe(1500);
    const bucket = scriptedBucket(PLANET, await sound(), () => ({ delayMs: 5 }));
    expect(
      drawn(await loadStreetLayer({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET }, [BLUE7]))
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
      await loadStreetLayer({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: name }, [BLUE7])
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
        { MAP_TILES: fakeBucket(PLANET, await sound()), MAP_TILES_ARCHIVE: PLANET },
        [BLUE7]
      );
      resetPmtilesCache();
      const bucket = fakeBucket(PLANET, await pmtilesArchive(tiles, { gzip: true, leaf: true }));
      const layer = await loadStreetLayer({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET }, [
        BLUE7,
      ]);
      expect(drawn(layer)).toBe(true);
      // The odd road added nothing: the layer is the one honest tiles give.
      expect(layer).toEqual(honest);
    }
  );

  it('security: only MAP_TILES is read; a bucket bound beside it is never asked', async () => {
    const archive = await sound();
    const tilesBucket = fakeBucket(PLANET, archive);
    const uploads = fakeBucket(PLANET, archive);
    const env = { MAP_TILES: tilesBucket, MAP_TILES_ARCHIVE: PLANET, UPLOADS_BUCKET: uploads };
    expect(drawn(await loadStreetLayer(env, [BLUE7]))).toBe(true);
    expect(uploads.gets).toHaveLength(0);
    expect(new Set(tilesBucket.gets.map((g) => g.key))).toEqual(new Set([PLANET]));
    // With no MAP_TILES, the other bucket is still not a fallback.
    resetPmtilesCache();
    expect(
      await loadStreetLayer({ MAP_TILES_ARCHIVE: PLANET, UPLOADS_BUCKET: uploads } as never, [
        BLUE7,
      ])
    ).toBeNull();
    expect(uploads.gets).toHaveLength(0);
  });

  it('security: never who: the reads depend on the cells alone, and no read names a place finer than a tile', async () => {
    const a = fakeBucket(PLANET, await sound());
    const b = fakeBucket(PLANET, await sound());
    await loadStreetLayer({ MAP_TILES: a, MAP_TILES_ARCHIVE: PLANET }, [BLUE7]);
    resetPmtilesCache();
    await loadStreetLayer({ MAP_TILES: b, MAP_TILES_ARCHIVE: PLANET }, [BLUE7]);
    // Two cold isolates asked for the same area ask R2 for the same byte ranges.
    const ranges = (g: typeof a.gets) =>
      g.map((x) => `${x.range!.offset}+${x.range!.length}`).sort();
    expect(ranges(b.gets)).toEqual(ranges(a.gets));
    // A get carries a key and a byte range, nothing else.
    for (const g of a.gets) expect(Object.keys(g).sort()).toEqual(['key', 'range']);
  });

  // ── network ────────────────────────────────────────────────────────────────
  it('network: R2 fails on the first read: no layer, no throw; the next request opens the archive again and draws', async () => {
    const bucket = scriptedBucket(PLANET, await sound(), (n) => (n === 0 ? 'throw' : 'ok'));
    const env = { MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET };
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
      const bucket = scriptedBucket(PLANET, archive, (n) => (n === last ? step : 'ok'));
      const env = { MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET };
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
    const bucket = scriptedBucket(PLANET, archive, (n, range) =>
      n === at ? { shortTo: to ?? Math.floor(range!.length / 2) } : 'ok'
    );
    expect(
      await loadStreetLayer({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET }, [BLUE7])
    ).toBeNull();
    expect(bucket.gets.length).toBeGreaterThan(at);
  });

  it('network: one late tile read makes the whole layer late: no layer, on time; the next request draws', async () => {
    const archive = await sound();
    const last = (await dryRun(archive)) - 1;
    const bucket = scriptedBucket(PLANET, archive, (n) => (n === last ? { delayMs: 400 } : 'ok'));
    const env = { MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET };
    const t0 = Date.now();
    expect(await loadStreetLayer(env, [BLUE7], { timeoutMs: 60 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(300);
    expect(drawn(await loadStreetLayer(env, [BLUE7], { timeoutMs: 2000 }))).toBe(true);
  });

  it('network: two requests for one area in a cold isolate read the header once', async () => {
    const bucket = scriptedBucket(PLANET, await sound(), () => ({ delayMs: 5 }));
    const env = { MAP_TILES: bucket, MAP_TILES_ARCHIVE: PLANET };
    const [one, two] = await Promise.all([
      loadStreetLayer(env, [BLUE7]),
      loadStreetLayer(env, [BLUE7]),
    ]);
    expect(drawn(one)).toBe(true);
    expect(two).toEqual(one);
    expect(bucket.gets.filter((g) => g.range!.offset === 0)).toHaveLength(1);
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
