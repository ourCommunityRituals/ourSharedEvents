/**
 * The landing page handler draws the street map under its hexagons
 * (handlers/pages.ts → lib/street-map.ts).
 *
 * Node-clean: the data provider and sponsor titles are mocked, the R2 binding is
 * a fake bucket. Registered in vitest.node-specs.mjs.
 *
 * What these pin:
 *   - the handler reads the street layer for exactly the cells it draws, and the
 *     page then carries the streets and the OpenStreetMap credit
 *   - no binding, or a broken archive: the page is served as before, same cells
 *   - the switch off (STREET_MAP): the page with no street map, the bucket never
 *     asked, on the landing and zoomed in (street-map CCR 2026-11-15, R20)
 *   - zoomed in on one area (epic OSE-1880): the dots are drawn only over that
 *     area's street map; with no street map the places are a list (OSE-1894)
 *   - a sound archive with no tile for the area counts as no street map
 *     (location-precision CCR, F41), and so does one missing a tile of the
 *     frame, or holding more in a tile than the decoder allows (street-map CCR
 *     2026-11-15, R15 and R2)
 *   - a second pass (the one with the streets) that throws leaves the first
 *     pass on the page (R22)
 */
// @born-red archive with no tile for the area | method: both cases seen failing before the guard in buildStreetLayer (the landing carried a blank street layer and its credit; the zoomed area drew its dot with no "amap-no-tiles" list) | date: 2026-11-09
// @born-red the switch off | method: the switch line removed from loadStreetLayer, then the switch read after the bucket; both "the switch off" cases failed on each. With the value lower-cased before the compare, the first failed alone (its "ON") | date: 2026-11-15
// @born-red the landing's second pass in its own try; a tile missing or over the decode limit (street-map CCR 2026-11-15, R22, R15, R2) | method: "a second pass that throws" seen failing with the inner try taken out of handlers/pages.ts (the page lost its cards and hexagons to the empty area); the missing-tile and decode-limit case seen failing twice: with R15 taken out of lib/street-map.ts (the first page carried streets and the credit) and with the decoder's limits taken out of lib/mvt.ts (the second did) | date: 2026-11-15
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { latLngToCell } from 'h3-js';
import { OSM_COPYRIGHT_URL } from '../src/lib/attendee-map';
import { fmt } from '../src/lib/i18n/catalog';
import { LANGUAGES, type Lang } from '../src/lib/i18n/languages';
import { TILE_LIMITS } from '../src/lib/mvt';
import { MAX_TILE_UNPACKED_BYTES, resetPmtilesCache } from '../src/lib/pmtiles';
import { DEFAULT_ARCHIVE, resetStreetLayerCache } from '../src/lib/street-map';
import {
  fakeBucket,
  paddedTile,
  pmtilesArchive,
  scriptedBucket,
  tilesForCells,
  type GetStep,
} from './helpers/street-map-fixtures';
import { BLUE_ISLAND, MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Make the landing's second pass, the one that is given the streets, throw. */
  secondPassThrows: false,
}));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => ({ fetchSponsorTitles: async () => new Map() }));
vi.mock('../src/lib/landing-area', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/landing-area')>();
  const renderLandingArea: typeof real.renderLandingArea = (items, opts) => {
    if (state.secondPassThrows && opts?.streets) throw new Error('the pass with streets threw');
    return real.renderLandingArea(items, opts);
  };
  return { ...real, renderLandingArea };
});

import { handleLandingPage } from '../src/handlers/pages';

// No tile in common with the Chicago rows at any zoom the map reads.
const LOS_ANGELES = latLngToCell(34.05, -118.25, 7);

const sansNonce = (html: string) => html.replace(/nonce="[^"]+"/g, 'nonce=""');

const cellsOf = (html: string) =>
  [...html.matchAll(/data-testid="amap-area" data-cell="([0-9a-f]+)"/g)].map((m) => m[1]!);

async function landing(env: Record<string, unknown>, path = '/', pathLang?: Lang): Promise<string> {
  const res = await handleLandingPage(
    env as never,
    null,
    new Request(`https://oursharedevents.com${path}`),
    pathLang
  );
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetPmtilesCache();
  resetStreetLayerCache();
  state.rows = sentinel(MANY);
  state.secondPassThrows = false;
});
afterEach(() => vi.useRealTimers());

describe('street map | the landing page handler', () => {
  it('reads the street layer for the cells it draws and puts it under them', async () => {
    const plain = await landing({});
    const cells = cellsOf(plain);
    expect(cells.length).toBeGreaterThan(0);
    expect(plain).not.toContain('data-testid="amap-streets"');

    const { tiles } = tilesForCells(cells);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(html).toContain('data-testid="amap-streets"');
    expect(html).toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cells);
    expect(new Set(bucket.gets.map((g) => g.key))).toEqual(new Set([DEFAULT_ARCHIVE]));
  });

  // Street-map CCR 2026-11-15, R20: with a sound archive under the key, the
  // switch alone decides.
  it('the switch off: the page with no street map, and the bucket is never asked', async () => {
    const unbound = await landing({ STREET_MAP: 'on' });
    const { tiles } = tilesForCells(cellsOf(unbound));
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    for (const env of [
      { STREET_MAP: 'off', MAP_TILES: bucket },
      { MAP_TILES: bucket },
      { STREET_MAP: 'ON', MAP_TILES: bucket },
    ]) {
      const html = await landing(env);
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(html).not.toContain('data-testid="amap-credit"');
      // The page with no bucket bound, but for the nonce each response makes.
      expect(sansNonce(html)).toBe(sansNonce(unbound));
    }
    expect(bucket.gets).toHaveLength(0);
    // The same bucket, switched on, draws.
    const on = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(on).toContain('data-testid="amap-streets"');
    expect(on).toContain('data-testid="amap-credit"');
    expect(bucket.gets.length).toBeGreaterThan(0);
  });

  it('the switch off, zoomed in: the places are a list, no dot, and the bucket is never asked', async () => {
    const { tiles } = tilesForCells([BLUE_ISLAND]);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    const html = await landing({ STREET_MAP: 'off', MAP_TILES: bucket }, `/?area=${BLUE_ISLAND}`);
    expect(html).toContain(`data-zoom="${BLUE_ISLAND}"`);
    expect(html).toContain('data-testid="amap-no-tiles"');
    expect(html).not.toContain('data-testid="amap-dot"');
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(bucket.gets).toHaveLength(0);
    const on = await landing({ STREET_MAP: 'on', MAP_TILES: bucket }, `/?area=${BLUE_ISLAND}`);
    expect(on).toContain('data-testid="amap-streets"');
    expect(on).toContain('data-testid="amap-dot"');
    expect(on).not.toContain('data-testid="amap-no-tiles"');
  });

  it('a broken archive leaves the page and its hexagons as they were', async () => {
    const plain = await landing({});
    const bucket = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(500).fill(1));
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
  });

  // The archive holds the right tiles for the page, and one of them is a good
  // tile (a few KB of gzip) that unpacks to one byte past the reader's tile
  // limit (lib/pmtiles.ts). Born red 2026-11-14: with a tile unpacked to any
  // length, this page drew its streets from that archive.
  it('an archive past the reader limits leaves the page and its hexagons as they were', async () => {
    const plain = await landing({});
    const { tiles } = tilesForCells(cellsOf(plain));
    const swollen = await pmtilesArchive(
      tiles.map((t, i) =>
        i === 0 ? { ...t, data: paddedTile(t.data, MAX_TILE_UNPACKED_BYTES + 1) } : t
      ),
      { gzip: true }
    );
    const bucket = fakeBucket(DEFAULT_ARCHIVE, swollen);
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
  });

  // street-map CCR 2026-11-15, R15 and R2: two more archives that are sound and
  // are still no street map. Born red 2026-11-15: with R15 taken out the first
  // page carried the streets and the credit; with the decoder's limits taken
  // out the second did.
  it('an archive missing one tile of the frame, or with more in a tile than the decoder allows, leaves the page as it was', async () => {
    const plain = await landing({});
    const cells = cellsOf(plain);
    const { tiles } = tilesForCells(cells);
    expect(tiles.length).toBeGreaterThan(1);
    const tooMuch = tilesForCells(cells, () => [
      {
        name: 'roads',
        features: [
          {
            type: 2,
            props: { kind: 'path' },
            parts: [
              Array.from({ length: TILE_LIMITS.points }, (_, i): [number, number] => [i % 4096, 7]),
            ],
          },
        ],
      },
    ]).tiles;
    for (const archive of [
      await pmtilesArchive(tiles.slice(1), { gzip: true }),
      await pmtilesArchive(tooMuch, { gzip: true }),
    ]) {
      resetPmtilesCache();
      const bucket = fakeBucket(DEFAULT_ARCHIVE, archive);
      const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
      expect(bucket.gets.length).toBeGreaterThan(0);
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(html).not.toContain('data-testid="amap-credit"');
      expect(cellsOf(html)).toEqual(cells);
    }
  });

  // street-map CCR 2026-11-15, R22. The second pass sat in the try whose catch
  // serves the empty area, so a throw there would have cost the page its cards
  // and hexagons for the sake of the streets. No throw path is known; the
  // renderer is made to throw here. Born red 2026-11-15: with the inner try
  // taken out, this case failed (the page no longer carried its hexagons).
  it('a second pass that throws leaves the first pass on the page: the hexagons, no streets, no credit', async () => {
    const plain = await landing({});
    const cells = cellsOf(plain);
    expect(cells.length).toBeGreaterThan(0);
    const { tiles } = tilesForCells(cells);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    // The control: this archive draws on this page.
    expect(await landing({ STREET_MAP: 'on', MAP_TILES: bucket })).toContain(
      'data-testid="amap-streets"'
    );

    state.secondPassThrows = true;
    // The kept layer is put aside: this is about the reader (kept layers: street-layer-kept.spec.ts).
    resetStreetLayerCache();
    const before = bucket.gets.length;
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    // The layer was read and was good: it is the drawing with it that threw.
    expect(bucket.gets.length).toBeGreaterThan(before);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cells);
  });

  // Born red 2026-11-09: with the no-street-map branch drawing the dots anyway,
  // and with the second pass (the one that has the streets) skipped, these fail.
  it('zoomed in on an area: its street layer is read, and the dots are drawn over it', async () => {
    const { tiles } = tilesForCells([BLUE_ISLAND]);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket }, `/?area=${BLUE_ISLAND}`);
    expect(html).toContain(`data-zoom="${BLUE_ISLAND}"`);
    expect(html).toContain('data-testid="amap-streets"');
    expect(html).toContain('data-testid="amap-credit"');
    expect(html).toContain(`data-testid="amap-zone" data-cell="${BLUE_ISLAND}"`);
    expect(html).toMatch(/<a href="#amap-dot-1" class="[^"]*" data-testid="amap-dot"/);
    expect(html).not.toContain('data-testid="amap-no-tiles"');
    expect(html).toContain('<span class="amap-t" id="amap-dot-1"></span><section class="amap-p');
  });

  it('zoomed in with no street map, or a broken one: the places are listed and no dot floats', async () => {
    const broken = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(500).fill(1));
    for (const env of [{ STREET_MAP: 'on' }, { STREET_MAP: 'on', MAP_TILES: broken }]) {
      const html = await landing(env, `/?area=${BLUE_ISLAND}`);
      expect(html).toContain(`data-zoom="${BLUE_ISLAND}"`);
      expect(html).toContain('data-testid="amap-no-tiles"');
      expect(html).not.toContain('data-testid="amap-dot"');
      expect(html).not.toContain('data-testid="amap-zone"');
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(html).not.toContain('data-testid="amap-place-link"');
      expect(html).not.toContain('data-testid="amap-legend"');
      expect(html).toContain('<span class="amap-t" id="amap-dot-1"></span><section class="amap-p');
    }
    expect(broken.gets.length).toBeGreaterThan(0);
  });

  // Born red 2026-11-09 (location-precision CCR, F41): a sound archive that has
  // no tile for the area gave a layer of one blank rectangle, so the zoomed
  // area drew its dots on nothing and the landing credited a map it did not show.
  const elsewhere = async () =>
    fakeBucket(
      DEFAULT_ARCHIVE,
      await pmtilesArchive(tilesForCells([LOS_ANGELES]).tiles, { gzip: true })
    );

  // street-map CCR 2026-11-15, R5: the landing had no width floor, so a list
  // that reached across the country read tiles at zoom 4 and drew them.
  it('areas spread wider than a street map can show: plain hexagons, no credit, and the bucket is never asked', async () => {
    state.rows = sentinel(
      MANY.map((row, i) =>
        i % 2
          ? {
              ...row,
              lat: 34.05,
              lon: -118.25,
              h3_res9: latLngToCell(34.05, -118.25, 9),
              h3_res7: LOS_ANGELES,
            }
          : row
      )
    );
    const plain = await landing({});
    const cells = cellsOf(plain);
    expect(cells).toContain(LOS_ANGELES);
    expect(cells).toContain(BLUE_ISLAND);

    // The tiles for that frame are in the archive, and they hold roads.
    const { tiles } = tilesForCells(cells);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cells);
    expect(bucket.gets).toHaveLength(0);
  });

  it('an archive with no tile for the areas: the landing keeps its plain hexagons, with no credit', async () => {
    const bucket = await elsewhere();
    const plain = await landing({});
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
  });

  it('an archive with no tile for the area: zoomed in, the places are listed and no dot floats', async () => {
    const bucket = await elsewhere();
    const zoomed = await landing({ STREET_MAP: 'on', MAP_TILES: bucket }, `/?area=${BLUE_ISLAND}`);
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(zoomed).toContain(`data-zoom="${BLUE_ISLAND}"`);
    expect(zoomed).toContain('data-testid="amap-no-tiles"');
    expect(zoomed).not.toContain('data-testid="amap-dot"');
    expect(zoomed).not.toContain('data-testid="amap-zone"');
    expect(zoomed).not.toContain('data-testid="amap-streets"');
    expect(zoomed).not.toContain('data-testid="amap-credit"');
    expect(zoomed).not.toContain('data-testid="amap-place-link"');
    expect(zoomed).not.toContain('data-testid="amap-legend"');
  });

  // The page, class by class (owner 2026-11-10). The loader's own cases are in
  // street-map.spec.ts; these pin that the page is served whatever the read does.
  // Born red 2026-11-10: with the catch in loadStreetLayer rethrowing, the four
  // network cases fail (the handler throws); with the archive name rule removed,
  // the fat-finger case draws streets from the mistyped object.
  const plans: [string, (n: number) => GetStep][] = [
    ['R2 fails on the first read', (n) => (n === 0 ? 'throw' : 'ok')],
    ['R2 fails on every read after the first', (n) => (n === 0 ? 'ok' : 'throw')],
    ['the object is gone after the first read', (n) => (n === 0 ? 'ok' : 'missing')],
    ['every answer is cut to 100 bytes', () => ({ shortTo: 100 })],
  ];
  it.each(plans)(
    'network: %s: the landing and the zoomed area are served, without streets',
    async (_, plan) => {
      const plain = await landing({});
      const cells = cellsOf(plain);
      const bucketFor = async (c: string[]) =>
        scriptedBucket(
          DEFAULT_ARCHIVE,
          await pmtilesArchive(tilesForCells(c).tiles, { gzip: true }),
          plan
        );
      const a = await bucketFor(cells);
      const html = await landing({ STREET_MAP: 'on', MAP_TILES: a });
      expect(a.gets.length).toBeGreaterThan(0);
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(html).not.toContain('data-testid="amap-credit"');
      expect(cellsOf(html)).toEqual(cells);

      resetPmtilesCache();
      const b = await bucketFor([BLUE_ISLAND]);
      const zoomed = await landing({ STREET_MAP: 'on', MAP_TILES: b }, `/?area=${BLUE_ISLAND}`);
      expect(b.gets.length).toBeGreaterThan(0);
      expect(zoomed).toContain('data-testid="amap-no-tiles"');
      expect(zoomed).not.toContain('data-testid="amap-dot"');
      expect(zoomed).not.toContain('data-testid="amap-streets"');
    }
  );

  it('fat finger: a mistyped MAP_TILES_ARCHIVE leaves the page as it was, and the bucket is never asked', async () => {
    const plain = await landing({});
    const mistyped = 'Us-20261120.PMTILES';
    const bucket = fakeBucket(
      mistyped,
      await pmtilesArchive(tilesForCells(cellsOf(plain)).tiles, { gzip: true })
    );
    const html = await landing({
      STREET_MAP: 'on',
      MAP_TILES: bucket,
      MAP_TILES_ARCHIVE: mistyped,
    });
    expect(bucket.gets).toHaveLength(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
    // Control: the same bucket under the name as typed correctly draws.
    const right = 'us-20261120.pmtiles';
    const good = fakeBucket(
      right,
      await pmtilesArchive(tilesForCells(cellsOf(plain)).tiles, { gzip: true })
    );
    const drawn = await landing({ STREET_MAP: 'on', MAP_TILES: good, MAP_TILES_ARCHIVE: right });
    expect(drawn).toContain('data-testid="amap-streets"');
  });
});

// The credit for the street data (owner 2026-11-10): wherever streets are drawn,
// in the page's language, with a link that opens OpenStreetMap's own copyright
// page in that language. OpenStreetMap's address without a language follows the
// visitor's browser, not the language chosen here, so each language names its page.
// Protomaps, which prepares the file from that data, is credited beside it with
// a link to its own site (owner 2026-11-10: it asks for the credit, its licence
// does not require it).
// @born-red street-map credit follows the page language | method: the new and changed cases seen failing before the change (6 red); then 7 faults injected one at a time in src/lib/attendee-map.ts (Spanish linked to the English page, both languages linked to the page with no language, the zoomed area without its credit, the landing map without its credit, the credit shown without streets, the credit always in English, a second module given the street layer); each turned cases here red. Protomaps in the credit: the 4 credit cases seen failing before it was added, then 4 more faults (left out, linked to another address, named with no link, a tile loaded from a Protomaps host beside the credit), each red | date: 2026-11-10
describe('street map | the credit, in the page language, wherever streets are drawn', () => {
  // Written out by hand for the first four languages; the rest are built from
  // the catalog the same way, so a missing or English credit still fails.
  const HAND: Partial<Record<Lang, string>> = {
    en: '<p class="amap-credit" data-testid="amap-credit">Street map data © <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> contributors, prepared by <a href="https://protomaps.com">Protomaps</a>.</p>',
    es: '<p class="amap-credit" data-testid="amap-credit">Datos del mapa de calles © colaboradores de <a href="https://www.openstreetmap.org/copyright/es">OpenStreetMap</a>, preparados por <a href="https://protomaps.com">Protomaps</a>.</p>',
    pl: '<p class="amap-credit" data-testid="amap-credit">Dane mapy ulic © współtwórcy <a href="https://www.openstreetmap.org/copyright/pl">OpenStreetMap</a>, przygotowane przez <a href="https://protomaps.com">Protomaps</a>.</p>',
    ar: '<p class="amap-credit" data-testid="amap-credit">بيانات خريطة الشوارع © المساهمون في <a href="https://www.openstreetmap.org/copyright/ar">OpenStreetMap</a>، من إعداد <a href="https://protomaps.com">Protomaps</a>.</p>',
  };
  // OpenStreetMap names its Chinese and Brazilian Portuguese pages by region.
  const OSM_TAG: Partial<Record<Lang, string>> = {
    'zh-hans': 'zh-CN',
    'zh-hant': 'zh-TW',
    pt: 'pt-BR',
  };
  const osmUrl = (lang: Lang): string =>
    `https://www.openstreetmap.org/copyright/${OSM_TAG[lang] ?? lang}`;
  const CREDIT = Object.fromEntries(
    LANGUAGES.map((lang) => [
      lang,
      HAND[lang] ??
        `<p class="amap-credit" data-testid="amap-credit">${fmt(lang, 'map.credit', {
          osm: `<a href="${osmUrl(lang)}">OpenStreetMap</a>`,
          protomaps: '<a href="https://protomaps.com">Protomaps</a>',
        })}</p>`,
    ])
  ) as Record<Lang, string>;

  it('every language has its own OpenStreetMap page, on openstreetmap.org over https', () => {
    expect(Object.keys(OSM_COPYRIGHT_URL).sort()).toEqual([...LANGUAGES].sort());
    for (const lang of LANGUAGES) {
      expect(OSM_COPYRIGHT_URL[lang]).toBe(osmUrl(lang));
    }
  });

  it.each(LANGUAGES)(
    '%s: the landing map and the zoomed area each carry the credit once, in that language, linked to that language',
    async (lang) => {
      const plain = await landing({}, '/', lang);
      // No streets, no credit, and no link to OpenStreetMap, in this language too.
      expect(plain).not.toContain('data-testid="amap-credit"');
      expect(plain).not.toContain('openstreetmap.org');
      expect(plain.toLowerCase()).not.toContain('protomaps');

      const views: [string, string[]][] = [
        ['/', cellsOf(plain)],
        [`/?area=${BLUE_ISLAND}`, [BLUE_ISLAND]],
      ];
      for (const [path, cells] of views) {
        resetPmtilesCache();
        const bucket = fakeBucket(
          DEFAULT_ARCHIVE,
          await pmtilesArchive(tilesForCells(cells).tiles, { gzip: true })
        );
        const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket }, path, lang);
        expect(html, path).toContain('data-testid="amap-streets"');
        expect(html.split('data-testid="amap-credit"'), path).toHaveLength(2);
        expect(html, path).toContain(CREDIT[lang]);
        for (const other of LANGUAGES) {
          if (other !== lang) expect(html, path).not.toContain(OSM_COPYRIGHT_URL[other]);
        }
        // Protomaps is named once, as a link a visitor may tap. Nothing on the
        // page is loaded from it or from any other map host: the same rule the
        // staging case holds (bruno/ose-pages, "draws streets under the map").
        expect(html.toLowerCase().split('protomaps'), path).toHaveLength(3);
        expect(html, path).toContain('<a href="https://protomaps.com">Protomaps</a>');
        expect(html.replace('<a href="https://protomaps.com">Protomaps</a>', ''), path).not.toMatch(
          /(src|href)="https?:\/\/[^"]*(tile\.openstreetmap|protomaps|maplibre|mapbox|maptiler|maps\.googleapis\.com\/maps\/api\/js)/i
        );
      }
    }
  );

  // Throughout the site. The street layer reaches a page through these modules
  // and no others, and lib/attendee-map.ts is the only one that draws it. A new
  // surface that draws streets turns this red: give it the credit (streetCredit)
  // and a case above, then add it here.
  //
  // OSE-2039 added the second surface: handlers/map-areas.ts hands the layer to a
  // reader outside OSE (GET /api/v2/map/areas). It sends the credit in the same
  // object as the layer, so one is never sent without the other; its case is in
  // map-areas.spec.ts ("draws the street layer ... and the credit").
  it('only the landing map and the public area map draw the street layer, and each drawing is paired with the credit', () => {
    const SRC = join(__dirname, '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|html)$/.test(entry)) files.push(full);
      }
    };
    walk(SRC);
    const touches = files
      .filter((f) => /StreetLayer|amap-streets/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .sort();
    expect(touches).toEqual([
      'handlers/map-areas.ts',
      'handlers/pages.ts',
      'lib/attendee-map.ts',
      'lib/landing-area.ts',
      'lib/street-map.ts',
    ]);
    const map = readFileSync(join(SRC, 'lib', 'attendee-map.ts'), 'utf8');
    const drawn = map.match(/\b(?:streetLayer|opts\.streets)\.svg\b/g) ?? [];
    const credited = map.match(/\? streetCredit\(lang\)/g) ?? [];
    expect(drawn).toHaveLength(2);
    expect(credited).toHaveLength(drawn.length);
    // The credit is built in one place.
    expect(map.split('data-testid="amap-credit"')).toHaveLength(2);
    // The public area map: the layer is sent once, inside the object that holds
    // its credit, and that object is null when there is no layer. This reads the
    // file's text, so under Stryker (which mutates map-areas.ts whole since
    // 2026-11-16 and runs this spec from a copy at .stryker-tmp/sandbox-*/, where
    // the file is rewritten with every mutant in it) it reads the checkout's own
    // copy, three folders up. The mutants there are killed by what the handler
    // answers (map-areas.spec.ts), never by its spelling.
    const sandbox = /[\\/]\.stryker-tmp[\\/]/.test(__dirname);
    const apiSrc = sandbox ? join(__dirname, '..', '..', '..', 'src') : SRC;
    const api = readFileSync(join(apiSrc, 'handlers', 'map-areas.ts'), 'utf8');
    expect(api.match(/\blayer\.svg\b/g) ?? []).toHaveLength(1);
    expect(api).toMatch(
      /streets: layer\s*\? \{[^}]*svg: layer\.svg,[^}]*credit: \{ html: streetCredit\('en'\)[^}]*\}[^}]*\}\s*: null/
    );
  });
});
