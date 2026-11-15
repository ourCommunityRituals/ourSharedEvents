/**
 * What the two map specs share: the seeded area and how to read which place
 * panels are open (epic OSE-1880).
 *
 *   tests/e2e/3-flows/map-place-panel.spec.ts          behaviour, one profile
 *   tests/e2e/2-pages/map-place-panel-layout.spec.ts   layout, one project per profile
 *
 * Fixture: bruno/fixtures/map-zoom-area-seed.sql. Ten synthetic events in one
 * res-7 area, at three places:
 *   place 1  map-zoom-a        a business; tickets and donation links; share code MZPANA
 *   place 2  map-zoom-b, -c    b has a tickets link and share code MZPANB; c has neither
 *   place 3  map-zoom-d .. -j  d is 3 days out, the rest 20 days or more
 * CI applies it right before these specs and unpublishes it right after.
 */
import { resolve } from 'node:path';
import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { edgeChallenged, edgeHeaders } from '../../../scripts/ci/edge-read.mjs';
import {
  FLAG,
  STAGING_ENV_FILE,
  streetMapArchiveLoaded,
} from '../../../scripts/ci/street-map-flag.mjs';

export const BASE_URL = (process.env.BASE_URL || 'https://stg.oursharedevents.com').replace(
  /\/+$/,
  ''
);

/** The seeded res-7 area. */
export const AREA = '872664405ffffff';
export const AREA_PATH = `/?area=${AREA}`;
export const PLACES = [1, 2, 3] as const;

/** Event ids by place, in card order (by date). */
export const EVENTS_AT: Record<number, string[]> = {
  1: ['map-zoom-a'],
  2: ['map-zoom-b', 'map-zoom-c'],
  3: [
    'map-zoom-d',
    'map-zoom-e',
    'map-zoom-f',
    'map-zoom-g',
    'map-zoom-h',
    'map-zoom-i',
    'map-zoom-j',
  ],
};

export const TITLE: Record<string, string> = {
  'map-zoom-a': 'Map Zoom Check (league night)',
  'map-zoom-b': 'Map Zoom Check (block party)',
  'map-zoom-c': 'Map Zoom Check (yard sale)',
  'map-zoom-d': 'Map Zoom Check (repair cafe)',
};

export const panel = (page: Page, n: number): Locator =>
  page.locator(`[data-testid="amap-panel"][data-n="${n}"]`);

export const placeRow = (page: Page, n: number): Locator =>
  page.locator(`[data-testid="amap-place-link"][href="#amap-dot-${n}"]`);

export const card = (page: Page, eventId: string): Locator =>
  page.locator(`[data-testid="amap-card"][data-event-id="${eventId}"]`);

/** The numbers of the place panels that are on show, in page order. */
export async function openPanels(page: Page): Promise<number[]> {
  return page
    .locator('[data-testid="amap-panel"]')
    .evaluateAll((els) =>
      els
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => Number(el.getAttribute('data-n')))
    );
}

/**
 * Open the seeded area (optionally on a `#hash`) and prove the fixture is there.
 * No skip: an area that is not seeded fails the test by name. A gate that skips
 * when its data is missing stays green while checking nothing.
 */
export async function gotoArea(page: Page, hash = ''): Promise<void> {
  const res = await page.goto(`${BASE_URL}${AREA_PATH}${hash}`, { waitUntil: 'domcontentloaded' });
  if (res) {
    const headers = res.headers();
    if (headers['cf-mitigated']) {
      throw new Error(
        `Cloudflare answered ${AREA_PATH}, not the Worker (cf-mitigated: ${headers['cf-mitigated']})`
      );
    }
    expect(res.status(), `${AREA_PATH} should answer 200`).toBe(200);
  }
  const zoomed = await page.locator(`[data-testid="amap"][data-zoom="${AREA}"]`).count();
  const panels = await page.locator('[data-testid="amap-panel"]').count();
  if (zoomed !== 1 || panels !== PLACES.length) {
    throw new Error(
      `precondition unmet: ${AREA_PATH} shows ${zoomed} zoomed map(s) and ${panels} place panel(s), ` +
        `expected 1 and ${PLACES.length}. Is bruno/fixtures/map-zoom-area-seed.sql applied?`
    );
  }
}

/**
 * Does the environment say the street-map archive is loaded? Read from the Bruno
 * staging environment file, the one place that says so (scripts/ci/street-map-flag.mjs).
 */
export const STREETS_LOADED: boolean = streetMapArchiveLoaded(resolve(__dirname, '../../..'));

/**
 * What the zoomed area draws above its place list. There are two whole pages,
 * and nothing between them passes:
 *
 *   'streets'  the street layer, the area's outline over it and a dot per place,
 *              with no "street map is not here" note
 *   'list'     the note, and no drawing at all: a dot is drawn only over streets
 *
 * The flag decides whether 'list' is allowed. While it is "false" either page
 * passes, so the day the archive is loaded turns nothing red. Once it is "true"
 * a page with no street layer fails here by name.
 */
export async function expectZoomDrawing(page: Page): Promise<'streets' | 'list'> {
  const drawn = (await page.getByTestId('amap-streets').count()) > 0;
  if (!drawn) {
    expect(
      STREETS_LOADED,
      `${STAGING_ENV_FILE} says the street-map archive is loaded (${FLAG} is "true"), ` +
        `and ${AREA_PATH} drew no street layer`
    ).toBe(false);
    await expect(page.getByTestId('amap-no-tiles')).toBeVisible();
    await expect(page.getByTestId('amap-svg')).toHaveCount(0);
    await expect(page.getByTestId('amap-zone')).toHaveCount(0);
    await expect(page.getByTestId('amap-dot')).toHaveCount(0);
    return 'list';
  }
  await expect(page.getByTestId('amap-svg')).toBeVisible();
  await expect(page.locator(`[data-testid="amap-zone"][data-cell="${AREA}"]`)).toHaveCount(1);
  // The streets lie under the outline and the dots, inside the one drawing.
  await expect(
    page.locator('[data-testid="amap-svg"] > [data-testid="amap-streets"]:first-child')
  ).toHaveCount(1);
  // A dot per place of the fixture, so at least one.
  await expect(page.getByTestId('amap-dot')).toHaveCount(PLACES.length);
  await expect(page.getByTestId('amap-no-tiles')).toHaveCount(0);
  return 'streets';
}

/**
 * Let this page's reads of the site pass the stg edge, as CI's other reads do.
 *
 * From a GitHub runner the Cloudflare edge answers a read of `/events/<id>…` on stg
 * with a managed challenge (403, cf-mitigated) unless it carries the X-OCR-CI
 * header the stg skip rule matches (docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md;
 * the stg watch `edge` job shows both answers). `/` is not challenged, which is
 * why the area page needs nothing.
 *
 * The header goes on requests to BASE_URL's own origin and on nothing else, so
 * the token never reaches another host. The Worker does not read X-OCR-CI
 * (nothing under workers/oursharedevents/src names it), so a read with it is
 * counted, or not counted, exactly as a visitor's is. With no token set (a local
 * Worker has no edge) nothing is added.
 */
export async function passStgEdge(page: Page): Promise<void> {
  const headers = edgeHeaders();
  if (Object.keys(headers).length === 0) return;
  const origin = new URL(BASE_URL).origin;
  await page.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), ...headers } })
  );
}

/**
 * Fail by name when the edge answered a navigation, not the Worker. A challenge
 * is never a pass and never a skip here: a link the walk could not follow proves
 * nothing about what following it counts.
 */
export function throwIfEdgeAnswered(res: Response | null, path: string): void {
  if (!res || !edgeChallenged(res.status(), res.headers())) return;
  const sent = edgeHeaders()['X-OCR-CI']
    ? 'with X-OCR-CI: the stg skip rule did not let it through (path not covered, or another token)'
    : 'without X-OCR-CI: OCR_CI_EDGE_TOKEN is not set for this step';
  throw new Error(
    `Cloudflare answered ${path}, not the Worker (cf-mitigated: ${res.headers()['cf-mitigated']}; ` +
      `sent ${sent}). See docs/runbooks/RUNBOOK-STG-CI-SKIP-RULE.md.`
  );
}
