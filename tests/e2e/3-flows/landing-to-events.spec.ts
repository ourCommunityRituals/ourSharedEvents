/**
 * E2E Flow Tests: Landing → Events + Subscribe Journey
 *
 * Customer journeys from the landing page:
 *   1. Land on / → click "Events" nav → see event cards
 *   2. Land on / → subscribe with email → success message
 *   3. Subscribe → POST /subscribe → API response reflected in UI
 *   4. Footer "Browse Events" link → /events
 *   5. All 6 landing aliases → same functional page
 *
 * Source: workers/oursharedevents/src/handlers/pages.ts (LANDING_HTML)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LANDING → EVENTS NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — Navigation to Events', () => {
  test('click "Events" in nav → lands on /events with event listing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="nav-events"]').click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/events');
    await expect(page.locator('[data-testid="public-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="public-events"]')).toBeVisible();
  });

  test('click "Browse Events" in footer → lands on /events', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="landing-footer"] a').click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SUBSCRIBE JOURNEY — FULL FLOW
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — Subscribe Journey', () => {
  test('complete flow: enter email → submit → success message → input cleared', async ({
    page,
  }) => {
    await page.route('**/subscribe', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, persisted: true }),
      })
    );
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Step 1: Form is visible
    await expect(page.locator('[data-testid="subscribe-form"]')).toBeVisible();

    // Step 2: Enter email
    const emailInput = page.locator('[data-testid="subscribe-email"]');
    await emailInput.fill('journey@example.com');
    expect(await emailInput.inputValue()).toBe('journey@example.com');

    // Step 3: Click submit
    await page.locator('[data-testid="subscribe-submit"]').click();

    // Step 4: Success message appears
    const msg = page.locator('#form-message');
    await expect(msg).toContainText("you're in", { timeout: 5000 });

    // Step 5: Input cleared
    expect(await emailInput.inputValue()).toBe('');

    // Step 6: Button re-enabled
    await expect(page.locator('[data-testid="subscribe-submit"]')).toBeEnabled();
  });

  test('subscribe fires POST /subscribe with correct payload', async ({ page }) => {
    let capturedBody: string | null = null;
    await page.route('**/subscribe', async (route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.locator('[data-testid="subscribe-email"]').fill('payload@test.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(capturedBody).toBeTruthy();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.email).toBe('payload@test.com');
  });

  test('subscribe request has Content-Type: application/json', async ({ page }) => {
    let contentType: string | null = null;
    await page.route('**/subscribe', async (route) => {
      contentType = route.request().headers()['content-type'];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.locator('[data-testid="subscribe-email"]').fill('ct@test.com');
    await page.locator('[data-testid="subscribe-submit"]').click();
    await page.waitForTimeout(1000);

    expect(contentType).toContain('application/json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MOBILE RESPONSIVENESS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — Mobile', () => {
  test('no horizontal overflow on 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });

  test('subscribe form stacks vertically on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const input = page.locator('[data-testid="subscribe-email"]');
    const btn = page.locator('[data-testid="subscribe-submit"]');
    const inputBox = await input.boundingBox();
    const btnBox = await btn.boundingBox();

    expect(inputBox).toBeTruthy();
    expect(btnBox).toBeTruthy();
    // On mobile (≤480px), flex-direction: column → button below input
    expect(btnBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height - 5);
  });

  test('ring nodes visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // At least the ring section is visible (nodes may overlap on small screens)
    await expect(page.locator('[data-testid="ring-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="ring-node-ep"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ALIAS EQUIVALENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — Alias Equivalence', () => {
  test('all aliases show hero + subscribe + ring + features', async ({ page }) => {
    const ALIASES = ['/', '/home', '/welcome', '/landing', '/about', '/info'];

    for (const path of ALIASES) {
      await page.goto(path, { waitUntil: 'networkidle', timeout: TIMEOUT });

      await expect(page.locator('[data-testid="hero-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="subscribe-form"]')).toBeVisible();
      await expect(page.locator('[data-testid="ring-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="features-section"]')).toBeVisible();
    }
  });
});
