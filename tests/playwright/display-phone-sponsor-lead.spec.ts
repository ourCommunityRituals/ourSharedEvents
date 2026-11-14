/**
 * OSE-1991 (owner 2026-11-12): on a phone, the Display page's title and its
 * sponsor lead the screen. Measured in a real browser at 375x812: the title
 * has the width of the screen (the side rail no longer squeezes it), one
 * sponsor block sits under the title and date with its banner full width and a
 * thumbnail a person can see, the "Sponsored by" label is one small line, and
 * nothing scrolls sideways. At TV width nothing changes.
 *
 * The rules (which sponsor, in which turns) are in
 * workers/oursharedevents/tests/display-phone-sponsor-lead.spec.ts (jsdom).
 * No seeded data: every call the page makes is answered here.
 *
 * @born-red OSE-1991 | method: run against the parent commit's template
 * (accb936f): the phone tests went red (no lead block, title squeezed beside
 * the side rail); the TV test stayed green | date: 2026-11-12
 */
import { test, expect, type Page } from '@playwright/test';

const EVT = 'evt-display-lead-1991';
const sponsor = (id: string, name: string, tier: string) => ({
  id,
  name,
  title: name,
  tier,
  logo_url: null,
  has_header_image: true,
  header_text: `${name} supports the league.`,
});
const S = [
  sponsor('spA', 'Lakeside Credit Union', 'platinum'),
  sponsor('spB', 'Sawyer Hardware', 'gold'),
  sponsor('spC', 'Corner Bakery', 'bronze'),
];
const BANNER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400"><rect width="1200" height="400" fill="#264653"/></svg>';

async function load(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v2/events', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [
          {
            id: EVT,
            name: 'Harbor County Bocce',
            venue: 'Harbor Hall',
            phase: 'pre_event',
            startDateISO: '2026-11-21',
            starts_at: '2026-11-21T23:00:00.000Z',
            timezone: 'America/Chicago',
          },
        ],
      }),
    })
  );
  await page.route(`**/api/v2/events/${EVT}/display-config`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' })
  );
  await page.route(`**/api/v2/events/${EVT}/sponsor-bundle*`, (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        bundle: {
          sponsors: S,
          surface_sponsors: {
            tvTop: S,
            tvSide: [S[0], S[1], S[0], S[2]],
            posterTop: S,
            mobileBanner: S,
          },
          rotation_config: { sponsorSlots: 4, rotationMs: 15000 },
        },
      }),
    })
  );
  await page.route('**/impression', (r) => r.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v2/sponsors/*/logo?slot=header', (r) =>
    r.fulfill({ contentType: 'image/svg+xml', body: BANNER })
  );
  await page.goto(`/events/${EVT}/tv`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('display-featured-title')).toHaveText('Harbor County Bocce');
}

test.describe('OSE-1991 Display on a phone: the title and one sponsor lead', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`375px ${colorScheme}: title full width, one sponsor block with its banner under it`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await load(page, 375, 812);
      const lead = page.getByTestId('display-sponsor-lead');
      await expect(lead).toBeVisible();
      await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
      const m = await page.evaluate(() => {
        const r = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height };
        };
        const shownBlocks = Array.from(
          document.querySelectorAll('[data-testid="display-sponsor-lead-item"]')
        ).filter((el) => (el as HTMLElement).offsetParent !== null);
        const shown = shownBlocks[0] as HTMLElement | undefined;
        const box = (el: Element | null | undefined) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height };
        };
        return {
          vw: document.documentElement.clientWidth,
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          title: r('[data-testid="display-featured-title"]'),
          date: r('[data-testid="display-featured-date"]'),
          lead: r('[data-testid="display-sponsor-lead"]'),
          label: r('[data-testid="display-sponsor-lead-label"]'),
          labelFs: parseFloat(
            getComputedStyle(document.querySelector('[data-testid="display-sponsor-lead-label"]')!)
              .fontSize
          ),
          shownCount: shownBlocks.length,
          block: box(shown),
          banner: box(shown?.querySelector('[data-testid="display-sponsor-lead-header"]')),
          logo: box(shown?.querySelector('[data-testid="display-sponsor-lead-logo"]')),
          rail: (document.querySelector('[data-testid="display-sponsor-sidebar"]') as HTMLElement)
            .innerHTML,
        };
      });
      expect(m.over, 'horizontal overflow').toBeLessThanOrEqual(1);
      // The rail is gone, so the title has the screen's width.
      expect(m.rail).toBe('');
      expect(m.title!.w, 'title width').toBeGreaterThanOrEqual(m.vw * 0.8);
      // One sponsor block, under the title and date, nearly the screen's width.
      expect(m.shownCount).toBe(1);
      expect(m.lead!.y).toBeGreaterThanOrEqual(m.date!.y + m.date!.h - 1);
      expect(m.block!.w).toBeGreaterThanOrEqual(m.vw * 0.85);
      // Its banner is full width and about 3:1; the thumbnail is 72px.
      expect(m.banner!.w).toBeGreaterThanOrEqual(m.block!.w - 3);
      expect(m.banner!.w / m.banner!.h).toBeGreaterThan(2.8);
      expect(m.logo!.h).toBeGreaterThanOrEqual(72);
      // "Sponsored by" is one small line.
      expect(m.labelFs).toBe(13);
      expect(m.label!.h).toBeLessThanOrEqual(17);
    });
  }

  test('TV width: unchanged — the strip shows every sponsor and the side rail rotates', async ({
    page,
  }) => {
    await load(page, 1280, 800);
    await expect(page.getByTestId('display-sponsor-lead')).toHaveCount(0);
    await expect(page.getByTestId('display-sponsor-item')).toHaveCount(3);
    await expect(page.getByTestId('display-sponsor-rotate')).toHaveCount(1);
  });
});
