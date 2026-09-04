/**
 * E2E Tests: Poster Page — LAYOUT / STRUCTURE (data-less)
 *
 * Tests /poster served by the Cloudflare Worker. This file holds ONLY the specs
 * that need no seeded data — structure, empty-state, error-state, URL aliases,
 * security headers, XSS resilience (mocked), response time. It runs in the
 * COMPONENT tier (playwright.component.config.ts, local worker, every PR).
 *
 * The DATA-dependent specs (event picker with data, poster content with data,
 * print layout) moved to poster-print.data.spec.ts (OSE-1228): they assert
 * specific seeded rows and can only run honestly where real data exists (the
 * staging E2E tier, testMatch **\/*.spec.ts). Keeping them here made the
 * component tier skip 22/57 vacuously against an empty/erroring local D1 — a
 * false green. Empty-State lives here on purpose: it is only meaningful with NO
 * data, which is exactly the component tier's local (unseeded) worker.
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (POSTER_HTML)
 *
 * Data-testids: poster-header, poster-print, poster-container,
 *   poster-event-select, poster-event-picker, poster-area
 */

import { test, expect } from '@playwright/test';
import { navigateToPoster, hasEvents } from './poster-helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Structure', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
  });

  test('returns HTTP 200', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.status()).toBe(200);
  });

  test('Content-Type is text/html', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['content-type']).toContain('text/html');
  });

  test('has correct <title>', async ({ page }) => {
    const title = await page.title();
    expect(title).toContain('Poster');
    expect(title).toContain('OurSharedEvents');
  });

  test('has lang="en" on <html>', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('page header is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-header"]')).toBeVisible();
  });

  test('print link is visible in header', async ({ page }) => {
    const printLink = page.locator('[data-testid="poster-print"]');
    await expect(printLink).toBeVisible();
    const href = await printLink.getAttribute('href');
    expect(href).toContain('print');
  });

  test('container is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-container"]')).toBeVisible();
  });

  test('event select wrapper is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-event-select"]')).toBeVisible();
  });

  test('event picker <select> is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-event-picker"]')).toBeVisible();
  });

  test('event picker has associated <label>', async ({ page }) => {
    const label = page.locator('label[for="event-picker"]');
    await expect(label).toBeVisible();
    const text = await label.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('poster area is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMPTY STATE  (meaningful only with NO data → the component tier's local worker)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(await hasEvents(page), 'Events present — skipping empty tests');
  });

  test('picker shows "No events available"', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    await expect(picker).toContainText('No events');
  });

  test('poster area shows "No events scheduled"', async ({ page }) => {
    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('No events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ERROR STATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Error State', () => {
  test('shows error message when API fails', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({ status: 500, body: 'Server Error' })
    );
    await navigateToPoster(page);

    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('Could not load events');
  });

  test('error state has .error class', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({ status: 500, body: 'Server Error' })
    );
    await navigateToPoster(page);

    await expect(page.locator('[data-testid="poster-area"] .error')).toBeVisible();
  });

  test('handles network timeout gracefully', async ({ page }) => {
    await page.route('**/api/v2/events', (route) => route.abort('timedout'));
    await navigateToPoster(page);

    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('Could not load events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FRIENDLY URL ALIASES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — URL Aliases', () => {
  const ALIASES = ['/poster', '/posters', '/flyers', '/tabletop', '/tent', '/signage'];

  for (const path of ALIASES) {
    test(`${path} returns 200 with HTML`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      expect(res?.status()).toBe(200);
      expect(res?.headers()['content-type']).toContain('text/html');
    });
  }

  for (const path of ALIASES) {
    test(`${path} renders the poster picker`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 });
      await expect(page.locator('[data-testid="poster-event-picker"]')).toBeVisible();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Security Headers', () => {
  test('has Content-Security-Policy header', async ({ page }) => {
    const res = await page.goto('/poster');
    const csp = res?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('nonce-');
  });

  test('has X-Content-Type-Options: nosniff', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('has X-Frame-Options', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['x-frame-options']).toBeDefined();
  });

  test('has Strict-Transport-Security', async ({ page }) => {
    const res = await page.goto('/poster');
    expect(res?.headers()['strict-transport-security']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. XSS RESILIENCE  (data mocked inline — no seeded backend needed)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — XSS Resilience', () => {
  test('XSS in event name is escaped in poster', async ({ page }) => {
    // Mock events API with XSS payload in name
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            {
              id: 'evt_xss',
              title: '<script>alert("xss")</script>',
              // OSE-844 / ADR-016: enrichWithPhase() emits the canonical field
              // `name` (mapped from `title`) and poster.html:556 reads it. This
              // mock fulfills the route directly, bypassing the worker and its
              // enrichment, so `name` must be supplied here or the poster title
              // renders EMPTY — which makes the `not.toContain('<script>alert')`
              // assertion below pass vacuously. The positive control below is
              // what catches that.
              name: '<script>alert("xss")</script>',
              slug: 'xss-event',
              status: 'active',
              brand_id: 'root',
            },
          ],
        }),
      })
    );
    await navigateToPoster(page);

    // The script tag should be escaped, not executed
    const posterHtml = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(posterHtml).not.toContain('<script>alert');
    // Should be HTML-escaped
    expect(posterHtml).toContain('&lt;script&gt;');
  });

  test('XSS in venue is escaped', async ({ page }) => {
    await page.route('**/api/v2/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            {
              id: 'evt_xss2',
              title: 'Safe Title',
              slug: 'safe-event',
              status: 'active',
              brand_id: 'root',
              venue: '<img src=x onerror=alert(1)>',
            },
          ],
        }),
      })
    );
    await navigateToPoster(page);

    const posterHtml = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(posterHtml).not.toContain('<img src=x');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. RESPONSE TIME
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Response Time', () => {
  test('page loads within 15 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(15_000);
  });
});
