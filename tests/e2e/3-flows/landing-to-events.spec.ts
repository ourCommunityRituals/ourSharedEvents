/**
 * E2E Flow Tests: Landing (supply side) → Events / Admin journeys.
 *
 * OSE-1312 rewrote the landing as the SUPPLY side: two doors (create event /
 * create sponsor), an area view of what's happening nearby, and a never-who
 * privacy panel. The old hero / subscribe / ring / feature-card journeys are
 * gone — the email-signup entry point was deliberately removed (the landing is
 * pure facilitation, never contact capture; email is collected only at
 * event/tournament signup and destroyed by the retention jobs).
 *
 * Customer journeys covered here:
 *   1. Land on / → click "Events" nav → see the event listing
 *   2. Land on / → "Create an event" door → /admin
 *   3. Land on / → "Create a sponsor" door → /admin
 *   4. Land on / → area / privacy "See what's happening" → /events
 *   5. All 6 landing aliases → the same supply-side page
 *
 * WIRING: this spec lives in tests/e2e/ and is NOT yet named in a CI workflow
 * allowlist (tracked in OSE-1244). It is kept in sync with the surface so it is
 * ready to wire, but it is not a CI coverage claim today — the CI-real coverage
 * for the landing area is the worker-suite renderer spec
 * (workers/oursharedevents/tests/landing-area.spec.ts, node project).
 *
 * Source: workers/oursharedevents/src/handlers/pages.ts (handleLandingPage)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LANDING → EVENTS / ADMIN NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — Navigation', () => {
  test('click "Events" in nav → lands on /events with the event listing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="nav-events"]').click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/events');
    await expect(page.locator('[data-testid="public-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="public-events"]')).toBeVisible();
  });

  test('"Create an event" door → /admin?start=event (OSE-1529)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="door-create-event"]')).toHaveAttribute(
      'href',
      '/admin?start=event'
    );
  });

  test('"Create a sponsor" door → /admin?start=sponsor (OSE-1529)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="door-create-sponsor"]')).toHaveAttribute(
      'href',
      '/admin?start=sponsor'
    );
  });

  test('privacy panel "See what\'s happening" → /events', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await page.locator('[data-testid="privacy-more"]').click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. NEVER-WHO PROMISE — TRUE OF THIS PAGE (no cookies)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — never-who', () => {
  test('the landing sets no cookies', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    const cookies = await context.cookies();
    expect(cookies, 'the landing page must set no cookies — it says so on the page').toHaveLength(
      0
    );
  });

  test('carries the supply-side doors + never-who panel', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await expect(page.locator('[data-testid="landing-doors"]')).toBeVisible();
    await expect(page.locator('[data-testid="landing-privacy"]')).toBeVisible();
    await expect(page.locator('[data-testid="landing-area"]')).toBeVisible();
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

  test('the two doors stack (single column) on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const create = page.locator('[data-testid="door-create-event"]');
    const sponsor = page.locator('[data-testid="door-create-sponsor"]');
    const createBox = await create.boundingBox();
    const sponsorBox = await sponsor.boundingBox();

    expect(createBox).toBeTruthy();
    expect(sponsorBox).toBeTruthy();
    // single-column grid below 640px → sponsor door sits below the create door
    expect(sponsorBox!.y).toBeGreaterThanOrEqual(createBox!.y + createBox!.height - 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ALIAS EQUIVALENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Landing Flow — Alias Equivalence', () => {
  test('all aliases show the doors + area + never-who panel', async ({ page }) => {
    const ALIASES = ['/', '/home', '/welcome', '/landing', '/about', '/info'];

    for (const path of ALIASES) {
      await page.goto(path, { waitUntil: 'networkidle', timeout: TIMEOUT });

      await expect(page.locator('[data-testid="landing-doors"]')).toBeVisible();
      await expect(page.locator('[data-testid="landing-area"]')).toBeVisible();
      await expect(page.locator('[data-testid="landing-privacy"]')).toBeVisible();
    }
  });
});
