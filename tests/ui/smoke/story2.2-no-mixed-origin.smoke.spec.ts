/**
 * Story 2.2 - Purge Mixed-Origin Calls in Frontend
 *
 * Playwright tests that verify NO frontend pages make direct calls to:
 * - script.google.com
 * - Any GAS exec URLs
 *
 * All API calls must go through:
 * - Same origin (/api/...) relative paths, OR
 * - The staging/production eventangle.com domain
 *
 * Acceptance Criteria:
 * - No frontend file calls script.google.com or past GAS endpoints
 * - All API calls use window.location.origin + route
 * - No request host shows script.google.com
 *
 * @see Story 2.2 - Purge Mixed-Origin Calls in Frontend
 */

import { test, expect, Page, Request } from '@playwright/test';

// Base URL from environment (set by CI or defaults to staging)
const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';

/**
 * Tracked API call for verification
 */
interface TrackedApiCall {
  url: string;
  hostname: string;
  pathname: string;
  method: string;
  timestamp: number;
}

/**
 * Check if a URL is a GAS URL using proper URL parsing
 * Uses hostname matching to prevent bypass attacks
 */
function isGasUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // Check if hostname is exactly script.google.com or a subdomain
    return url.hostname === 'script.google.com' ||
           url.hostname.endsWith('.script.google.com') ||
           // Also check for GAS exec URL patterns
           url.pathname.includes('/macros/s/');
  } catch {
    return false;
  }
}

/**
 * Check if a URL is to the expected origin (same-origin or eventangle.com)
 */
function isExpectedOrigin(urlString: string, baseUrl: string): boolean {
  try {
    const url = new URL(urlString);
    const base = new URL(baseUrl);

    // Same origin
    if (url.hostname === base.hostname) {
      return true;
    }

    // Eventangle.com domains
    if (url.hostname === 'eventangle.com' ||
        url.hostname.endsWith('.eventangle.com')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Setup request monitoring for a page
 */
function setupRequestMonitor(page: Page): TrackedApiCall[] {
  const apiCalls: TrackedApiCall[] = [];

  page.on('request', (request: Request) => {
    const url = request.url();

    // Only track API calls (fetch/XHR to /api or external APIs)
    if (url.includes('/api') ||
        url.includes('google') ||
        url.includes('script.google') ||
        request.resourceType() === 'xhr' ||
        request.resourceType() === 'fetch') {
      try {
        const parsed = new URL(url);
        apiCalls.push({
          url,
          hostname: parsed.hostname,
          pathname: parsed.pathname,
          method: request.method(),
          timestamp: Date.now(),
        });
      } catch {
        // Ignore malformed URLs
      }
    }
  });

  return apiCalls;
}

/**
 * Assert no GAS calls were made
 */
function assertNoGasCalls(apiCalls: TrackedApiCall[], pageName: string): void {
  const gasCalls = apiCalls.filter(call => isGasUrl(call.url));

  if (gasCalls.length > 0) {
    const gasUrls = gasCalls.map(c => c.url).join('\n  - ');
    throw new Error(
      `Story 2.2 VIOLATION: ${pageName} made ${gasCalls.length} direct call(s) to GAS:\n  - ${gasUrls}`
    );
  }
}

test.describe('Story 2.2 - No Mixed-Origin Calls', () => {

  test.describe('/events page', () => {

    test('makes no direct calls to script.google.com', async ({ page }) => {
      const apiCalls = setupRequestMonitor(page);

      await page.goto('/events');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000); // Wait for async API calls

      assertNoGasCalls(apiCalls, '/events');
    });

    test('all API calls go to same origin or eventangle.com', async ({ page }) => {
      const apiCalls = setupRequestMonitor(page);

      await page.goto('/events');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      // Filter to only /api calls
      const apiOnlyCalls = apiCalls.filter(c => c.pathname.startsWith('/api'));

      for (const call of apiOnlyCalls) {
        expect(
          isExpectedOrigin(call.url, BASE_URL),
          `API call to unexpected origin: ${call.url}`
        ).toBe(true);
      }
    });

  });

  test.describe('/public surface', () => {

    test('makes no direct calls to script.google.com', async ({ page }) => {
      const apiCalls = setupRequestMonitor(page);

      // Use a test event ID
      await page.goto('/events?brand=root');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      assertNoGasCalls(apiCalls, '/public');
    });

  });

  test.describe('/display surface', () => {

    test('makes no direct calls to script.google.com', async ({ page }) => {
      const apiCalls = setupRequestMonitor(page);

      await page.goto('/display?brand=root');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      assertNoGasCalls(apiCalls, '/display');
    });

  });

  test.describe('/poster surface', () => {

    test('makes no direct calls to script.google.com', async ({ page }) => {
      const apiCalls = setupRequestMonitor(page);

      await page.goto('/poster?brand=root');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      assertNoGasCalls(apiCalls, '/poster');
    });

  });

  test.describe('/admin surface', () => {

    test('makes no direct calls to script.google.com', async ({ page }) => {
      const apiCalls = setupRequestMonitor(page);

      await page.goto('/admin?brand=root');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      assertNoGasCalls(apiCalls, '/admin');
    });

  });

  test.describe('Cross-Surface Validation', () => {

    test('CRITICAL: No GAS URLs in any network request across all surfaces', async ({ page }) => {
      const allApiCalls: TrackedApiCall[] = [];
      const surfaces = ['/events', '/display', '/poster'];

      for (const surface of surfaces) {
        const surfaceCalls = setupRequestMonitor(page);

        await page.goto(`${surface}?brand=root`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        allApiCalls.push(...surfaceCalls);
      }

      // Assert no GAS calls across all surfaces
      const gasCalls = allApiCalls.filter(call => isGasUrl(call.url));
      expect(
        gasCalls,
        `Story 2.2 CRITICAL: Found ${gasCalls.length} GAS call(s) across surfaces`
      ).toHaveLength(0);
    });

    test('all surfaces use relative /api paths', async ({ page }) => {
      const allApiCalls: TrackedApiCall[] = [];
      const surfaces = ['/events', '/display', '/poster'];

      for (const surface of surfaces) {
        const surfaceCalls = setupRequestMonitor(page);

        await page.goto(`${surface}?brand=root`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        allApiCalls.push(...surfaceCalls);
      }

      // Filter to API calls only
      const apiOnlyCalls = allApiCalls.filter(c =>
        c.pathname.startsWith('/api') || c.url.includes('/api/')
      );

      // Verify all API calls are to expected origins
      for (const call of apiOnlyCalls) {
        const isValid = isExpectedOrigin(call.url, BASE_URL);
        expect(
          isValid,
          `Unexpected API origin: ${call.url}`
        ).toBe(true);
      }
    });

  });

  test.describe('Response Header Verification', () => {

    test('pages are served by Worker (not direct GAS)', async ({ page }) => {
      const surfaces = ['/events', '/display', '/poster'];

      for (const surface of surfaces) {
        const response = await page.goto(`${surface}?brand=root`);
        const headers = response?.headers() || {};

        // Should have Worker proxy header
        expect(
          headers['x-proxied-by'],
          `${surface} should be served by Worker`
        ).toBe('eventangle-worker');
      }
    });

  });

});
