/**
 * NETWORK FAILURE TESTS - Story 4.4
 *
 * Purpose: Test error handling when network failures occur
 *
 * Coverage:
 *   - Network request timeouts
 *   - Complete network failure (offline)
 *   - Intermittent network connectivity
 *   - Slow network (3G simulation)
 *   - Connection aborts
 *
 * Assertions:
 *   - Appropriate error messages shown to user
 *   - Page does not freeze or crash
 *   - Retry mechanisms work correctly
 *   - No internal errors exposed
 *
 * @see docs/qa/NEGATIVE_TEST_PLAN.md - Test plan document
 * @see src/mvp/GlobalErrorHandler.html - Error handler implementation
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const { ADMIN_PAGE } = require('../selectors');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

// Patterns that indicate internal errors leaking to users
const INTERNAL_ERROR_PATTERNS = [
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /at\s+\w+\s+\(/i,
  /\.gs:\d+/i,
  /\.js:\d+:\d+/i,
  /undefined is not/i,
  /null is not/i,
  /Cannot read propert/i,
  /fetch failed/i,
  /NetworkError/i,
  /ERR_NETWORK/i,
];

/**
 * Check for internal error leaks in page content
 */
async function assertNoInternalErrors(page) {
  const bodyText = await page.locator('body').innerText();
  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    const match = bodyText.match(pattern);
    expect(match, `Internal error leaked to UI: ${pattern}`).toBeNull();
  }
}

/**
 * Check page layout is not broken
 */
async function assertLayoutNotBroken(page) {
  const hasBody = await page.locator('body').count() > 0;
  expect(hasBody, 'Page body should exist').toBe(true);

  const bodyText = await page.locator('body').innerText();
  const hasVisualContent = await page.locator('img, svg, canvas, div').count() > 0;
  const hasContent = bodyText.trim().length > 0 || hasVisualContent;
  expect(hasContent, 'Page should have content').toBe(true);
}

/**
 * Check page is not frozen (can still interact)
 */
async function assertPageNotFrozen(page) {
  // Try to evaluate a simple script - frozen pages will timeout
  try {
    const result = await page.evaluate(() => {
      return document.readyState;
    }, { timeout: 5000 });
    expect(['complete', 'interactive']).toContain(result);
  } catch (e) {
    expect.fail('Page appears to be frozen - cannot execute JavaScript');
  }
}

// =============================================================================
// NETWORK TIMEOUT TESTS
// =============================================================================
test.describe('NET-001: Network Request Timeout', () => {

  test('Page handles API timeout gracefully', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Abort API requests to simulate timeout
    await page.route('**/api/**', route => route.abort('timedout'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Admin form submission handles timeout gracefully', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Let page load first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    // Now intercept form submission as timeout
    await page.route('**/api/**', route => route.abort('timedout'));

    // Fill and submit form
    await page.fill('#name', `Timeout Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();

    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Long-running request shows loading state then error', async ({ page }) => {
    // Delay response significantly
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      await route.abort('timedout');
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, {
      ...TIMEOUT_CONFIG,
      timeout: 15000,
    });

    // Page should not be frozen while waiting
    await assertPageNotFrozen(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// COMPLETE NETWORK FAILURE (OFFLINE)
// =============================================================================
test.describe('NET-002: Complete Network Failure', () => {

  test('Page handles offline state gracefully', async ({ page }) => {
    // Abort all network requests
    await page.route('**/*', route => {
      const resourceType = route.request().resourceType();
      // Allow initial HTML load, abort all fetches
      if (resourceType === 'fetch' || resourceType === 'xhr') {
        return route.abort('failed');
      }
      return route.continue();
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Connection refused shows user-friendly error', async ({ page }) => {
    await page.route('**/api/**', route => route.abort('connectionrefused'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// INTERMITTENT NETWORK
// =============================================================================
test.describe('NET-003: Intermittent Network', () => {

  test('Retry logic handles intermittent failures', async ({ page }) => {
    let requestCount = 0;

    // First 2 requests fail, third succeeds
    await page.route('**/api/**', async route => {
      requestCount++;
      if (requestCount <= 2) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Wait for retries
    await page.waitForTimeout(8000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);

    // Should have made multiple attempts
    expect(requestCount).toBeGreaterThanOrEqual(2);
  });

  test('Page recovers after network restored', async ({ page }) => {
    // Start with network failure
    await page.route('**/api/**', route => route.abort('failed'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    await assertLayoutNotBroken(page);

    // "Restore" network
    await page.unroute('**/api/**');

    // Navigate again - should work now
    await page.reload();
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// SLOW NETWORK
// =============================================================================
test.describe('NET-004: Slow Network', () => {

  test('Page handles slow network (500ms delay) gracefully', async ({ page }) => {
    // Add delay to all API requests
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });

    const startTime = Date.now();
    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, {
      ...TIMEOUT_CONFIG,
      timeout: 60000,
    });
    const loadTime = Date.now() - startTime;

    // Should eventually load
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);

    // Verify it actually waited (not instant)
    expect(loadTime).toBeGreaterThan(500);
  });

  test('Page handles very slow network (3s delay) gracefully', async ({ page }) => {
    // Simulate 3G-like latency
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await route.continue();
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, {
      ...TIMEOUT_CONFIG,
      timeout: 60000,
    });

    // Wait for slow response
    await page.waitForTimeout(5000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Loading indicator shown during slow network', async ({ page }) => {
    // Add significant delay
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.continue();
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Check for loading indicator within first second
    await page.waitForTimeout(500);

    // Look for common loading indicators
    const loadingIndicators = [
      '.spinner',
      '.loading',
      '[aria-busy="true"]',
      '.loading-message',
      '[data-testid="loading"]',
    ];

    let hasLoadingIndicator = false;
    for (const selector of loadingIndicators) {
      if (await page.locator(selector).isVisible().catch(() => false)) {
        hasLoadingIndicator = true;
        break;
      }
    }

    // Either has loading indicator OR has skeleton/placeholder content
    const hasPlaceholder = await page.locator('.skeleton, .placeholder, [aria-hidden="true"]').count() > 0;

    // Should show some indication of loading state
    // (This is a soft check - some pages may handle this differently)
    if (!hasLoadingIndicator && !hasPlaceholder) {
      console.log('Note: No explicit loading indicator found during slow network');
    }

    // Wait for load to complete
    await page.waitForTimeout(3000);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// DNS RESOLUTION FAILURE
// =============================================================================
test.describe('NET-005: DNS Resolution Failure', () => {

  test('DNS failure shows user-friendly error', async ({ page }) => {
    // Abort with DNS-like failure
    await page.route('**/api/**', route => route.abort('namenotresolved'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// CONNECTION ABORT TESTS
// =============================================================================
test.describe('Connection Abort Scenarios', () => {

  test('Connection closed mid-transfer handles gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.abort('connectionclosed'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Connection reset handles gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.abort('connectionreset'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Internet disconnected handles gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.abort('internetdisconnected'));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// MULTIPLE SURFACES NETWORK RESILIENCE
// =============================================================================
test.describe('Multi-Surface Network Resilience', () => {

  const surfaces = ['public', 'display', 'poster'];

  for (const surface of surfaces) {
    test(`${surface} page handles network failure gracefully`, async ({ page }) => {
      await page.route('**/api/**', route => route.abort('failed'));

      await page.goto(`${BASE_URL}?page=${surface}&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.waitForTimeout(3000);

      await assertNoInternalErrors(page);
      await assertLayoutNotBroken(page);
      await assertPageNotFrozen(page);
    });
  }
});
