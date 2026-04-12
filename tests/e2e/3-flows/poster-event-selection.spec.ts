/**
 * E2E Flow Tests: Poster — Event Selection + Print Journey
 *
 * Multi-step flows:
 *   1. Load poster → picker populated → first event renders
 *   2. Switch events via picker → poster updates with new event data
 *   3. Verify poster content matches picker selection
 *   4. Print flow: poster content visible, controls hidden
 *   5. All aliases resolve to same functional page
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (POSTER_HTML)
 */

import { test, expect } from '@playwright/test';

test.describe('Poster Flow — Event Selection Journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: 20_000 });
  });

  test('load → picker populated → first poster renders', async ({ page }) => {
    // Step 1: Picker should have options
    const picker = page.locator('[data-testid="poster-event-picker"]');
    await expect(picker).toBeVisible();
    const options = picker.locator('option');
    const count = await options.count();
    test.skip(
      count === 0 || (await options.first().textContent())?.includes('No events'),
      'No events'
    );

    // Step 2: First event selected (value=0)
    expect(await picker.inputValue()).toBe('0');

    // Step 3: Poster card rendered
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();

    // Step 4: Event name in poster header matches first option
    const firstOptionText = await options.first().textContent();
    const posterH2 = await page
      .locator('[data-testid="poster-area"] .poster-header h2')
      .textContent();
    expect(posterH2?.trim()).toBe(firstOptionText?.trim());
  });

  test('switch event → poster updates to show new event name', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    const count = await options.count();
    test.skip(count < 2, 'Need 2+ events');

    // Get second event name from picker
    const secondName = await options.nth(1).textContent();

    // Switch to second event
    await picker.selectOption({ index: 1 });
    await page.waitForTimeout(500);

    // Poster h2 should now show second event name
    const posterH2 = await page
      .locator('[data-testid="poster-area"] .poster-header h2')
      .textContent();
    expect(posterH2?.trim()).toBe(secondName?.trim());
  });

  test('switch events multiple times → poster always matches selection', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    const count = await options.count();
    test.skip(count < 3, 'Need 3+ events');

    for (let i = 0; i < Math.min(count, 3); i++) {
      const expectedName = await options.nth(i).textContent();
      await picker.selectOption({ index: i });
      await page.waitForTimeout(300);

      const h2 = await page.locator('[data-testid="poster-area"] .poster-header h2').textContent();
      expect(h2?.trim(), `Event ${i} name mismatch`).toBe(expectedName?.trim());
    }
  });

  test('poster always shows org line "OurSharedEvents" regardless of event', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    const count = await options.count();
    test.skip(
      count === 0 || (await options.first().textContent())?.includes('No events'),
      'No events'
    );

    // Check first event
    const org = page.locator('[data-testid="poster-area"] .poster-header .org');
    await expect(org).toContainText('OurSharedEvents');

    // Switch and check again
    if (count >= 2) {
      await picker.selectOption({ index: 1 });
      await page.waitForTimeout(300);
      await expect(org).toContainText('OurSharedEvents');
    }
  });

  test('poster footer always shows domain', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    test.skip((await options.first().textContent())?.includes('No events') ?? true, 'No events');

    await expect(page.locator('[data-testid="poster-area"] .poster-footer')).toContainText(
      'oursharedevents.com'
    );
  });

  test('QR section always present with 2 items per event', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    const count = await options.count();
    test.skip(
      count === 0 || (await options.first().textContent())?.includes('No events'),
      'No events'
    );

    for (let i = 0; i < Math.min(count, 2); i++) {
      await picker.selectOption({ index: i });
      await page.waitForTimeout(300);

      const qrItems = page.locator('[data-testid="poster-area"] .qr-item');
      expect(await qrItems.count(), `Event ${i} should have 2 QR items`).toBe(2);
    }
  });
});

test.describe('Poster Flow — Print Journey', () => {
  test('print media hides controls, keeps poster', async ({ page }) => {
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: 20_000 });
    const options = page.locator('[data-testid="poster-event-picker"] option');
    test.skip((await options.first().textContent())?.includes('No events') ?? true, 'No events');

    // Before print: controls visible
    await expect(page.locator('[data-testid="poster-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="poster-event-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();

    // Switch to print media
    await page.emulateMedia({ media: 'print' });

    // Controls hidden
    await expect(page.locator('[data-testid="poster-header"]')).toBeHidden();
    await expect(page.locator('[data-testid="poster-event-select"]')).toBeHidden();

    // Poster content still visible
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();
    await expect(page.locator('[data-testid="poster-area"] .poster-header h2')).toBeVisible();
    await expect(page.locator('[data-testid="poster-area"] .qr-section')).toBeVisible();
    await expect(page.locator('[data-testid="poster-area"] .poster-footer')).toBeVisible();
  });
});

test.describe('Poster Flow — All Aliases Functional Equivalence', () => {
  const ALIASES = ['/poster', '/posters', '/flyers', '/tabletop', '/tent', '/signage'];

  test('all aliases render same picker and poster structure', async ({ page }) => {
    for (const path of ALIASES) {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 });

      await expect(page.locator('[data-testid="poster-event-picker"]')).toBeVisible();
      await expect(page.locator('[data-testid="poster-area"]')).toBeVisible();
      await expect(page.locator('[data-testid="poster-header"]')).toBeVisible();
    }
  });
});
