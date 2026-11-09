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
 * @born-red OSE-1825 | method: run against the pre-change template (no
 * poster-details block) and with the share-link min-height planted at 30px
 * | date: 2026-11-09
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const EVT = 'evt-poster-actions-1825';
const ADDRESS = '13001 S Western Ave, Blue Island, IL 60406';

async function load(page: Page, kind: 'digital' | 'print' = 'digital') {
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
        },
        sponsors: [{ id: 'sp1', name: 'Western Ave Bakery', tier: 'primary' }],
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

  test('print keeps one plain line: no buttons, no Share', async ({ page }) => {
    await load(page, 'print');
    await expect(page.getByTestId('poster-meta-venue')).toHaveText('Uptown Blue Island');
    await expect(page.getByTestId('poster-share')).toHaveCount(0);
    await expect(page.locator('[data-testid="poster-meta"] a')).toHaveCount(0);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe WCAG 2.1 AA, ${colorScheme}, links open: nothing serious`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => {
        delete (Navigator.prototype as unknown as { share?: unknown }).share;
      });
      await load(page);
      await page.getByTestId('poster-share-btn').click();
      const results = await new AxeBuilder({ page })
        .include('[data-testid="poster-meta"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
