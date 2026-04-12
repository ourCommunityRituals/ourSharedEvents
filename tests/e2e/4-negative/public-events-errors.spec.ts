/**
 * E2E Negative Tests: Public Events — Error States + Edge Cases
 *
 * Covers:
 *   - API failure → error message with data-testid="public-error"
 *   - Network timeout → error message
 *   - Malformed JSON → error message
 *   - Empty events → "No events scheduled"
 *   - ok:false → treated as empty
 *   - XSS payloads → escaped in rendered HTML
 *   - Edge data: no name, no date, no venue, very long strings
 *   - Console errors during all states
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (PUBLIC_HTML)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

function mockApi(page: any, response: { status: number; body: unknown } | 'timeout') {
  return page.route('**/api/v2/events', (route: any) => {
    if (response === 'timeout') return route.abort('timedout');
    return route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    });
  });
}

function evt(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_neg_${Date.now()}`,
    name: 'Negative Test Event',
    slug: 'neg-test',
    status: 'active',
    brand_id: 'root',
    startDateISO: '2026-12-01T18:00:00Z',
    venue: 'Test Venue',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. API FAILURES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events Negative — API Failures', () => {
  test('500 shows error with data-testid="public-error"', async ({ page }) => {
    await mockApi(page, { status: 500, body: 'Internal Error' });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const error = page.locator('[data-testid="public-error"]');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Could not load events');
  });

  test('network timeout shows error', async ({ page }) => {
    await mockApi(page, 'timeout');
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-error"]')).toBeVisible();
  });

  test('malformed JSON shows error', async ({ page }) => {
    await mockApi(page, { status: 200, body: 'not json {{{}' });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-error"]')).toBeVisible();
  });

  test('error message includes "Please try again"', async ({ page }) => {
    await mockApi(page, { status: 500, body: 'fail' });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-error"]')).toContainText('Please try again');
  });

  test('error has .error CSS class', async ({ page }) => {
    await mockApi(page, { status: 500, body: 'fail' });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('.error')).toBeVisible();
  });

  test('no event cards when error occurs', async ({ page }) => {
    await mockApi(page, { status: 500, body: 'fail' });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    expect(await page.locator('[data-testid="public-event-card"]').count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMPTY / FALSE STATES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events Negative — Empty States', () => {
  test('empty items → "No events scheduled"', async ({ page }) => {
    await mockApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-events"]')).toContainText(
      'No events scheduled'
    );
  });

  test('ok:false → "No events scheduled"', async ({ page }) => {
    await mockApi(page, { status: 200, body: { ok: false } });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-events"]')).toContainText(
      'No events scheduled'
    );
  });

  test('null items → "No events scheduled"', async ({ page }) => {
    await mockApi(page, { status: 200, body: { ok: true, items: null } });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-events"]')).toContainText(
      'No events scheduled'
    );
  });

  test('empty state has no event cards', async ({ page }) => {
    await mockApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    expect(await page.locator('[data-testid="public-event-card"]').count()).toBe(0);
  });

  test('empty state has no error message', async ({ page }) => {
    await mockApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    expect(await page.locator('[data-testid="public-error"]').count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. XSS RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events Negative — XSS Resilience', () => {
  test('script in name is escaped', async ({ page }) => {
    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ name: '<script>alert("xss")</script>' })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const nameHtml = await page.locator('[data-testid="public-event-name"]').first().innerHTML();
    expect(nameHtml).not.toContain('<script>');
    expect(nameHtml).toContain('&lt;script&gt;');
  });

  test('img onerror in venue is escaped', async ({ page }) => {
    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ venue: '<img src=x onerror=alert(1)>' })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const metaHtml = await page.locator('[data-testid="public-event-meta"]').first().innerHTML();
    expect(metaHtml).not.toContain('<img src=x');
  });

  test('SQL injection in name does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ name: "Robert'); DROP TABLE events;--" })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    expect(errors).toHaveLength(0);
    await expect(page.locator('[data-testid="public-event-card"]')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EDGE CASE DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events Negative — Edge Case Data', () => {
  test('event with no name shows "Untitled Event"', async ({ page }) => {
    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ name: undefined })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-event-name"]')).toContainText('Untitled Event');
  });

  test('event with empty name shows "Untitled Event"', async ({ page }) => {
    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ name: '' })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-event-name"]')).toContainText('Untitled Event');
  });

  test('very long name (200 chars) renders without overflow', async ({ page }) => {
    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ name: 'A'.repeat(200) })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-event-card"]')).toBeVisible();
    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });

  test('event with emoji renders correctly', async ({ page }) => {
    await mockApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [evt({ name: '🎵 Music Festival 🎸', venue: '🏟 Stadium' })],
      },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="public-event-name"]')).toContainText('🎵');
    await expect(page.locator('[data-testid="public-event-meta"]')).toContainText('🏟');
  });

  test('event with invalid date string does not crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockApi(page, {
      status: 200,
      body: { ok: true, status: 200, items: [evt({ startDateISO: 'garbage-date' })] },
    });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Card should still render even if date is invalid
    await expect(page.locator('[data-testid="public-event-card"]')).toBeVisible();
    // May show "Invalid Date" in meta — that's acceptable for garbage input
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONSOLE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Public Events Negative — Console Errors', () => {
  test('no JS errors on normal load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });

  test('no JS errors on empty state', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    expect(errors).toHaveLength(0);
  });

  test('no JS errors on error state', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockApi(page, { status: 500, body: 'fail' });
    await page.goto('/events', { waitUntil: 'networkidle', timeout: TIMEOUT });
    expect(errors).toHaveLength(0);
  });
});
