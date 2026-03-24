/**
 * CLOUDFLARE WORKER ERROR TESTS - Story 4.4
 *
 * Purpose: Test error handling when Cloudflare worker returns error headers
 *
 * Coverage:
 *   - X-ErrorType: RATE_LIMITED (429)
 *   - X-ErrorType: BAD_INPUT (400)
 *   - X-ErrorType: UNAUTHORIZED (401/403)
 *   - X-ErrorType: NOT_FOUND (404)
 *   - Malformed worker responses
 *
 * Assertions:
 *   - Appropriate error messages shown based on error type
 *   - No internal error details exposed
 *   - Page remains functional after error
 *   - Retry logic respects rate limiting
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
  /cloudflare/i,
  /worker/i,
  /edge/i,
  /wrangler/i,
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
 * Check page is not frozen
 */
async function assertPageNotFrozen(page) {
  try {
    const result = await page.evaluate(() => document.readyState, { timeout: 5000 });
    expect(['complete', 'interactive']).toContain(result);
  } catch (e) {
    expect.fail('Page appears to be frozen');
  }
}

// =============================================================================
// RATE LIMITED (429) TESTS
// =============================================================================
test.describe('CF-001: Rate Limited (X-ErrorType: RATE_LIMITED)', () => {

  test('Page handles rate limit error gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'RATE_LIMITED',
        'Retry-After': '60',
      },
      body: JSON.stringify({
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Rate limit error shows appropriate user message', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'RATE_LIMITED',
      },
      body: JSON.stringify({
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    // Should not expose raw error code
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).not.toContain('429');
    expect(bodyText.toLowerCase()).not.toContain('rate_limited');

    await assertLayoutNotBroken(page);
  });

  test('Admin form handles rate limit on submission', async ({ page }) => {
    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else {
        await dialog.accept();
      }
    });

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await expect(page.locator(ADMIN_PAGE.CREATE_CARD)).toBeVisible({ timeout: 15000 });

    await page.route('**/api/**', route => route.fulfill({
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'RATE_LIMITED',
      },
      body: JSON.stringify({
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.'
      })
    }));

    await page.fill('#name', `Rate Limit Test ${Date.now()}`);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');
    await page.locator(ADMIN_PAGE.CREATE_EVENT_BUTTON).first().click();

    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// BAD INPUT (400) TESTS
// =============================================================================
test.describe('CF-002: Bad Input (X-ErrorType: BAD_INPUT)', () => {

  test('Page handles bad input error gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'BAD_INPUT',
      },
      body: JSON.stringify({
        ok: false,
        code: 'BAD_INPUT',
        message: 'Invalid request parameters'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Bad input error with validation details handled safely', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'BAD_INPUT',
      },
      body: JSON.stringify({
        ok: false,
        code: 'BAD_INPUT',
        message: 'Validation failed',
        details: {
          field: 'eventDate',
          error: 'Date must be in the future'
        }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });
});

// =============================================================================
// UNAUTHORIZED (401/403) TESTS
// =============================================================================
test.describe('CF-003: Unauthorized (X-ErrorType: UNAUTHORIZED)', () => {

  test('Page handles 401 unauthorized gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'UNAUTHORIZED',
      },
      body: JSON.stringify({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      })
    }));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Page handles 403 forbidden gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'UNAUTHORIZED',
      },
      body: JSON.stringify({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Access denied'
      })
    }));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('Unauthorized does not expose credentials or tokens', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'UNAUTHORIZED',
        'WWW-Authenticate': 'Bearer realm="api"',
      },
      body: JSON.stringify({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
      })
    }));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    // Should not expose JWT or token details
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('eyJ');
    expect(bodyText.toLowerCase()).not.toContain('bearer');
    expect(bodyText.toLowerCase()).not.toContain('jwt');

    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// NOT FOUND (404) TESTS
// =============================================================================
test.describe('CF-004: Not Found (X-ErrorType: NOT_FOUND)', () => {

  test('Page handles 404 not found gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'NOT_FOUND',
      },
      body: JSON.stringify({
        ok: false,
        code: 'NOT_FOUND',
        message: 'Resource not found'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
  });

  test('404 for specific event shows user-friendly message', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'NOT_FOUND',
      },
      body: JSON.stringify({
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}&event=nonexistent`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    // Should not expose internal IDs or paths
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).not.toContain('404');
    expect(bodyText.toLowerCase()).not.toContain('not_found');

    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// MALFORMED WORKER RESPONSE TESTS
// =============================================================================
test.describe('CF-005: Malformed Worker Response', () => {

  test('Page handles empty response body gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: ''
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles non-JSON response gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
      body: '<html><body>Error</body></html>'
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles truncated JSON gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"ok": true, "value": {"events": ['
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles response with missing ok field gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'success',
        data: { events: [] }
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertNoInternalErrors(page);
    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);
  });

  test('Page handles worker timeout header gracefully', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 524,
      headers: {
        'Content-Type': 'application/json',
        'X-ErrorType': 'TIMEOUT',
        'CF-RAY': '12345-SJC',
      },
      body: JSON.stringify({
        ok: false,
        code: 'TIMEOUT',
        message: 'A timeout occurred'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    // Should not expose Cloudflare-specific details
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).not.toContain('cf-ray');
    expect(bodyText.toLowerCase()).not.toContain('cloudflare');
    expect(bodyText.toLowerCase()).not.toContain('524');

    await assertLayoutNotBroken(page);
  });
});

// =============================================================================
// CORRELATION ID HANDLING
// =============================================================================
test.describe('Correlation ID in Error Responses', () => {

  test('Error with corrId does not expose internal details', async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': 'req-12345-abcde',
      },
      body: JSON.stringify({
        ok: false,
        code: 'INTERNAL',
        message: 'Internal error',
        corrId: 'corr-67890-fghij'
      })
    }));

    await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
    await page.waitForTimeout(3000);

    await assertLayoutNotBroken(page);
    await assertPageNotFrozen(page);

    // corrId may be shown for support reference, but should not expose internals
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).not.toContain('internal');
    expect(bodyText).not.toContain('INTERNAL');
  });
});

// =============================================================================
// MULTI-SURFACE ERROR HANDLING
// =============================================================================
test.describe('All Surfaces Handle Worker Errors', () => {

  const surfaces = ['public', 'display', 'poster'];
  const errorTypes = [
    { code: 'RATE_LIMITED', status: 429 },
    { code: 'BAD_INPUT', status: 400 },
    { code: 'UNAUTHORIZED', status: 401 },
    { code: 'NOT_FOUND', status: 404 },
    { code: 'INTERNAL', status: 500 },
  ];

  for (const surface of surfaces) {
    for (const error of errorTypes) {
      test(`${surface} handles ${error.code} gracefully`, async ({ page }) => {
        await page.route('**/api/**', route => route.fulfill({
          status: error.status,
          headers: {
            'Content-Type': 'application/json',
            'X-ErrorType': error.code,
          },
          body: JSON.stringify({
            ok: false,
            code: error.code,
            message: `Error: ${error.code}`
          })
        }));

        await page.goto(`${BASE_URL}?page=${surface}&brand=${BRAND_ID}`, TIMEOUT_CONFIG);
        await page.waitForTimeout(2000);

        await assertNoInternalErrors(page);
        await assertLayoutNotBroken(page);
        await assertPageNotFrozen(page);
      });
    }
  }
});
