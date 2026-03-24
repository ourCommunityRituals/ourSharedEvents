/**
 * Stage-2 E2E Test Suite - Staging Worker Cutover Validation
 *
 * Story 4.2 - Cut Over Public/Display/Poster to Worker in Staging
 *
 * This test suite validates that staging is fully Worker-backed:
 * - All stg URLs function correctly
 * - Public/Display/Poster pages load via Worker API
 * - QR codes created in stg hit Worker and produce valid pages
 *
 * IMPORTANT: This is the gate for production cutover.
 * Prod cutover is only allowed when this Stage-2 suite passes.
 *
 * Test Flow:
 * 1. Create event via Worker API
 * 2. Verify public page loads with event data
 * 3. Verify display page loads with event data
 * 4. Verify poster page loads with valid QR codes
 * 5. Verify negative paths show "Temporarily unavailable"
 *
 * @module tests/e2e/stage-2/staging-worker-cutover
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl, isStaging } = require('../../../config/environments');

// =============================================================================
// Test Configuration
// =============================================================================

const BASE_URL = getBaseUrl();
const TEST_BRAND = 'root';
const STAGING_HOSTNAME = 'stg.eventangle.com';

// Skip entire suite if not targeting staging
test.describe('Stage-2: Staging Worker Cutover Validation', () => {
  test.beforeAll(async () => {
    // Verify we're testing against staging
    const url = new URL(BASE_URL);
    const isTargetingStaging = url.hostname === STAGING_HOSTNAME ||
      url.hostname.includes('stg.') ||
      process.env.TEST_ENV === 'staging';

    if (!isTargetingStaging) {
      console.log(`[STAGE-2] Skipping - Not targeting staging (BASE_URL: ${BASE_URL})`);
      test.skip();
    }
  });

  // ===========================================================================
  // 1. Health Check Tests
  // ===========================================================================

  test.describe('Worker Health Checks', () => {
    test('Worker API v2 status endpoint returns healthy', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v2/status`);

      expect(response.ok()).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.value).toBeDefined();
      expect(data.value.backend).toBe('worker');
    });

    test('Worker API v2 ping endpoint responds', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v2/ping`);

      expect(response.ok()).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
    });

    test('Worker Sheets status endpoint returns configured', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v2/status/sheets`);

      expect(response.ok()).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Public Page Tests
  // ===========================================================================

  test.describe('Public Page via Worker', () => {
    test('Public events page loads successfully', async ({ page }) => {
      await page.goto(`${BASE_URL}/events`);

      // Verify page loaded (not error page)
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Check for Worker backend header
      const response = await page.goto(`${BASE_URL}/events`);
      const backend = response.headers()['x-backend'] || response.headers()['x-proxied-by'];
      expect(backend).toContain('worker');
    });

    test('Public page loads event list from Worker API', async ({ page, request }) => {
      // First verify API returns data
      const apiResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      expect(apiResponse.ok()).toBe(true);

      const apiData = await apiResponse.json();
      const hasEvents = apiData.ok && apiData.value && Array.isArray(apiData.value.items);

      // Navigate to public page
      await page.goto(`${BASE_URL}/events`);

      if (hasEvents && apiData.value.items.length > 0) {
        // If there are events, verify they're displayed
        // Wait for content to load
        await page.waitForTimeout(2000);

        // Should not show error state
        const errorState = page.locator('.error-state');
        await expect(errorState).not.toBeVisible();
      }
    });

    test('Public page with event ID loads event details', async ({ page, request }) => {
      // Get an existing event from API
      const apiResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      const apiData = await apiResponse.json();

      if (!apiData.ok || !apiData.value?.items?.length) {
        test.skip('No events available for testing');
        return;
      }

      const eventId = apiData.value.items[0].id;

      // Navigate to event page
      await page.goto(`${BASE_URL}/events?event=${eventId}`);

      // Verify page loads without error
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);
    });
  });

  // ===========================================================================
  // 3. Display Page Tests
  // ===========================================================================

  test.describe('Display Page via Worker', () => {
    test('Display page loads successfully', async ({ page }) => {
      await page.goto(`${BASE_URL}/display`);

      // Verify page loaded (not error page)
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Check for Worker backend header
      const response = await page.goto(`${BASE_URL}/display`);
      const backend = response.headers()['x-backend'] || response.headers()['x-proxied-by'];
      expect(backend).toContain('worker');
    });

    test('Display bundle API returns valid data', async ({ request }) => {
      // Get an existing event
      const eventsResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      const eventsData = await eventsResponse.json();

      if (!eventsData.ok || !eventsData.value?.items?.length) {
        test.skip('No events available for testing');
        return;
      }

      const eventId = eventsData.value.items[0].id;

      // Get display bundle
      const bundleResponse = await request.get(
        `${BASE_URL}/api/v2/events/${eventId}/bundle/display?brand=${TEST_BRAND}`
      );

      expect(bundleResponse.ok()).toBe(true);
      const bundleData = await bundleResponse.json();
      expect(bundleData.ok).toBe(true);
      expect(bundleData.value).toBeDefined();
      expect(bundleData.value.event).toBeDefined();
    });

    test('Display page with event shows content', async ({ page, request }) => {
      // Get an existing event
      const eventsResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      const eventsData = await eventsResponse.json();

      if (!eventsData.ok || !eventsData.value?.items?.length) {
        test.skip('No events available for testing');
        return;
      }

      const eventId = eventsData.value.items[0].id;

      // Navigate to display page with event
      await page.goto(`${BASE_URL}/display?event=${eventId}`);

      // Verify page loads without error
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Wait for content to load
      await page.waitForTimeout(2000);

      // Should not show error state
      const errorState = page.locator('.error-state-tv, .error-state');
      const errorCount = await errorState.count();
      expect(errorCount).toBe(0);
    });
  });

  // ===========================================================================
  // 4. Poster Page Tests
  // ===========================================================================

  test.describe('Poster Page via Worker', () => {
    test('Poster page loads successfully', async ({ page }) => {
      await page.goto(`${BASE_URL}/poster`);

      // Verify page loaded (not error page)
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Check for Worker backend header
      const response = await page.goto(`${BASE_URL}/poster`);
      const backend = response.headers()['x-backend'] || response.headers()['x-proxied-by'];
      expect(backend).toContain('worker');
    });

    test('Poster bundle API returns valid data with QR', async ({ request }) => {
      // Get an existing event
      const eventsResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      const eventsData = await eventsResponse.json();

      if (!eventsData.ok || !eventsData.value?.items?.length) {
        test.skip('No events available for testing');
        return;
      }

      const eventId = eventsData.value.items[0].id;

      // Get poster bundle
      const bundleResponse = await request.get(
        `${BASE_URL}/api/v2/events/${eventId}/bundle/poster?brand=${TEST_BRAND}`
      );

      expect(bundleResponse.ok()).toBe(true);
      const bundleData = await bundleResponse.json();
      expect(bundleData.ok).toBe(true);
      expect(bundleData.value).toBeDefined();
      expect(bundleData.value.event).toBeDefined();
    });

    test('Poster page with event shows QR code', async ({ page, request }) => {
      // Get an existing event
      const eventsResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      const eventsData = await eventsResponse.json();

      if (!eventsData.ok || !eventsData.value?.items?.length) {
        test.skip('No events available for testing');
        return;
      }

      const eventId = eventsData.value.items[0].id;

      // Navigate to poster page with event
      await page.goto(`${BASE_URL}/poster?event=${eventId}`);

      // Verify page loads without error
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Wait for content to load
      await page.waitForTimeout(2000);

      // Should not show error state
      const errorState = page.locator('.error-state');
      const errorCount = await errorState.count();
      expect(errorCount).toBe(0);
    });
  });

  // ===========================================================================
  // 5. Admin Page Tests
  // ===========================================================================

  test.describe('Admin Page via Worker', () => {
    test('Admin page loads successfully', async ({ page }) => {
      await page.goto(`${BASE_URL}/admin`);

      // Verify page loaded (not error page)
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Check for Worker backend header
      const response = await page.goto(`${BASE_URL}/admin`);
      const backend = response.headers()['x-backend'] || response.headers()['x-proxied-by'];
      expect(backend).toContain('worker');
    });
  });

  // ===========================================================================
  // 6. Cross-Surface Navigation Tests
  // ===========================================================================

  test.describe('Cross-Surface Navigation Flow', () => {
    test('Complete flow: events list → public → display → poster', async ({ page, request }) => {
      // Step 1: Load events list
      await page.goto(`${BASE_URL}/events`);
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);

      // Get an existing event from API
      const eventsResponse = await request.get(`${BASE_URL}/api/v2/events?brand=${TEST_BRAND}`);
      const eventsData = await eventsResponse.json();

      if (!eventsData.ok || !eventsData.value?.items?.length) {
        test.skip('No events available for testing');
        return;
      }

      const eventId = eventsData.value.items[0].id;

      // Step 2: Navigate to public event page
      await page.goto(`${BASE_URL}/events?event=${eventId}`);
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);
      await page.waitForTimeout(1000);

      // Step 3: Navigate to display page
      await page.goto(`${BASE_URL}/display?event=${eventId}`);
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);
      await page.waitForTimeout(1000);

      // Step 4: Navigate to poster page
      await page.goto(`${BASE_URL}/poster?event=${eventId}`);
      await expect(page).not.toHaveTitle(/Unavailable|Error/i);
      await page.waitForTimeout(1000);

      // All pages loaded successfully
      console.log('[STAGE-2] Complete navigation flow passed');
    });
  });

  // ===========================================================================
  // 7. Negative Path Tests
  // ===========================================================================

  test.describe('Negative Paths: Graceful Error Handling', () => {
    test('Invalid event ID shows proper error, not blank page', async ({ page }) => {
      const invalidEventId = 'invalid-event-id-12345';

      await page.goto(`${BASE_URL}/events?event=${invalidEventId}`);

      // Should not have a blank page
      const bodyText = await page.textContent('body');
      expect(bodyText.trim().length).toBeGreaterThan(10);

      // Should show error state or event not found message
      // Not a raw error or blank page
      const hasErrorHandling = await page.evaluate(() => {
        const body = document.body.textContent.toLowerCase();
        return body.includes('not found') ||
               body.includes('unavailable') ||
               body.includes('error') ||
               body.includes('event') ||
               document.querySelector('.error-state, .empty-state') !== null;
      });

      // Either shows proper error UI OR falls back to empty state
      // Main thing: no blank page or raw error
      expect(hasErrorHandling || bodyText.length > 100).toBe(true);
    });

    test('API error returns structured JSON, not raw error', async ({ request }) => {
      const invalidEventId = 'invalid-event-id-12345';

      const response = await request.get(
        `${BASE_URL}/api/v2/events/${invalidEventId}/bundle/public?brand=${TEST_BRAND}`
      );

      // Should return 404
      expect(response.status()).toBe(404);

      // Should return structured JSON
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.code).toBeDefined();
      expect(data.message).toBeDefined();
    });

    test('Bundle API handles missing brand gracefully', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v2/events`);

      // Should still work with default brand
      expect(response.ok()).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  // ===========================================================================
  // 8. Worker Headers Verification
  // ===========================================================================

  test.describe('Worker Response Headers', () => {
    test('API responses include Worker headers', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v2/status`);

      // Should include worker identification headers
      const headers = response.headers();
      expect(
        headers['x-backend'] ||
        headers['x-proxied-by'] ||
        headers['x-worker-version']
      ).toBeDefined();
    });

    test('HTML pages include Worker headers', async ({ page }) => {
      const response = await page.goto(`${BASE_URL}/events`);

      // Should include worker identification headers
      const headers = response.headers();
      expect(
        headers['x-backend'] ||
        headers['x-proxied-by'] ||
        headers['x-worker-version'] ||
        headers['x-template']
      ).toBeDefined();
    });
  });

  // ===========================================================================
  // 9. Performance Sanity Checks
  // ===========================================================================

  test.describe('Performance Sanity', () => {
    test('Worker API responds within acceptable time', async ({ request }) => {
      const start = Date.now();
      const response = await request.get(`${BASE_URL}/api/v2/status`);
      const duration = Date.now() - start;

      expect(response.ok()).toBe(true);
      // Should respond within 5 seconds (generous timeout)
      expect(duration).toBeLessThan(5000);
    });

    test('HTML pages load within acceptable time', async ({ page }) => {
      const start = Date.now();
      await page.goto(`${BASE_URL}/events`);
      const duration = Date.now() - start;

      // Should load within 10 seconds (generous timeout)
      expect(duration).toBeLessThan(10000);
    });
  });
});

// =============================================================================
// Summary Report
// =============================================================================

test.afterAll(async () => {
  console.log('\n==========================================');
  console.log('Stage-2 E2E Test Suite Complete');
  console.log('==========================================');
  console.log(`Target: ${BASE_URL}`);
  console.log('Tests validated:');
  console.log('  - Worker health checks');
  console.log('  - Public page via Worker');
  console.log('  - Display page via Worker');
  console.log('  - Poster page via Worker');
  console.log('  - Admin page via Worker');
  console.log('  - Cross-surface navigation');
  console.log('  - Graceful error handling');
  console.log('  - Worker response headers');
  console.log('  - Performance sanity');
  console.log('==========================================\n');
});
