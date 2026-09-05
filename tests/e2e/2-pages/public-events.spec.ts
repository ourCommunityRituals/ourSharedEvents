/**
 * E2E Tests: Public Events Page — Deep Functional Coverage
 *
 * Tests /events served by the Cloudflare Worker.
 * This is the customer-facing event listing — must render flawlessly.
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (PUBLIC_HTML)
 *
 * Data-testids:
 *   public-header          — header with h1 "OurSharedEvents"
 *   public-main            — main content area
 *   public-events          — events container (cards, or the empty state)
 *   public-event-card      — individual event card (repeated per event)
 *   public-event-name      — h3 event name inside card
 *   public-event-meta      — p.meta with date + venue
 *
 * SERVER-RENDERED as of OSE-1243. The Worker reads the events and puts them in
 * the HTML it sends; there is no client fetch, no loading state, and no
 * `esc()` helper in the template. Escaping happens in
 * `workers/oursharedevents/src/lib/html-escape.ts`, and the markup is produced
 * by `renderEventList()` in `src/lib/event-list.ts`.
 *
 * This file therefore tests the surface as a reader meets it — real data, real
 * headers, real layout. Anything that needs specific event data to assert
 * belongs in tests/unit/public-events-phase.test.ts instead, where the
 * renderer can simply be called.
 */

import { test, expect, Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function navigateToPublic(page: Page) {
  await page.goto('/events', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

async function hasEventCards(page: Page): Promise<boolean> {
  const cards = page.locator('[data-testid="public-event-card"]');
  return (await cards.count()) > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PAGE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Structure', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPublic(page);
  });

  test('returns HTTP 200', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.status()).toBe(200);
  });

  test('Content-Type is text/html', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.headers()['content-type']).toContain('text/html');
  });

  test('has correct <title>', async ({ page }) => {
    expect(await page.title()).toContain('OurSharedEvents');
  });

  test('has lang="en" on <html>', async ({ page }) => {
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
  });

  test('header is visible with h1', async ({ page }) => {
    const header = page.locator('[data-testid="public-header"]');
    await expect(header).toBeVisible();
    await expect(header.locator('h1')).toContainText('OurSharedEvents');
  });

  test('main content area is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="public-main"]')).toBeVisible();
  });

  test('h2 "Upcoming Events" is visible', async ({ page }) => {
    const h2 = page.locator('[data-testid="public-main"] h2');
    await expect(h2).toBeVisible();
    await expect(h2).toContainText('Upcoming Events');
  });

  test('events container is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="public-events"]')).toBeVisible();
  });

  test('heading hierarchy: h1 → h2 (no skip)', async ({ page }) => {
    const h1 = page.locator('h1');
    const h2 = page.locator('h2');
    expect(await h1.count()).toBeGreaterThanOrEqual(1);
    expect(await h2.count()).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EVENT CARDS — WITH DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Event Cards (Data Present)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPublic(page);
    test.skip(!(await hasEventCards(page)), 'No events on staging');
  });

  test('at least one event card is rendered', async ({ page }) => {
    const cards = page.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('each card has an event name (h3)', async ({ page }) => {
    const names = page.locator('[data-testid="public-event-name"]');
    const count = await names.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const text = await names.nth(i).textContent();
      expect(text?.trim().length, `Card ${i} name is empty`).toBeGreaterThan(0);
    }
  });

  test('each card has a meta line', async ({ page }) => {
    const metas = page.locator('[data-testid="public-event-meta"]');
    expect(await metas.count()).toBeGreaterThanOrEqual(1);
  });

  test('event cards have left border accent', async ({ page }) => {
    const card = page.locator('[data-testid="public-event-card"]').first();
    const borderLeft = await card.evaluate((el) => window.getComputedStyle(el).borderLeftWidth);
    expect(parseInt(borderLeft)).toBeGreaterThanOrEqual(2);
  });

  test('event cards are inside the events container', async ({ page }) => {
    const container = page.locator('[data-testid="public-events"]');
    const cards = container.locator('[data-testid="public-event-card"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('each card has a Register CTA link', async ({ page }) => {
    const ctas = page.locator('[data-testid="public-event-cta"]');
    const count = await ctas.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      await expect(ctas.nth(i)).toContainText('Register');
      const href = await ctas.nth(i).getAttribute('href');
      expect(href).toContain('/forms/');
      expect(href).toContain('type=register');
    }
  });

  test('each card has data-event-id attribute', async ({ page }) => {
    const cards = page.locator('[data-testid="public-event-card"]');
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const eventId = await cards.nth(i).getAttribute('data-event-id');
      expect(eventId?.length, `Card ${i} missing data-event-id`).toBeGreaterThan(0);
    }
  });

  test('CTA aria-label includes event name', async ({ page }) => {
    const cta = page.locator('[data-testid="public-event-cta"]').first();
    const ariaLabel = await cta.getAttribute('aria-label');
    expect(ariaLabel).toContain('Register');
    expect(ariaLabel?.length).toBeGreaterThan(15); // "Register for {name}"
  });

  test('no error message when events load successfully', async ({ page }) => {
    const error = page.locator('[data-testid="public-error"]');
    expect(await error.count()).toBe(0);
  });

  test('no "Loading" text visible after load', async ({ page }) => {
    const container = page.locator('[data-testid="public-events"]');
    const text = await container.textContent();
    expect(text).not.toContain('Loading events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Removed by OSE-1243: Empty State, Error State, Mock Data Rendering, and
// XSS Resilience (20 tests) ───────────────────────────────────────────────────
//
// All twenty drove the page with `mockEventsApi(...)`, intercepting
// `**/api/v2/events` to decide what rendered. The list is server-rendered now,
// so that interception no longer reaches the code under test — the page shows
// whatever the backend holds and the stub goes unused. These would not have
// failed; they would have passed while proving nothing, which is the worse
// outcome and the harder one to notice.
//
// Every case moved to tests/unit/public-events-phase.test.ts against
// renderEventList(): empty items, ok:false, null items, HTTP 500, timeout,
// malformed JSON, card counts, name/date/venue rendering, absent date, absent
// venue, script-in-name, img-onerror-in-venue, emoji, and CJK. That file now
// carries 27 tests where these were 20, runs without a browser, and is on the
// path CI actually executes.
//
// One of the removed tests asserted that a missing name renders "Untitled
// Event". OSE-871 deleted that fallback. It could only have stayed green by
// never running — see the header of tests/e2e/4-negative/public-events-errors
// .spec.ts and OSE-1244 for why none of these suites did.

test.describe('Public Events — URL Aliases', () => {
  const ALIASES = ['/events', '/public', '/schedule', '/calendar', '/agenda', '/lineup'];

  for (const path of ALIASES) {
    test(`${path} returns 200 with HTML`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      expect(res?.status()).toBe(200);
      expect(res?.headers()['content-type']).toContain('text/html');
    });
  }

  for (const path of ALIASES) {
    test(`${path} renders the events container`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 20_000 });
      await expect(page.locator('[data-testid="public-events"]')).toBeVisible();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Security Headers', () => {
  test('has CSP with nonce', async ({ page }) => {
    const res = await page.goto('/events');
    const csp = res?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain('nonce-');
  });

  test('has X-Content-Type-Options: nosniff', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('has HSTS', async ({ page }) => {
    const res = await page.goto('/events');
    expect(res?.headers()['strict-transport-security']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. NO GAS MARKERS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — No GAS HTML Leak', () => {
  test('no GAS markers in page source', async ({ page }) => {
    await navigateToPublic(page);
    const content = await page.content();
    expect(content).not.toContain('userCodeAppPanel');
    expect(content).not.toContain('Google Apps Script');
    expect(content).not.toContain('script.google.com');
    expect(content).not.toContain('macros/s/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. RESPONSE TIME
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — Response Time', () => {
  test('page loads within 15 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/events', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    expect(Date.now() - start).toBeLessThan(15_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. CONSOLE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events — No Console Errors', () => {
  test('no JS errors during normal page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await navigateToPublic(page);
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});
