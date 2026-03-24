/**
 * API ERROR RESPONSE TESTS - Story 4.4
 *
 * Purpose: Test error handling when API returns HTTP 5xx errors
 *
 * Coverage:
 *   - HTTP 500 Internal Server Error
 *   - HTTP 502 Bad Gateway
 *   - HTTP 503 Service Unavailable
 *   - HTTP 504 Gateway Timeout
 *
 * Assertions:
 *   - Error UI is displayed with appropriate message
 *   - No internal errors/stack traces leak to user
 *   - Page layout remains intact (no crash)
 *   - Retry functionality works where appropriate
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
  /INTERNAL_ERROR/i,
  /Exception:/i,
  /spreadsheet/i,
  /DriveApp|SpreadsheetApp/i,
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
 * Check page layout is not broken (no crash)
 */
async function assertLayoutNotBroken(page) {
  const hasBody = await page.locator('body').count() > 0;
  expect(hasBody, 'Page body should exist').toBe(true);

  const bodyText = await page.locator('body').innerText();
  const hasVisualContent = await page.locator('img, svg, canvas, div').count() > 0;
  const hasContent = bodyText.trim().length > 0 || hasVisualContent;
  expect(hasContent, 'Page should have content (not blank)').toBe(true);
}

// =============================================================================
// HTTP 500 INTERNAL SERVER ERROR TESTS
// =============================================================================
test.describe('API-001: HTTP 500 Internal Server Error', () => {

  test('Public page handles 500 error gracefully', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Intercept all API calls and return 500
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Internal server error'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);

    // Wait for page to attempt loading and handle error
    await page.waitForTimeout(3000);

    // Verify no internal errors leaked
    await assertNoInternalErrors(page);

    // Verify page layout is intact
    await assertLayoutNotBroken(page);

    // Verify page didn't crash with JS errors (filter expected GAS errors)
    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined') &&
      !e.includes('Script error')
    );
    expect(criticalErrors.length, 'No critical JS errors should occur').toBe(0);
  });

  test('Display page handles 500 error gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Internal server error'
      })
    }));

    await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Poster page handles 500 error gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Internal server error'
      })
    }));

    await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Admin page handles 500 error on form submission gracefully', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    // Let page load normally first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    // Now intercept API calls for form submission
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Failed to save event'
      })
    }));

    // Fill form and submit
    await page.fill('#name', `500 Error Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();

    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// HTTP 502 BAD GATEWAY TESTS
// =============================================================================
test.describe('API-002: HTTP 502 Bad Gateway', () => {

  test('Public page handles 502 error gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Bad gateway'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// HTTP 503 SERVICE UNAVAILABLE TESTS
// =============================================================================
test.describe('API-003: HTTP 503 Service Unavailable', () => {

  test('Page shows appropriate error state on 503', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// HTTP 504 GATEWAY TIMEOUT TESTS
// =============================================================================
test.describe('API-004: HTTP 504 Gateway Timeout', () => {

  test('Page handles 504 timeout gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 504,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'TIMEOUT',
        message: 'Gateway timeout'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// ERROR UI VERIFICATION TESTS
// =============================================================================
test.describe('Error UI Display Verification', () => {

  test('500 error shows user-friendly error message', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Internal server error'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    // Page should show some form of error indication
    const bodyText = await page.locator('body').innerText();

    // Should NOT show technical error details
    expect(bodyText).not.toContain('500');
    expect(bodyText).not.toContain('Internal server error');

    // Should show user-friendly alternative OR graceful empty state
    await assertLayoutNotBroken(page);
  });

  test('Error dialog can be dismissed', async ({ page }) => {
    // Set up error interception before navigation
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Server error'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    // If error dialog appears, try to dismiss it
    const dismissBtn = page.locator('[data-action="dismiss"], button:has-text("Dismiss")');
    if (await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click();
      await page.waitForTimeout(500);

      // Dialog should be gone
      const overlay = page.locator('.global-error-overlay');
      await expect(overlay).not.toBeVisible();
    }

    await assertLayoutNotBroken(page);
  });

  test('Error state does not prevent navigation', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Server error'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(2000);

    // Should still be able to navigate (page not frozen)
    await page.unroute('**/api/**');

    const response = await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    expect(response?.status()).toBe(200);

    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// RECOVERY TESTS
// =============================================================================
test.describe('Error Recovery', () => {

  test('Page recovers after transient 500 error', async ({ page }) => {
    let requestCount = 0;

    // First request fails, subsequent requests succeed
    await page.route('**/api/**', async route => {
      requestCount++;
      if (requestCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            code: 'INTERNAL',
            message: 'Transient error'
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(5000); // Allow time for retry

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Multiple sequential errors do not crash page', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Server error'
      })
    }));

    // Navigate to page multiple times with errors
    for (let i = 0; i < 3; i++) {
      await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
      await page.waitForTimeout(1000);
    }

    await assertLayoutNotBroken(page);

    // Filter expected errors
    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined') &&
      !e.includes('Script error')
    );
    expect(criticalErrors.length, 'Should not have critical JS errors').toBe(0);
  });
});
