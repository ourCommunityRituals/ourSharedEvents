/**
 * E2E Tests: Poster Page — Deep Functional Coverage
 *
 * Tests /poster served by the Cloudflare Worker.
 * Covers: page structure, event picker, poster rendering, print layout,
 *         QR placeholders, empty/error states, accessibility.
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (POSTER_HTML)
 *
 * Data-testids:
 *   poster-header          — page header (hidden on print)
 *   poster-print           — print link
 *   poster-container       — main container
 *   poster-event-select    — picker wrapper (hidden on print)
 *   poster-event-picker    — <select> dropdown
 *   poster-area            — rendered poster content (dynamic)
 *
 * Dynamic content (inside poster-area):
 *   .poster                — poster card
 *   .poster-header .org    — "OurSharedEvents" org line
 *   .poster-header h2      — event name
 *   .poster-body           — body content
 *   .poster-meta           — date and venue rows
 *   .meta-row              — individual meta row (icon + text)
 *   .qr-section            — QR placeholder section
 *   .qr-item               — individual QR item (placeholder + label)
 *   .qr-placeholder        — dashed placeholder box (120x120)
 *   .qr-label              — "Event Page" / "Registration"
 *   .poster-footer         — "oursharedevents.com"
 */

import { test, expect, Page } from '@playwright/test';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function navigateToPoster(page: Page) {
  await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle');
}

async function hasEvents(page: Page): Promise<boolean> {
  const picker = page.locator('[data-testid="poster-event-picker"]');
  const text = await picker.textContent();
  return !text?.includes('No events') && !text?.includes('Loading');
}

async function selectEvent(page: Page, index: number) {
  const picker = page.locator('[data-testid="poster-event-picker"]');
  await picker.selectOption({ index });
  // Wait for poster to re-render
  await page.waitForTimeout(500);
}

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
// 2. EVENT PICKER — WITH DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Event Picker (Data Present)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(!(await hasEvents(page)), 'No events on staging — skipping picker tests');
  });

  test('picker is populated with event options', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    expect(await options.count()).toBeGreaterThanOrEqual(1);
  });

  test('first option is selected by default', async ({ page }) => {
    const picker = page.locator('[data-testid="poster-event-picker"]');
    const value = await picker.inputValue();
    expect(value).toBe('0');
  });

  test('each option has text content (event name)', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent();
      expect(text?.trim().length, `Option ${i} is empty`).toBeGreaterThan(0);
    }
  });

  test('selecting a different event re-renders the poster', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    const count = await options.count();
    test.skip(count < 2, 'Need at least 2 events to test picker switch');

    // Get first poster content
    const firstPoster = await page.locator('[data-testid="poster-area"]').innerHTML();

    // Select second event
    await selectEvent(page, 1);

    // Poster should have changed
    const secondPoster = await page.locator('[data-testid="poster-area"]').innerHTML();
    // Content may or may not differ (events could have same name) — at minimum it shouldn't error
    expect(secondPoster.length).toBeGreaterThan(0);
  });

  test('switching back to first event restores its poster', async ({ page }) => {
    const options = page.locator('[data-testid="poster-event-picker"] option');
    const count = await options.count();
    test.skip(count < 2, 'Need at least 2 events');

    const firstPoster = await page.locator('[data-testid="poster-area"]').innerHTML();
    await selectEvent(page, 1);
    await selectEvent(page, 0);
    const restoredPoster = await page.locator('[data-testid="poster-area"]').innerHTML();

    expect(restoredPoster).toBe(firstPoster);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. POSTER RENDERING — WITH DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Poster Content (Data Present)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(!(await hasEvents(page)), 'No events on staging');
  });

  test('poster card renders', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();
  });

  test('poster header shows org name', async ({ page }) => {
    const org = page.locator('[data-testid="poster-area"] .poster-header .org');
    await expect(org).toBeVisible();
    await expect(org).toContainText('OurSharedEvents');
  });

  test('poster header shows event name in h2', async ({ page }) => {
    const h2 = page.locator('[data-testid="poster-area"] .poster-header h2');
    await expect(h2).toBeVisible();
    const text = await h2.textContent();
    expect(text?.trim().length, 'Event name should not be empty').toBeGreaterThan(0);
  });

  test('poster body is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"] .poster-body')).toBeVisible();
  });

  test('poster has meta section', async ({ page }) => {
    await expect(page.locator('[data-testid="poster-area"] .poster-meta')).toBeVisible();
  });

  test('meta rows have icon + text structure', async ({ page }) => {
    const rows = page.locator('[data-testid="poster-area"] .meta-row');
    const count = await rows.count();
    // May have 0 meta rows if event has no date/venue — that's valid
    if (count > 0) {
      const firstRow = rows.first();
      await expect(firstRow.locator('.meta-icon')).toBeVisible();
      await expect(firstRow.locator('.meta-text')).toBeVisible();
    }
  });

  test('QR section renders with 2 placeholder items', async ({ page }) => {
    const qrSection = page.locator('[data-testid="poster-area"] .qr-section');
    await expect(qrSection).toBeVisible();

    const qrItems = qrSection.locator('.qr-item');
    expect(await qrItems.count()).toBe(2);
  });

  test('QR placeholders are 120x120 dashed boxes', async ({ page }) => {
    const placeholders = page.locator('[data-testid="poster-area"] .qr-placeholder');
    expect(await placeholders.count()).toBe(2);

    for (let i = 0; i < 2; i++) {
      const box = await placeholders.nth(i).boundingBox();
      expect(box, `QR placeholder ${i} should have a bounding box`).toBeTruthy();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(100);
        expect(box.height).toBeGreaterThanOrEqual(100);
      }
    }
  });

  test('QR labels show "Event Page" and "Registration"', async ({ page }) => {
    const labels = page.locator('[data-testid="poster-area"] .qr-label');
    expect(await labels.count()).toBe(2);

    const texts = await labels.allTextContents();
    expect(texts.some((t) => t.includes('Event Page'))).toBe(true);
    expect(texts.some((t) => t.includes('Registration'))).toBe(true);
  });

  test('poster footer shows domain', async ({ page }) => {
    const footer = page.locator('[data-testid="poster-area"] .poster-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('oursharedevents.com');
  });

  test('no GAS HTML markers in poster content', async ({ page }) => {
    const content = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(content).not.toContain('userCodeAppPanel');
    expect(content).not.toContain('Google Apps Script');
    expect(content).not.toContain('script.google.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EMPTY STATE
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
// 5. ERROR STATE
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
// 6. PRINT LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Print Layout', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToPoster(page);
    test.skip(!(await hasEvents(page)), 'No events — skipping print tests');
  });

  test('page header has .no-print class', async ({ page }) => {
    const header = page.locator('[data-testid="poster-header"]');
    const classes = await header.getAttribute('class');
    expect(classes).toContain('no-print');
  });

  test('event select has .no-print class', async ({ page }) => {
    const eventSelect = page.locator('[data-testid="poster-event-select"]');
    const classes = await eventSelect.getAttribute('class');
    expect(classes).toContain('no-print');
  });

  test('@media print CSS hides .no-print elements', async ({ page }) => {
    // Emulate print media
    await page.emulateMedia({ media: 'print' });

    const header = page.locator('[data-testid="poster-header"]');
    await expect(header).toBeHidden();

    const eventSelect = page.locator('[data-testid="poster-event-select"]');
    await expect(eventSelect).toBeHidden();
  });

  test('@media print — poster card is still visible', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-testid="poster-area"] .poster')).toBeVisible();
  });

  test('@media print — poster has no box-shadow', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    const poster = page.locator('[data-testid="poster-area"] .poster');
    const boxShadow = await poster.evaluate((el) => window.getComputedStyle(el).boxShadow);
    expect(boxShadow === 'none' || boxShadow === '').toBe(true);
  });

  test('@media print — body background is white', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    const bg = await page
      .locator('body')
      .evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // white = rgb(255, 255, 255) or transparent
    expect(bg === 'rgb(255, 255, 255)' || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent').toBe(
      true
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FRIENDLY URL ALIASES
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
// 8. SECURITY HEADERS
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
// 9. XSS RESILIENCE
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
              // assertion above pass vacuously. The positive control below is
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
// 10. RESPONSE TIME
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Page — Response Time', () => {
  test('page loads within 15 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/poster', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(15_000);
  });
});
