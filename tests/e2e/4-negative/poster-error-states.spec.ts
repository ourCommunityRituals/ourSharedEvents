/**
 * E2E Negative Tests: Poster — Error States + Edge Cases
 *
 * Covers:
 *   - API failure → error message
 *   - Network timeout → error message
 *   - Empty events list → empty state in picker and area
 *   - Malformed API response → graceful degradation
 *   - XSS in event data → HTML-escaped, not executed
 *   - Console errors during normal operation
 *   - Poster with minimal event data (no date, no venue)
 *   - Poster with maximum-length strings
 *
 * Source of truth: workers/oursharedevents/src/handlers/pages.ts (POSTER_HTML)
 */

import { test, expect } from '@playwright/test';

const TIMEOUT = 20_000;

function mockEventsApi(page: any, response: { status: number; body: any } | 'timeout' | 'abort') {
  return page.route('**/api/v2/events', (route: any) => {
    if (response === 'timeout') return route.abort('timedout');
    if (response === 'abort') return route.abort('failed');
    return route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    });
  });
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_test_${Date.now()}`,
    title: 'Test Event',
    slug: 'test-event',
    status: 'active',
    brand_id: 'root',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. API FAILURES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Negative — API Failures', () => {
  test('500 response shows error message', async ({ page }) => {
    await mockEventsApi(page, { status: 500, body: 'Internal Error' });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="poster-area"]')).toContainText(
      'Could not load events'
    );
  });

  test('network timeout shows error message', async ({ page }) => {
    await mockEventsApi(page, 'timeout');
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="poster-area"]')).toContainText(
      'Could not load events'
    );
  });

  test('network abort shows error message', async ({ page }) => {
    await mockEventsApi(page, 'abort');
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="poster-area"]')).toContainText(
      'Could not load events'
    );
  });

  test('error state has .error CSS class', async ({ page }) => {
    await mockEventsApi(page, { status: 500, body: 'fail' });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="poster-area"] .error')).toBeVisible();
  });

  test('malformed JSON response shows error', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: 'not json at all' });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    await expect(page.locator('[data-testid="poster-area"]')).toContainText(
      'Could not load events'
    );
  });

  test('response with ok:false shows empty state', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: false, error: 'DB error' } });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // ok:false → items is falsy → treated as empty
    const area = page.locator('[data-testid="poster-area"]');
    const text = await area.textContent();
    expect(text).toMatch(/no events/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMPTY STATES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Negative — Empty States', () => {
  test('empty items array → picker shows "No events available"', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const picker = page.locator('[data-testid="poster-event-picker"]');
    await expect(picker).toContainText('No events');
  });

  test('empty items array → area shows "No events scheduled"', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const area = page.locator('[data-testid="poster-area"]');
    await expect(area).toContainText('No events');
  });

  test('empty items → no .poster card rendered', async ({ page }) => {
    await mockEventsApi(page, { status: 200, body: { ok: true, status: 200, items: [] } });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const poster = page.locator('[data-testid="poster-area"] .poster');
    expect(await poster.count()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. XSS RESILIENCE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Negative — XSS Resilience', () => {
  test('script tag in event name is HTML-escaped', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ title: '<script>alert("xss")</script>Hacked' })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2Html = await page.locator('[data-testid="poster-area"] .poster-header h2').innerHTML();
    expect(h2Html).not.toContain('<script>');
    expect(h2Html).toContain('&lt;script&gt;');
  });

  test('img onerror in venue is HTML-escaped', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ venue: '<img src=x onerror=alert(1)>' })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const bodyHtml = await page.locator('[data-testid="poster-area"] .poster-body').innerHTML();
    expect(bodyHtml).not.toContain('<img src=x');
  });

  test('XSS in address is HTML-escaped', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ data: { address: '"><script>alert(1)</script>' } })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const html = await page.locator('[data-testid="poster-area"]').innerHTML();
    expect(html).not.toContain('"><script>');
  });

  test('no unhandled JS errors during XSS test', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [
          validEvent({
            title: '"><img src=x onerror=alert(1)>',
            venue: "'; DROP TABLE events;--",
          }),
        ],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EDGE CASE DATA
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Negative — Edge Case Data', () => {
  test('event with no title shows "Event" fallback', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ title: undefined, name: undefined })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2 = await page.locator('[data-testid="poster-area"] .poster-header h2').textContent();
    // renderPoster() falls back to 'Event' when name is falsy
    expect(h2?.trim()).toBe('Event');
  });

  test('event with no date → no date meta row', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ start_date: null, startDateISO: null })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Calendar icon row should not appear
    const calendarRow = page.locator('[data-testid="poster-area"] .meta-icon:has-text("📅")');
    expect(await calendarRow.count()).toBe(0);
  });

  test('event with no venue → no venue meta row', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ venue: null, location: null })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    // Pin icon row should not appear
    const pinRow = page.locator('[data-testid="poster-area"] .meta-icon:has-text("📍")');
    expect(await pinRow.count()).toBe(0);
  });

  test('event with very long title renders without overflow', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ title: 'A'.repeat(200) })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2 = page.locator('[data-testid="poster-area"] .poster-header h2');
    await expect(h2).toBeVisible();

    // Check no horizontal overflow on poster container
    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasScroll).toBe(false);
  });

  test('event with emoji in title renders correctly', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ title: '🎉 Community BBQ 🌭' })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2 = await page.locator('[data-testid="poster-area"] .poster-header h2').textContent();
    expect(h2).toContain('🎉');
    expect(h2).toContain('🌭');
  });

  test('event with CJK characters renders correctly', async ({ page }) => {
    await mockEventsApi(page, {
      status: 200,
      body: {
        ok: true,
        status: 200,
        items: [validEvent({ title: 'コミュニティイベント', venue: '東京都渋谷区' })],
      },
    });
    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const h2 = await page.locator('[data-testid="poster-area"] .poster-header h2').textContent();
    expect(h2).toContain('コミュニティイベント');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CONSOLE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Poster Negative — No Console Errors', () => {
  test('no JS errors during normal poster load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });

  test('no JS errors after switching events', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/poster', { waitUntil: 'networkidle', timeout: TIMEOUT });

    const picker = page.locator('[data-testid="poster-event-picker"]');
    const options = picker.locator('option');
    const count = await options.count();

    if (count >= 2 && !(await options.first().textContent())?.includes('No events')) {
      await picker.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      await picker.selectOption({ index: 0 });
      await page.waitForTimeout(500);
    }

    expect(errors).toHaveLength(0);
  });
});
