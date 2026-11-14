/**
 * Admin: a way back to Your events from anywhere past the front door.
 *
 * Owner report (2026-10-11): once in the full admin screen, or on a draft,
 * there was no way back to the list of Your events. The doors on the front
 * door (Your events, Show me everything, Create a sponsor) only flipped CSS
 * classes: no control on the page led back, and the browser's Back left admin
 * altogether.
 *
 * Runs in the blocking phone audit (playwright.mobile.config.ts), at 375px.
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_BEARER = process.env.OSE_ADMIN_BEARER || '';

async function openAdmin(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${ADMIN_BEARER}` });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="admin-path-chooser"]')).toBeVisible();
}

// Landing on the list puts keyboard focus on its status filter. Scroll position
// alone proves nothing here: clicking a control in the header scrolls the page
// to the top, where the list heading already is.
async function backToListBy(page: Page, control: string): Promise<void> {
  const onFilter = () =>
    page.evaluate(() => document.activeElement?.getAttribute('data-action') === 'events-filter');
  expect(await onFilter(), 'focus starts away from the list').toBe(false);
  await page.click(`[data-testid="${control}"]`);
  await expect.poll(onFilter, { message: 'focus lands on the list filter' }).toBe(true);
  await expect(page.locator('#events-heading')).toBeInViewport();
  // In view and not under the selected event's bar, which stays at the top of
  // the screen (three rows tall on a phone).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const top = document.getElementById('events-heading')!.getBoundingClientRect().top;
          const bar = document.getElementById('event-context-bar');
          const under = bar && !bar.hidden ? bar.getBoundingClientRect().bottom : 0;
          return top >= under;
        }),
      { message: 'the list heading is not hidden under the bar' }
    )
    .toBe(true);
}

test.describe('admin: back to Your events', () => {
  let draftId = '';

  test.beforeAll(async ({ request }) => {
    expect(ADMIN_BEARER, 'OSE_ADMIN_BEARER is set by playwright.mobile.config.ts').not.toBe('');
    const res = await request.post('/api/v2/admin/events', {
      headers: { Authorization: `Bearer ${ADMIN_BEARER}`, 'Content-Type': 'application/json' },
      data: {
        attendance_mode: 'in_person',
        title: `Way back draft ${Date.now()}`,
        start_date: '2027-01-15',
        location: 'Eagles Hall',
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    draftId = ((await res.json()) as { id?: string }).id ?? '';
    expect(draftId).not.toBe('');
  });

  test('the front door does not repeat its own door in the header', async ({ page }) => {
    await openAdmin(page);
    await expect(page.locator('[data-testid="admin-nav-your-events"]')).toBeHidden();
  });

  test('from Show me everything, the header leads back to the list', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-advanced"]');
    const back = page.locator('[data-testid="admin-nav-your-events"]');
    await expect(back).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await backToListBy(page, 'admin-nav-your-events');
  });

  test('from a draft, the bar at the top of the screen leads back to the list', async ({
    page,
  }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-events"]');
    const row = page.locator(`[data-testid="event-row-${draftId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.locator('[data-testid="event-context-bar"]')).toBeVisible();
    // On a draft the page sits on its cards, far below the header; the bar
    // that stays at the top of the screen carries the way back.
    const inBar = page.locator('[data-testid="ecb-nav-your-events"]');
    await expect(inBar).toBeInViewport();
    await backToListBy(page, 'ecb-nav-your-events');
  });

  test('Back from the dashboard returns to the front door, not out of admin', async ({ page }) => {
    await openAdmin(page);
    await page.click('[data-testid="admin-path-advanced"]');
    await expect(page.locator('[data-testid="admin-path-chooser"]')).toBeHidden();
    await page.goBack();
    expect(new URL(page.url()).pathname).toBe('/admin');
    await expect(page.locator('[data-testid="admin-path-chooser"]')).toBeVisible();
    await expect(page.locator('[data-testid="admin-nav-your-events"]')).toBeHidden();
  });
});
