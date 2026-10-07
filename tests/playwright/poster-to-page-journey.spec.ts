/**
 * From the poster to the event page, on a phone.
 *
 * The poster is how most people first meet an event: they scan its code, tap
 * its link on the digital poster, or type the short address printed under the
 * code. All three must land on that event's public page. Each step was tested
 * on its own (the poster's layout, the short-link resolver, the event page);
 * nothing followed the whole path in a browser.
 *
 * Seeds a real live event through the admin API, so the short code is the one
 * the Worker minted, and follows it the way a visitor does.
 *
 * Runs in the blocking phone audit on Chromium and WebKit
 * (playwright.mobile.config.ts).
 */
import { test, expect } from '@playwright/test';
import { createLiveEvent } from './helpers/sponsor-home-seed';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';
const MIN_TOUCH = 44;

let eventId = '';
let title = '';

test.describe('poster to event page', () => {
  test.beforeAll(async ({ request }) => {
    // No skip: without the local admin key this cannot seed, and a skipped check
    // on a required job would read as a pass.
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    title = `Poster journey ${Date.now()}`;
    eventId = (await createLiveEvent(request, ADMIN_BEARER, title, 30)).id;
  });

  test('digital poster: tapping the event-page code opens that event page', async ({ page }) => {
    await page.goto(`/poster?event=${encodeURIComponent(eventId)}&kind=digital`);
    await expect(page.getByTestId('poster-title')).toHaveText(title);

    const link = page.getByTestId('qr-slot-code-public');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/s\/[A-Za-z0-9]{6}$/);
    const box = await link.boundingBox();
    expect(box?.height ?? 0, 'the link is a 44px touch target').toBeGreaterThanOrEqual(MIN_TOUCH);

    // The link opens a new tab, as a tap on a phone does.
    const [opened] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await opened.waitForLoadState('domcontentloaded');
    expect(new URL(opened.url()).pathname).toBe(`/events/${eventId}`);
    await expect(opened.locator('h1')).toHaveCount(1);
    await expect(opened.locator('h1')).toContainText(title);
  });

  test('printed poster: the short address under the code leads to the same page when typed', async ({
    page,
  }) => {
    await page.goto(`/poster?event=${encodeURIComponent(eventId)}&kind=print`);
    const printed = page.getByTestId('qr-slot-code-public');
    await expect(printed).toBeVisible();
    const text = ((await printed.textContent()) ?? '').trim();
    expect(text, 'the printed address is a short link on this site').toMatch(
      /\/s\/[A-Za-z0-9]{6}$/
    );

    // Typed into the address bar: only the path matters, the host is this site.
    await page.goto(new URL(text).pathname);
    expect(new URL(page.url()).pathname).toBe(`/events/${eventId}`);
    await expect(page.locator('h1')).toContainText(title);
  });
});
