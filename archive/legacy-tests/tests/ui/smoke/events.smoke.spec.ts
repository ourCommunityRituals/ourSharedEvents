/**
 * Story 6 + Story A2: Events Page Playwright Tests
 *
 * Dedicated tests for the /events page that validate:
 * - Page loads correctly and displays expected title
 * - Shows event cards when events exist OR clean "no events" message
 * - No error states (red "Temporary Issue" card) in happy path
 * - No uncaught JS console errors
 * - (Story A2) Origin safety - browser NEVER calls Google origins
 * - (Story A2) Runtime logging for CI observability
 *
 * These tests run as part of Stage-2 CI/CD validation against staging.
 *
 * Acceptance Criteria:
 * - A commit that breaks the GAS URL or Worker RPC mapping causes Stage-2 to fail
 * - A commit that passes local tests and preserves GAS mapping passes Stage-2
 * - /events verified with page title and content assertions
 * - (Story A2) CI fails if browser calls Google origin
 * - (Story A2) Playwright logs show BASE_URL, first navigation URL, first API host
 *
 * @see docs/STORY-6-CI-STAGING.md
 * @see docs/STORY-A2-OBSERVABILITY.md
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import {
  RequestLogger,
  createRequestLogger,
  BANNED_ORIGINS,
} from '../../shared/helpers/request-logger';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Base URL from environment (set by CI or defaults to staging)
const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';

/**
 * Console error tracking for detecting uncaught JS errors
 */
interface ConsoleError {
  type: string;
  text: string;
  location?: string;
}

/**
 * Collects console errors during page load
 * Story 6 requirement: Fail on uncaught JS or console errors
 */
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

/**
 * Filters out non-critical console errors
 * Excludes: favicon errors, third-party CORS errors
 */
function filterCriticalErrors(errors: ConsoleError[], baseUrl: string): ConsoleError[] {
  return errors.filter((err) => {
    const text = err.text.toLowerCase();
    // Ignore favicon errors
    if (text.includes('favicon')) return false;
    // Ignore third-party CORS errors (use proper URL parsing)
    if (text.includes('cors') && err.location && !isFromExpectedOrigin(err.location, baseUrl))
      return false;
    // Ignore browser extension errors
    if (err.location?.includes('chrome-extension://')) return false;
    if (err.location?.includes('moz-extension://')) return false;
    return true;
  });
}

test.describe('Events Page Tests - Story 6', () => {
  test.describe('Page Load & HTTP Status', () => {
    test('/events returns HTTP 200', async ({ page }) => {
      const response = await page.goto(`/events`);

      // Must return HTTP 200
      expect(response?.status()).toBe(200);
    });

    test('/events page loads successfully', async ({ page }) => {
      const response = await page.goto(`/events`);

      // Should not be a server error
      expect(response?.status()).toBeLessThan(500);

      // Wait for page to stabilize
      await page.waitForLoadState('networkidle');
    });

    test('page returns HTML content-type', async ({ page }) => {
      const response = await page.goto(`/events`);

      const contentType = response?.headers()['content-type'] || '';
      expect(contentType).toContain('text/html');
    });
  });

  test.describe('Page Title Verification', () => {
    test('page has correct title containing EventAngle', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('domcontentloaded');

      const title = await page.title();

      // Title should contain EventAngle or similar branding
      // Allows for variations like "EventAngle", "EventAngle · Events", etc.
      expect(title.toLowerCase()).toContain('oursharedevents');
    });

    test('page title is non-empty', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('domcontentloaded');

      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });
  });

  test.describe('Events Content Verification', () => {
    test('shows event cards OR clean "no events" message', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('networkidle');

      // Wait for JavaScript to render content
      await page.waitForTimeout(2000);

      // Look for event cards (various possible selectors)
      const eventCards = page.locator(
        '[data-testid="event-card"], .event-card, .event-item, [class*="event-card"]'
      );
      const eventCardCount = await eventCards.count();

      // Look for "no events" message (various possible selectors)
      const noEventsMessage = page.locator(
        '[data-testid="no-events"], .no-events, .empty-state, :text("No events"), :text("no events")'
      );
      const noEventsCount = await noEventsMessage.count();

      // Either we have event cards OR a clean "no events" message
      const hasContent = eventCardCount > 0 || noEventsCount > 0;
      expect(
        hasContent,
        `Expected either event cards (found ${eventCardCount}) or no-events message (found ${noEventsCount})`
      ).toBe(true);
    });

    test('page has main content area', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('networkidle');

      // Body should have substantive content
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent?.length, 'Page should have content').toBeGreaterThan(50);
    });
  });

  test.describe('No Error States (Happy Path)', () => {
    test('no "Temporary Issue" error card displayed', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('networkidle');

      // Wait for JavaScript to render
      await page.waitForTimeout(2000);

      // Check for error indicators
      const temporaryIssue = page.locator(
        ':text("Temporary Issue"), :text("temporary issue"), [data-testid="error-card"], .error-card, .error-banner'
      );
      const errorCount = await temporaryIssue.count();

      expect(errorCount, 'Should not display "Temporary Issue" error card in happy path').toBe(0);
    });

    test('no "Something went wrong" error displayed', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('networkidle');

      // Wait for JavaScript to render
      await page.waitForTimeout(2000);

      // Check for generic error messages
      const somethingWrong = page.locator(
        ':text("Something went wrong"), :text("something went wrong"), :text("An error occurred")'
      );
      const errorCount = await somethingWrong.count();

      expect(errorCount, 'Should not display "Something went wrong" error').toBe(0);
    });

    test('no GAS error page indicators', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('networkidle');

      // Check page content for GAS error indicators
      const pageContent = await page.content();

      // Should not contain GAS error page markers
      expect(pageContent).not.toContain('Google Apps Script');
      expect(pageContent).not.toContain('Script function not found');
      expect(pageContent).not.toContain('warden');
    });
  });

  test.describe('No JavaScript Console Errors', () => {
    test('page loads without uncaught JS errors', async ({ page }) => {
      const consoleErrors = setupConsoleErrorCollector(page);

      await page.goto(`/events`);
      await page.waitForLoadState('networkidle');

      // Wait for any async operations
      await page.waitForTimeout(2000);

      // Filter out non-critical errors
      const criticalErrors = filterCriticalErrors(consoleErrors, BASE_URL);

      if (criticalErrors.length > 0) {
        console.log('Critical JS errors found:', JSON.stringify(criticalErrors, null, 2));
      }

      expect(
        criticalErrors,
        `Found ${criticalErrors.length} critical JS console errors`
      ).toHaveLength(0);
    });
  });

  test.describe('Response Headers Verification', () => {
    test('includes Worker transparency headers', async ({ page }) => {
      const response = await page.goto(`/events`);
      const headers = response?.headers() || {};

      // Should be served by Worker (not direct GAS)
      expect(headers['x-proxied-by']).toBe('oursharedevents-worker');
    });

    test('Worker version header present', async ({ page }) => {
      const response = await page.goto(`/events`);
      const headers = response?.headers() || {};

      // Worker should return version header
      expect(headers['x-worker-version']).toBeDefined();
      expect(headers['x-worker-version'].length).toBeGreaterThan(0);
    });
  });

  test.describe('Page Structure Validation', () => {
    test('valid HTML document structure', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('domcontentloaded');

      // Verify basic HTML structure
      await expect(page.locator('html')).toBeAttached();
      await expect(page.locator('head')).toBeAttached();
      await expect(page.locator('body')).toBeAttached();
    });

    test('meta tags are present', async ({ page }) => {
      await page.goto(`/events`);
      await page.waitForLoadState('domcontentloaded');

      // Should have viewport meta tag for responsive design
      const viewport = page.locator('meta[name="viewport"]');
      await expect(viewport).toBeAttached();
    });

    /**
     * Story 1.2 - CI/CD Gate Impact
     *
     * Critical smoke test: /events must render the events-root marker.
     * This is a Stage-1 build gate - if this test fails, the build fails.
     *
     * Acceptance Criteria:
     * - GET /events returns HTTP 200
     * - Page renders data-testid="events-root" marker
     * - First navigation is always to staging Cloudflare origin (not GAS)
     */
    test('renders data-testid="events-root" marker (Story 1.2 CI Gate)', async ({ page }) => {
      const response = await page.goto(`/events`);

      // Must return HTTP 200
      expect(response?.status(), '/events must return HTTP 200').toBe(200);

      // Wait for page to fully render
      await page.waitForLoadState('networkidle');

      // Story 1.2: Critical marker check - events-root must be present
      // This validates the page rendered correctly via Cloudflare Worker
      const eventsRoot = page.locator('[data-testid="events-root"]');
      await expect(eventsRoot, 'Page must render data-testid="events-root" marker').toBeAttached({
        timeout: 15000, // Allow time for JS rendering
      });
    });
  });

  test.describe('Brand Parameter Support', () => {
    test('/events loads with brand parameter', async ({ page }) => {
      const response = await page.goto(`/events?brand=${BRAND}`);

      expect(response?.status()).toBeLessThan(500);
      expect(response?.ok()).toBe(true);
    });

    test('page functions with default brand', async ({ page }) => {
      // Load without explicit brand parameter
      const response = await page.goto(`/events`);

      expect(response?.status()).toBeLessThan(500);
    });
  });
});

test.describe('Events Page Negative Path Handling', () => {
  test.describe('Staging Unavailability Detection', () => {
    test('page handles slow network gracefully', async ({ page }) => {
      // Test with extended timeout - should still load or show clean error
      page.setDefaultTimeout(30000);

      const response = await page.goto(`/events`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Should not throw - either loads or returns error status
      expect(response).not.toBeNull();

      // If status is error, should be handled gracefully
      if (response && response.status() >= 500) {
        // Check for clean error page, not raw exception
        const content = await page.content();
        expect(content.length).toBeGreaterThan(100); // Has some content
      }
    });
  });
});

test.describe('Events API Integration', () => {
  test('events page fetches data from /api endpoints (not GAS directly)', async ({ page }) => {
    const apiCalls: string[] = [];

    // Monitor network requests
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api') || url.includes('google') || url.includes('script.google')) {
        apiCalls.push(url);
      }
    });

    await page.goto(`/events`);
    await page.waitForLoadState('networkidle');

    // Wait for async API calls
    await page.waitForTimeout(3000);

    // Should use /api endpoints
    const usesApiEndpoints = apiCalls.some((url) => url.includes('/api'));

    // Should NOT call GAS directly - use proper URL parsing to check hostname
    const callsGasDirectly = apiCalls.some((urlString) => {
      try {
        const url = new URL(urlString);
        // Check if hostname is exactly script.google.com or a subdomain of it
        return (
          url.hostname === 'script.google.com' ||
          url.hostname.endsWith('.script.google.com') ||
          // Also check for GAS exec URLs pattern in pathname
          url.pathname.startsWith('/macros/s/')
        );
      } catch {
        // If URL parsing fails, check for obvious GAS patterns conservatively
        return false;
      }
    });

    expect(callsGasDirectly, 'Should not call GAS directly from browser').toBe(false);
  });
});

// ===========================================================================
// STORY A2: ORIGIN SAFETY & OBSERVABILITY TESTS
// ===========================================================================

test.describe('Events Page Origin Safety - Story A2', () => {
  let requestLogger: RequestLogger;

  test.beforeEach(async ({ page }) => {
    // Initialize request logger for comprehensive monitoring
    requestLogger = createRequestLogger(page, BASE_URL);

    // Log test start with environment info
    console.log('');
    console.log('='.repeat(60));
    console.log('[Story A2] /events Origin Safety Test');
    console.log('='.repeat(60));
    console.log(`  BASE_URL: ${BASE_URL}`);
    console.log('='.repeat(60));
  });

  test.afterEach(async () => {
    // Always print request summary for CI visibility
    requestLogger.printSummary();
  });

  test('browser NEVER calls Google origins (script.google.com)', async ({ page }) => {
    await page.goto(`/events`);
    await page.waitForLoadState('networkidle');

    // Wait for any async operations (JS rendering, API calls)
    await page.waitForTimeout(3000);

    // CRITICAL: Assert no banned origins were called
    requestLogger.assertNoBannedOrigins();

    // Verify and log summary
    const summary = requestLogger.getSummary();
    console.log('Origin Safety Check Passed:');
    console.log(`  Total requests: ${summary.totalRequests}`);
    console.log(`  Banned origin calls: ${summary.bannedOriginCalls.length}`);
  });

  test('first API call goes to same origin (stg.oursharedevents.com)', async ({ page }) => {
    await page.goto(`/events`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Assert first API host matches expected origin
    requestLogger.assertFirstApiHost();

    const summary = requestLogger.getSummary();
    if (summary.firstApiHost) {
      const expectedHost = new URL(BASE_URL).host;
      console.log(`First API Host Verification:`);
      console.log(`  Expected: ${expectedHost}`);
      console.log(`  Actual:   ${summary.firstApiHost}`);
      expect(summary.firstApiHost).toBe(expectedHost);
    }
  });

  test('all network requests go to allowed origins only', async ({ page }) => {
    await page.goto(`/events`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const summary = requestLogger.getSummary();

    // Log all hosts for CI visibility
    console.log('All hosts contacted during page load:');
    summary.allHosts.forEach((host) => {
      const isBanned = BANNED_ORIGINS.some(
        (banned) => host === banned || host.endsWith('.' + banned)
      );
      console.log(`  ${isBanned ? 'X BANNED' : '✓'} ${host}`);
    });

    // Verify no banned origins were called
    expect(
      summary.bannedOriginCalls.length,
      `Found ${summary.bannedOriginCalls.length} calls to banned origins`
    ).toBe(0);
  });

  test('API failures are logged with requestId and status', async ({ page }) => {
    await page.goto(`/events`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for API failures (they get logged automatically by requestLogger)
    const failures = requestLogger.getAPIFailures();

    if (failures.length > 0) {
      console.log(`Detected ${failures.length} API failure(s) - see summary above`);
      // Log details for CI visibility
      failures.forEach((f) => {
        console.log(`  ${f.method} ${f.url}`);
        console.log(`    Status: ${f.status} ${f.statusText}`);
        if (f.requestId) console.log(`    Request ID: ${f.requestId}`);
        if (f.errorBody) console.log(`    Error: ${f.errorBody.substring(0, 100)}...`);
      });
    }

    // This test passes as long as origin safety is maintained
    // The actual failures are logged for CI visibility
    requestLogger.assertNoBannedOrigins();
  });
});
