/**
 * E2E Negative Tests: Display / TV Kiosk — Error States + Edge Cases
 *
 * The Display page runs unattended. Error states must be graceful —
 * never a blank screen, never a JS crash. The TV just sits there.
 *
 * Source: workers/oursharedevents/src/handlers/pages.ts (DISPLAY_HTML)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

function evt(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_neg_${Date.now()}`,
    name: 'Negative Event',
    status: 'active',
    brand_id: 'root',
    startDateISO: '2026-07-04T17:00:00Z',
    venue: 'Test Venue',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. API FAILURES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Negative — API Failures', () => {
  test('500 shows error message, not blank screen', async ({ page }) => {
    await page.route('**/api/v2/events', (r) => r.fulfill({ status: 500, body: 'fail' }));
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const main = page.locator('[data-testid="display-main"]');
    await expect(main).toBeVisible();
    await expect(main).toContainText('Could not load events');
  });

  test('network timeout shows error, not blank screen', async ({ page }) => {
    await page.route('**/api/v2/events', (r) => r.abort('timedout'));
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="display-main"]')).toContainText(
      'Could not load events'
    );
  });

  test('malformed JSON shows error', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: 'not json' })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="display-main"]')).toContainText(
      'Could not load events'
    );
  });

  test('ok:false treated as empty', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'DB down' }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="display-main"]')).toContainText('No upcoming events');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Negative — Empty State', () => {
  test('empty items → "No upcoming events scheduled"', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="display-main"]')).toContainText('No upcoming events');
  });

  test('empty state shows .empty class element', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('.empty')).toBeVisible();
  });

  test('header + clock + ticker remain visible on empty', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="display-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-clock"]')).toBeVisible();
    await expect(page.locator('[data-testid="display-ticker"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. XSS RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Negative — XSS', () => {
  test('script in name escaped in featured card', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [evt({ name: '<script>alert(1)</script>Hacked' })],
        }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2 = await page.locator('.event-card h2').innerHTML();
    expect(h2).not.toContain('<script>');
    expect(h2).toContain('&lt;script&gt;');
  });

  test('XSS in next-card name escaped', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            evt({ name: 'Safe Featured' }),
            evt({ name: '<img src=x onerror=alert(1)>', id: 'e2' }),
          ],
        }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const nameHtml = await page.locator('.next-card .name').first().innerHTML();
    expect(nameHtml).not.toContain('<img');
  });

  test('no JS errors with XSS payloads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [
            evt({
              name: '"><script>alert(1)</script>',
              venue: "'; DROP TABLE events;--",
            }),
          ],
        }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EDGE CASE DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Negative — Edge Cases', () => {
  test('event with no name → "Untitled Event"', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [evt({ name: undefined })] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('.event-card h2')).toContainText('Untitled');
  });

  test('event with emoji renders on dark background', async ({ page }) => {
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 200,
          items: [evt({ name: '🎶 Jazz Night 🎷' })],
        }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('.event-card h2')).toContainText('🎶');
  });

  test('200-char event name no overflow at 1920px', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [evt({ name: 'A'.repeat(200) })] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONSOLE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Display Negative — Console Errors', () => {
  test('no JS errors on normal load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('no JS errors on empty', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('**/api/v2/events', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 200, items: [] }),
      })
    );
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    expect(errors).toHaveLength(0);
  });

  test('no JS errors on API failure', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('**/api/v2/events', (r) => r.fulfill({ status: 500, body: 'fail' }));
    await page.goto('/display', { waitUntil: 'networkidle', timeout: TIMEOUT });
    expect(errors).toHaveLength(0);
  });
});
