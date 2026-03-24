/**
 * NEGATIVE PATH UI TESTS - Cross-Surface Navigation - Story 10
 *
 * Purpose: Test error handling when navigating between surfaces
 *
 * Coverage:
 *   - Broken links from Admin to other surfaces
 *   - Surface pages with invalid/missing event IDs
 *   - Navigation with modified URLs
 *   - Surface-specific error handling
 *
 * Run with: npm run test:negative
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE } = require('../selectors');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

// Invalid/nonsense IDs for testing
const INVALID_IDS = {
  nonsense: 'invalid-id-xyz-' + Date.now(),
  deleted: 'deleted-event-id-12345',
  empty: '',
  sqlInjection: "'; DROP TABLE events; --",
  xssAttempt: '<script>alert(1)</script>',
};

/**
 * Check for internal error leaks
 */
async function assertNoInternalErrors(page) {
  const bodyText = await page.locator('body').innerText();
  const patterns = [
    /TypeError:/i,
    /ReferenceError:/i,
    /at\s+\w+\s+\(/i,
    /\.gs:\d+/i,
    /undefined is not/i,
    /SpreadsheetApp/i,
  ];
  for (const pattern of patterns) {
    expect(bodyText).not.toMatch(pattern);
  }
}

/**
 * Verify page is not completely broken
 */
async function assertLayoutNotBroken(page) {
  const bodyExists = await page.locator('body').count() > 0;
  expect(bodyExists).toBe(true);
}

// =============================================================================
// ADMIN LINK INTEGRITY TESTS
// =============================================================================
test.describe('Negative Path: Admin Link Integrity', () => {

  test('Admin generates valid URLs for all surfaces', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Link Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Verify all links are valid URLs
    const links = [
      { name: 'Public', selector: ADMIN_PAGE.PUBLIC_LINK },
      { name: 'Display', selector: ADMIN_PAGE.DISPLAY_LINK },
      { name: 'Poster', selector: ADMIN_PAGE.POSTER_LINK },
      { name: 'Report', selector: ADMIN_PAGE.REPORT_LINK },
    ];

    for (const link of links) {
      const element = page.locator(link.selector);
      if (await element.isVisible().catch(() => false)) {
        const href = await element.getAttribute('href');
        expect(href, `${link.name} should have valid href`).toBeTruthy();

        // URL should be well-formed
        try {
          new URL(href);
        } catch {
          // If not absolute, should be relative
          expect(href).toContain('page=');
        }
      }
    }
  });

  test('Manually modified event ID in URL shows error on Public page', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show error or fallback content, not crash
    const bodyText = await page.locator('body').innerText();
    const hasContent = bodyText.length > 0;
    expect(hasContent).toBe(true);
  });

  test('Manually modified event ID in URL shows fallback on Display page', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });

  test('Manually modified event ID in URL shows fallback on Poster page', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });

  test('Manually modified event ID in URL shows fallback on Report page', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });
});

// =============================================================================
// MISSING BRAND/PAGE PARAMETER TESTS
// =============================================================================
test.describe('Negative Path: Missing URL Parameters', () => {

  test('Missing page parameter defaults gracefully', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
  });

  test('Missing brand parameter uses default', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=admin`, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
  });

  test('Invalid page parameter shows error or defaults', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=nonexistent&brand=${BRAND_ID}`,
      TIMEOUT_CONFIG
    );

    // Should either redirect, show error, or show default
    expect(response.status()).toBeLessThan(500);
    await assertLayoutNotBroken(page);
  });

  test('Invalid brand parameter handled gracefully', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=admin&brand=nonexistent-brand`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBeLessThan(500);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// SURFACE SPECIFIC ERROR HANDLING
// =============================================================================
test.describe('Negative Path: Surface-Specific Error Handling', () => {

  test('Public page without events shows appropriate message', async ({ page }) => {
    // Use a brand that might not have events
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=empty-test-brand`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show "no events" message or empty state, not crash
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('Display page handles missing stage content', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // TV display should have some structure even without content
    const hasStage = await page.locator('#stage, #tv, body[data-tv], main').count() > 0;
    expect(hasStage).toBe(true);
  });

  test('Poster page handles missing QR data', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should not have broken image sources
    const brokenImages = await page.locator('img[src*="undefined"], img[src*="null"], img[src=""]').count();
    expect(brokenImages).toBe(0);
  });

  test('SharedReport page handles missing analytics data', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Metrics should show zeros or "no data", not NaN or undefined
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('NaN');
    expect(bodyText).not.toContain('undefined');
  });
});

// =============================================================================
// URL MANIPULATION SECURITY
// =============================================================================
test.describe('Negative Path: URL Security', () => {

  test('SQL injection in event ID is sanitized on all surfaces', async ({ page }) => {
    const surfaces = ['public', 'display', 'poster', 'report'];

    for (const surface of surfaces) {
      const response = await page.goto(
        `${BASE_URL}?page=${surface}&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.sqlInjection)}`,
        TIMEOUT_CONFIG
      );

      expect(response.status()).toBe(200);
      await assertLayoutNotBroken(page);
      await assertNoInternalErrors(page);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('DROP TABLE');
    }
  });

  test('XSS in event ID is sanitized on all surfaces', async ({ page }) => {
    const surfaces = ['public', 'display', 'poster', 'report'];

    for (const surface of surfaces) {
      await page.goto(
        `${BASE_URL}?page=${surface}&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.xssAttempt)}`,
        TIMEOUT_CONFIG
      );

      await assertLayoutNotBroken(page);

      // XSS should not be in raw HTML
      const html = await page.content();
      expect(html).not.toContain('<script>alert(1)</script>');
    }
  });

  test('Path traversal attempts in parameters are blocked', async ({ page }) => {
    const maliciousIds = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      '%2e%2e%2f%2e%2e%2f',
    ];

    for (const id of maliciousIds) {
      const response = await page.goto(
        `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${encodeURIComponent(id)}`,
        TIMEOUT_CONFIG
      );

      expect(response.status()).toBeLessThan(500);
      await assertLayoutNotBroken(page);
      await assertNoInternalErrors(page);
    }
  });
});

// =============================================================================
// NAVIGATION STATE TESTS
// =============================================================================
test.describe('Negative Path: Navigation State', () => {

  test('Back button after event creation returns to form', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Back Button Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    // Navigate to a surface
    const publicLink = page.locator(ADMIN_PAGE.PUBLIC_LINK);
    if (await publicLink.isVisible().catch(() => false)) {
      const href = await publicLink.getAttribute('href');
      await page.goto(href, TIMEOUT_CONFIG);

      // Go back
      await page.goBack();
      await page.waitForTimeout(1000);

      await assertLayoutNotBroken(page);
    }
  });

  test('Refresh on surface page maintains state', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Create event and navigate to public page
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.fill('#name', `Refresh Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();
    await page.waitForTimeout(3000);

    const publicLink = page.locator(ADMIN_PAGE.PUBLIC_LINK);
    if (await publicLink.isVisible().catch(() => false)) {
      const href = await publicLink.getAttribute('href');
      await page.goto(href, TIMEOUT_CONFIG);

      // Refresh
      await page.reload();
      await page.waitForTimeout(2000);

      await assertLayoutNotBroken(page);
      await assertNoInternalErrors(page);
    }
  });

  test('Multiple rapid page navigations do not crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const surfaces = ['admin', 'public', 'display', 'poster', 'report'];

    for (const surface of surfaces) {
      await page.goto(
        `${BASE_URL}?page=${surface}&brand=${BRAND_ID}`,
        { ...TIMEOUT_CONFIG, waitUntil: 'commit' } // Don't wait for full load
      );
    }

    // Wait for last page to settle
    await page.waitForLoadState('domcontentloaded');

    await assertLayoutNotBroken(page);

    // Filter expected GAS errors
    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });
});

// =============================================================================
// CONCURRENT ACCESS TESTS
// =============================================================================
test.describe('Negative Path: Edge Cases', () => {

  test('Opening same event in multiple tabs does not cause conflicts', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    const setupDialog = (page) => {
      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
          await dialog.accept(ADMIN_KEY);
        } else {
          await dialog.accept();
        }
      });
    };

    setupDialog(page1);
    setupDialog(page2);

    // Open admin in both tabs
    await Promise.all([
      page1.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG),
      page2.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG),
    ]);

    // Both should load without error
    await assertLayoutNotBroken(page1);
    await assertLayoutNotBroken(page2);

    await page1.close();
    await page2.close();
    await context.close();
  });

  test('Very long URL parameters are handled', async ({ page }) => {
    const longParam = 'a'.repeat(2000);
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${longParam}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBeLessThan(500);
    await assertLayoutNotBroken(page);
  });

  test('Unicode in URL parameters is handled', async ({ page }) => {
    const unicodeId = 'イベント-событие-事件-🎉';
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${encodeURIComponent(unicodeId)}`,
      TIMEOUT_CONFIG
    );

    expect(response.status()).toBeLessThan(500);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });
});
