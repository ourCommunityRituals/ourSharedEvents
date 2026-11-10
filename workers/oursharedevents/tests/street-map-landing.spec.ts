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
 *   - zoomed in on one area (epic OSE-1880): the dots are drawn only over that
 *     area's street map; with no street map the places are a list (OSE-1894)
 *   - a sound archive with no tile for the area counts as no street map
 *     (location-precision CCR, F41)
 */
// @born-red archive with no tile for the area | method: both cases seen failing before the guard in buildStreetLayer (the landing carried a blank street layer and its credit; the zoomed area drew its dot with no "amap-no-tiles" list) | date: 2026-11-09
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { latLngToCell } from 'h3-js';
import { OSM_COPYRIGHT_URL } from '../src/lib/attendee-map';
import { LANGUAGES, type Lang } from '../src/lib/i18n/languages';
import { resetPmtilesCache } from '../src/lib/pmtiles';
import { DEFAULT_ARCHIVE } from '../src/lib/street-map';
import {
  fakeBucket,
  pmtilesArchive,
  scriptedBucket,
  tilesForCells,
  type GetStep,
} from './helpers/street-map-fixtures';
import { BLUE_ISLAND, MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => ({ fetchSponsorTitles: async () => new Map() }));

import { handleLandingPage } from '../src/handlers/pages';

// No tile in common with the Chicago rows at any zoom the map reads.
const LOS_ANGELES = latLngToCell(34.05, -118.25, 7);

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
  state.rows = sentinel(MANY);
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
    const html = await landing({ MAP_TILES: bucket });
    expect(html).toContain('data-testid="amap-streets"');
    expect(html).toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cells);
    expect(new Set(bucket.gets.map((g) => g.key))).toEqual(new Set([DEFAULT_ARCHIVE]));
  });

  it('a broken archive leaves the page and its hexagons as they were', async () => {
    const plain = await landing({});
    const bucket = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(500).fill(1));
    const html = await landing({ MAP_TILES: bucket });
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
  });

  // Born red 2026-11-09: with the no-street-map branch drawing the dots anyway,
  // and with the second pass (the one that has the streets) skipped, these fail.
  it('zoomed in on an area: its street layer is read, and the dots are drawn over it', async () => {
    const { tiles } = tilesForCells([BLUE_ISLAND]);
    const bucket = fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
    const html = await landing({ MAP_TILES: bucket }, `/?area=${BLUE_ISLAND}`);
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
    for (const env of [{}, { MAP_TILES: broken }]) {
      const html = await landing(env, `/?area=${BLUE_ISLAND}`);
      expect(html).toContain(`data-zoom="${BLUE_ISLAND}"`);
      expect(html).toContain('data-testid="amap-no-tiles"');
      expect(html).not.toContain('data-testid="amap-dot"');
      expect(html).not.toContain('data-testid="amap-zone"');
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(html).toContain('href="#amap-dot-1" data-testid="amap-place-link"');
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

  it('an archive with no tile for the areas: the landing keeps its plain hexagons, with no credit', async () => {
    const bucket = await elsewhere();
    const plain = await landing({});
    const html = await landing({ MAP_TILES: bucket });
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
  });

  it('an archive with no tile for the area: zoomed in, the places are listed and no dot floats', async () => {
    const bucket = await elsewhere();
    const zoomed = await landing({ MAP_TILES: bucket }, `/?area=${BLUE_ISLAND}`);
    expect(bucket.gets.length).toBeGreaterThan(0);
    expect(zoomed).toContain(`data-zoom="${BLUE_ISLAND}"`);
    expect(zoomed).toContain('data-testid="amap-no-tiles"');
    expect(zoomed).not.toContain('data-testid="amap-dot"');
    expect(zoomed).not.toContain('data-testid="amap-zone"');
    expect(zoomed).not.toContain('data-testid="amap-streets"');
    expect(zoomed).not.toContain('data-testid="amap-credit"');
    expect(zoomed).toContain('href="#amap-dot-1" data-testid="amap-place-link"');
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
      const html = await landing({ MAP_TILES: a });
      expect(a.gets.length).toBeGreaterThan(0);
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(html).not.toContain('data-testid="amap-credit"');
      expect(cellsOf(html)).toEqual(cells);

      resetPmtilesCache();
      const b = await bucketFor([BLUE_ISLAND]);
      const zoomed = await landing({ MAP_TILES: b }, `/?area=${BLUE_ISLAND}`);
      expect(b.gets.length).toBeGreaterThan(0);
      expect(zoomed).toContain('data-testid="amap-no-tiles"');
      expect(zoomed).not.toContain('data-testid="amap-dot"');
      expect(zoomed).not.toContain('data-testid="amap-streets"');
    }
  );

  it('fat finger: a mistyped MAP_TILES_ARCHIVE leaves the page as it was, and the bucket is never asked', async () => {
    const plain = await landing({});
    const mistyped = 'Us-20261109.PMTILES';
    const bucket = fakeBucket(
      mistyped,
      await pmtilesArchive(tilesForCells(cellsOf(plain)).tiles, { gzip: true })
    );
    const html = await landing({ MAP_TILES: bucket, MAP_TILES_ARCHIVE: mistyped });
    expect(bucket.gets).toHaveLength(0);
    expect(html).not.toContain('data-testid="amap-streets"');
    expect(html).not.toContain('data-testid="amap-credit"');
    expect(cellsOf(html)).toEqual(cellsOf(plain));
    // Control: the same bucket under the name as typed correctly draws.
    const right = 'us-20261109.pmtiles';
    const good = fakeBucket(
      right,
      await pmtilesArchive(tilesForCells(cellsOf(plain)).tiles, { gzip: true })
    );
    const drawn = await landing({ MAP_TILES: good, MAP_TILES_ARCHIVE: right });
    expect(drawn).toContain('data-testid="amap-streets"');
  });
});

// The credit for the street data (owner 2026-11-10): wherever streets are drawn,
// in the page's language, with a link that opens OpenStreetMap's own copyright
// page in that language. OpenStreetMap's address without a language follows the
// visitor's browser, not the language chosen here, so each language names its page.
// @born-red street-map credit follows the page language | method: the new and changed cases seen failing before the change (6 red); then 7 faults injected one at a time in src/lib/attendee-map.ts (Spanish linked to the English page, both languages linked to the page with no language, the zoomed area without its credit, the landing map without its credit, the credit shown without streets, the credit always in English, a second module given the street layer); each turned cases here red | date: 2026-11-10
describe('street map | the credit, in the page language, wherever streets are drawn', () => {
  const CREDIT: Record<Lang, string> = {
    en: '<p class="amap-credit" data-testid="amap-credit">Street map data © <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> contributors.</p>',
    es: '<p class="amap-credit" data-testid="amap-credit">Datos del mapa de calles © colaboradores de <a href="https://www.openstreetmap.org/copyright/es">OpenStreetMap</a>.</p>',
  };

  it('every language has its own OpenStreetMap page, on openstreetmap.org over https', () => {
    expect(Object.keys(OSM_COPYRIGHT_URL).sort()).toEqual([...LANGUAGES].sort());
    for (const lang of LANGUAGES) {
      expect(OSM_COPYRIGHT_URL[lang]).toBe(`https://www.openstreetmap.org/copyright/${lang}`);
    }
  });

  it.each(LANGUAGES)(
    '%s: the landing map and the zoomed area each carry the credit once, in that language, linked to that language',
    async (lang) => {
      const plain = await landing({}, '/', lang);
      // No streets, no credit, and no link to OpenStreetMap, in this language too.
      expect(plain).not.toContain('data-testid="amap-credit"');
      expect(plain).not.toContain('openstreetmap.org');

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
        const html = await landing({ MAP_TILES: bucket }, path, lang);
        expect(html, path).toContain('data-testid="amap-streets"');
        expect(html.split('data-testid="amap-credit"'), path).toHaveLength(2);
        expect(html, path).toContain(CREDIT[lang]);
        for (const other of LANGUAGES) {
          if (other !== lang) expect(html, path).not.toContain(OSM_COPYRIGHT_URL[other]);
        }
      }
    }
  );

  // Throughout the site. The street layer reaches a page through these modules
  // and no others, and lib/attendee-map.ts is the only one that draws it. A new
  // surface that draws streets turns this red: give it the credit (streetCredit)
  // and a case above, then add it here.
  it('only the landing map draws the street layer, and each drawing is paired with the credit', () => {
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
  });
});
