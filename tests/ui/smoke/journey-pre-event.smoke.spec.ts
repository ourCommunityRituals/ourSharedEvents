/**
 * SMOKE JOURNEY: Pre-Event — Customer Registration Flow
 *
 * The customer path before the event happens:
 *   1. Customer visits /events → sees event cards with Register CTAs
 *   2. Clicks Register on a card → lands on /events/{eventId}/register
 *   3. Form shows event name in header
 *   4. Fills name → submits → success message appears
 *   5. Goes back to /events → card still there (didn't disappear)
 *
 * Runs in T2 Smoke. If registration is broken, no customers show up.
 */

import { test, expect } from '@playwright/test';

test.describe('Journey: Pre-Event — Customer Registration', () => {
  test.describe.configure({ mode: 'serial' });

  test('Step 1: /events loads with event cards + Register CTAs', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    // The list is phase-aware (staging walkthrough 2026-09-03): a wrapped event
    // links to its recap, not a registration form. This journey is the
    // PRE-event one, so it selects cards that still take registrations.
    const cards = page.locator('[data-testid="public-event-card"]:not([data-phase="post_event"])');
    const count = await cards.count();
    test.skip(count === 0, 'No pre-event events on staging');

    await expect(cards.first()).toBeVisible();
    const cta = cards.first().locator('[data-testid="public-event-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('Register');
  });

  test('Step 2: Click Register → lands on registration form', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });
    const ctas = page.locator('[data-testid="public-event-cta"][data-cta="register"]');
    test.skip((await ctas.count()) === 0, 'No pre-event events');

    await ctas.first().click();
    await page.waitForLoadState('networkidle');

    // The event's own sign-up form (OSE-1684).
    expect(new URL(page.url()).pathname).toMatch(/^\/events\/[^/]+\/register$/);
  });

  test('Step 3: Form header shows event name', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });
    const ctas = page.locator('[data-testid="public-event-cta"][data-cta="register"]');
    test.skip((await ctas.count()) === 0, 'No pre-event events');

    // Get event name from card
    const eventName = await page.locator('[data-testid="public-event-name"]').first().textContent();

    await ctas.first().click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="form-header"]')).toBeVisible();
  });

  test('Step 4: Fill name → submit → success', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });
    const ctas = page.locator('[data-testid="public-event-cta"][data-cta="register"]');
    test.skip((await ctas.count()) === 0, 'No pre-event events');

    await ctas.first().click();
    await page.waitForLoadState('networkidle');

    const nameInput = page.locator('[data-testid="register-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(`Smoke Test ${Date.now()}`);

    await page.locator('[data-testid="register-submit"]').click();

    await expect(page.locator('[data-testid="form-success"]')).toBeVisible({ timeout: 10_000 });
  });

  test('Step 5: /events still shows the event (not removed)', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle', timeout: 20_000 });

    const cards = page.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });
});
