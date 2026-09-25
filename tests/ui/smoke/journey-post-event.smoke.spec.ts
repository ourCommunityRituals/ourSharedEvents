/**
 * SMOKE JOURNEY: Post-Event — Admin Reviews Results
 *
 * After the event, the organizer checks results:
 *   1. Admin loads → events table visible
 *   2. Click event → forms card loads
 *   3. Count boxes show numbers (registrations, check-ins, surveys, emails)
 *   4. /sharedReport loads (analytics dashboard)
 *   5. Surface cards all have working links
 *
 * Runs in T2 Smoke. If the organizer can't see results,
 * they can't prove value to sponsors.
 */

import { test, expect } from '@playwright/test';

test.describe('Journey: Post-Event — Organizer Reviews Results', () => {
  test.describe.configure({ mode: 'serial' });

  test('Step 1: Admin loads with events table', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    await expect(page.locator('[data-testid="admin-header"]')).toBeVisible();

    // Either events table or "No events found"
    const table = page.locator('[data-testid="events-table"]');
    const empty = page.getByText('No events found');
    await Promise.race([
      table.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      empty.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    ]);

    const hasTable = await table.isVisible();
    const hasEmpty = await empty.isVisible();
    expect(hasTable || hasEmpty, 'Admin must show table or empty state').toBe(true);
  });

  test('Step 2: Click event → forms card loads with gates', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    const table = page.locator('[data-testid="events-table"]');
    test.skip(!(await table.isVisible().catch(() => false)), 'No events table');

    const firstRow = page.locator('[data-testid^="event-row-"]').first();
    test.skip(!(await firstRow.isVisible().catch(() => false)), 'No event rows');

    await firstRow.click();
    await page.waitForSelector('[data-testid="forms-list"]', { timeout: 15_000 });

    await expect(page.locator('[data-testid="form-row-register"]')).toBeVisible();
    await expect(page.locator('[data-testid="form-row-checkin"]')).toBeVisible();
  });

  test('Step 3: Count boxes show numeric values', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    const rows = page.locator('[data-testid^="event-row-"]');
    test.skip((await rows.count()) === 0, 'No events');

    await rows.first().click();
    await page.waitForSelector('[data-testid="forms-list"]', { timeout: 15_000 });

    // Counts should be visible in the consolidated form rows.
    const countCards = page.locator('[data-testid^="form-count-"]');
    await expect(countCards.first()).toBeVisible({ timeout: 10_000 });

    const count = await countCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Each count should be a number (0 or more)
    for (let i = 0; i < count; i++) {
      const text = await countCards.nth(i).textContent();
      expect(
        Number.isFinite(parseInt(text || '', 10)),
        `Count ${i} is not a number: "${text}"`
      ).toBe(true);
    }
  });

  test('Step 4: /sharedReport loads without 5xx', async ({ page }) => {
    const res = await page.goto('/sharedReport', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });

    // May be 200 (report enabled) or 403 (feature-flag gated) — NOT 5xx
    expect(res?.status()).toBeLessThan(500);
  });

  test('Step 5: Surface card links are present and valid', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle', timeout: 20_000 });

    const links = [
      { testid: 'link-poster', contains: '/poster' },
      { testid: 'link-display', contains: '/display' },
      { testid: 'link-public', contains: '/' },
      { testid: 'link-report', contains: '/sharedReport' },
    ];

    for (const link of links) {
      const el = page.locator(`[data-testid="${link.testid}"]`);
      await expect(el).toBeVisible();
      const href = await el.getAttribute('href');
      expect(href).toContain(link.contains);
    }
  });
});
