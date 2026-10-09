/**
 * The landing never shows a blank list for a chosen time window.
 *
 * The window pills are CSS-only: choosing one hides every card outside it. A
 * window with no events used to hide them all and say nothing. The server now
 * writes one message per empty window (the /events sentence, with its link to a
 * wider range) and the pill that hides the cards shows the matching message.
 *
 * Measured at 375px in a real engine, because the whole behaviour is CSS: the
 * markup tests (workers/oursharedevents/tests/landing-area.spec.ts) prove the
 * rules are written, this proves they apply.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { createLiveEvent, waitUntilListed } from './helpers/sponsor-home-seed';
import { zoneDay } from './helpers/lifecycle-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const WINDOWS = ['weekend', 'week', 'month', 'next-90'] as const;

/**
 * Which windows can be empty today. The global setup seeds a live event dated
 * today in the audit zone (helpers/lifecycle-seed.ts), so the next 7 days, this
 * month and the next 90 days always hold a card. "This weekend" is the coming
 * Fri-Sun (lib/event-discovery.ts), so Monday to Thursday it is empty, and
 * Friday to Sunday today's event fills it and no window is empty at all.
 */
function expectedEmptyWindows(): string[] {
  const dow = new Date(`${zoneDay(0)}T12:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6 || dow === 0 ? [] : ['weekend'];
}

async function visibleCards(page: Page): Promise<number> {
  return page.locator('[data-testid="area-list"] [data-testid="area-card"]:visible').count();
}

test.describe('landing: an empty time window says so', () => {
  test.beforeAll(async ({ request }) => {
    // The local worker lists a new event one minute after it goes live.
    test.setTimeout(150_000);
    // No skip: without the local admin key this test cannot seed, and a skipped
    // check on a required job would read as a pass.
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    // 45 days out: inside the next 90 days, outside this weekend, the next 7
    // days and this month, so the page has both a filled and an empty window.
    // Unique per run: a local D1 keeps rows between runs and the slug must be free.
    const ev = await createLiveEvent(request, ADMIN_BEARER, `Empty window probe ${Date.now()}`, 45);
    await waitUntilListed(ev.listedFrom);
  });

  test('every window shows either cards or its own message, never neither', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('[data-testid="toggle-window"]')).toBeVisible();

    const empty: string[] = [];
    for (const w of WINDOWS) {
      await page.locator(`label[for="win-${w}"]`).click();
      const cards = await visibleCards(page);
      const message = page.locator(`[data-testid="area-window-empty-${w}"]`);

      if (cards === 0) {
        empty.push(w);
        await expect(message, `"${w}" has no cards, so it must say so`).toBeVisible();
        await expect(message.locator('a[href^="/events"]')).toBeVisible();
      } else {
        await expect(message, `"${w}" has cards, so no empty message`).toBeHidden();
      }

      // A message for another window never shows under this one.
      for (const other of WINDOWS.filter((x) => x !== w)) {
        await expect(page.locator(`[data-testid="area-window-empty-${other}"]`)).toBeHidden();
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `no sideways scroll with "${w}" chosen`).toBeLessThanOrEqual(0);
    }

    test.info().annotations.push({ type: 'empty windows seen', description: empty.join(', ') });
    // Every day asserts something: Monday to Thursday the weekend message must
    // have shown; Friday to Sunday no message may show, because every window is full.
    expect(
      empty,
      'the empty windows follow from the date: the setup event is today, the probe 45 days out'
    ).toEqual(expectedEmptyWindows());
  });

  test('the link in the message leads to a wider list', async ({ page }) => {
    test.skip(
      expectedEmptyWindows().length === 0,
      'Friday to Sunday the setup event fills every window, so no message is drawn; the test above checks none shows'
    );
    await page.goto('/');
    for (const w of WINDOWS) {
      await page.locator(`label[for="win-${w}"]`).click();
      if ((await visibleCards(page)) > 0) continue;
      const link = page.locator(`[data-testid="area-window-empty-${w}"] a`);
      await link.click();
      await expect(page).toHaveURL(/\/events(\?when=[a-z0-9-]+)?$/);
      await expect(page.locator('h1')).toHaveCount(1);
      return;
    }
    throw new Error('no empty window to follow a link from');
  });
});
