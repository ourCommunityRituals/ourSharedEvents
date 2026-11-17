/**
 * The public stall list of a fair (OSE-1998), in a browser at phone width.
 *
 * Its rules (grouping, order, escaping, the one 404, no count) are held in
 * workers/oursharedevents/tests/booth-list-page.spec.ts. This spec proves the
 * page as served works on a phone:
 *
 *   1. at 375px there is no sideways scroll, every stall row is 44px or taller,
 *      and axe finds nothing serious or critical, in light and in dark;
 *   2. tapping a row lands on that stall's own page;
 *   3. the fair's event page offers "See the stalls", and it reaches the list.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker that config starts. The fair and its stalls are made here
 * through the admin API; nothing is assumed. Only the stall routes are
 * watched: the pages make background requests of their own.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const AUTH = { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' };

test.describe.configure({ mode: 'serial' });

test.describe('the stall list of a fair, on a phone', () => {
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    eventId = (await createLiveEvent(request, ADMIN_BEARER, `Stall list fair ${Date.now()}`)).id;
    const res = await request.post(
      `/api/v2/admin/events/${encodeURIComponent(eventId)}/booths/bulk`,
      {
        headers: AUTH,
        data: {
          booths: [
            { number: 'A1', name: 'Pine Crafts', category: 'craft' },
            {
              number: 'A2',
              name: 'Willow Baskets and Woven Goods of Every Size',
              category: 'craft',
            },
            { number: 'B1', name: 'Old Books', category: 'books' },
            { number: 'C1', name: 'Hollow Bread', category: 'food' },
            { number: 'D1', name: 'Corner Swap Table' },
          ],
        },
      }
    );
    expect(res.status(), await res.text()).toBe(201);
  });

  async function openList(page: Page): Promise<void> {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/events/${eventId}/booths`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('booth-list-title')).toHaveText('Stalls');
  }

  test('375px: no sideways scroll, and every row is a 44px target', async ({ page }) => {
    await openList(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, 'no sideways scroll at 375px').toBeLessThanOrEqual(clientWidth + 1);
    const rows = page.getByTestId('booth-list-row');
    await expect(rows).toHaveCount(5);
    for (const box of await rows.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { h: r.height, right: r.right };
      })
    )) {
      expect(box.h, 'a row is at least 44px tall').toBeGreaterThanOrEqual(44);
      expect(box.right, 'a row stays on the screen').toBeLessThanOrEqual(376);
    }
    await expect(page.getByTestId('booth-list-group-title')).toHaveText([
      'Food and drink',
      'Craft',
      'Books',
      'Other',
    ]);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe WCAG 2.1 AA, ${colorScheme}: nothing serious`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await openList(page);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const found = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, found.join('\n')).toEqual([]);
    });
  }

  test('tapping a row lands on that stall’s page', async ({ page }) => {
    await openList(page);
    const asked: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.includes('/booths')) asked.push(`${r.method()} ${path}`);
    });
    await page.getByTestId('booth-list-row').filter({ hasText: 'Old Books' }).tap();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}/booths/B1$`));
    await expect(page.getByTestId('booth-name')).toHaveText('Old Books');
    await expect(page.getByTestId('booth-number')).toHaveText('Stall B1');
    expect(asked).toEqual([`GET /events/${eventId}/booths/B1`]);
    // And back: the stall page links to the whole list.
    await page.getByTestId('booth-all-stalls-link').tap();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}/booths$`));
  });

  test('the event page’s "See the stalls" reaches the list', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/events/${eventId}`, { waitUntil: 'domcontentloaded' });
    const link = page.getByTestId('event-stalls-link');
    await expect(link).toHaveText('See the stalls');
    const box = await link.boundingBox();
    expect(box?.height ?? 0, 'the link is a 44px target').toBeGreaterThanOrEqual(44);
    await link.tap();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}/booths$`));
    await expect(page.getByTestId('booth-list-row')).toHaveCount(5);
  });
});
