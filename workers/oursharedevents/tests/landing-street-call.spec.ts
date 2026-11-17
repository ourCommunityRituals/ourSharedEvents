/**
 * The landing's own call for the street layer (handlers/pages.ts, the block
 * after the first pass of renderLandingArea). Mutated by Stryker since
 * 2026-11-16 (base-map plan, gap G11; stryker.conf.mjs), and these are the
 * cases that kill its mutants:
 *
 *   - the call names the landing as its surface in the STREET_LAYER log line
 *     (lib/street-map.ts, emitStreetLayer), so Workers Logs can tell its reads
 *     from the public area map's
 *   - no hexagon drawn (the area empty, or zoomed in on an area with no event):
 *     the street layer is not asked for at all
 *   - no street layer (no binding, a broken archive): the area is drawn once,
 *     never a second time with nothing to add
 *   - a street layer: the area is drawn twice, the second time with it
 *
 * Node-clean, like street-map-landing.spec.ts (the data provider and sponsor
 * titles mocked, the R2 binding a fake bucket). The street-map and
 * landing-area modules are the real ones, wrapped only to count their calls.
 * Nothing is drawn as the file loads: each test draws its own page.
 */
// @born-red the landing's street call (G11) | method: Stryker, the block mutated (MUTATION_GROUP=render). Before this file, 5 of its 11 mutants survived: the surface "landing" to "" and the options to {}, `if (area.mapCells?.length)` to `if (true)`, `if (streets)` to `if (true)`, and `?.` to `.` (equivalent, disabled in the source with its reason). With it, each of the first four was killed by the test named for it here ("names the landing as the surface", "no hexagon drawn", "no street layer: one pass"): 10 of 10 | date: 2026-11-16
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { latLngToCell } from 'h3-js';
import { resetPmtilesCache } from '../src/lib/pmtiles';
import { DEFAULT_ARCHIVE } from '../src/lib/street-map';
import { fakeBucket, pmtilesArchive, tilesForCells } from './helpers/street-map-fixtures';
import { MANY, NOW, sentinel } from './helpers/list-landing-rows';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** The cells of each loadStreetLayer call, in order. */
  streetCalls: [] as unknown[],
  /** Each renderLandingArea call: whether it was given a street layer. */
  passes: [] as boolean[],
}));

vi.mock('../src/lib/data-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDataProvider: () => ({
    listEvents: async () => ({ data: state.rows, source: 'live', cacheAge: null }),
  }),
}));
vi.mock('../src/lib/sponsor-titles', async () => ({ fetchSponsorTitles: async () => new Map() }));
vi.mock('../src/lib/street-map', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/street-map')>();
  const loadStreetLayer: typeof real.loadStreetLayer = (env, cells, opts) => {
    state.streetCalls.push(cells);
    return real.loadStreetLayer(env, cells, opts);
  };
  return { ...real, loadStreetLayer };
});
vi.mock('../src/lib/landing-area', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/landing-area')>();
  const renderLandingArea: typeof real.renderLandingArea = (items, opts) => {
    state.passes.push(Boolean(opts?.streets));
    return real.renderLandingArea(items, opts);
  };
  return { ...real, renderLandingArea };
});

import { handleLandingPage } from '../src/handlers/pages';

// No tile in common with the Chicago rows at any zoom the map reads.
const LOS_ANGELES = latLngToCell(34.05, -118.25, 7);

const cellsOf = (html: string) =>
  [...html.matchAll(/data-testid="amap-area" data-cell="([0-9a-f]+)"/g)].map((m) => m[1]!);

async function landing(env: Record<string, unknown>, path = '/'): Promise<string> {
  const res = await handleLandingPage(
    env as never,
    null,
    new Request(`https://oursharedevents.com${path}`)
  );
  expect(res.status).toBe(200);
  return res.text();
}

/** A street bucket with a tile for every tile the landing's frame reads. */
async function streetBucket() {
  const cells = cellsOf(await landing({}));
  expect(cells.length).toBeGreaterThan(0);
  const { tiles } = tilesForCells(cells);
  return fakeBucket(DEFAULT_ARCHIVE, await pmtilesArchive(tiles, { gzip: true }));
}

function streetLines(log: { mock: { calls: unknown[][] } }) {
  return log.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => s.includes('"STREET_LAYER"'))
    .map((s) => JSON.parse(s) as Record<string, unknown>);
}

/** Forget what the setup calls counted, so a test reads only its own page. */
function forget() {
  state.streetCalls.length = 0;
  state.passes.length = 0;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetPmtilesCache();
  state.rows = sentinel(MANY);
  forget();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the landing's street call", () => {
  it('names the landing as the surface in the STREET_LAYER line', async () => {
    const bucket = await streetBucket();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(html).toContain('data-testid="amap-streets"');
    const lines = streetLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ outcome: 'drew', surface: 'landing' });
  });

  it('a street layer: two passes, the second with it, for exactly the cells drawn', async () => {
    const bucket = await streetBucket();
    forget();
    const html = await landing({ STREET_MAP: 'on', MAP_TILES: bucket });
    expect(state.passes).toEqual([false, true]);
    expect(state.streetCalls).toEqual([cellsOf(html)]);
  });

  it('no street layer: one pass, never a second with nothing to add', async () => {
    const broken = fakeBucket(DEFAULT_ARCHIVE, new Uint8Array(500).fill(1));
    for (const env of [{}, { STREET_MAP: 'on' }, { STREET_MAP: 'on', MAP_TILES: broken }]) {
      forget();
      const html = await landing(env);
      expect(html).not.toContain('data-testid="amap-streets"');
      expect(cellsOf(html).length).toBeGreaterThan(0);
      // The layer was asked for, and none came back.
      expect(state.streetCalls).toHaveLength(1);
      expect(state.passes).toEqual([false]);
    }
    expect(broken.gets.length).toBeGreaterThan(0);
  });

  it('no hexagon drawn: the street layer is not asked for', async () => {
    const bucket = await streetBucket();
    const env = { STREET_MAP: 'on', MAP_TILES: bucket };
    // No event at all: the empty area, with no map.
    state.rows = [];
    forget();
    const empty = await landing(env);
    expect(cellsOf(empty)).toEqual([]);
    expect(state.streetCalls).toEqual([]);
    expect(state.passes).toEqual([false]);
    // Zoomed in on an area with no event: no hexagon to put streets under.
    state.rows = sentinel(MANY);
    forget();
    const zoomed = await landing(env, `/?area=${LOS_ANGELES}`);
    expect(zoomed).toContain('data-testid="amap-zoom-empty"');
    expect(state.streetCalls).toEqual([]);
    expect(state.passes).toEqual([false]);
  });
});
