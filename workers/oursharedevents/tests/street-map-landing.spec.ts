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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetPmtilesCache } from '../src/lib/pmtiles';
import { DEFAULT_ARCHIVE } from '../src/lib/street-map';
import { fakeBucket, pmtilesArchive, tilesForCells } from './helpers/street-map-fixtures';
import { MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => ({ fetchSponsorTitles: async () => new Map() }));

import { handleLandingPage } from '../src/handlers/pages';

const cellsOf = (html: string) =>
  [...html.matchAll(/data-testid="amap-area" data-cell="([0-9a-f]+)"/g)].map((m) => m[1]!);

async function landing(env: Record<string, unknown>): Promise<string> {
  const res = await handleLandingPage(
    env as never,
    null,
    new Request('https://oursharedevents.com/')
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
});
