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
import { expect, type Locator, type Page } from '@playwright/test';
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

export const dotOf = (page: Page, n: number): Locator =>
  page.locator(`[data-testid="amap-dot"][href="#amap-dot-${n}"]`);

/**
 * Open place `n` the way a visitor does: tap its dot when the street map is
 * drawn, else follow its link (`#amap-dot-N`), one history entry either way.
 * The zoomed page has no text list of places (owner, 2026-11-17); the event
 * cards are the list, and a panel opens from a dot or a shared link.
 * A dot a When pill has hidden (`display:none`) cannot be tapped, and a click on
 * it waits for the whole test timeout (OSE-2138); it is followed by its link.
 */
export async function openPlace(page: Page, n: number): Promise<void> {
  const dot = dotOf(page, n);
  if (await dot.isVisible()) await dot.click();
  else await page.evaluate((h) => (window.location.hash = h), `#amap-dot-${n}`);
}

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

// The stg edge helpers moved to ./stg-edge.ts, where the launch story smoke uses
// them too. They are still offered from here, so the map specs read as before.
export { passStgEdge, throwIfEdgeAnswered } from './stg-edge';
