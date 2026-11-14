/**
 * OSE-1825 — the digital poster's When / Where / Share block, measured on a
 * phone (375×812) in a real browser: the cards and their buttons, the street
 * address, 44px targets, nothing sideways, both themes clean under axe, and the
 * Share button's two paths (the phone's share sheet; the plain links without it).
 *
 * The markup rules are in workers/oursharedevents/tests/poster-digital-actions.spec.ts
 * (jsdom); this is the half that can lay things out and tap them.
 *
 * No seeded data: the poster's one data call (the poster-bundle) is answered here.
 *
 * OSE-1826 adds the sponsor's header block: the header image full width, the
 * text under the logo and name, the small "Sponsored by" label, the fallback.
 *
 * @born-red OSE-1825 | method: run against the pre-change template (no
 * poster-details block) and with the share-link min-height planted at 30px
 * | date: 2026-11-09
 * @born-red OSE-1826 | method: run against the parent commit's template (no
 * sponsor block) | date: 2026-11-09
 *
 * OSE-1991 (owner 2026-11-11): the sponsor's thumbnail and name lead to the
 * sponsor's own https site (new tab, noopener noreferrer), else its card page
 * here, else nowhere; the label is the smallest thing in the block and the
 * thumbnail takes the room; the artwork sits between the sponsor block and the
 * When card; print shows the same cards with pictures of the buttons, no links.
 *
 * @born-red OSE-1991 | method: run against main's template (2218bbbd: no
 * sponsor link, 40px logo, art below the cards, print one plain line) | date: 2026-11-12
 * @born-red OSE-1991 phone spacing | method: run against accb936f's template
 * (the wider title and body padding): the spacing case went red | date: 2026-11-12
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const EVT = 'evt-poster-actions-1825';
const ADDRESS = '13001 S Western Ave, Blue Island, IL 60406';

const BAKERY = {
  id: 'sp1',
  name: 'Western Ave Bakery',
  title: 'Western Ave Bakery',
  tier: 'bronze',
  has_header_image: true,
  header_text: 'Fresh bread every morning, two blocks from the square.',
};
const HEADER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400"><rect width="1200" height="400" fill="#7a4"/></svg>';

const ART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000"><rect width="800" height="1000" fill="#47a"/></svg>';

async function load(
  page: Page,
  kind: 'digital' | 'print' = 'digital',
  sponsors: Record<string, unknown>[] = [
    { id: 'sp1', name: 'Western Ave Bakery', tier: 'primary' },
  ],
  art = false
) {
  await page.route('**/api/v2/sponsors/sp1/logo?slot=header', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: HEADER_SVG })
  );
  await page.route('**/art-1991.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: ART_SVG })
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(`**/api/v2/events/${EVT}/poster-bundle`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        event: {
          id: EVT,
          name: 'Uptown Blue Island',
          venue: 'Uptown Blue Island',
          where_address: ADDRESS,
          startDateISO: '2026-11-11',
          starts_at: '2026-11-11T23:00:00.000Z',
          timezone: 'America/Chicago',
          ...(art ? { cover_image_url: '/art-1991.svg' } : {}),
        },
        sponsors,
        slots: [],
      }),
    })
  );
  await page.goto(`/events/${EVT}/poster?kind=${kind}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('poster-title')).toHaveText('Uptown Blue Island');
}

/** Every visible control in the block: at least 44px each way. */
async function expectTargets(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { t: (e.textContent || '').trim(), w: r.width, h: r.height };
      })
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.h, `${b.t} height`).toBeGreaterThanOrEqual(44);
    expect(b.w, `${b.t} width`).toBeGreaterThanOrEqual(44);
  }
}

test.describe('OSE-1825 digital poster: When / Where / Share at 375px', () => {
  test('the When and Where cards, the street address, and buttons a thumb can hit', async ({
    page,
  }) => {
    await load(page);
    await expect(page.getByTestId('poster-when-date')).toHaveText('Wednesday, November 11, 2026');
    await expect(page.getByTestId('poster-when-time')).toHaveText('5:00 PM CST');
    await expect(page.getByTestId('poster-venue-name')).toHaveText('Uptown Blue Island');
    await expect(page.getByTestId('poster-venue-address')).toHaveText(ADDRESS);
    await expect(page.getByTestId('poster-add-to-calendar')).toBeVisible();
    await expect(page.getByTestId('poster-open-map')).toHaveText('Google Maps');
    await expect(page.getByTestId('poster-open-map-apple')).toHaveText('Apple Maps');
    await expectTargets(page, '[data-testid="poster-meta"] a, [data-testid="poster-meta"] button');
    // The two map buttons share one row at phone width.
    const g = await page.getByTestId('poster-open-map').boundingBox();
    const a = await page.getByTestId('poster-open-map-apple').boundingBox();
    expect(Math.abs(g!.y - a!.y)).toBeLessThan(2);
    // Nothing scrolls sideways.
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(over).toBeLessThanOrEqual(1);
  });

  test('the sponsor strip stays above the When / Where block', async ({ page }) => {
    await load(page);
    const strip = await page.getByTestId('poster-sponsor-strip').boundingBox();
    const when = await page.getByTestId('poster-meta-date').boundingBox();
    expect(strip!.y + strip!.height).toBeLessThanOrEqual(when!.y + 1);
  });

  test('with a share sheet, Share hands it the event’s public page', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      (window as unknown as { __shares: unknown[] }).__shares = calls;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (d: unknown) => {
          calls.push(d);
          return Promise.resolve();
        },
      });
    });
    await load(page);
    await page.getByTestId('poster-share-btn').click();
    const shares = await page.evaluate(
      () => (window as unknown as { __shares: unknown[] }).__shares
    );
    expect(shares).toEqual([
      {
        title: 'Uptown Blue Island',
        text: 'Uptown Blue Island · Wednesday, November 11, 2026, 5:00 PM CST · Uptown Blue Island',
        url: new URL(`/events/${EVT}`, page.url()).toString(),
      },
    ]);
    await expect(page.getByTestId('poster-share-links')).toBeHidden();
  });

  test('without a share sheet, Share opens plain links a thumb can hit, and Copy link works', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // A desktop browser with no Web Share.
      delete (Navigator.prototype as unknown as { share?: unknown }).share;
    });
    await load(page);
    const btn = page.getByTestId('poster-share-btn');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const links = page.getByTestId('poster-share-links');
    await expect(links).toBeVisible();
    await expect(links.locator('a')).toHaveCount(8);
    await expectTargets(
      page,
      '[data-testid="poster-share-links"] a, [data-testid="poster-share-links"] button'
    );
    await page.getByTestId('poster-share-copy').click();
    await expect(page.getByTestId('poster-share-status')).toHaveText('Link copied');
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(over).toBeLessThanOrEqual(1);
  });

  test('print shows the same cards, the buttons only as pictures: nothing to tap, no Share', async ({
    page,
  }) => {
    await load(page, 'print', [{ ...BAKERY, website_url: 'https://westernavebakery.example' }]);
    await expect(page.getByTestId('poster-when-date')).toHaveText('Wednesday, November 11, 2026');
    await expect(page.getByTestId('poster-venue-name')).toHaveText('Uptown Blue Island');
    await expect(page.getByTestId('poster-venue-address')).toHaveText(ADDRESS);
    // The buttons are there to see, as <span>s hidden from screen readers.
    for (const id of ['poster-add-to-calendar', 'poster-open-map', 'poster-open-map-apple']) {
      const b = page.getByTestId(id);
      await expect(b).toBeVisible();
      expect(await b.evaluate((e) => e.tagName)).toBe('SPAN');
      expect(await b.evaluate((e) => !!e.closest('[aria-hidden="true"]'))).toBe(true);
    }
    await expect(page.getByTestId('poster-share')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="poster-meta"] a, [data-testid="poster-meta"] button')
    ).toHaveCount(0);
    // The sponsor is on the sheet, with no link and no header image or text.
    await expect(page.getByTestId('poster-sponsor-name')).toHaveText('Western Ave Bakery');
    await expect(page.locator('[data-testid="poster-sponsor-strip"] a')).toHaveCount(0);
    await expect(page.getByTestId('poster-sponsor-header')).toHaveCount(0);
    await expect(page.getByTestId('poster-sponsor-text')).toHaveCount(0);
  });

  for (const kind of ['digital', 'print'] as const) {
    test(`OSE-1991 ${kind}: title, sponsor block, artwork, then the When card`, async ({
      page,
    }) => {
      await load(page, kind, undefined, true);
      await page.waitForFunction(() => {
        const i = document.querySelector('[data-testid="poster-art-img"]') as HTMLImageElement;
        return i && i.complete && i.naturalWidth > 0;
      });
      const title = await page.getByTestId('poster-title').boundingBox();
      const strip = await page.getByTestId('poster-sponsor-strip').boundingBox();
      const art = await page.getByTestId('poster-art-img').boundingBox();
      const when = await page.getByTestId('poster-meta-date').boundingBox();
      expect(strip!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
      expect(strip!.y + strip!.height, 'sponsor block ends above the art').toBeLessThanOrEqual(
        art!.y + 1
      );
      expect(art!.y + art!.height, 'art ends above the When card').toBeLessThanOrEqual(when!.y + 1);
    });
  }

  // OSE-1991 (owner 2026-11-12): on a phone the title and the sponsor set the
  // page; the art follows close behind, with no wide band of empty space.
  test('OSE-1991 digital 375px: the sponsor block sits tight under the title and the art tight under it', async ({
    page,
  }) => {
    await load(page, 'digital', undefined, true);
    await page.waitForFunction(() => {
      const i = document.querySelector('[data-testid="poster-art-img"]') as HTMLImageElement;
      return i && i.complete && i.naturalWidth > 0;
    });
    const header = await page.getByTestId('poster-card-header').boundingBox();
    const title = await page.getByTestId('poster-title').boundingBox();
    const strip = await page.getByTestId('poster-sponsor-strip').boundingBox();
    const art = await page.getByTestId('poster-art-img').boundingBox();
    expect(
      header!.y + header!.height - (title!.y + title!.height),
      'space under the title'
    ).toBeLessThanOrEqual(16);
    expect(strip!.y - (header!.y + header!.height), 'title to sponsor block').toBeLessThanOrEqual(
      2
    );
    expect(art!.y - (strip!.y + strip!.height), 'sponsor block to art').toBeLessThanOrEqual(16);
  });

  test('OSE-1991: the sponsor block links to the sponsor’s own https site, in a new tab', async ({
    page,
  }) => {
    const site = 'https://westernavebakery.example/menu';
    await load(page, 'digital', [{ ...BAKERY, website_url: site, card_url: '/sponsors/sp1' }]);
    const link = page.getByTestId('poster-sponsor-link');
    await expect(link).toHaveAttribute('href', site);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The link names the sponsor (its visible name starts the name, WCAG 2.5.3).
    await expect(link).toHaveAttribute('aria-label', /^Western Ave Bakery/);
    // One link per sponsor, holding the header image, thumbnail and name.
    await expect(page.locator('[data-testid="poster-sponsor-strip"] a')).toHaveCount(1);
    await expect(link.getByTestId('poster-sponsor-header')).toHaveCount(1);
    await expect(link.getByTestId('poster-sponsor-logo')).toHaveCount(1);
    await expect(link.getByTestId('poster-sponsor-name')).toHaveCount(1);
    await expectTargets(page, '[data-testid="poster-sponsor-link"]');
  });

  test('OSE-1991: no https site leads to the sponsor’s card page here; with neither, no link', async ({
    page,
  }) => {
    await load(page, 'digital', [
      {
        id: 'sp3',
        name: 'Old Web Diner',
        tier: 'primary',
        website_url: 'http://oldweb.example',
        card_url: '/sponsors/sp3',
      },
    ]);
    const card = page.getByTestId('poster-sponsor-card-link');
    await expect(card).toHaveAttribute('href', '/sponsors/sp3');
    expect(await card.getAttribute('target')).toBeNull();
    await expect(page.getByTestId('poster-sponsor-link')).toHaveCount(0);
    await expectTargets(page, '[data-testid="poster-sponsor-card-link"]');

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await load(page, 'digital', [
      {
        id: 'sp4',
        name: 'Quiet Shop',
        tier: 'primary',
        website_url: 'javascript:alert(1)',
        card_url: 'https://elsewhere.example/x',
      },
    ]);
    await expect(page.getByTestId('poster-sponsor-name')).toHaveText('Quiet Shop');
    await expect(page.locator('[data-testid="poster-sponsor-strip"] a')).toHaveCount(0);
  });

  test('OSE-1991: a small label, a prominent thumbnail and name', async ({ page }) => {
    await load(page, 'digital', [{ id: 'sp2', name: 'Plain Hardware', tier: 'primary' }]);
    const m = await page.evaluate(() => {
      const el = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const cs = (id: string) => getComputedStyle(el(id));
      return {
        labelFs: parseFloat(cs('poster-sponsor-label').fontSize),
        labelH: el('poster-sponsor-label').getBoundingClientRect().height,
        nameFs: parseFloat(cs('poster-sponsor-name').fontSize),
        logoH: parseFloat(cs('poster-sponsor-logo').height),
      };
    });
    expect(m.labelFs).toBe(13);
    // One tight line: the label takes no more room than its text.
    expect(m.labelH).toBeLessThanOrEqual(17);
    expect(m.nameFs).toBeGreaterThanOrEqual(20);
    // The thumbnail box is 72px tall (it was 40).
    expect(m.logoH).toBeGreaterThanOrEqual(72);
  });

  test('OSE-1826: the sponsor gets a header block: the image full width, then logo, name and text', async ({
    page,
  }) => {
    await load(page, 'digital', [BAKERY]);
    const item = page.getByTestId('poster-sponsor-item');
    const header = page.getByTestId('poster-sponsor-header');
    await expect(header).toBeVisible();
    await page.waitForFunction(() => {
      const i = document.querySelector('[data-testid="poster-sponsor-header"]') as HTMLImageElement;
      return i && i.complete && i.naturalWidth > 0;
    });
    const ib = await item.boundingBox();
    const hb = await header.boundingBox();
    // Full width of the block (less its 1px border), about 3:1.
    expect(hb!.width).toBeGreaterThanOrEqual(ib!.width - 3);
    expect(hb!.width / hb!.height).toBeGreaterThan(2.8);
    expect(hb!.width / hb!.height).toBeLessThan(3.2);
    await expect(page.getByTestId('poster-sponsor-text')).toHaveText(BAKERY.header_text);
    // The label is small next to the sponsor's own name: @ocr/ui's sponsor
    // panel sets it at the 13px text floor, the smallest the fleet renders.
    const sizes = await page.evaluate(() => {
      const fs = (id: string) =>
        parseFloat(getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).fontSize);
      return { label: fs('poster-sponsor-label'), name: fs('poster-sponsor-name') };
    });
    expect(sizes.label).toBe(13);
    expect(sizes.label).toBeLessThan(sizes.name);
    // Placement: below the title, above the When / Where block.
    const title = await page.getByTestId('poster-title').boundingBox();
    const when = await page.getByTestId('poster-meta-date').boundingBox();
    expect(ib!.y).toBeGreaterThan(title!.y + title!.height - 1);
    expect(ib!.y + ib!.height).toBeLessThanOrEqual(when!.y + 1);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(over).toBeLessThanOrEqual(1);
  });

  test('OSE-1826: an unconfigured sponsor falls back to logo and name; a dead header image drops out', async ({
    page,
  }) => {
    await load(page, 'digital', [{ id: 'sp2', name: 'Plain Hardware', tier: 'primary' }]);
    await expect(page.getByTestId('poster-sponsor-name')).toHaveText('Plain Hardware');
    await expect(page.getByTestId('poster-sponsor-header')).toHaveCount(0);
    await expect(page.getByTestId('poster-sponsor-text')).toHaveCount(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/v2/sponsors/sp1/logo?slot=header', (route) =>
      route.fulfill({ status: 404, body: '' })
    );
    await page.route(`**/api/v2/events/${EVT}/poster-bundle`, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          event: {
            id: EVT,
            name: 'Uptown Blue Island',
            venue: 'Uptown Blue Island',
            startDateISO: '2026-11-11',
          },
          sponsors: [BAKERY],
          slots: [],
        }),
      })
    );
    await page.goto(`/events/${EVT}/poster?kind=digital`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('poster-sponsor-name')).toHaveText('Western Ave Bakery');
    await expect(page.getByTestId('poster-sponsor-header')).toHaveCount(0);
    await expect(page.getByTestId('poster-sponsor-text')).toBeVisible();
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe WCAG 2.1 AA, ${colorScheme}, links open: nothing serious`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => {
        delete (Navigator.prototype as unknown as { share?: unknown }).share;
      });
      await load(page, 'digital', [BAKERY]);
      await page.getByTestId('poster-share-btn').click();
      const results = await new AxeBuilder({ page })
        .include('[data-testid="poster-meta"]')
        .include('[data-testid="poster-sponsor-strip"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
