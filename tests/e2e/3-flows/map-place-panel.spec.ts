/**
 * The zoomed landing map, its place panels and its links, in a real browser
 * (epic OSE-1880; CI/CD tickets OSE-1886 zoom, OSE-1891 panel, OSE-1896 links).
 *
 * This is the staging layer. The mock layer is the workers pool
 * (workers/oursharedevents/tests/map-zoom.spec.ts, map-place-links.spec.ts,
 * street-map-landing.spec.ts); the HTML contract is Bruno
 * (bruno/ose-pages/16. Landing Map Zoom). What only a browser can show is here:
 * `:target` opening one panel, Back, the keyboard, the pills, Share, a page with
 * scripts off, axe in both themes, and that using the map moves no count.
 *
 * Fixture: bruno/fixtures/map-zoom-area-seed.sql (see helpers/map-zoom-area.ts).
 * The zoomed area is one of two whole pages (helpers/map-zoom-area.ts,
 * expectZoomDrawing): with no street layer it is the note, the place list and
 * the panels; with one it is the dot map over the streets, the same list and the
 * same panels. Every test below works a row of the list, which both pages have.
 * Staging has no street-map archive yet, so it shows the first page, and
 * `streetMapArchiveLoaded` in bruno/ose-pages/environments/ose-staging.yml is
 * "false". The first test passes on either page while that is so, so loading the
 * archive turns nothing red; once the flag is "true" it fails on a page with no
 * streets. The dot map's own behaviour is proven at the mock layer until then.
 *
 * Runs on one profile (project `e2e-smoke`). The button grid runs on one project
 * per device profile: tests/e2e/2-pages/map-place-panel-layout.spec.ts.
 *
 * BORN RED (2026-11-14, local Worker on this branch rebased on main; one fault at
 * a time injected in workers/oursharedevents/src or in the local D1, the tests
 * run, the fault taken out). What is written is what was seen, test by test:
 *   F1  PLACE_PANEL_CSS: the `.amap-t:target + .amap-p` rule no longer matches
 *         -> 13 of the 17 tests fail: every test that opens a panel (tap, Prev and
 *            Next, shared link, keyboard, scripts off, pills, both Share tests, the
 *            four axe tests, moves no count). The three `#amap-dot-99/0/x` tests
 *            and the hexagon test stay green, as they open no panel.
 *   F2  PLACE_PANEL_CSS: `.amap-p` no longer hidden (all three panels show)
 *         -> 12 of 17 fail: tap, Prev and Next, shared link, the three
 *            `#amap-dot-99/0/x` tests, keyboard, scripts off, the four axe tests
 *   F3  panelNav: Next links to its own place
 *         -> "Prev and Next walk the places…" fails
 *   F3b panelNav: the last place gets a Next (to a place 4)
 *         -> "Prev and Next walk the places…" fails
 *   F4  panelActions: "Open event" of map-zoom-a goes through `/s/mzPub1`
 *         -> "using the map moves no count…" fails; the D1 count check
 *            (scripts/ci/map-counts-check.mjs) then reads taps_a 43 and a daily
 *            tap row, and fails too
 *   F5  shareScript: shares the first button on the page, not the pressed one
 *         -> "Share hands the share sheet that card's own link and title" fails
 *   F6a shareScript: the copied label is never set
 *   F6b shareScript: copies the page address, not the event link
 *         -> each: "with no share sheet, Share copies the link and says so" fails
 *   F7  PLACE_PANEL_CSS: focus ring removed from the place rows and the chips
 *         -> "keyboard…" fails
 *   F8  the panel title rendered as a second `<h1>`
 *         -> "a tap on a place row opens only its panel…" and the four axe tests fail
 *   F9  landing filter CSS no longer covers `.amap-f`
 *         -> "the When pills filter the places" fails
 *   F10 renderZoom: the way back links to `#`
 *         -> "a tap on the area's hexagon zooms in…" fails
 *   F11 panelNav: the Prev chip has no text (a link with no name)
 *         -> the four axe tests fail
 *   F12 PLACE_PANEL_CSS: the target span no longer sits at the top of the map block
 *         -> "a tap on a place row opens only its panel, at the top of the screen" fails
 *   F13 PLACE_PANEL_CSS: the panel's meta line drawn in the background colour
 *         -> first run: NOTHING failed. axe calls text with no contrast at all
 *            "incomplete", not a violation, and the test only logged that. The
 *            test now fails on any rule axe could not decide; with that, the four
 *            axe tests fail on this fault.
 *   F13b the same line drawn faint (30% of its colour over the background)
 *         -> the four axe tests fail (a color-contrast violation)
 *   F14 panelNav: the Prev chip named "Go" while it shows "Place N" (the known
 *       defect below, on another element)
 *         -> the four axe tests fail: the excused rule is excused on "Open event" only
 *   B1  renderZoom: the no-street-map note loses its test id
 *         -> "a tap on a place row opens only its panel…" fails
 *       (seen again 2026-11-15 as S6 below, through expectZoomDrawing)
 *   B2  renderPlacePanel: target ids start at 2 (a row opens the wrong place)
 *         -> "a shared link to #amap-dot-2…" and "scripts off…" fail
 *   B4  map-place-links: a code taken off the poster is offered
 *   B6  panelActions: a "Check in" button on every card
 *         -> each: "using the map moves no count…" fails
 *   B10 eventShareUrl: the share code is ignored
 *         -> both Share tests fail
 *   D1  data: every code of map-zoom-a holds 1 tap (under the floor)
 *         -> "using the map moves no count…" fails (the read is withheld)
 *   D3  data: the fixture is unpublished
 *         -> "a shared link to #amap-dot-2…" and "scripts off…" fail
 * Every test in this file failed under at least one fault. The same faults run
 * against the Bruno folder and the layout spec; the full table is in the PR that
 * added this file.
 *
 * BORN RED (2026-11-15, street-map CCR R21: this spec must stay green the day the
 * street-map archive is loaded, and must not pass on a half-drawn page). A local
 * Worker on this branch (wrangler dev, local D1 with the fixture, local R2), in
 * two states: no archive, and a synthetic archive that draws streets, town names
 * and dots for this area. A test rig: it supports the result, staging is the
 * verdict. First, what the load would have done to this spec as it was: with
 * streets drawn 6 of the 17 tests failed (the note at the head of the first
 * test, the four axe tests, and the link walk). As it is now, 17 pass in both
 * states with the flag "false". Then one fault at a time, each taken out again:
 *   no archive:
 *   T1  the flag file says "true"            -> the first test fails by name
 *   S6  renderZoom: the note loses its test id
 *   S8  renderZoom: dots are drawn with no street layer under them
 *         -> each: the first test fails
 *   streets drawn:
 *   S4  renderZoom: the note is drawn with the streets too
 *   S5  zoomSvg: no dot is drawn
 *   S7  zoomSvg: the area's outline is not drawn
 *   S9  zoomSvg: the streets are drawn over the outline, not under it
 *         -> each: the first test fails
 *   S1  ZOOM_STYLE: the Back link drawn in the background colour
 *         -> the axe test fails: still undecided with the street layer hidden
 *   S2  ZOOM_STYLE: the Back link drawn faint (opacity .3)
 *         -> the axe test fails (a color-contrast violation)
 *   S2b ZOOM_STYLE: the Back link drawn in the border colour
 *         -> the axe test fails: axe leaves it undecided beside the streets, and
 *            the second scan, street layer hidden, calls it a violation
 *   S3  streetCredit: the credit loses its Protomaps link
 *         -> "using the map moves no count…" fails
 *   T2  the flag file says "true"
 *         -> the four axe tests fail by name: axe cannot judge the text drawn on
 *            the map (town names, dot numbers), and the street map is binding.
 *            This is meant. Setting the flag needs that contrast judged first.
 * Not seen failing here: a water-only street layer. This spec does not count
 * roads; the Bruno street cases do, and failed on that layer on the same rig.
 *
 * THE CONTRAST OF TEXT ON THE MAP IS MEASURED (2026-11-16, street-map CCR R27).
 * T2 above was a dead end: with the flag "true" the four axe tests failed because
 * axe could not decide, so the flag could never be set on a green chain. Text
 * drawn on the map is now judged by measurement (helpers/map-text-contrast.ts
 * reads the colours this theme resolved; scripts/ci/map-text-contrast.mjs has
 * the rule), and "not decided" is gone for it:
 *   under its ratio, flag "false"  -> reported: an annotation, and a warning
 *                                     with the figures, once a test
 *   under its ratio, flag "true"   -> the axe test fails by name, with the figures
 *   a text the judge does not know, a dot with no number read, or a node axe
 *   left undecided in the drawing that holds no text -> fails, whatever the flag
 * No street layer is on staging, so no run of this spec has judged a text yet.
 * The judge itself is born red where streets can be drawn today:
 * tests/e2e/2-pages/street-map-contrast.component.spec.ts (the real landing
 * handler over a synthetic archive, both themes, Chromium and WebKit, in T0).
 * What it finds there is what this spec will find on staging once streets are
 * drawn: the number on a pale dot is 2.10:1 (light) and 2.38:1 (dark), under
 * AA. So the flag still cannot be set until that number is drawn another way;
 * the difference is that the run now says which text, and by how much.
 * tests/unit/ci/street-map-staging-cases.test.js holds this spec's lines.
 *
 * BORN RED (2026-11-15, the Share test and the stg edge). On staging "Share hands
 * the share sheet that card's own link and title" was red in four of eight main
 * runs (43668128696, 43669630533, 43674376427, 43676301628). What it recorded was
 * not the page's: the edge adds its own scripts to the page, and they called
 * /cdn-cgi/challenge-platform/… and /cdn-cgi/rum between the page loading and the
 * check. On a retry the two reads of /events/<id>, sent without X-OCR-CI, met the
 * edge's challenge (403). A local Worker has no edge, so the rig stood in for it:
 * a script on the page that makes those two calls every 50 ms, and a 403 with
 * cf-mitigated on /events/ unless X-OCR-CI matches. One fault at a time:
 *   the edge's scripts on the page, Share sends nothing
 *         -> the test as it was on main fails, as on staging; as it is now, passes
 *   the edge's scripts on the page, and pressing Share also asks for
 *   E1  the event's counted share link (GET /e/MZPANB)
 *   E2  an API route (POST /api/v2/track)
 *   E3  a path under /cdn-cgi/ that is not one of the edge's two (/cdn-cgi/trace)
 *   E4  a route whose query only names the edge's path (/api/v2/track?to=/cdn-cgi/rum)
 *         -> each: the test fails, on that request alone
 *   the edge challenges /events/<id>
 *   E5  no token set          -> fails by name: "Cloudflare answered /events/map-zoom-b"
 *   E6  another token         -> fails by name, "sent with X-OCR-CI"
 *       the token the rule matches -> passes; the test as it was on main still got 403
 * Which calls are the edge's is decided in scripts/ci/edge-read.mjs (edgeOwnRequest,
 * tests/unit/ci/edge-read.test.js); tests/unit/ci/map-links-stg-edge.test.js keeps
 * this spec from growing a second list. Staging is the verdict.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { edgeOwnRequest } from '../../../scripts/ci/edge-read.mjs';
import { judgeMapTextOn } from '../helpers/map-text-contrast';
import {
  AREA,
  AREA_PATH,
  BASE_URL,
  EVENTS_AT,
  PLACES,
  STREETS_LOADED,
  TITLE,
  card,
  expectZoomDrawing,
  gotoArea,
  openPanels,
  panel,
  passStgEdge,
  openPlace,
  throwIfEdgeAnswered,
} from '../helpers/map-zoom-area';

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const X_OCR_INTERNAL = process.env.X_OCR_INTERNAL || '';
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

// English, whatever the runner's locale: the labels below are asserted as text.
test.use({ locale: 'en-US' });

/**
 * The street map's credit: OpenStreetMap's copyright page in the page's language
 * (the tests run in English) and Protomaps (lib/attendee-map.ts, streetCredit).
 * They are on the page when streets are drawn, and only then.
 */
const CREDIT_LINKS = ['https://www.openstreetmap.org/copyright/en', 'https://protomaps.com'];

/** Never a link the map may offer: tracking, counted short links, check-in. */
const TRACKED_PATH = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:q|s|e|r|c)\/|check-?in/i;

function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (ADMIN_KEY) headers.Authorization = `Bearer ${ADMIN_KEY}`;
  if (X_OCR_INTERNAL) headers['X-OCR-Internal'] = X_OCR_INTERNAL;
  if (CF_ACCESS_CLIENT_ID) headers['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID;
  if (CF_ACCESS_CLIENT_SECRET) headers['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET;
  return headers;
}

/**
 * The organizer's tap total for one event, through the admin API
 * (GET /api/v2/admin/events/:id/pre-event-activity). The seed puts 5 taps or
 * more on every code, so the floored read is the exact number.
 */
async function readTaps(request: APIRequestContext, eventId: string): Promise<number> {
  const path = `/api/v2/admin/events/${eventId}/pre-event-activity`;
  const resp = await request.get(`${BASE_URL}${path}`, {
    headers: adminHeaders(),
    timeout: 30_000,
  });
  if (resp.headers()['cf-mitigated']) {
    throw new Error(`Cloudflare answered GET ${path}, not the Worker`);
  }
  if (!(resp.headers()['content-type'] || '').includes('application/json')) {
    throw new Error(`GET ${path} did not reach the Worker as an admin (status ${resp.status()})`);
  }
  expect(resp.status(), `GET ${path}`).toBe(200);
  const clicks = (await resp.json()).activity?.clicks;
  expect(clicks?.suppressed, `${eventId}: taps must be readable, not withheld`).toBe(false);
  return clicks.count as number;
}

/** Is there a focus ring on the focused element? An outline counts, a shadow counts. */
async function focusRing(page: Page): Promise<{ on: string; ring: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== 'none';
    return {
      on: `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? ''}] ${el.getAttribute('href') ?? ''}`,
      ring: outline || shadow,
    };
  });
}

test.describe('Zoomed map: the place panel opens under the list (OSE-1891)', () => {
  test('a tap on a place opens only its panel, at the top of the screen', async ({ page }) => {
    await gotoArea(page);
    expect(await openPanels(page), 'no panel is open before a tap').toEqual([]);
    // No text list of places: the event cards are the list (owner, 2026-11-17).
    await expect(page.getByTestId('amap-legend')).toHaveCount(0);
    await expect(page.getByTestId('amap-place-link')).toHaveCount(0);
    // The note and no drawing, or the dot map over streets: never a half of each.
    const drawing = await expectZoomDrawing(page);
    test.info().annotations.push({
      type: 'street-map',
      description: `${AREA_PATH} drew the ${drawing} page; streetMapArchiveLoaded is "${STREETS_LOADED}"`,
    });

    await openPlace(page, 2);

    await expect(page).toHaveURL(/#amap-dot-2$/);
    await expect.poll(() => openPanels(page)).toEqual([2]);
    await expect(panel(page, 2).locator('h2')).toHaveText(/^Place 2/);
    await expect(panel(page, 2).getByTestId('amap-card')).toHaveCount(2);
    await expect(card(page, 'map-zoom-b').locator('h3')).toHaveText(TITLE['map-zoom-b']);
    await expect(card(page, 'map-zoom-b').getByTestId('amap-open')).toBeVisible();
    // The map's block, not the panel, is what scrolls to the top of the screen.
    const top = await page
      .getByTestId('amap-wrap')
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(top), 'the map block sits at the top of the screen').toBeLessThan(2);
    // The page keeps its one h1; the panel is an h2 and its cards h3.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(panel(page, 2).locator('h3')).toHaveCount(2);
  });

  test('Prev and Next walk the places, Back steps back, Show all places clears', async ({
    page,
  }) => {
    await gotoArea(page);
    await openPlace(page, 1);
    await expect.poll(() => openPanels(page)).toEqual([1]);
    // The first place has no Prev, the last no Next.
    await expect(panel(page, 1).getByTestId('amap-prev')).toHaveCount(0);

    await panel(page, 1).getByTestId('amap-next').click();
    await expect.poll(() => openPanels(page)).toEqual([2]);
    await panel(page, 2).getByTestId('amap-next').click();
    await expect.poll(() => openPanels(page)).toEqual([3]);
    await expect(panel(page, 3).getByTestId('amap-next')).toHaveCount(0);
    await panel(page, 3).getByTestId('amap-prev').click();
    await expect.poll(() => openPanels(page)).toEqual([2]);

    // Each step was one history entry: Back walks 2 -> 3 -> 2 -> 1 -> the list.
    for (const want of [[3], [2], [1], []]) {
      await page.goBack();
      await expect.poll(() => openPanels(page)).toEqual(want);
    }
    await expect(page).toHaveURL(new RegExp(`area=${AREA}$`));

    await openPlace(page, 3);
    await expect.poll(() => openPanels(page)).toEqual([3]);
    await panel(page, 3).getByTestId('amap-all').click();
    await expect(page).toHaveURL(/#amap-places$/);
    await expect.poll(() => openPanels(page)).toEqual([]);
  });

  test('a shared link to #amap-dot-2 opens on place 2', async ({ page }) => {
    await gotoArea(page, '#amap-dot-2');
    await expect.poll(() => openPanels(page)).toEqual([2]);
    await expect(card(page, 'map-zoom-b')).toBeVisible();
    await expect(card(page, 'map-zoom-c')).toBeVisible();
    await expect(card(page, 'map-zoom-a')).toBeHidden();
  });

  for (const hash of ['#amap-dot-99', '#amap-dot-0', '#amap-dot-x']) {
    test(`a link to ${hash} opens no panel and raises no error`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await gotoArea(page, hash);
      expect(await openPanels(page)).toEqual([]);
      await expect(page.getByTestId('amap-legend')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('keyboard: a place opens, Tab lands in its panel; the focus ring shows', async ({
    page,
  }) => {
    await gotoArea(page);
    if ((await page.locator('[data-testid="amap-dot"][href="#amap-dot-2"]').count()) > 0) {
      // Over a street map the dot is a link: Tab reaches it and Enter opens it.
      await page.getByTestId('amap-back').focus();
      let reached = false;
      for (let i = 0; i < 12 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(
          () =>
            document.activeElement?.getAttribute('data-testid') === 'amap-dot' &&
            document.activeElement?.getAttribute('href') === '#amap-dot-2'
        );
      }
      expect(reached, 'Tab reaches the dot of place 2').toBe(true);
      await page.keyboard.press('Enter');
    } else {
      // No dots to tap: a shared link opens the place, as it does for a visitor.
      await openPlace(page, 2);
    }
    await expect.poll(() => openPanels(page)).toEqual([2]);

    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        panel: el?.closest('[data-testid="amap-panel"]')?.getAttribute('data-n') ?? null,
        testid: el?.getAttribute('data-testid') ?? null,
      };
    });
    expect(where, 'the next Tab is the first control of the open panel').toEqual({
      panel: '2',
      testid: 'amap-prev',
    });
    expect(await focusRing(page), 'the focused panel control shows a focus ring').toMatchObject({
      ring: true,
    });
  });

  test('scripts off: a shared link opens each panel, and Prev and Next still walk them', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: 'en-US' });
    try {
      const page = await context.newPage();
      await gotoArea(page);
      await expect(panel(page, 2)).toBeHidden();
      await gotoArea(page, '#amap-dot-2');
      await expect(panel(page, 2)).toBeVisible();
      await expect(panel(page, 1)).toBeHidden();
      await expect(panel(page, 3)).toBeHidden();
      await panel(page, 2).getByTestId('amap-next').click();
      await expect(panel(page, 3)).toBeVisible();
      await expect(panel(page, 2)).toBeHidden();
      // The buttons are plain links and a button; they are there without script.
      await expect(card(page, 'map-zoom-d').getByTestId('amap-open')).toBeVisible();
      await expect(card(page, 'map-zoom-d').getByTestId('share-btn')).toBeVisible();

      await gotoArea(page, '#amap-dot-1');
      await expect(panel(page, 1)).toBeVisible();
      await expect(panel(page, 2)).toBeHidden();
    } finally {
      await context.close();
    }
  });
});

test.describe('Zoomed map: in and out, and the pills (OSE-1886)', () => {
  test("a tap on the area's hexagon zooms in, and Back to all areas zooms out", async ({
    page,
  }) => {
    const res = await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    // The fixture alone holds 10 events, so the landing leads with its hexagon map.
    const hexagon = page.locator(
      `[data-testid="amap-area"][data-cell="${AREA}"] [data-testid="amap-area-link"]`
    );
    await expect(hexagon, 'the seeded area is a hexagon on the landing map').toHaveCount(1);
    await expect(page.locator('[data-testid="amap"][data-zoom]')).toHaveCount(0);

    await hexagon.click();

    await expect(page).toHaveURL(new RegExp(`[?&]area=${AREA}$`));
    await expect(page.locator(`[data-testid="amap"][data-zoom="${AREA}"]`)).toHaveCount(1);
    await expect(page.getByTestId('amap-panel')).toHaveCount(3);
    await expect(page.getByTestId('amap-legend')).toHaveCount(0);

    await page.getByTestId('amap-back').click();

    await expect(page).not.toHaveURL(/area=/);
    await expect(page.locator('[data-testid="amap"][data-zoom]')).toHaveCount(0);
    await expect(page.getByTestId('amap-panel')).toHaveCount(0);
    await expect(hexagon).toHaveCount(1);
  });

  test('the When pills filter the places, with no script', async ({ page }) => {
    await gotoArea(page);
    await expect(page.getByTestId('amap-panel')).toHaveCount(3);

    // On a phone the When row folds behind the Filters chip (lib/area-filters-style.ts).
    const filters = page.getByTestId('area-filters-btn');
    if (await filters.isVisible()) await filters.click();
    // Only map-zoom-d (place 3) is within 7 days; places 1 and 2 are 10 days out or more.
    await page.locator('label[for="win-week"]').click();
    await openPlace(page, 1);
    await expect(panel(page, 1)).toBeHidden();
    await openPlace(page, 2);
    await expect(panel(page, 2)).toBeHidden();

    await openPlace(page, 3);
    await expect.poll(() => openPanels(page)).toEqual([3]);
    await expect(card(page, 'map-zoom-d')).toBeVisible();
    for (const later of EVENTS_AT[3].slice(1)) await expect(card(page, later)).toBeHidden();

    await page.locator('label[for="win-next-90"]').click();
    for (const id of EVENTS_AT[3]) await expect(card(page, id)).toBeVisible();
  });
});

test.describe('Zoomed map: Share is the event page share (OSE-1891)', () => {
  /** What the event's own page shares: the reference the card must match. */
  async function ownPageShare(
    page: Page,
    eventId: string
  ): Promise<{ url: string; title: string }> {
    const own = await page.context().newPage();
    try {
      // Event pages sit behind the stg edge's challenge; CI's reads carry the
      // header its skip rule matches. An answer from the edge fails by name.
      await passStgEdge(own);
      const path = `/events/${eventId}`;
      const res = await own.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      throwIfEdgeAnswered(res, path);
      expect(res?.status(), path).toBe(200);
      const btn = own.getByTestId('share-btn').first();
      return {
        url: (await btn.getAttribute('data-share-url')) ?? '',
        title: (await btn.getAttribute('data-share-title')) ?? '',
      };
    } finally {
      await own.close();
    }
  }

  test("Share hands the share sheet that card's own link and title", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { title?: string; url?: string }[] };
      w.__shared = [];
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        writable: true,
        value: (data: { title?: string; url?: string }) => {
          w.__shared.push({ title: data.title, url: data.url });
          return Promise.resolve();
        },
      });
    });
    const ownB = await ownPageShare(page, 'map-zoom-b');
    const ownC = await ownPageShare(page, 'map-zoom-c');
    // The fixture: b has a share code, c has none (its share is its page).
    expect(new URL(ownB.url).pathname).toBe('/e/MZPANB');
    expect(new URL(ownC.url).pathname).toBe('/events/map-zoom-c/map-zoom-c');

    await gotoArea(page, '#amap-dot-2');
    const origin = new URL(BASE_URL).origin;
    const requests: string[] = [];
    // The stg edge adds its own scripts to the page it serves (the bot check, the
    // timing beacon). They call /cdn-cgi/… on their own clock after the page
    // loads, pressed or not, and Cloudflare answers them, never the Worker. Those
    // calls are set apart by exact path (edgeOwnRequest) and named on the report.
    // Every other request, to any host, is the page's own and fails the test.
    const edgeOwn: string[] = [];
    page.on('request', (r) => {
      if (edgeOwnRequest(r.url(), origin)) {
        edgeOwn.push(`${r.method()} ${new URL(r.url()).pathname.split('/').slice(0, 3).join('/')}`);
      } else {
        requests.push(`${r.method()} ${r.url()}`);
      }
    });

    // The second card first: a listener that reads the first button would share b.
    await card(page, 'map-zoom-c').getByTestId('share-btn').click();
    await card(page, 'map-zoom-b').getByTestId('share-btn').click();

    const shared = await page.evaluate(
      () => (window as unknown as { __shared: unknown[] }).__shared
    );
    expect(shared).toEqual([
      { title: TITLE['map-zoom-c'], url: ownC.url },
      { title: TITLE['map-zoom-b'], url: ownB.url },
    ]);
    test.info().annotations.push({
      type: 'edge-own-requests',
      description: `set apart, not the page's: ${edgeOwn.join('; ') || 'none'}`,
    });
    // Pressing Share writes nothing: no request leaves the page.
    expect(requests, 'requests the page made once Share could be pressed').toEqual([]);
    await expect(page).toHaveURL(/#amap-dot-2$/);
  });

  test('with no share sheet, Share copies the link and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(BASE_URL).origin,
    });
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });
    await gotoArea(page, '#amap-dot-1');
    const btn = card(page, 'map-zoom-a').getByTestId('share-btn');
    await expect(btn).toHaveText('Share this event');
    const url = (await btn.getAttribute('data-share-url')) ?? '';
    expect(new URL(url).pathname).toBe('/e/MZPANA');
    await page.evaluate(() => navigator.clipboard.writeText('not yet copied'));

    await btn.click();

    await expect(btn).toHaveText('Link copied!');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    // The label comes back, so the button can be used again.
    await expect(btn).toHaveText('Share this event', { timeout: 6_000 });
  });
});

/**
 * A defect this spec found on 2026-11-09 and does not hide. The panel's "Open
 * event" button (lib/map-place-panel.ts panelActions) shows "Open event" but is
 * named, by its aria-label, "Open <event> public page". The name a screen reader
 * or voice control hears does not contain the words on the button (WCAG 2.5.3
 * Label in Name, level A; axe `label-content-name-mismatch`, serious). It is
 * tracked as OSE-2070 and is feature code, so it is not changed here. Until then
 * the scan logs it, checks it sits on "Open event" only (born-red fault F14) and
 * fails on anything else; OSE-2070 takes the id out of this set so the scan is
 * whole again.
 */
const KNOWN_DEFECTS = new Set(['label-content-name-mismatch']);

type AxeIncomplete = Awaited<ReturnType<AxeBuilder['analyze']>>['incomplete'];

/** Which of these selectors name an element inside the map's drawing (its `<svg>`)? */
async function onTheDrawing(page: Page, selectors: string[]): Promise<boolean[]> {
  return page.evaluate(
    (sels) =>
      sels.map((s) => {
        try {
          return document.querySelector(s)?.closest('[data-testid="amap-svg"]') != null;
        } catch {
          return false;
        }
      }),
    selectors
  );
}

/** Which of these selectors name a `<text>` of the drawing, or an element that holds one? */
async function holdsMapText(page: Page, selectors: string[]): Promise<boolean[]> {
  return page.evaluate(
    (sels) =>
      sels.map((s) => {
        try {
          const el = document.querySelector(s);
          if (!el || el.closest('[data-testid="amap-svg"]') == null) return false;
          return el.closest('text') != null || el.querySelector('text') != null;
        } catch {
          return false;
        }
      }),
    selectors
  );
}

/**
 * What axe could not decide, sorted. With no street layer on the page nothing is
 * sorted: every undecided rule is a failure, as before.
 *
 * With streets drawn, axe leaves two more kinds of contrast undecided (seen on a
 * local Worker over a street layer, 2026-11-15, both themes, phone and desktop):
 *
 *   beside the map  The Back link, the caption and the credit. Streets run past
 *                   the frame and the `<svg>` clips them, but axe counts their
 *                   unclipped boxes as lying over the text next to the map
 *                   (bgOverlap). Nothing is painted there. So the scan is run
 *                   again with the street layer hidden, where axe does decide:
 *                   a violation there, or a node still undecided, fails.
 *   on the map      Town names over roads and water, and the one-digit numbers
 *                   on the dots (axe does not judge text that short). axe cannot
 *                   decide these at all. They come back as `onTheMap`, and the
 *                   caller judges every text of the drawing by measurement
 *                   (helpers/map-text-contrast.ts). Only a node that is a
 *                   `<text>`, or holds one, is handed over: the judge reads
 *                   text and nothing else.
 *
 * Any other rule, a node this cannot place, or a node in the drawing with no
 * text in it, stays undecided, so it fails.
 */
async function sortUndecided(
  page: Page,
  incomplete: AxeIncomplete
): Promise<{ undecided: string[]; onTheMap: string[] }> {
  const nodes = incomplete.flatMap((v) =>
    v.nodes.map((n) => ({
      rule: v.id,
      name: `${v.id}: ${n.target.join(' ')}`,
      // A plain selector in this document; a frame or shadow target is not placed.
      selector: n.target.length === 1 && typeof n.target[0] === 'string' ? n.target[0] : null,
    }))
  );
  const streets = (await page.getByTestId('amap-streets').count()) > 0;
  if (!streets || nodes.length === 0) return { undecided: nodes.map((n) => n.name), onTheMap: [] };

  const drawn = await onTheDrawing(
    page,
    nodes.map((n) => n.selector ?? ':not(*)')
  );
  const text = await holdsMapText(
    page,
    nodes.map((n) => n.selector ?? ':not(*)')
  );
  const contrast = (n: (typeof nodes)[number]) =>
    n.rule === 'color-contrast' && n.selector !== null;
  const onTheMap = nodes.filter((n, i) => contrast(n) && drawn[i] && text[i]).map((n) => n.name);
  const undecided = nodes
    .filter((n, i) => !contrast(n) || (drawn[i] && !text[i]))
    .map((n) => n.name);
  if (nodes.some((n, i) => contrast(n) && !drawn[i])) {
    const hide = await page.addStyleTag({
      content: '[data-testid="amap-streets"]{display:none!important}',
    });
    const again = await new AxeBuilder({ page })
      .include('[data-testid="amap-wrap"]')
      .withRules(['color-contrast'])
      .analyze();
    await hide.evaluate((el) => el.remove());
    const left = [
      ...again.violations.map((v) => ({ v, said: 'fails' })),
      ...again.incomplete.map((v) => ({ v, said: 'is still undecided' })),
    ].flatMap(({ v, said }) =>
      v.nodes.map((n) => ({
        name: `${v.id} ${said} with the street layer hidden: ${n.target.join(' ')}`,
        selector: n.target.length === 1 && typeof n.target[0] === 'string' ? n.target[0] : null,
      }))
    );
    const leftDrawn = await onTheDrawing(
      page,
      left.map((n) => n.selector ?? ':not(*)')
    );
    undecided.push(...left.filter((_, i) => !leftDrawn[i]).map((n) => n.name));
  }
  return { undecided, onTheMap };
}

test.describe('Zoomed map: accessibility in both themes (OSE-1886, OSE-1891)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const screen of [
      { name: 'phone', width: 375, height: 812 },
      { name: 'desktop', width: 1280, height: 800 },
    ]) {
      test(`axe finds nothing but the one reported defect, ${scheme} theme on a ${screen.name}: the list, then an open panel`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: screen.width, height: screen.height });
        await page.emulateMedia({ colorScheme: scheme });
        const mapTextUnderRatio = new Set<string>();
        for (const hash of ['', '#amap-dot-1', '#amap-dot-2']) {
          await gotoArea(page, hash);
          await expect.poll(() => openPanels(page)).toEqual(hash ? [Number(hash.slice(-1))] : []);
          await expect(page.locator('h1'), 'exactly one h1').toHaveCount(1);
          // The theme asked for is the theme on screen, or "both themes" is one theme twice.
          const bg = await page.evaluate(() => {
            const seen = [document.body, document.documentElement]
              .map((el) => getComputedStyle(el).backgroundColor)
              .find((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent');
            return seen ?? '';
          });
          const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
          expect(
            (r ?? 0) + (g ?? 0) + (b ?? 0) > 382 ? 'light' : 'dark',
            `page background ${bg}`
          ).toBe(scheme);
          const results = await new AxeBuilder({ page })
            .include('[data-testid="amap-wrap"]')
            .analyze();
          const line = (v: (typeof results.violations)[number]) =>
            `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`;
          const known = results.violations.filter((v) => KNOWN_DEFECTS.has(v.id));
          const found = results.violations.filter((v) => !KNOWN_DEFECTS.has(v.id)).map(line);
          expect(found, `axe on ${AREA_PATH}${hash}, ${scheme}, ${screen.name}`).toEqual([]);
          // A known defect may only sit where it was reported: on "Open event".
          for (const v of known) {
            for (const n of v.nodes) expect(n.target.join(' '), line(v)).toContain('amap-open');
            test.info().annotations.push({
              type: 'axe-known-defect',
              description: `${hash || 'list'} ${scheme} ${screen.name}: ${line(v)}`,
            });
          }
          // A rule axe could not decide proves nothing, so it is a failure, not a
          // pass. Text drawn in its own background colour is the case: axe calls
          // that contrast "incomplete", not a violation (born-red fault F13).
          // With streets drawn, what axe leaves undecided is sorted first
          // (sortUndecided): only text drawn on the map itself is set apart.
          const { undecided, onTheMap } = await sortUndecided(page, results.incomplete);
          test.info().annotations.push({
            type: 'axe-incomplete',
            description: `${hash || 'list'} ${scheme} ${screen.name}: ${undecided.join('; ') || 'none'}`,
          });
          expect(
            undecided,
            `axe could not decide these rules on ${AREA_PATH}${hash}, ${scheme}, ${screen.name}`
          ).toEqual([]);
          // Text drawn on the map is decided by measurement, not by axe: every
          // `<text>` of the drawing, from the colours this theme resolved
          // (helpers/map-text-contrast.ts). What axe left undecided there
          // (onTheMap) is among the texts read.
          if ((await page.getByTestId('amap-streets').count()) === 0) {
            expect(onTheMap, 'no street layer: no text is set apart as drawn on the map').toEqual(
              []
            );
            continue;
          }
          const judged = await judgeMapTextOn(page);
          for (const line of judged.summary) {
            test.info().annotations.push({
              type: 'map-text-contrast',
              description: `${hash || 'list'} ${scheme} ${screen.name}: ${line}`,
            });
          }
          expect(
            judged.texts.filter((t) => t.kind === 'other').map((t) => t.text),
            'a text on the map the contrast judge does not know'
          ).toEqual([]);
          // A dot is drawn for every place, and a number on every dot: the judge
          // read the page, or it judged nothing.
          expect(
            judged.texts.filter((t) => t.kind === 'dot number' || t.kind === 'pale dot number')
              .length,
            `the contrast judge read a number for each of the ${PLACES.length} dots ` +
              `(axe left undecided on the map: ${onTheMap.join(' | ') || 'nothing'})`
          ).toBe(PLACES.length);
          if (judged.failures.length > 0) {
            for (const line of judged.failures) mapTextUnderRatio.add(line);
            test.info().annotations.push({
              type: 'map-text-under-its-ratio',
              description: `${hash || 'list'} ${scheme} ${screen.name}: ${judged.failures.join(' | ')}`,
            });
            expect(
              STREETS_LOADED,
              `streetMapArchiveLoaded is "true", so the street map is binding, and text drawn ` +
                `on it is under its contrast ratio, by measurement:\n${judged.failures.join('\n')}`
            ).toBe(false);
          }
        }
        // Shown where a person looks, once a test: not hidden, and not red while
        // the street map is not binding. The annotations above name each text.
        if (mapTextUnderRatio.size > 0) {
          console.log(
            `::warning title=T4k street map text UNDER ITS CONTRAST RATIO::${scheme} theme on a ${screen.name}: ` +
              `${[...mapTextUnderRatio].join(' | ')}. ` +
              `Not a failure while streetMapArchiveLoaded is "false"; a failure once it is "true".`
          );
        }
      });
    }
  }
});

test.describe('Zoomed map: using it moves no count (OSE-1896)', () => {
  test('using the map moves no count: every link is followed, no tracked path is asked for, the tap totals stay', async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!ADMIN_KEY && !X_OCR_INTERNAL) {
      throw new Error(
        'precondition unmet: ADMIN_KEY or X_OCR_INTERNAL is needed to read the tap totals'
      );
    }
    const before = {
      a: await readTaps(request, 'map-zoom-a'),
      b: await readTaps(request, 'map-zoom-b'),
    };
    // The seed's numbers (bruno/fixtures/map-zoom-area-seed.sql).
    expect(before).toEqual({ a: 42, b: 8 });

    // The organizer's outside links are example hosts: answer them here, so the
    // walk follows them without leaving for a site that does not exist.
    await context.route(/^https:\/\/[a-z.-]+\.map-zoom\.example\//, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>outside</title>' })
    );
    // With streets drawn the map credits its sources (CREDIT_LINKS). Those two
    // are answered here as well: the walk follows them, and no run of this test
    // reads a site that is not ours.
    await context.route(/^https:\/\/(www\.openstreetmap\.org|protomaps\.com)(\/|$)/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>credit</title>' })
    );
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(),
      });
    });
    const asked: string[] = [];
    context.on('request', (r) => asked.push(r.url()));

    await gotoArea(page);
    const origin = new URL(BASE_URL).origin;
    // Every link of the zoomed part: the list, and each panel's cards and chips.
    const hrefs = await page
      .getByTestId('amap-wrap')
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.length, 'the zoomed part holds links to follow').toBeGreaterThanOrEqual(40);
    // Soft from here to the last read: a link that reaches tracking should show
    // all three ways it is caught (the href, the request, the moved total).
    expect
      .soft(
        hrefs.filter((h) => TRACKED_PATH.test(h.replace(origin, ''))),
        'no href of the zoomed part is a tracked path'
      )
      .toEqual([]);

    // Follow each destination once, the way a tap would.
    const destinations = [...new Set(hrefs.filter((h) => !h.startsWith('#')))];
    const outside = destinations.filter((h) => /^https?:\/\//.test(h) && !h.startsWith(origin));
    const inside = destinations.filter((h) => !outside.includes(h));
    // The street map's credit is there exactly when streets are drawn.
    const streets = (await page.getByTestId('amap-streets').count()) > 0;
    expect
      .soft(
        outside.sort(),
        streets
          ? 'the only outside links are the organizer https links on the poster and the street map credit'
          : 'the only outside links are the organizer https links on the poster'
      )
      .toEqual(
        [
          'https://give.map-zoom.example/a',
          'https://tickets.map-zoom.example/a',
          'https://tickets.map-zoom.example/b',
          ...(streets ? CREDIT_LINKS : []),
        ].sort()
      );
    const visitor = await context.newPage();
    // Event pages sit behind the stg edge's challenge; CI's reads carry the
    // header its skip rule matches. An answer from the edge stops the test.
    await passStgEdge(visitor);
    for (const href of [...inside, ...outside]) {
      const res = await visitor.goto(new URL(href, `${BASE_URL}/`).toString(), {
        waitUntil: 'domcontentloaded',
      });
      throwIfEdgeAnswered(res, href);
      expect.soft(res?.status(), `following ${href}`).toBeLessThan(400);
    }
    await visitor.close();
    // And press every Share: it opens the share sheet and writes nothing.
    for (const n of [1, 2, 3]) {
      await gotoArea(page, `#amap-dot-${n}`);
      for (const id of EVENTS_AT[n]) await card(page, id).getByTestId('share-btn').click();
    }

    const tracked = asked
      .filter((u) => u.startsWith(origin))
      .map((u) => new URL(u).pathname)
      .filter((p) => TRACKED_PATH.test(p));
    expect.soft(tracked, 'no request of the whole walk went to a tracked path').toEqual([]);
    expect(asked.filter((u) => u.includes('/events/map-zoom-a')).length).toBeGreaterThan(0);

    const after = {
      a: await readTaps(request, 'map-zoom-a'),
      b: await readTaps(request, 'map-zoom-b'),
    };
    expect(after, 'tap totals after using the map').toEqual(before);
  });
});
