/**
 * OSE-R-001 — Playwright E2E for the admin sign-in front door.
 *
 * Companion to:
 *   - tests/admin-signin-page.spec.ts (vitest — Worker-internal)
 *   - bruno/ose-pages (API contract)
 *
 * Layer:
 *   • Vitest: unit + Worker-binding tests (fast, runs in CI)
 *   • Bruno: response shape + headers (runs via `bru run` against staging)
 *   • Playwright (this file): real browser, DOM, accessibility, navigation
 *
 * Story: OSE-R-001 in REFINEMENT-BACKLOG-2026-05-15.md
 * Pre-fix defect: unauth GET /admin returned JSON 401 rendered as text
 * Post-fix contract: HTML 401 sign-in page with brand + sign-in CTA
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.STAGING_URL || 'https://stg.oursharedevents.com';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoAdminUnauth(page: Page, path: string = '/admin') {
  // Use a fresh context with no auth headers — Playwright contexts default
  // to no shared state, so this is incognito-equivalent.
  const res = await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
  return res;
}

// ═════════════════════════════════════════════════════════════════════════════
// SUITE: OSE-R-001 ADMIN SIGN-IN PAGE
// ═════════════════════════════════════════════════════════════════════════════

test.describe('OSE-R-001 — admin sign-in front door', () => {
  test('OSE-R-001 | FE | GET /admin (unauthenticated) | 401 HTML sign-in page', async ({
    page,
  }) => {
    const res = await gotoAdminUnauth(page);
    expect(res, 'navigation response should exist').not.toBeNull();
    expect(res!.status()).toBe(401);

    const contentType = res!.headers()['content-type'] ?? '';
    expect(contentType).toMatch(/text\/html/);

    // The body is a real HTML page, not the pre-OSE-R-001 JSON dump
    const body = await page.content();
    expect(body).toMatch(/<!DOCTYPE html>/i);
    expect(body).not.toMatch(/"ok":\s*false/);
    expect(body).not.toMatch(/"code":\s*"UNAUTH"/);
  });

  test('OSE-R-001 | FE | GET /admin (unauthenticated) | heading + lede + CTAs render', async ({
    page,
  }) => {
    await gotoAdminUnauth(page);

    // Heading is found by data-testid (locked into the markup)
    await expect(page.locator('[data-testid="signin-heading"]')).toHaveText(
      'Admin sign-in required'
    );

    // Lede explains who this is for
    await expect(page.locator('[data-testid="signin-lede"]')).toContainText(/event organizers/i);

    // Primary CTA exists and points to /admin (retry → CF Access in prod)
    const cta = page.locator('[data-testid="signin-cta"]');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/admin');

    // Request-access path for prospects exists and points home
    const requestAccess = page.locator('[data-testid="signin-request-access"]');
    await expect(requestAccess).toBeVisible();
    await expect(requestAccess).toHaveAttribute('href', '/');
  });

  test('OSE-R-001 | FE | GET /admin (unauthenticated) | brand matches landing (logo + nav)', async ({
    page,
  }) => {
    await gotoAdminUnauth(page);

    const logo = page.locator('[data-testid="signin-logo"]');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveText('OurSharedEvents');
    await expect(logo).toHaveAttribute('href', '/');

    // Events link in nav (matches landing nav)
    await expect(page.locator('[data-testid="nav-events"]')).toHaveAttribute('href', '/events');
  });

  test('OSE-R-001 | FE | GET /admin (unauthenticated) | a11y skip-link + semantic main + focus', async ({
    page,
  }) => {
    await gotoAdminUnauth(page);

    // Skip-link exists and is visually hidden until focused
    const skipLink = page.locator('a.skip-link');
    await expect(skipLink).toHaveAttribute('href', '#main-content');

    // Semantic main landmark
    await expect(page.locator('main#main-content')).toBeVisible();

    // Sign-in CTA is keyboard-focusable
    const cta = page.locator('[data-testid="signin-cta"]');
    await cta.focus();
    const isFocused = await cta.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);
  });

  test('OSE-R-001 | FE | GET /admin (unauthenticated) | robots noindex meta present', async ({
    page,
  }) => {
    await gotoAdminUnauth(page);
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', 'noindex');
  });

  test('OSE-R-001 | FE | GET /manage (unauthenticated) | 401 HTML sign-in page (alias)', async ({
    page,
  }) => {
    const res = await gotoAdminUnauth(page, '/manage');
    expect(res!.status()).toBe(401);
    await expect(page.locator('[data-testid="signin-heading"]')).toBeVisible();
  });

  test('OSE-R-001 | FE | GET /dashboard (unauthenticated) | 401 HTML sign-in page (alias)', async ({
    page,
  }) => {
    const res = await gotoAdminUnauth(page, '/dashboard');
    expect(res!.status()).toBe(401);
    await expect(page.locator('[data-testid="signin-heading"]')).toBeVisible();
  });

  test('OSE-R-001 | FE | GET /create (unauthenticated) | 401 HTML sign-in page (alias)', async ({
    page,
  }) => {
    const res = await gotoAdminUnauth(page, '/create');
    expect(res!.status()).toBe(401);
    await expect(page.locator('[data-testid="signin-heading"]')).toBeVisible();
  });

  test('OSE-R-001 | FE | GET /admin (unauthenticated) | sign-in CTA href is /admin', async ({
    page,
  }) => {
    await gotoAdminUnauth(page);
    const cta = page.locator('[data-testid="signin-cta"]');
    // We don't follow the click into CF Access (that's an external dependency
    // tested elsewhere). We only verify the link target is correct.
    const href = await cta.getAttribute('href');
    expect(href).toBe('/admin');
  });

  test('OSE-R-001 | FE | GET /admin (mobile 375px viewport) | card fits within viewport width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await gotoAdminUnauth(page);

    // Card is visible and within viewport
    const card = page.locator('[data-testid="signin-card"]');
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.width).toBeLessThanOrEqual(375);
  });

  test('OSE-R-001 | FE | GET /admin (unauthenticated) | no admin dashboard content leaked', async ({
    page,
  }) => {
    await gotoAdminUnauth(page);
    const body = await page.content();
    // Defense-in-depth: even though we expect 401, confirm no admin internals
    // accidentally render (e.g., the JSON branch returning HTML by mistake).
    expect(body).not.toMatch(/data-testid="admin-header"/);
    expect(body).not.toMatch(/data-testid="admin-main"/);
    expect(body).not.toMatch(/Event Templates/i); // an admin-specific label
  });
});
