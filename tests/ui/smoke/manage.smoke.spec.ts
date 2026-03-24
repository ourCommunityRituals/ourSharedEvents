/**
 * Story A2: /manage Page Smoke Test with Observability
 *
 * Validates the /manage (Admin) page with comprehensive runtime logging
 * and origin safety assertions. This is a Stage-2 CI gate test.
 *
 * Acceptance Criteria:
 * - Playwright logs show BASE_URL, first navigation URL, first API host
 * - If API fails: status code, requestId, error body snippet printed
 * - CI fails if browser calls Google origin
 * - /manage fails to load core UI elements
 *
 * Origin Safety Rule (Story A2):
 * - Browser MUST NEVER call script.google.com or googleusercontent.com
 * - All API calls must go through the Cloudflare Worker
 *
 * @see docs/STORY-A2-OBSERVABILITY.md
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import {
  RequestLogger,
  createRequestLogger,
  BANNED_ORIGINS,
} from '../../shared/helpers/request-logger';

// ===========================================================================
// CONFIGURATION
// ===========================================================================

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Base URL from environment (set by CI or defaults to staging)
const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';

// ===========================================================================
// CONSOLE ERROR TRACKING
// ===========================================================================

interface ConsoleError {
  type: string;
  text: string;
  location?: string;
}

function setupConsoleErrorCollector(page: Page): ConsoleError[] {
  const errors: ConsoleError[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      errors.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url,
      });
    }
  });

  return errors;
}

/**
 * Check if a URL belongs to the expected origin using proper URL parsing
 */
function isFromExpectedOrigin(location: string, expectedBaseUrl: string): boolean {
  try {
    const locationUrl = new URL(location);
    const expectedUrl = new URL(expectedBaseUrl);
    return locationUrl.hostname === expectedUrl.hostname;
  } catch {
    // If URL parsing fails, use conservative check
    return false;
  }
}

function filterCriticalErrors(errors: ConsoleError[]): ConsoleError[] {
  return errors.filter(err => {
    const text = err.text.toLowerCase();
    // Ignore favicon errors
    if (text.includes('favicon')) return false;
    // Ignore third-party CORS errors (use proper URL parsing)
    if (text.includes('cors') && err.location && !isFromExpectedOrigin(err.location, BASE_URL)) return false;
    // Ignore browser extension errors
    if (err.location?.includes('chrome-extension://')) return false;
    if (err.location?.includes('moz-extension://')) return false;
    return true;
  });
}

// ===========================================================================
// TEST SUITE: /manage Page (Story A2 Observability)
// ===========================================================================

test.describe('/manage Page Smoke Tests - Story A2', () => {
  // Request logger for observability
  let requestLogger: RequestLogger;
  let consoleErrors: ConsoleError[];

  test.beforeEach(async ({ page }) => {
    // Initialize request logger
    requestLogger = createRequestLogger(page, BASE_URL);

    // Setup console error collector
    consoleErrors = setupConsoleErrorCollector(page);

    // Log test start with environment info
    console.log('');
    console.log('='.repeat(60));
    console.log('[Story A2] /manage Page Smoke Test');
    console.log('='.repeat(60));
    console.log(`  BASE_URL: ${BASE_URL}`);
    console.log(`  BRAND:    ${BRAND}`);
    console.log('='.repeat(60));
  });

  test.afterEach(async () => {
    // Always print request summary for CI visibility
    requestLogger.printSummary();

    // Log console errors if any
    const criticalErrors = filterCriticalErrors(consoleErrors);
    if (criticalErrors.length > 0) {
      console.error('');
      console.error('Console Errors:');
      criticalErrors.forEach(err => {
        console.error(`  - ${err.text}`);
        if (err.location) {
          console.error(`    at ${err.location}`);
        }
      });
      console.error('');
    }
  });

  // ===========================================================================
  // CORE PAGE LOAD TESTS
  // ===========================================================================

  test.describe('Page Load & HTTP Status', () => {

    test('/manage returns HTTP 200', async ({ page }) => {
      const response = await page.goto(`/manage?brand=${BRAND}`);

      // Must return HTTP 200 (or redirect which resolves to 200)
      expect(response?.status()).toBeLessThan(400);

      // Log response headers for debugging
      const headers = response?.headers() || {};
      console.log('Response Headers:');
      console.log(`  x-proxied-by:     ${headers['x-proxied-by'] || 'N/A'}`);
      console.log(`  x-worker-version: ${headers['x-worker-version'] || 'N/A'}`);
      console.log(`  x-request-id:     ${headers['x-request-id'] || headers['cf-ray'] || 'N/A'}`);
    });

    test('/manage page loads within timeout', async ({ page }) => {
      const response = await page.goto(`/manage?brand=${BRAND}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      expect(response).not.toBeNull();
      expect(response?.ok()).toBe(true);
    });

  });

  // ===========================================================================
  // ORIGIN SAFETY ASSERTIONS (Critical - Story A2)
  // ===========================================================================

  test.describe('Origin Safety (Story A2 Critical)', () => {

    test('browser NEVER calls Google origins', async ({ page }) => {
      // Navigate to /manage
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Wait for any async operations
      await page.waitForTimeout(3000);

      // CRITICAL: Assert no banned origins were called
      requestLogger.assertNoBannedOrigins();
    });

    test('first API call goes to same origin (staging)', async ({ page }) => {
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Wait for API calls
      await page.waitForTimeout(2000);

      // Assert first API host matches expected origin
      requestLogger.assertFirstApiHost();

      // Get summary and verify
      const summary = requestLogger.getSummary();
      if (summary.firstApiHost) {
        const expectedHost = new URL(BASE_URL).host;
        console.log(`First API host: ${summary.firstApiHost}`);
        console.log(`Expected host:  ${expectedHost}`);
        expect(summary.firstApiHost).toBe(expectedHost);
      }
    });

    test('all network requests go to allowed origins only', async ({ page }) => {
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const summary = requestLogger.getSummary();

      // Log all hosts for visibility
      console.log('All hosts contacted:');
      summary.allHosts.forEach(host => {
        const isBanned = BANNED_ORIGINS.some(banned =>
          host === banned || host.endsWith('.' + banned)
        );
        console.log(`  ${isBanned ? 'X' : '✓'} ${host}`);
      });

      // Verify no banned origins
      expect(summary.bannedOriginCalls.length,
        `Found ${summary.bannedOriginCalls.length} calls to banned origins`
      ).toBe(0);
    });

  });

  // ===========================================================================
  // UI ELEMENT VERIFICATION
  // ===========================================================================

  test.describe('Core UI Elements', () => {

    test('event dropdown is visible (event management mode)', async ({ page }) => {
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Wait for JavaScript rendering
      await page.waitForTimeout(2000);

      // Either wizard OR event selector should be visible
      const launchWizard = page.locator('[data-testid="launch-wizard"]');
      const eventDropdown = page.locator('[data-testid="event-dropdown"]');
      const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

      const wizardVisible = await launchWizard.isVisible().catch(() => false);
      const dropdownVisible = await eventDropdown.isVisible().catch(() => false);
      const selectorBarVisible = await eventSelectorBar.isVisible().catch(() => false);

      // Log what we found for debugging
      console.log('UI Element Visibility:');
      console.log(`  Launch Wizard:      ${wizardVisible}`);
      console.log(`  Event Dropdown:     ${dropdownVisible}`);
      console.log(`  Event Selector Bar: ${selectorBarVisible}`);

      // At least one core UI element must be visible
      expect(
        wizardVisible || dropdownVisible || selectorBarVisible,
        'Expected either launch wizard, event dropdown, or event selector bar to be visible'
      ).toBe(true);
    });

    test('page has admin content (not error page)', async ({ page }) => {
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Check page content for admin-specific elements
      const pageContent = await page.content();

      // Should NOT contain GAS error markers
      expect(pageContent).not.toContain('Google Apps Script');
      expect(pageContent).not.toContain('Script function not found');

      // Should NOT contain "Something went wrong" or "Temporary Issue"
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.toLowerCase()).not.toContain('something went wrong');

      // Should have substantive content
      expect(bodyText?.length, 'Page should have content').toBeGreaterThan(50);
    });

    test('Worker transparency headers are present', async ({ page }) => {
      const response = await page.goto(`/manage?brand=${BRAND}`);
      const headers = response?.headers() || {};

      // Should be served by Worker (not direct GAS)
      expect(headers['x-proxied-by']).toBe('eventangle-worker');

      // Worker version should be present
      expect(headers['x-worker-version']).toBeDefined();
      expect(headers['x-worker-version'].length).toBeGreaterThan(0);
    });

  });

  // ===========================================================================
  // API FAILURE HANDLING
  // ===========================================================================

  test.describe('API Failure Observability', () => {

    test('API failures are logged with requestId and error body', async ({ page }) => {
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Check if there were any API failures
      const failures = requestLogger.getAPIFailures();

      if (failures.length > 0) {
        // If there were failures, they should have been logged
        console.log(`Detected ${failures.length} API failure(s):`);
        failures.forEach(f => {
          console.log(`  ${f.method} ${f.url} -> ${f.status}`);
          if (f.requestId) console.log(`    Request ID: ${f.requestId}`);
        });

        // In normal operation, we don't expect failures
        // But if there are any, CI can see why from the logs
      }

      // This test passes as long as origin safety is maintained
      // The actual failure logging is done by the request logger
      requestLogger.assertNoBannedOrigins();
    });

  });

  // ===========================================================================
  // CONSOLE ERROR VERIFICATION
  // ===========================================================================

  test.describe('No JavaScript Console Errors', () => {

    test('page loads without critical JS errors', async ({ page }) => {
      await page.goto(`/manage?brand=${BRAND}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const criticalErrors = filterCriticalErrors(consoleErrors);

      if (criticalErrors.length > 0) {
        console.log('Critical JS errors found:', JSON.stringify(criticalErrors, null, 2));
      }

      expect(criticalErrors, `Found ${criticalErrors.length} critical JS console errors`).toHaveLength(0);
    });

  });

});

// ===========================================================================
// NEGATIVE PATH TESTS (Story A2 - "No silent failures allowed")
// ===========================================================================

test.describe('/manage Negative Path Handling - Story A2', () => {
  let requestLogger: RequestLogger;

  test.beforeEach(async ({ page }) => {
    requestLogger = createRequestLogger(page, BASE_URL);
  });

  test.afterEach(async () => {
    requestLogger.printSummary();
  });

  test('if backend is down, CI logs show why', async ({ page }) => {
    // This test validates that even if things fail, we get visibility
    const response = await page.goto(`/manage?brand=${BRAND}`, {
      timeout: 30000,
    }).catch(err => {
      console.error('Navigation failed:', err.message);
      return null;
    });

    // Log response status regardless of success/failure
    if (response) {
      console.log(`Response status: ${response.status()} ${response.statusText()}`);
      const headers = response.headers();
      if (headers['x-request-id'] || headers['cf-ray']) {
        console.log(`Request ID: ${headers['x-request-id'] || headers['cf-ray']}`);
      }
    }

    // Check for API failures
    const failures = requestLogger.getAPIFailures();
    if (failures.length > 0) {
      console.log('API failures detected - see summary above');
      // The request logger already logged details
    }

    // Even on failure, we should know why
    expect(response).not.toBeNull();
  });

  test('auth failure shows code + requestId', async ({ page }) => {
    // Navigate to admin - may require auth
    const response = await page.goto(`/manage?brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Get all entries and check for auth-related failures
    const entries = requestLogger.getEntries();
    const authFailures = entries.filter(e =>
      e.status === 401 || e.status === 403
    );

    if (authFailures.length > 0) {
      console.log('Auth failures detected:');
      authFailures.forEach(f => {
        console.log(`  ${f.method} ${f.url} -> ${f.status}`);
        if (f.requestId) console.log(`    Request ID: ${f.requestId}`);
      });
    }

    // Page should still load (showing login prompt or similar)
    expect(response?.status()).toBeLessThan(500);
  });

});
