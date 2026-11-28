/**
 * The landing page as the Worker renders it over a street map, with no Worker,
 * no D1 and no R2 (street-map CCR 2026-11-15, findings R24 and R38).
 *
 * Staging has no street-map archive, so no deployed page draws dots or town
 * names. The component layer needs the real markup and the real CSS in a real
 * browser, over a street layer. This bundles the landing handler
 * (`handleLandingPage` in workers/oursharedevents/src/handlers/pages.ts),
 * `serveCss` from @ocr/ui and the street-map test writers
 * (workers/oursharedevents/tests/helpers/street-map-fixtures.ts) with esbuild,
 * the bundler wrangler itself uses, and loads `.html` as text as
 * wrangler.toml's Text rule does.
 *
 * Two modules are swapped while bundling, as the worker specs swap them with
 * `vi.mock` (tests/street-map-landing.spec.ts): the data provider answers with
 * the rows the spec passes in, and no sponsor title is read. Everything else is
 * the shipped code: the page shell, the map, the reader and the drawer. The
 * archive is synthetic (a highway, a minor road and a lake in every tile, and a
 * town name in each): it proves sizes and layout, never what a real tile holds.
 *
 * Bundled once per Playwright worker into a temp folder; never written into the
 * repository.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER_DIR = resolve(__dirname, '../../../workers/oursharedevents');

/** Not the production host: ADR-021 keeps it out of test code. */
export const ORIGIN = 'http://street-map.component.test';

type Row = Record<string, unknown>;
type Pt = [number, number];
interface FixtureLayer {
  name: string;
  features: { type: 1 | 2 | 3; props: Record<string, string | number>; parts: Pt[][] }[];
}
interface Bucket {
  gets: unknown[];
}

interface Bundle {
  handleLandingPage: (env: unknown, ctx: null, request: Request) => Promise<Response>;
  handlePublicPage: (env: unknown, ctx: null, request: Request) => Promise<Response>;
  serveCss: () => Response;
  DEFAULT_ARCHIVE: string;
  resetPmtilesCache: () => void;
  fakeBucket: (name: string, bytes: Uint8Array) => Bucket;
  pmtilesArchive: (tiles: unknown[], opts: { gzip: boolean }) => Promise<Uint8Array>;
  tilesForCells: (
    cells: string[],
    extra: (x: number, y: number) => FixtureLayer[]
  ) => { tiles: unknown[] };
}

/** Where the swapped data provider finds the spec's rows. */
const ROWS_KEY = '__oseComponentLandingRows';

let loaded: Promise<Bundle> | null = null;

function load(): Promise<Bundle> {
  loaded ??= (async () => {
    const req = createRequire(join(WORKER_DIR, 'package.json'));
    // wrangler's own bundler; installed with the Worker's dependencies.
    const esbuild = req('esbuild') as { build: (options: object) => Promise<unknown> };
    const outfile = join(mkdtempSync(join(tmpdir(), 'ose-component-')), 'landing.cjs');
    const real = (file: string) => JSON.stringify(join(WORKER_DIR, 'src', 'lib', file));
    const swaps: Record<string, string> = {
      'data-provider':
        `export * from ${real('data-provider.ts')};\n` +
        `export function getDataProvider() {\n` +
        `  return { listEvents: async () => ({ data: globalThis.${ROWS_KEY} ?? [], source: 'live', cacheAge: null }) };\n` +
        `}\n`,
      'sponsor-titles': `export async function fetchSponsorTitles() { return new Map(); }\n`,
    };
    await esbuild.build({
      stdin: {
        contents:
          "export { handleLandingPage, handlePublicPage } from './src/handlers/pages.ts';\n" +
          "export { serveCss } from '@ocr/ui';\n" +
          "export { DEFAULT_ARCHIVE } from './src/lib/street-map.ts';\n" +
          "export { resetPmtilesCache } from './src/lib/pmtiles.ts';\n" +
          "export { fakeBucket, pmtilesArchive, tilesForCells } from './tests/helpers/street-map-fixtures.ts';\n",
        resolveDir: WORKER_DIR,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      loader: { '.html': 'text' },
      logLevel: 'error',
      plugins: [
        {
          name: 'landing-swaps',
          setup(build: {
            onResolve: (
              o: { filter: RegExp },
              cb: (a: { path: string; namespace: string }) => object | undefined
            ) => void;
            onLoad: (
              o: { filter: RegExp; namespace: string },
              cb: (a: { path: string }) => object
            ) => void;
          }) {
            // The handlers import '../lib/data-provider.js' and '../lib/sponsor-titles'.
            // Relative imports only: the package `@ocr/data-provider` is left alone,
            // and so is the real file, which the swap itself names by its full path.
            build.onResolve(
              { filter: /^\.{1,2}\/(.*\/)?(data-provider|sponsor-titles)(\.js)?$/ },
              (a) => {
                const name = /(data-provider|sponsor-titles)(\.js)?$/.exec(a.path)![1]!;
                return { path: name, namespace: 'landing-swap' };
              }
            );
            build.onLoad({ filter: /.*/, namespace: 'landing-swap' }, (a) => ({
              contents: swaps[a.path],
              loader: 'ts',
              resolveDir: join(WORKER_DIR, 'src', 'lib'),
            }));
          },
        },
      ],
    });
    return req(outfile) as Bundle;
  })();
  return loaded;
}

const TOWNS = ['Blue Island', 'Calumet Park', 'Riverdale', 'Posen', 'Dixmoor', 'Midlothian'];

const STREETS = ['Western Ave', 'Kedzie Ave', 'Vermont St', 'Grove St', 'Burr Oak Ave'];
const PARKS = ['Memorial Park', 'Centennial Park', 'Kelly Park', 'Hart Park'];

/**
 * In every tile: a town name in the middle, as the Protomaps `places` layer has
 * them; a named major street across its lower part; and a park, so street
 * names and landmarks (lib/street-labels.ts) are drawn and measured too.
 */
const towns = (x: number, y: number): FixtureLayer[] => [
  {
    name: 'roads',
    features: [
      {
        type: 2,
        props: { kind: 'major_road', name: STREETS[(x + y * 2) % STREETS.length]! },
        parts: [
          [
            [0, 3100],
            [4096, 3100],
          ],
        ],
      },
    ],
  },
  {
    name: 'pois',
    features: [
      {
        type: 1,
        props: { kind: 'park', name: PARKS[(x * 2 + y) % PARKS.length]!, min_zoom: 12 },
        parts: [[[900, 2600]]],
      },
    ],
  },
  {
    name: 'places',
    features: [
      {
        type: 1,
        props: {
          kind: 'locality',
          name: TOWNS[(x * 3 + y) % TOWNS.length]!,
          population_rank: 5 + ((x + y) % 4),
        },
        parts: [[[2048, 1400]]],
      },
    ],
  },
];

async function page(b: Bundle, path: string, env: Record<string, unknown>): Promise<string> {
  b.resetPmtilesCache();
  const res = await b.handleLandingPage(env, null, new Request(`${ORIGIN}${path}`));
  if (res.status !== 200) throw new Error(`landing ${path} answered ${res.status}`);
  return res.text();
}

/**
 * The landing at `path` (`/`, or `/?area=<res-7 cell>` for the zoomed area)
 * holding `rows`, drawn over a street layer made for exactly the cells it shows.
 * With `streets: false` it is the page with no archive.
 */
export async function renderLanding(
  path: string,
  rows: Row[],
  opts: { streets: boolean; env?: Record<string, unknown> } = { streets: true }
): Promise<string> {
  const b = await load();
  (globalThis as Record<string, unknown>)[ROWS_KEY] = rows;
  try {
    const extra = opts.env ?? {};
    const plain = await page(b, path, { ...extra });
    if (!opts.streets) return plain;
    const zoom = /data-zoom="([0-9a-f]{15})"/.exec(plain)?.[1];
    const cells = zoom
      ? [zoom]
      : [...plain.matchAll(/data-testid="amap-area" data-cell="([0-9a-f]+)"/g)].map((m) => m[1]!);
    if (cells.length === 0)
      throw new Error(`landing ${path} drew no map area to put streets under`);
    const { tiles } = b.tilesForCells(cells, towns);
    const bucket = b.fakeBucket(b.DEFAULT_ARCHIVE, await b.pmtilesArchive(tiles, { gzip: true }));
    // The street layer is behind a switch the Worker reads (STREET_MAP, off
    // unless it is exactly 'on'): the page draws no street without it.
    const html = await page(b, path, { ...extra, MAP_TILES: bucket, STREET_MAP: 'on' });
    if (!html.includes('data-testid="amap-streets"')) {
      throw new Error(`landing ${path} drew no street layer over its synthetic archive`);
    }
    return html;
  } finally {
    delete (globalThis as Record<string, unknown>)[ROWS_KEY];
  }
}

/**
 * The /events page at `path` (`/events`, `/events?when=past`) holding `rows`, as
 * the Worker renders it (lib/event-list.ts). No map and no street layer: the
 * page has neither.
 */
export async function renderEvents(path: string, rows: Row[]): Promise<string> {
  const b = await load();
  (globalThis as Record<string, unknown>)[ROWS_KEY] = rows;
  try {
    const res = await b.handlePublicPage({}, null, new Request(`${ORIGIN}${path}`));
    if (res.status !== 200) throw new Error(`events ${path} answered ${res.status}`);
    return res.text();
  } finally {
    delete (globalThis as Record<string, unknown>)[ROWS_KEY];
  }
}

/**
 * Run `fn` with the clock this process reads (`new Date()` and `Date.now()`) held
 * at `now`, then put the real one back. The landing is rendered in this process
 * (the Worker's "today", "this weekend" and "next 7 days" windows read it), so a
 * spec that seeds events relative to the day can be run on any weekday. Keep
 * only the render inside `fn`: nothing else may wait on the real clock meanwhile.
 */
export async function withClock<T>(now: string | number | Date, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const t = new RealDate(now).getTime();
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      super(...((args.length === 0 ? [t] : args) as [any]));
    }
    static override now() {
      return t;
    }
  }
  globalThis.Date = FakeDate as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/**
 * A stand-in for the `DB` binding that answers the event-type catalog's two reads
 * (lib/event-type-catalog-read.ts) and nothing else, so the landing draws its Type
 * row. Pass it as `env: { DB: fakeCatalogDb(...) }`. Every other read comes back empty.
 */
export function fakeCatalogDb(
  categories: { category_code: string; display_name: string; display_order: number }[],
  types: { id: string; uec_code: string; name: string; category_code: string }[]
): unknown {
  const answer = (sql: string) =>
    /event_type_bucket|event_type_category_registry/.test(sql)
      ? categories.map((c) => ({ ...c, is_active: 1 }))
      : /event_type_registry/.test(sql)
        ? types.map((t) => ({ ...t, description: null, is_active: 1 }))
        : [];
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        all: async () => ({ results: answer(sql) }),
        first: async () => null,
        run: async () => ({ success: true, meta: {} }),
      };
      return stmt;
    },
  };
}

/** The stylesheet the Worker serves at /ui.css (@ocr/ui: tokens and base rules). */
export async function uiCss(): Promise<string> {
  const b = await load();
  return b.serveCss().text();
}
