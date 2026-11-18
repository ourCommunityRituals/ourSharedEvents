/**
 * The map's zoom, scale bar and you-are-here mark, in a real browser
 * (workers/oursharedevents/src/lib/map-pan-script.ts; owner, 2026-11-18, who
 * chose "a small script on the map only").
 *
 * The page is the landing as the Worker renders it over a synthetic street map
 * (tests/e2e/helpers/render-landing-map.ts), the same rig as
 * street-map-sizes.component.spec.ts. What the server sends is pinned in
 * workers/oursharedevents/tests/map-pan.spec.ts; this is how it behaves:
 *
 *   - with scripts off, the map is what it was and the buttons stay hidden;
 *   - +, −, "whole map", Ctrl + scroll and the keyboard zoom the drawing, at
 *     most four times; the hexagons and streets are one drawing, so they move
 *     together; text keeps its size on screen; the second tier of names shows
 *     from twice the size;
 *   - a drag moves the map once it is zoomed in;
 *   - every button is a 44 px target, and + and − are 48 px on a phone;
 *   - on a phone, a two-finger pinch zooms the map;
 *   - where location is allowed, a mark is drawn where the visitor is, each
 *     area in the list says how far it is, and a polite line names the nearest;
 *   - and the page asks for nothing but itself and its stylesheet, before and
 *     after all of that (invariant 3: the position never leaves the phone).
 *
 * Born red (2026-11-18, Chromium, one fault at a time in map-pan-script.ts,
 * each put back): `ctl.hidden = false` removed (the controls test); MAX set to
 * 8 (the four-times test); the text sizes not counter-scaled (the text-size
 * test); a drag that does nothing (the drag test); `find()` not called where
 * location is granted (the you-are-here test); a fetch() of the position added
 * to `located` (the no-request test); the pinch's zoom left out (the pinch
 * test). Not born red: removing the two-finger `preventDefault` on touch
 * events leaves the pinch test green, because the test sends pointer events
 * and a headless browser does not scroll the page either way; that guard is
 * checked on a phone, not here.
 *
 * It runs in the T0 `component` shard (playwright.component.config.ts). Every
 * request goes to ORIGIN and is answered by the routes; anything else is
 * aborted and counted.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { cellToLatLng, latLngToCell } from 'h3-js';
import { ORIGIN, renderLanding, uiCss } from '../helpers/render-landing-map';

/** Touch target floor, in CSS px (AGENTS.md invariant 8). */
const TARGET_PX = 44;

const BLUE_ISLAND = latLngToCell(41.6573, -87.6806, 7);
const BEVERLY = latLngToCell(41.7135, -87.6812, 7);

type Row = Record<string, unknown>;

function ev(n: number, over: Row): Row {
  const d = new Date(Date.now() + (2 + n) * 86_400_000).toISOString().slice(0, 10);
  return {
    id: `evt_p${String(n).padStart(2, '0')}`,
    slug: `pan-${n}`,
    title: `Pan Event ${n}`,
    status: 'active',
    is_published: 1,
    timezone: 'America/Chicago',
    location: 'Rock Island Public House',
    where_address: '13328 Olde Western Ave, Blue Island, IL 60406',
    template_id: 'bar_night',
    event_type_id: 'etr-ent-trivia',
    cover_image_url: null,
    start_date: d,
    end_date: d,
    starts_at: `${d}T23:00:00Z`,
    ...over,
  };
}

/** Six events in each of two areas, so the landing leads with a map of two areas. */
function rows(): Row[] {
  return [BLUE_ISLAND, BEVERLY].flatMap((cell, a) => {
    const [lat, lon] = cellToLatLng(cell);
    return [1, 2, 3, 4, 5, 6].map((n) =>
      ev(a * 6 + n, { lat, lon, h3_res7: cell, place_kind: 'business' })
    );
  });
}

/**
 * Serve the page and /ui.css from ORIGIN; abort and count everything else.
 * `secure` serves it over https, as a browser gives the position only to a
 * secure page.
 */
async function open(page: Page, path = '/', secure = false): Promise<string[]> {
  const origin = secure ? ORIGIN.replace(/^http:/, 'https:') : ORIGIN;
  const html = await renderLanding(path, rows());
  const css = await uiCss();
  const asked: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.href);
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/' || url.pathname === '') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (url.pathname === '/ui.css') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const res = await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('amap-streets')).toHaveCount(1);
  await page.getByTestId('amap-svg').scrollIntoViewIfNeeded();
  return asked;
}

const viewBox = (page: Page) =>
  page
    .getByTestId('amap-svg')
    .getAttribute('viewBox')
    .then((v) => (v ?? '').split(' ').map(Number));

/** On-screen size of the first town name, in CSS px. */
const townPx = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('[data-testid="amap-svg"]')!;
    const t = svg.querySelector('.as-t')!;
    return parseFloat(getComputedStyle(t).fontSize) * svg.getScreenCTM()!.a;
  });

/** After a zoom the script redraws on the next frame. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const width of [375, 1280]) {
  test.describe(`${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
    });

    test('the controls show, each a 44 px target, and the map starts whole', async ({ page }) => {
      await open(page);
      await expect(page.getByTestId('amap-ctl')).toBeVisible();
      expect(await viewBox(page)).toEqual([0, 0, 600, 360]);
      for (const z of ['in', 'out', 'reset']) {
        const box = (await page.getByTestId(`amap-${z}`).boundingBox())!;
        expect(Math.round(box.width), `${z}: width`).toBeGreaterThanOrEqual(TARGET_PX);
        expect(Math.round(box.height), `${z}: height`).toBeGreaterThanOrEqual(TARGET_PX);
      }
      await expect(page.getByTestId('amap-out')).toBeDisabled();
      await expect(page.getByTestId('amap-reset')).toBeDisabled();
      await expect(page.getByTestId('amap-scale-text')).toContainText(/mi/);
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(sideways, 'the page does not scroll sideways').toBe(false);
    });

    test('+ zooms in, to four times at most; text keeps its size; − and "whole map" come back', async ({
      page,
    }) => {
      await open(page);
      const px = await townPx(page);
      await expect(page.locator('.as-t2').first()).toBeHidden();

      await page.getByTestId('amap-in').click();
      await settled(page);
      const [, , w2, h2] = await viewBox(page);
      expect(w2).toBeCloseTo(300, 1);
      expect(h2).toBeCloseTo(180, 1);
      await expect(page.getByTestId('amap')).toHaveAttribute('data-k', '');
      // The second tier of names waits for twice the size.
      await expect(page.locator('.as-t2').first()).toBeAttached();
      expect(
        await page
          .locator('.as-t2')
          .first()
          .evaluate((el) => getComputedStyle(el).display)
      ).not.toBe('none');
      // A town name is set at the same size on screen as before the zoom.
      expect(Math.abs((await townPx(page)) - px), 'town name size on screen').toBeLessThan(0.6);

      await page.getByTestId('amap-in').click();
      await settled(page);
      expect((await viewBox(page))[2]).toBeCloseTo(150, 1);
      await expect(page.getByTestId('amap-in')).toBeDisabled();

      await page.getByTestId('amap-out').click();
      await settled(page);
      expect((await viewBox(page))[2]).toBeCloseTo(300, 1);

      await page.getByTestId('amap-reset').click();
      await settled(page);
      expect(await viewBox(page)).toEqual([0, 0, 600, 360]);
      await expect(page.getByTestId('amap')).not.toHaveAttribute('data-k', '');
      expect(Math.abs((await townPx(page)) - px)).toBeLessThan(0.6);
    });

    test('a drag moves the zoomed map; the hexagons move with the streets', async ({ page }) => {
      await open(page);
      await page.getByTestId('amap-in').click();
      await settled(page);
      const before = await viewBox(page);
      const cell = page.locator('[data-testid="amap-svg"] .amap-cell').first();
      const cellBefore = (await cell.boundingBox())!;
      const svg = (await page.getByTestId('amap-svg').boundingBox())!;
      const x = svg.x + svg.width / 2;
      const y = svg.y + svg.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 40, y + 20, { steps: 5 });
      await page.mouse.up();
      await settled(page);
      const after = await viewBox(page);
      expect(after[0], 'the view moved left as the map was dragged right').toBeLessThan(before[0]!);
      const cellAfter = (await cell.boundingBox())!;
      expect(Math.round(cellAfter.x - cellBefore.x)).toBeGreaterThan(10);
    });

    test('Ctrl + scroll and the keyboard zoom too', async ({ page }) => {
      await open(page);
      const svg = (await page.getByTestId('amap-svg').boundingBox())!;
      await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -120);
      await page.keyboard.up('Control');
      await settled(page);
      expect((await viewBox(page))[2]).toBeLessThan(600);

      await page.getByTestId('amap-reset').click();
      await page.getByTestId('amap-in').focus();
      await page.keyboard.press('0');
      await page.keyboard.press('+');
      await settled(page);
      expect((await viewBox(page))[2]).toBeCloseTo(300, 1);
      const x0 = (await viewBox(page))[0]!;
      await page.keyboard.press('ArrowRight');
      await settled(page);
      expect((await viewBox(page))[0]).toBeGreaterThan(x0);
      await page.keyboard.press('0');
      await settled(page);
      expect(await viewBox(page)).toEqual([0, 0, 600, 360]);
    });
  });
}

test.describe('where location is allowed', () => {
  let context: BrowserContext;
  test.afterEach(async () => {
    await context?.close();
  });

  test('a mark where the visitor is, how far each area is, the nearest named, and nothing sent', async ({
    browser,
  }) => {
    const [lat, lon] = cellToLatLng(BLUE_ISLAND);
    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      geolocation: { latitude: lat + 0.004, longitude: lon + 0.004 },
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    const asked = await open(page, '/', true);

    const you = page.getByTestId('amap-you');
    await expect(you).toHaveCount(1);
    await expect(you).toHaveAttribute('aria-hidden', 'true');
    const ring = (await you.locator('circle').first().boundingBox())!;
    // The outer ring is 36 px across on screen, whatever the map's size.
    expect(Math.round(ring.width)).toBeGreaterThanOrEqual(34);
    expect(Math.round(ring.width)).toBeLessThanOrEqual(38);

    await expect(page.getByTestId('amap-dist')).toHaveCount(2);
    await expect(page.getByTestId('amap-dist').first()).toContainText(/\d mi from you/);
    const status = page.getByTestId('amap-you-status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toContainText(/Nearest/i);

    // Zoomed in, the mark stays the same size on screen.
    await page.getByTestId('amap-in').click();
    await settled(page);
    const ring2 = (await you.locator('circle').first().boundingBox())!;
    expect(Math.abs(ring2.width - ring.width)).toBeLessThan(1);

    // Nothing was asked for but the page, its stylesheet and the pictures its
    // list names, none with a query: the position never left the browser.
    const pictures = await page.evaluate(() =>
      [...document.querySelectorAll('img[src]')].map(
        (i) => new URL((i as HTMLImageElement).src).pathname
      )
    );
    for (const u of asked) {
      const url = new URL(u);
      expect(url.search, u).toBe('');
      expect(url.hash, u).toBe('');
      expect(['/', '/ui.css', ...pictures], u).toContain(url.pathname);
    }
  });

  // @born-red nearest first | method: the reorder in lib/map-pan-script.ts made a no-op, these run (Beverly red), restored | date: 2026-11-18
  for (const [where, cell] of [
    ['Blue Island', BLUE_ISLAND],
    ['Beverly', BEVERLY],
  ] as const) {
    test(`near ${where}, its area is first in the list, still with its own number`, async ({
      browser,
    }) => {
      const [lat, lon] = cellToLatLng(cell);
      context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        geolocation: { latitude: lat + 0.002, longitude: lon + 0.002 },
        permissions: ['geolocation'],
      });
      const page = await context.newPage();
      await open(page, '/', true);
      await expect(page.getByTestId('amap-dist')).toHaveCount(2);
      const rows = page.locator('ol.amap-legend > li[data-area]');
      await expect(rows.first()).toHaveAttribute('data-area', cell);
      // Nearest first, and each row keeps the number its hexagon shows.
      const order = await rows.evaluateAll((lis) =>
        lis.map((li) => ({
          d: Number(li.getAttribute('data-d')),
          n: li.getAttribute('value'),
          cell: li.getAttribute('data-area'),
        }))
      );
      expect(order.map((o) => o.d)).toEqual([...order.map((o) => o.d)].sort((x, y) => x - y));
      for (const o of order) {
        const num = page
          .locator(`g[data-testid="amap-area"][data-cell="${o.cell}"] .amap-num`)
          .first();
        expect(((await num.textContent()) ?? '').trim()).toMatch(new RegExp(`^${o.n}`));
      }
    });
  }

  test('on a phone, a two-finger pinch zooms the map and never scrolls the page', async ({
    browser,
  }) => {
    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await open(page);
    const box = (await page.getByTestId('amap-svg').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const scrolled = await page.evaluate(() => window.scrollY);
    // Two touch pointers, as a phone's two fingers reach the page: down
    // together, apart in steps, then up. Sent as pointer events so the same
    // pinch runs in Chromium and WebKit.
    await page.evaluate(
      ([cx, cy]) => {
        const svg = document.querySelector('[data-testid="amap-svg"]')!;
        const send = (type: string, id: number, px: number) =>
          svg.dispatchEvent(
            new PointerEvent(type, {
              pointerId: id,
              pointerType: 'touch',
              isPrimary: id === 1,
              clientX: px,
              clientY: cy,
              bubbles: true,
              cancelable: true,
            })
          );
        send('pointerdown', 1, cx - 20);
        send('pointerdown', 2, cx + 20);
        for (let d = 30; d <= 80; d += 10) {
          send('pointermove', 1, cx - d);
          send('pointermove', 2, cx + d);
        }
        send('pointerup', 1, cx - 80);
        send('pointerup', 2, cx + 80);
      },
      [x, y]
    );
    await settled(page);
    const [, , w] = await viewBox(page);
    expect(w, 'the fingers moved four times apart: the map is at most four times').toBeLessThan(
      300
    );
    expect(await page.evaluate(() => window.scrollY), 'the page did not scroll').toBe(scrolled);
    await expect(page.getByTestId('amap-reset')).toBeEnabled();
    // The buttons a thumb uses are 48 px on a phone.
    for (const z of ['in', 'out']) {
      const b = (await page.getByTestId(`amap-${z}`).boundingBox())!;
      expect(Math.round(Math.min(b.width, b.height)), z).toBeGreaterThanOrEqual(48);
    }
  });

  test('with scripts off, the map is drawn and its buttons stay hidden', async ({ browser }) => {
    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await open(page);
    await expect(page.getByTestId('amap-ctl')).toBeHidden();
    await expect(page.locator('[data-testid="amap-svg"] .amap-cell').first()).toBeVisible();
    expect(await viewBox(page)).toEqual([0, 0, 600, 360]);
  });
});
