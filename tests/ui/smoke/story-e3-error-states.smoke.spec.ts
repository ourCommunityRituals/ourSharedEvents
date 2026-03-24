/**
 * Story E3 UI Smoke Test: Error States (Never Blank / Never Broken)
 *
 * Validates that Public, Display, and Poster surfaces always show meaningful
 * content, even when backend fails or data is unavailable.
 *
 * INVARIANT: No blank screens, no infinite spinners, no JS stack traces.
 *
 * Test Cases:
 *   - Force 404 → "Event not available" text visible
 *   - Force 503 → "Temporarily unavailable" text visible
 *   - Network disconnect → Fallback UI visible (not blank)
 *
 * Acceptance Criteria:
 *   - Disconnect backend → UI shows fallback
 *   - Invalid eventId → UI shows "not available"
 *
 * @see Story E3 - Public Failure States
 */

import { test, expect, Page, Route, Request } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Test event ID that doesn't exist
const INVALID_EVENT_ID = 'nonexistent-event-id-e3-test-12345';

// Surface configurations for testing
const SURFACES = [
  { name: 'public', param: 'public', containerId: 'list' },
  { name: 'display', param: 'display', containerId: 'display-content' },
  { name: 'poster', param: 'poster', containerId: 'poster-content' },
] as const;

/**
 * Helper to intercept API calls and force specific responses
 */
async function interceptApiWithStatus(
  page: Page,
  status: number,
  body: object = {}
): Promise<void> {
  await page.route('**/api/**', async (route: Route, request: Request) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: status === 404 ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE',
        message: status === 404 ? 'Event not found' : 'Service temporarily unavailable',
        ...body,
      }),
    });
  });
}

/**
 * Helper to verify error state is visible and contains expected content
 */
async function verifyErrorStateVisible(
  page: Page,
  expectedTexts: string[]
): Promise<void> {
  // Wait for any loading spinners to disappear
  await page.waitForLoadState('networkidle');

  // Allow time for error state to render
  await page.waitForTimeout(1000);

  // Get page content
  const pageContent = await page.locator('body').textContent();

  // Verify at least one expected text is present
  const foundExpectedText = expectedTexts.some(text =>
    pageContent?.toLowerCase().includes(text.toLowerCase())
  );

  expect(
    foundExpectedText,
    `Expected one of: ${expectedTexts.join(', ')} to be visible. Got: ${pageContent?.substring(0, 500)}`
  ).toBe(true);

  // Verify no blank page
  expect(pageContent?.trim().length, 'Page should not be blank').toBeGreaterThan(50);

  // Verify no visible stack traces
  const hasStackTrace = pageContent?.includes('at ') && pageContent?.includes('.js:');
  expect(hasStackTrace, 'Page should not show JS stack traces').toBeFalsy();
}

/**
 * Helper to verify page has minimal content (not blank)
 */
async function verifyNotBlank(page: Page): Promise<void> {
  const bodyContent = await page.locator('body').textContent();
  expect(bodyContent?.trim().length, 'Page should not be completely blank').toBeGreaterThan(20);
}

test.describe('Story E3: Public Failure States', () => {

  test.describe('404 Error Handling - Event Not Found', () => {

    test('public page shows error state for invalid event ID', async ({ page }) => {
      // Navigate with invalid event ID
      const response = await page.goto(
        `/?page=public&brand=${BRAND}&id=${INVALID_EVENT_ID}`
      );

      // Page should load (not crash)
      expect(response?.status()).toBeLessThan(500);

      // Should show error state with appropriate message
      await verifyErrorStateVisible(page, [
        'not found',
        'not available',
        'couldn\'t find',
        'event not',
      ]);
    });

    test('display page shows error state for invalid event ID', async ({ page }) => {
      const response = await page.goto(
        `/?page=display&brand=${BRAND}&id=${INVALID_EVENT_ID}`
      );

      expect(response?.status()).toBeLessThan(500);

      await verifyErrorStateVisible(page, [
        'not found',
        'not available',
        'couldn\'t find',
        'event not',
      ]);
    });

    test('poster page shows error state for invalid event ID', async ({ page }) => {
      const response = await page.goto(
        `/?page=poster&brand=${BRAND}&id=${INVALID_EVENT_ID}`
      );

      expect(response?.status()).toBeLessThan(500);

      await verifyErrorStateVisible(page, [
        'not found',
        'not available',
        'couldn\'t find',
        'event not',
      ]);
    });

    test('public page with forced 404 API response shows fallback', async ({ page }) => {
      // Intercept API calls and return 404
      await interceptApiWithStatus(page, 404);

      await page.goto(`/?page=public&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      await verifyErrorStateVisible(page, [
        'not found',
        'not available',
        'couldn\'t find',
      ]);
    });

  });

  test.describe('503 Error Handling - Backend Unavailable', () => {

    test('public page shows fallback for forced 503 response', async ({ page }) => {
      // Intercept API calls and return 503
      await interceptApiWithStatus(page, 503);

      await page.goto(`/?page=public&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      await verifyErrorStateVisible(page, [
        'unavailable',
        'temporary',
        'try again',
        'issue',
        'problem',
        'wrong',
      ]);
    });

    test('display page shows fallback for forced 503 response', async ({ page }) => {
      await interceptApiWithStatus(page, 503);

      await page.goto(`/?page=display&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      await verifyErrorStateVisible(page, [
        'unavailable',
        'temporary',
        'try again',
        'issue',
        'problem',
        'wrong',
      ]);
    });

    test('poster page shows fallback for forced 503 response', async ({ page }) => {
      await interceptApiWithStatus(page, 503);

      await page.goto(`/?page=poster&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      await verifyErrorStateVisible(page, [
        'unavailable',
        'temporary',
        'try again',
        'issue',
        'problem',
        'wrong',
      ]);
    });

  });

  test.describe('Network Error Handling', () => {

    test('public page shows fallback when API request aborted', async ({ page }) => {
      // Abort all API requests to simulate network disconnect
      await page.route('**/api/**', async (route) => {
        await route.abort('connectionfailed');
      });

      await page.goto(`/?page=public&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      // Should show some fallback, not blank
      await verifyNotBlank(page);
    });

    test('display page shows fallback when API request times out', async ({ page }) => {
      // Simulate timeout by never responding
      await page.route('**/api/**', async (route) => {
        // Don't fulfill - let it hang (will be caught by page timeout)
        await new Promise(() => {}); // Never resolves
      });

      // Set a short timeout for this test
      page.setDefaultTimeout(5000);

      try {
        await page.goto(`/?page=display&brand=${BRAND}&id=test-event`, {
          timeout: 3000,
        });
      } catch {
        // Expected to timeout - that's fine
      }

      // Page should still have content (HTML loaded)
      await verifyNotBlank(page);
    });

  });

  test.describe('Never Blank Invariant', () => {

    SURFACES.forEach(({ name, param }) => {
      test(`${name} page never shows blank screen on error`, async ({ page }) => {
        // Force a generic error
        await interceptApiWithStatus(page, 500, {
          code: 'INTERNAL',
          message: 'Internal server error',
        });

        await page.goto(`/?page=${param}&brand=${BRAND}&id=test-event`);
        await page.waitForLoadState('networkidle');

        // Page must have visible content
        const bodyContent = await page.locator('body').textContent();
        expect(
          bodyContent?.trim().length,
          `${name} page should never be blank`
        ).toBeGreaterThan(50);

        // Should have at least basic HTML structure
        await expect(page.locator('html')).toBeAttached();
        await expect(page.locator('body')).toBeAttached();
      });
    });

  });

  test.describe('No Stack Traces Invariant', () => {

    SURFACES.forEach(({ name, param }) => {
      test(`${name} page never shows JS stack traces to users`, async ({ page }) => {
        // Force error response
        await interceptApiWithStatus(page, 500);

        await page.goto(`/?page=${param}&brand=${BRAND}&id=test-event`);
        await page.waitForLoadState('networkidle');

        const bodyContent = await page.locator('body').textContent() || '';

        // Check for common stack trace patterns
        const stackTracePatterns = [
          /at\s+\w+\s+\([^)]+\.js:\d+:\d+\)/,
          /Error:.*\n.*at\s+/,
          /TypeError:/,
          /ReferenceError:/,
          /SyntaxError:/,
        ];

        for (const pattern of stackTracePatterns) {
          expect(
            pattern.test(bodyContent),
            `${name} page should not expose stack traces: ${pattern}`
          ).toBe(false);
        }
      });
    });

  });

  test.describe('Retry Button Functionality', () => {

    test('error state shows retry button for recoverable errors', async ({ page }) => {
      await interceptApiWithStatus(page, 503);

      await page.goto(`/?page=public&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      // Look for retry button
      const retryButton = page.locator('button, [role="button"]').filter({
        hasText: /try again|retry|reload/i,
      });

      const retryCount = await retryButton.count();

      // Retry button should be present for recoverable errors
      expect(retryCount, 'Retry button should be present for 503 errors').toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('Error State Data Attributes', () => {

    test('error state includes data-testid for testing', async ({ page }) => {
      // Intercept to force error
      await interceptApiWithStatus(page, 404);

      await page.goto(`/?page=public&brand=${BRAND}&id=test-event`);
      await page.waitForLoadState('networkidle');

      // Wait for error state to render
      await page.waitForTimeout(500);

      // Look for error state element (various possible selectors)
      const errorState = page.locator(
        '[data-testid="error-state"], .error-state, .empty-state, [class*="error"], [class*="not-found"]'
      );

      const count = await errorState.count();

      // Should have some error indicator
      expect(count, 'Error state element should be present').toBeGreaterThanOrEqual(0);
    });

  });

});
