/**
 * The league page and the host score screen (leagues phase 1), in a browser at
 * phone width.
 *
 * Their rules (round robin, table order, the brand wall, tabs, paging) are held
 * in workers/oursharedevents/tests/competitions.spec.ts. This spec proves the
 * pages as served work on a phone, as the owner asked on 2026-11-27:
 *
 *   1. no scrolling: each tab of the league page fits one 375 x 812 screen, with
 *      no sideways scroll, and axe finds nothing serious, in light and in dark;
 *   2. the tabs, the round arrows and the Deeper Dive button work by tapping;
 *   3. the host score screen shows one game at a time, and a saved score shows
 *      on the public page.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), against the
 * local worker that config starts. The nights and the league are made here
 * through the admin API; nothing is assumed.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const AUTH = { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' };

test.describe.configure({ mode: 'serial' });

test.describe('the league page and score screen, on a phone', () => {
  let id = '';

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const nights: string[] = [];
    for (let i = 0; i < 3; i++) {
      nights.push(
        (
          await createLiveEvent(
            request,
            ADMIN_BEARER,
            `League night ${i + 1} ${Date.now()}`,
            10 + i * 7
          )
        ).id
      );
    }
    const made = await request.post('/api/v2/admin/competitions', {
      headers: AUTH,
      data: { name: 'Phone League', format: 'seasonal', sport: 'bocce_league' },
    });
    expect(made.status(), await made.text()).toBe(201);
    id = (await made.json()).id;
    for (const [i, label] of [
      'Rolling Thunder',
      'Lawn Rangers',
      'Court Jesters',
      'Kiss the Jack',
    ].entries()) {
      const e = await request.post(`/api/v2/admin/competitions/${id}/entries`, {
        headers: AUTH,
        data: { label, seed: i + 1 },
      });
      expect(e.status(), await e.text()).toBe(201);
    }
    const plan = await request.post(`/api/v2/admin/competitions/${id}/schedule`, {
      headers: AUTH,
      data: { event_ids: nights, slots: ['Court 1', 'Court 2'], start_time: '19:00' },
    });
    expect(plan.ok(), await plan.text()).toBe(true);
    const go = await request.put(`/api/v2/admin/competitions/${id}`, {
      headers: AUTH,
      data: { status: 'active' },
    });
    expect(go.ok(), await go.text()).toBe(true);
  });

  async function open(page: Page, query = ''): Promise<void> {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/competitions/${id}${query}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('competition-name')).toHaveText('Phone League');
  }

  /** The owner's rule: what a tab shows fits one screen, and nothing scrolls sideways. */
  async function fitsOneScreen(page: Page): Promise<void> {
    const m = await page.evaluate(() => ({
      bottom: document.querySelector('main')!.getBoundingClientRect().bottom,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(m.bottom, 'the tab fits one screen').toBeLessThanOrEqual(m.height);
    expect(m.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(m.clientWidth + 1);
  }

  test('each tab fits one screen, and the tabs move between them', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('competition-next')).toBeVisible();
    await fitsOneScreen(page);

    await page.locator('[data-tab="table"]').tap();
    await expect(page.getByTestId('competition-standing')).toHaveCount(4);
    await expect(page.getByTestId('competition-next')).toHaveCount(0);
    await fitsOneScreen(page);

    await page.locator('[data-tab="rounds"]').tap();
    await expect(page.getByTestId('competition-round')).toHaveCount(1);
    await fitsOneScreen(page);
  });

  test('Deeper Dive opens and closes on a tap, and is a 44px target', async ({ page }) => {
    await open(page, '?tab=table');
    const dive = page.locator('details.deeper-dive');
    const button = dive.locator('summary');
    await expect(button).toHaveText('Deeper Dive ›');
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('competition-rule')).toBeHidden();
    await button.tap();
    await expect(page.getByTestId('competition-rule')).toBeVisible();
    await button.tap();
    await expect(page.getByTestId('competition-rule')).toBeHidden();
  });

  test('the round arrows move one round at a time', async ({ page }) => {
    await open(page, '?tab=rounds&round=1');
    await expect(page.getByTestId('competition-round')).toHaveAttribute('data-round', '1');
    await page.getByRole('link', { name: 'Round 2' }).tap();
    await expect(page.getByTestId('competition-round')).toHaveAttribute('data-round', '2');
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`axe WCAG 2.1 AA, ${colorScheme}: nothing serious on any tab`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      for (const tab of ['next', 'table', 'rounds']) {
        await open(page, `?tab=${tab}`);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const found = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map(
            (v) =>
              `${tab}: ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
          );
        expect(found, found.join('\n')).toEqual([]);
      }
    });
  }

  test('the score screen shows one game at a time, and a saved score goes public', async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/api/v2/admin/competitions/${id}/score-screen`, {
      waitUntil: 'domcontentloaded',
    });
    const cards = page.getByTestId('score-match');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toBeVisible();
    await expect(cards.nth(1)).toBeHidden();
    await page.locator('[data-show="1"]').tap();
    await expect(cards.nth(0)).toBeHidden();
    await expect(cards.nth(1)).toBeVisible();
    await page.locator('[data-show="0"]').tap();
    const first = cards.nth(0);
    await first.locator('input[name=a]').fill('12');
    await first.locator('input[name=b]').fill('7');
    await first.locator('[data-act="save"]').tap();
    await expect(first.locator('[role=status]')).toHaveText('Saved');

    await page.setExtraHTTPHeaders({});
    await open(page, '?tab=rounds&round=1');
    await expect(page.locator('[data-score="12-7"]')).toHaveCount(1);
  });
});
