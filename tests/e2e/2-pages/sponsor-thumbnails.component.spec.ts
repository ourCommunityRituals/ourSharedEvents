/**
 * The event page's "Supported by" sponsor thumbnails at the COMPONENT level
 * (OSE-1955, feature OSE-1948; owner 2026-11-09 and 2026-11-10: "moving
 * testing down to component level").
 *
 * The rule under test is `renderSponsorItem` / `renderSponsorList` and
 * SPONSOR_LIST_CSS in workers/oursharedevents/src/handlers/pages.ts, with the
 * colour tokens of @ocr/ui's /ui.css. The page is rendered by the real
 * renderer (tests/e2e/helpers/render-event-page.ts) and served to a real
 * browser from page routes, so no Worker, no D1 and no seed is involved: the
 * rows are this file's, and so are the logo images (a wide 4:1, a tall 1:4 and
 * a square SVG, chosen by sponsor id).
 *
 * What only a browser can tell, and the staging spec (T4j,
 * tests/e2e/3-flows/sponsor-thumbnails.spec.ts) checks once per deploy, runs
 * here on every pull request, on Chromium and WebKit:
 *   - any shape of logo stays inside its 160 x 64 box, drawn whole;
 *   - 1, 2 and 10 sponsors at 320 and 375 px: no horizontal page scroll, every
 *     link at least 44 px tall and on screen;
 *   - a long name wraps instead of widening the page;
 *   - a visible focus ring on a name link and on an art link, light and dark;
 *   - axe finds nothing on the list, light and dark.
 *
 * It runs in the T0 `component` shard (playwright.component.config.ts). That
 * config starts a local Worker for the other specs of the shard; this one never
 * asks it for anything: every request goes to ORIGIN below and is answered by
 * the routes, and anything else is aborted.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { renderEventPage, uiCss, type SponsorRow } from '../helpers/render-event-page';

const ORIGIN = 'http://sponsor-thumbs.component.test';
const PAGE = `${ORIGIN}/events/evt_component`;

/**
 * Logo shapes by sponsor id: `*wide*` 4:1, `*tall*` 1:4, anything else square.
 * A `*broken*` id gets a 404 instead of an image.
 */
function logoSize(id: string): [number, number] {
  if (id.includes('wide')) return [400, 100];
  if (id.includes('tall')) return [100, 400];
  return [120, 120];
}

const art = (id: string, name: string): SponsorRow => ({
  id,
  name,
  website_url: `https://${id.replace(/_/g, '-')}.example.com/`,
  has_logo: 1,
});
const named = (id: string, name: string, address: string | null = null): SponsorRow => ({
  id,
  name,
  website_url: null,
  address_line: address,
  has_logo: 0,
});

const LONG_NAME =
  'The Very Long and Proud Neighbourhood Association of the Southwest Side Community Gardens and Friends';

const SETS: Record<string, SponsorRow[]> = {
  one: [art('sp_square_1', 'Corner Bakery')],
  two: [art('sp_wide_1', 'Wide Hardware'), named('sp_name_1', 'Main Street Books', '12 Main St')],
  ten: [
    art('sp_wide_1', 'Wide Hardware'),
    named('sp_name_1', 'Main Street Books', '12 Main St'),
    art('sp_tall_1', 'Tall Coffee'),
    named('sp_name_2', LONG_NAME),
    art('sp_square_1', 'Corner Bakery'),
    named('sp_name_3', 'Ace Tools', '2407 W 111th St, Chicago IL'),
    art('sp_wide_2', 'Lakeside Credit Union'),
    named('sp_name_4', 'Q'),
    art('sp_tall_2', 'North Pier Florist'),
    art('sp_square_2', 'Hall Rentals'),
  ],
};

/**
 * Serve the rendered page, /ui.css and the logos from ORIGIN; abort the rest.
 * Returns the ids whose logo was asked for, so a spec can tell a loaded image
 * from one that never left the page.
 */
async function serve(page: Page, sponsors: SponsorRow[]): Promise<Set<string>> {
  const html = await renderEventPage(sponsors);
  const css = await uiCss();
  const asked = new Set<string>();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/events/evt_component') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    if (url.pathname === '/ui.css') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    }
    const logo = /^\/api\/v2\/sponsors\/([^/]+)\/logo$/.exec(url.pathname);
    if (logo && url.searchParams.get('slot') === 'sidebar') {
      const id = decodeURIComponent(logo[1]);
      asked.add(id);
      // A logo the proxy cannot serve (upstream gone, consent withdrawn): 404.
      if (id.includes('broken')) return route.fulfill({ status: 404, body: '' });
      const [w, h] = logoSize(id);
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="gray"/></svg>`,
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return asked;
}

async function open(page: Page, sponsors: SponsorRow[]): Promise<void> {
  await serve(page, sponsors);
  const res = await page.goto(PAGE, { waitUntil: 'load' });
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('sponsor-list')).toBeVisible();
  // /ui.css really applied: the tokens are defined on the page.
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  );
  expect(accent, '--accent from /ui.css').not.toBe('');
}

/** Every thumbnail scrolled into view and fully loaded at its own natural size. */
async function allArtLoaded(page: Page, sponsors: SponsorRow[]): Promise<void> {
  for (const s of sponsors.filter((x) => x.has_logo && !x.id.includes('broken'))) {
    const img = page.locator(`img[data-testid="sponsor-thumb"][src*="/sponsors/${s.id}/"]`);
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBe(logoSize(s.id)[0]);
  }
}

test.describe('OSE-1955 component: any shape of logo stays inside its box, drawn whole', () => {
  for (const [shape, id] of [
    ['wide 4:1', 'sp_wide_1'],
    ['tall 1:4', 'sp_tall_1'],
  ] as const) {
    for (const width of [320, 375]) {
      test(`${shape} at ${width} px: at most 160 x 64, uncropped, its link at least 44 px tall`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const sponsors = [art(id, 'Shape Test Sponsor')];
        await open(page, sponsors);
        await allArtLoaded(page, sponsors);
        const img = page.getByTestId('sponsor-thumb');
        const box = (await img.boundingBox())!;
        expect(box.width, 'thumb width').toBeLessThanOrEqual(160.5);
        expect(box.height, 'thumb height').toBeLessThanOrEqual(64.5);
        expect(box.height, 'thumb is not collapsed').toBeGreaterThan(0);
        // Drawn whole: the image's content box keeps the logo's own proportions
        // (fill), or the logo is scaled into it whole (contain / scale-down).
        // `cover` or a squashed box would crop or distort it.
        const [nw, nh] = logoSize(id);
        const fit = await img.evaluate((el) => getComputedStyle(el).objectFit);
        if (fit === 'fill') {
          expect(Math.abs(box.width / box.height - nw / nh) / (nw / nh)).toBeLessThan(0.03);
        } else {
          expect(['contain', 'scale-down'], `object-fit ${fit} crops`).toContain(fit);
        }
        const scale = Math.min(box.width / nw, box.height / nh);
        expect(scale * nw).toBeLessThanOrEqual(box.width + 0.5);
        expect(scale * nh).toBeLessThanOrEqual(box.height + 0.5);
        // The whole logo is at least half the box on its long side: not a speck.
        expect(Math.max(scale * nw, scale * nh)).toBeGreaterThanOrEqual(32);
        const link = page.locator('[data-testid="sponsor-list"] a');
        expect((await link.boundingBox())!.height, 'art link height').toBeGreaterThanOrEqual(44);
        await expect(page.getByTestId('sponsor-item'), 'no visible name beside the art').toHaveText(
          ''
        );
      });
    }
  }
});

test.describe('OSE-1955 component: the strip fits a phone', () => {
  for (const [set, count] of [
    ['one', 1],
    ['two', 2],
    ['ten', 10],
  ] as const) {
    for (const width of [320, 375]) {
      test(`${count} sponsor(s) at ${width} px: no horizontal scroll, every link at least 44 px tall and on screen`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const sponsors = SETS[set];
        await open(page, sponsors);
        await allArtLoaded(page, sponsors);
        await expect(page.getByTestId('sponsor-item')).toHaveCount(count);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, 'horizontal page scroll').toBeLessThanOrEqual(0);
        const links = page.locator('[data-testid="sponsor-list"] a');
        await expect(links).toHaveCount(count);
        for (let i = 0; i < count; i++) {
          const box = (await links.nth(i).boundingBox())!;
          const label = (await links.nth(i).getAttribute('href')) ?? String(i);
          expect(box.height, `target ${label} height`).toBeGreaterThanOrEqual(44);
          expect(box.x, `target ${label} starts on screen`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `target ${label} ends on screen`).toBeLessThanOrEqual(
            width + 0.5
          );
        }
      });
    }
  }

  for (const width of [320, 375]) {
    test(`a logo that cannot load at ${width} px: its link is still at least 44 px tall, named for the sponsor`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, [art('sp_broken_1', 'Broken Logo Books')]);
      const img = page.getByTestId('sponsor-thumb');
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth === 0))
        .toBe(true);
      const link = page.getByRole('link', { name: 'Broken Logo Books' });
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      expect(box.height, 'broken-art link height').toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    });

    test(`a long name wraps onto more than one line inside ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, SETS.ten);
      const link = page.getByRole('link', { name: LONG_NAME });
      await link.scrollIntoViewIfNeeded();
      const lines = await link.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      expect(lines, 'the long name is on more than one line').toBeGreaterThan(1);
      const box = (await link.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    });
  }
});

/** WCAG relative luminance contrast of two `rgb(...)` / `rgba(...)` colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Give `selector` keyboard focus. Chromium walks there with Tab, as a keyboard
 * user does. WebKit, like Safari, moves Tab through form controls only, and
 * its builds do not agree on the key that reaches links, so there the link is
 * focused directly after a key press; either way the link must then match
 * :focus-visible, the state the ring is drawn for.
 */
async function keyboardFocus(page: Page, selector: string, browserName: string): Promise<void> {
  const reached = () => page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector);
  if (browserName === 'chromium') {
    for (let i = 0; i < 60 && !(await reached()); i++) await page.keyboard.press('Tab');
  } else {
    await page.keyboard.press('Shift');
    await page.locator(selector).focus();
  }
  expect(await reached(), `${selector} has focus`).toBe(true);
  expect(
    await page.locator(selector).evaluate((el) => el.matches(':focus-visible')),
    `${selector} is :focus-visible`
  ).toBe(true);
}

test.describe('OSE-1955 component: light and dark themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: a visible focus ring on a name link and on an art link`, async ({
      page,
      browserName,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, SETS.two);
      await allArtLoaded(page, SETS.two);
      for (const selector of [
        '[data-testid="sponsor-list"] a[data-thumb]',
        '[data-testid="sponsor-list"] a[data-testid="sponsor-card-link"]',
      ]) {
        await keyboardFocus(page, selector, browserName);
        const ring = await page.locator(selector).evaluate((el) => {
          const cs = getComputedStyle(el);
          // The background the ring is drawn against: the first opaque one up the tree.
          let bg = 'rgb(255, 255, 255)';
          for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) {
              bg = c;
              break;
            }
          }
          return {
            style: cs.outlineStyle,
            width: parseFloat(cs.outlineWidth),
            color: cs.outlineColor,
            bg,
          };
        });
        expect(ring.style, `${selector}: a focus outline is drawn`).not.toBe('none');
        expect(ring.width, `${selector}: outline width`).toBeGreaterThanOrEqual(2);
        expect(
          contrast(ring.color, ring.bg),
          `${selector}: ring ${ring.color} on ${ring.bg} (WCAG 1.4.11 needs 3:1)`
        ).toBeGreaterThanOrEqual(3);
      }
    });

    test(`${scheme}: axe finds nothing on the list of ten`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, SETS.ten);
      await allArtLoaded(page, SETS.ten);
      const axe = await new AxeBuilder({ page })
        .include('[data-testid="sponsor-list"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length} - ${v.help}`)).toEqual([]);
      // The rules that matter here really ran: a passed rule is proof, an
      // inapplicable or missing one is not.
      const ran = new Set([...axe.passes, ...axe.incomplete].map((r) => r.id));
      for (const id of ['link-name', 'image-alt', 'color-contrast', 'list', 'listitem']) {
        expect(ran.has(id), `axe rule ${id} ran on the list`).toBe(true);
      }
    });
  }
});
