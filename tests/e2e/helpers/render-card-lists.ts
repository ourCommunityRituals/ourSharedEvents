/**
 * The sponsor's home and a fair's stall list as the Worker renders them, for the
 * card-pager component spec (tests/e2e/2-pages/card-pager.component.spec.ts).
 * Pure renders: the handlers read rows and hand them to these, so the spec hands
 * them rows of its own. The Worker's sources are bundled with its own esbuild,
 * as tests/e2e/helpers/render-vote-page.ts does.
 */
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKER_DIR = resolve(__dirname, '../../../workers/oursharedevents');

interface Bundle {
  renderSponsorHomePage: (input: unknown) => string;
  renderBoothListPage: (input: unknown) => string;
  renderBoothPage: (input: unknown) => string;
  serveCss: () => Response;
}

let loaded: Promise<Bundle> | null = null;

function load(): Promise<Bundle> {
  loaded ??= (async () => {
    const req = createRequire(join(WORKER_DIR, 'package.json'));
    const esbuild = req('esbuild') as { build: (options: object) => Promise<unknown> };
    const outfile = join(mkdtempSync(join(tmpdir(), 'ose-card-lists-')), 'card-lists.cjs');
    await esbuild.build({
      stdin: {
        contents:
          "export { renderSponsorHomePage } from './src/lib/sponsor-home-render.ts';\n" +
          "export { renderBoothListPage } from './src/lib/booth-list-render.ts';\n" +
          "export { renderBoothPage } from './src/lib/booth-page-render.ts';\n" +
          "export { serveCss } from '@ocr/ui';\n",
        resolveDir: WORKER_DIR,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      loader: { '.html': 'text' },
      logLevel: 'error',
    });
    return req(outfile) as Bundle;
  })();
  return loaded;
}

/** A sponsor's home with this many placements, requests and events it could back. */
export async function renderSponsorHome(
  placements: number,
  requests: number,
  could: number
): Promise<string> {
  const b = await load();
  return b.renderSponsorHomePage({
    sponsor: { id: 'sb_component', name: 'Corner Bakery' },
    placements: Array.from({ length: placements }, (_, i) => ({
      placement_id: `p${i}`,
      event_id: `pe${i}`,
      tier: 'gold',
      locality_band: 0,
      organizer_accepted: 1,
      sponsor_accepted: 1,
      placement_active: 1,
      title: `Bocce Night ${i + 1}`,
      status: 'active',
      start_date: '2099-10-01',
      end_date: null,
      location: 'Eagles Hall',
      is_published: 1,
    })),
    expiresIso: '2099-11-10T12:00:00Z',
    requests: Array.from({ length: requests }, (_, i) => ({
      placement_id: `r${i}`,
      event_id: `re${i}`,
      title: `Fish Fry ${i + 1}`,
      start_date: '2099-10-03',
      organizer_accepted: null,
    })),
    discoverable: Array.from({ length: could }, (_, i) => ({
      id: `d${i}`,
      title: `Trivia Night ${i + 1}`,
      start_date: '2099-10-02',
      location: 'Open OutCry',
      near: i % 4 === 3 ? 1 : 0,
    })),
  });
}

/** A fair's stall list with this many food stalls and this many craft stalls. */
export async function renderStalls(food: number, craft: number): Promise<string> {
  const b = await load();
  const stall = (cat: string, n: number, i: number) => ({
    id: `${cat}${i}`,
    number: `${n + i}`,
    name: `${cat === 'food' ? 'Tamales' : 'Pottery'} stand ${i + 1}`,
    category: cat,
    hall_x: null,
    hall_y: null,
  });
  return b.renderBoothListPage({
    event: { id: 'fair_component', title: 'Harvest Fair', slug: 'harvest-fair' },
    when: 'Saturday, October 3',
    booths: [
      ...Array.from({ length: food }, (_, i) => stall('food', 1, i)),
      ...Array.from({ length: craft }, (_, i) => stall('craft', 100, i)),
    ],
    sponsors: [],
    noindex: true,
  });
}

/** The stops of the passport walk the passport component spec drives. */
export const PASSPORT_WALK = {
  id: 'walk_component',
  stops: ['1', '2', '3'],
} as const;

const walkStop = (n: string) => ({
  id: `stop${n}`,
  number: n,
  name: `Gallery ${n}`,
  category: 'art',
  hall_x: null,
  hall_y: null,
});

/** One stop's page on a walk with the stamp passport on (or off, for the control). */
export async function renderPassportStop(stop: string, passport = true): Promise<string> {
  const b = await load();
  return b.renderBoothPage({
    event: { id: PASSPORT_WALK.id, title: 'First Friday Art Walk', slug: null },
    when: 'Friday, June 4',
    booth: walkStop(stop),
    sponsors: [],
    noindex: true,
    passportStops: passport ? [...PASSPORT_WALK.stops] : null,
  });
}

/** The walk's list of stops, passport on. */
export async function renderPassportList(): Promise<string> {
  const b = await load();
  return b.renderBoothListPage({
    event: { id: PASSPORT_WALK.id, title: 'First Friday Art Walk', slug: null },
    when: 'Friday, June 4',
    booths: PASSPORT_WALK.stops.map(walkStop),
    sponsors: [],
    noindex: true,
    passport: true,
  });
}

/** The stylesheet the Worker serves at /ui.css. */
export async function cardListsUiCss(): Promise<string> {
  const b = await load();
  return b.serveCss().text();
}
