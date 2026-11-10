/**
 * The event page's "Supported by" sponsor thumbnails, in a browser on staging
 * (OSE-1955, feature OSE-1948; owner 2026-11-09).
 *
 * Between the header and "What", a sponsor with a logo is thumbnail art only:
 * the compact logo, else the header logo, through the same-origin proxy
 * /api/v2/sponsors/<id>/logo?slot=sidebar, its title as alt. A sponsor with no
 * logo is its name. The workers pool (workers/oursharedevents/tests/
 * sponsor-thumb-flows.spec.ts) and Bruno folder 17 prove the markup and the
 * proxy; this spec proves what only a browser can: the image really loads under
 * the CSP, the tap really leaves for the website, the box holds any shape of
 * logo, and the strip fits a phone.
 *
 * Fixture: tests/ui/smoke/fixtures/sponsor-logo-check.sql, seeded by the T4
 * surfaces leg before this step:
 *   evt_sponsor_logo_check  A = logo + website, B = no logo, C = a logo that cannot load
 *   evt_sponsor_thumb_ten   ten sponsors, art and names mixed, one very long name
 *
 * Read-only: it writes nothing to staging. Requests to example.com (the
 * fixture's website) are answered in the browser, so the tap is checked
 * without leaving for a third-party site.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';
const CHECK = '/events/evt_sponsor_logo_check';
const TEN = '/events/evt_sponsor_thumb_ten';

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const strip = (page: Page) =>
  page.locator('[data-testid$="sponsor-strip"], [data-testid="post-sponsor-thanks"]').first();
const itemWith = (page: Page, sponsorId: string) =>
  page
    .getByTestId('sponsor-item')
    .filter({ has: page.locator(`a[href*="${sponsorId}"], img[src*="${sponsorId}"]`) });

async function open(page: Page, path: string): Promise<void> {
  const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'load' });
  expect(res?.status(), `${path} must render (is the fixture seeded?)`).toBe(200);
  if (res?.headers()['cf-mitigated']) {
    throw new Error(`Cloudflare challenged ${path}; the Worker was not reached`);
  }
  await expect(page.getByTestId('event-title')).toBeVisible();
}

/** A logo sponsor's art, scrolled into view so a lazy image has loaded (or failed). */
async function loadedThumb(page: Page, sponsorId: string) {
  const img = page.locator(`img[data-testid="sponsor-thumb"][src*="/sponsors/${sponsorId}/"]`);
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete), { timeout: 15_000 })
    .toBe(true);
  return img;
}

for (const vp of VIEWPORTS) {
  test.describe(`OSE-1955 sponsor thumbnails @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('A is a loaded thumbnail with its name as alt, and tapping it opens the website', async ({
      page,
    }) => {
      await page.route('https://example.com/**', (r) =>
        r.fulfill({ status: 200, contentType: 'text/html', body: '<title>sponsor site</title>ok' })
      );
      await open(page, CHECK);
      const img = await loadedThumb(page, 'sp_logo_check_a');
      expect(await img.getAttribute('alt')).toBe('Logo Check Bakery');
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      const item = itemWith(page, 'sp_logo_check_a');
      await expect(item, 'no visible name beside the art').not.toContainText('Logo Check Bakery');
      const link = item.locator('a');
      await expect(link).toHaveAttribute('rel', /noreferrer/);
      await Promise.all([page.waitForURL(/^https:\/\/example\.com\//), link.click()]);
    });

    test('B is its name, with its location under it', async ({ page }) => {
      await open(page, CHECK);
      const item = itemWith(page, 'sp_logo_check_b');
      await expect(item.getByRole('link', { name: 'No Logo Hardware' })).toBeVisible();
      await expect(item.getByTestId('sponsor-item-address')).toHaveText(
        '2407 W 111th St, Chicago IL'
      );
      await expect(item.locator('img')).toHaveCount(0);
    });

    test('C (a logo that cannot load) is still on the page, named "Broken Logo Books"', async ({
      page,
    }) => {
      // Today C is art whose image fails, so its name is the alt text; after
      // OSE-1950 it is the name as text. Either way the link is named for it.
      await open(page, CHECK);
      const link = itemWith(page, 'sp_logo_check_c').getByRole('link', {
        name: 'Broken Logo Books',
      });
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });

    test('one h1; the strip sits below the header and above "What"; axe finds nothing on it', async ({
      page,
    }) => {
      await open(page, CHECK);
      await expect(page.locator('h1')).toHaveCount(1);
      const s = strip(page);
      await expect(s).toBeVisible();
      const title = await page.getByTestId('event-title').boundingBox();
      const sBox = await s.boundingBox();
      expect(sBox!.y).toBeGreaterThan(title!.y);
      const what = page.getByTestId('event-what');
      if ((await what.count()) > 0) {
        expect(sBox!.y + sBox!.height).toBeLessThanOrEqual((await what.boundingBox())!.y + 1);
      }
      await loadedThumb(page, 'sp_logo_check_a');
      const axe = await new AxeBuilder({ page }).include('[data-testid="sponsor-list"]').analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  });
}

test.describe('OSE-1955 edge: any shape of logo stays inside its box, uncropped', () => {
  // The fixture's logo is square. A very wide and a very tall image are served in
  // place of A's real logo, on the same same-origin URL, so the page's own CSS
  // and CSP decide how they show.
  for (const [shape, w, h] of [
    ['wide 4:1', 400, 100],
    ['tall 1:4', 100, 400],
  ] as const) {
    test(`a ${shape} logo is at most 160 x 64, object-fit contain`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.route('**/api/v2/sponsors/sp_logo_check_a/logo?slot=sidebar', (r) =>
        r.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#888"/></svg>`,
        })
      );
      await open(page, CHECK);
      const img = await loadedThumb(page, 'sp_logo_check_a');
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(w);
      const box = (await img.boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(64.5);
      expect(box.width).toBeLessThanOrEqual(160.5);
      expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
      // Contained: the whole image is drawn, scaled by the smaller of the two ratios.
      const scale = Math.min(box.width / w, box.height / h);
      expect(scale * w).toBeLessThanOrEqual(box.width + 0.5);
      expect(scale * h).toBeLessThanOrEqual(box.height + 0.5);
    });
  }
});

test.describe('OSE-1955 edge: ten sponsors on a phone', () => {
  for (const width of [320, 375]) {
    test(`at ${width} px: ten items, no horizontal page scroll, every target at least 44 px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, TEN);
      const items = page.getByTestId('sponsor-item');
      await expect(items).toHaveCount(10);
      for (const id of ['00', '02', '04', '06', '08', '09'])
        await loadedThumb(page, `sp_thumb_ten_${id}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, 'horizontal page scroll').toBeLessThanOrEqual(0);
      const links = page.locator('[data-testid="sponsor-list"] a');
      await expect(links).toHaveCount(10);
      for (let i = 0; i < 10; i++) {
        const box = (await links.nth(i).boundingBox())!;
        const label = (await links.nth(i).getAttribute('href')) ?? String(i);
        expect(box.height, `target ${label} height`).toBeGreaterThanOrEqual(44);
        expect(box.x, `target ${label} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `target ${label} ends on screen`).toBeLessThanOrEqual(
          width + 0.5
        );
      }
      // The long name wraps inside the screen rather than pushing the page wide.
      const long = page.getByRole('link', { name: /Very Long and Proud Neighbourhood/ });
      await expect(long).toBeVisible();
    });
  }
});

test.describe('OSE-1955 edge: light and dark themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: a visible focus ring on a sponsor link, and axe finds no contrast issue on the strip`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open(page, CHECK);
      const link = itemWith(page, 'sp_logo_check_b').getByRole('link', {
        name: 'No Logo Hardware',
      });
      await link.focus();
      const ring = await link.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          style: cs.outlineStyle,
          width: parseFloat(cs.outlineWidth),
          color: cs.outlineColor,
        };
      });
      expect(ring.style, 'a focus outline is drawn').not.toBe('none');
      expect(ring.width).toBeGreaterThan(0);
      await loadedThumb(page, 'sp_logo_check_a');
      const axe = await new AxeBuilder({ page })
        .include('[data-testid="sponsor-list"]')
        .withRules(['color-contrast', 'link-name', 'image-alt'])
        .analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
