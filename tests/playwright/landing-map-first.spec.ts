/**
 * The map-first landing, measured on the pull request (OSE-2160, F-52).
 *
 * At ten or more events in the default window (LIST_MAX, lib/landing-area.ts)
 * the landing leads with the map and the doors move under it. The local worker
 * the phone audit boots is migrated and empty, so the global setup leaves it
 * with a handful of events: the audit measured the list-first layout and the
 * map-first layout was measured only by the nightly run on staging. A change
 * that pushed the action below the map passed every pull request.
 *
 * This spec tops the local worker up to ten events in `beforeAll`, through the
 * admin API (the same door an organizer uses), and measures the page that
 * results. It is not in the global setup on purpose: the global setup seeds the
 * lifecycle events every other spec reads, and ten events there would change the
 * page for all of them. The events are archived in `afterAll`, so the specs that
 * run after this one see the page as they did before.
 *
 * Born red: SEED_TOTAL = 9 leaves the doors leading and the "map leads" cases
 * fail. The seed is counted, not assumed: it reads how many cards the landing
 * already shows in the window and adds the difference.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts). Relative URLs
 * only: the config owns the host.
 */
import { request, test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { assertActionAboveFold } from './helpers/fold-gate';
import { createLiveEvent, waitUntilListed } from './helpers/sponsor-home-seed';

/** LIST_MAX in workers/oursharedevents/src/lib/landing-area.ts: the map leads at this many. */
const SEED_TOTAL = 9;
const PHONE = { width: 375, height: 812 };
/** The landing's default window (DEFAULT_WINDOW) puts a card in this class. */
const IN_WINDOW = '[data-testid="area-card"].when-next-90';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const seeded: string[] = [];
let ctx: APIRequestContext;

/** How many cards the landing shows in its default window, read from the page. */
async function windowCount(c: APIRequestContext): Promise<number> {
  const res = await c.get('/');
  expect(res.status(), 'GET /').toBe(200);
  const html = await res.text();
  return (html.match(/<article class="[^"]*\bwhen-next-90\b[^"]*" data-testid="area-card"/g) ?? [])
    .length;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Seeding is a few requests each, and the last event waits out the publish grace
  // window (a minute on this worker) before the landing lists it.
  test.setTimeout(180_000);
  const baseURL = test.info().project.use.baseURL;
  expect(baseURL, 'the config names a base URL').toBeTruthy();
  expect(ADMIN_BEARER, 'the config sets the local admin key').not.toBe('');
  ctx = await request.newContext({ baseURL });
  const have = await windowCount(ctx);
  const need = Math.max(0, SEED_TOTAL - have);
  let listedFrom: string | null = null;
  for (let i = 0; i < need; i++) {
    const made = await createLiveEvent(
      ctx,
      ADMIN_BEARER,
      `Map first ${Date.now().toString(36)}${i}`,
      20 + i,
      // One part of town each, so the map has something to draw.
      { lat: 41.85 + i * 0.02, lon: -87.65 + i * 0.02 }
    );
    seeded.push(made.id);
    listedFrom = made.listedFrom;
  }
  // The publish grace window (1 minute on this worker) keeps a new event off the list.
  await waitUntilListed(listedFrom);
  expect(await windowCount(ctx), `the landing shows at least ${SEED_TOTAL} events`).toBeGreaterThan(
    SEED_TOTAL - 1
  );
});

test.afterAll(async () => {
  const headers = { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' };
  for (const id of seeded) {
    await ctx.put(`/api/v2/admin/events/${encodeURIComponent(id)}`, {
      headers,
      data: { status: 'archived' },
    });
  }
  await ctx.dispose();
});

async function open(page: Page, path: string): Promise<void> {
  await page.setViewportSize(PHONE);
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(res?.status(), `GET ${path}`).toBe(200);
}

test.describe('landing at ten or more events: the map leads', () => {
  test('the window holds ten or more events', async ({ page }) => {
    await open(page, '/');
    expect(await page.locator(IN_WINDOW).count()).toBeGreaterThan(SEED_TOTAL - 1);
  });

  test('the page opens on the map view, not the list', async ({ page }) => {
    await open(page, '/');
    await expect(page.locator('#view-map')).toBeChecked();
    await expect(page.locator('#view-list')).not.toBeChecked();
  });

  test('the doors sit under the map, not above it', async ({ page }) => {
    await open(page, '/');
    const map = await page.getByTestId('area-map').boundingBox();
    const doors = await page.getByTestId('landing-doors').boundingBox();
    expect(map, 'the map has a box').not.toBeNull();
    expect(doors, 'the doors have a box').not.toBeNull();
    expect(doors!.y, 'doors follow the map when the map leads').toBeGreaterThan(map!.y);
  });

  test('the action is above the fold and the map starts on the first screen', async ({ page }) => {
    await open(page, '/');
    await assertActionAboveFold(
      page,
      'landing (map first)',
      '[data-testid="where-submit"]',
      PHONE.height
    );
    const map = await page.getByTestId('area-map').boundingBox();
    expect(map, 'the map has a box').not.toBeNull();
    expect(
      map!.y,
      `the map starts above the fold (top ${Math.round(map!.y)}px, screen ${PHONE.height}px)`
    ).toBeLessThan(PHONE.height);
  });

  test('the map address leads with the map too', async ({ page }) => {
    await open(page, '/map');
    await expect(page.locator('#view-map')).toBeChecked();
    await assertActionAboveFold(page, 'map', '[data-testid="area-map"]', PHONE.height);
  });
});
