/**
 * Stage-2 Critical Smoke Tests - Story 5
 *
 * Comprehensive smoke test suite for Stage-2 CI/CD gate validation.
 * Tests critical flows that must always pass before deployment succeeds.
 *
 * Critical Endpoints Covered:
 * - /api/health/backend - Backend health check (ok:true required)
 * - /api/v2/events - Events list endpoint
 * - /manage - Admin UI basics
 * - /events - Public events page
 * - SharedReport pages
 *
 * Acceptance Criteria (Story 5):
 * - Smoke tests cover all critical endpoints
 * - Tests fail if first API host does not include stg.oursharedevents.com
 * - Tests fail if any response returns ok:false
 * - Stage-2 log output includes base URL and first host for debugging
 *
 * @see Story 5 - Expand Playwright Smoke Coverage
 */

import { test, expect } from '@playwright/test';
import {
  SmokeTestHelper,
  assertStagingHost,
  getBaseUrl,
  logTestEnvironment,
  makeApiRequest,
  STAGING_HOST_PATTERN,
} from '../../shared/helpers/smoke-test-helper';

// ===========================================================================
// CONFIGURATION
// ===========================================================================

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Base URL - must be staging for Stage-2 tests
const BASE_URL = getBaseUrl();

// ===========================================================================
// TEST SETUP - Log environment at suite start
// ===========================================================================

test.beforeAll(() => {
  logTestEnvironment('Stage-2 Critical Smoke Tests');
});

// ===========================================================================
// STAGING ENVIRONMENT VERIFICATION (Critical Gate)
// ===========================================================================

test.describe('Staging Environment Verification - Story 5 Gate', () => {

  test('BASE_URL is set and points to staging', () => {
    console.log(`Checking BASE_URL: ${BASE_URL}`);

    // BASE_URL must be set
    expect(BASE_URL).toBeDefined();
    expect(BASE_URL.length).toBeGreaterThan(0);

    // Must be HTTPS
    expect(BASE_URL.startsWith('https://')).toBe(true);

    // Skip staging assertion if explicitly running against production
    if (process.env.USE_PRODUCTION === 'true') {
      console.log('USE_PRODUCTION=true - skipping staging host assertion');
      return;
    }

    // Must include staging pattern
    const url = new URL(BASE_URL);
    const isStaging = url.host.includes('stg.') || url.host.includes('staging.');

    expect(isStaging, `BASE_URL host must include staging pattern. Got: ${url.host}`).toBe(true);
  });

  test('first API call goes to staging host', async ({ request }) => {
    // Make a simple API call to verify host
    const response = await request.get('/api/status');
    const responseUrl = response.url();

    console.log(`First API call URL: ${responseUrl}`);

    // Extract and verify host
    const url = new URL(responseUrl);
    console.log(`Response host: ${url.host}`);

    // Skip staging assertion if explicitly running against production
    if (process.env.USE_PRODUCTION !== 'true') {
      assertStagingHost(url.host);
    }
  });

});

// ===========================================================================
// /api/health/backend - Backend Health Check (Story B2)
// ===========================================================================

test.describe('/api/health/backend - Backend Health', () => {

  test('returns HTTP 200 and ok:true', async ({ request }) => {
    const { status, json, requestId } = await makeApiRequest(
      request,
      '/api/health/backend',
      { logResponse: true }
    );

    console.log(`Request ID: ${requestId || 'N/A'}`);

    // HTTP status check
    expect(status, 'Health endpoint must return 200').toBe(200);

    // Contract field checks
    expect(json).toHaveProperty('ok');
    expect(json.ok, 'Health check must return ok:true').toBe(true);
  });

  test('includes required contract fields', async ({ request }) => {
    const { json } = await makeApiRequest(request, '/api/health/backend');

    // Required fields per Story B2 contract
    expect(json).toHaveProperty('ok');
    expect(json).toHaveProperty('env');
    expect(json).toHaveProperty('backend');
    expect(json).toHaveProperty('googleAuth');
    expect(json).toHaveProperty('token');
    expect(json).toHaveProperty('sheetsProbe');
    expect(json).toHaveProperty('workerVersion');

    // Log key values for CI visibility
    console.log(`Environment: ${json.env}`);
    console.log(`Backend: ${json.backend}`);
    console.log(`Google Auth: ${json.googleAuth}`);
    console.log(`Token: ${json.token}`);
    console.log(`Sheets Probe OK: ${json.sheetsProbe?.ok}`);
  });

  test('includes requestId for tracing', async ({ request }) => {
    const { json, headers } = await makeApiRequest(request, '/api/health/backend');

    // Response body should include requestId
    expect(json).toHaveProperty('requestId');
    expect(typeof json.requestId).toBe('string');

    // Headers should include x-request-id
    expect(headers['x-request-id']).toBeDefined();

    console.log(`Body requestId: ${json.requestId}`);
    console.log(`Header X-Request-Id: ${headers['x-request-id']}`);
  });

  test('sheetsProbe returns ok:true when healthy', async ({ request }) => {
    const { json } = await makeApiRequest(request, '/api/health/backend');

    // sheetsProbe must be present and healthy
    expect(json.sheetsProbe).toBeDefined();
    expect(json.sheetsProbe).toHaveProperty('ok');
    expect(json.sheetsProbe.ok, 'sheetsProbe must return ok:true').toBe(true);

    // When healthy, status should be 200
    if (json.sheetsProbe.ok === true) {
      expect(json.sheetsProbe.status).toBe(200);
    }
  });

});

// ===========================================================================
// /api/v2/events - Events List Endpoint (Story B5)
// ===========================================================================

test.describe('/api/v2/events - Events API', () => {

  test('returns HTTP 200 and ok:true', async ({ request }) => {
    const { status, json, requestId } = await makeApiRequest(
      request,
      `/api/v2/events?brand=${BRAND}`,
      { logResponse: true }
    );

    console.log(`Request ID: ${requestId || 'N/A'}`);

    // HTTP status check
    expect(status, 'Events endpoint must return 200').toBe(200);

    // Contract checks
    expect(json).toHaveProperty('ok');
    expect(json.ok, 'Events must return ok:true').toBe(true);
  });

  test('includes required contract fields (ok, status, items)', async ({ request }) => {
    const { json } = await makeApiRequest(request, `/api/v2/events?brand=${BRAND}`);

    // Required fields per Story B5 contract
    expect(json).toHaveProperty('ok');
    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('items');

    // Type checks
    expect(typeof json.ok).toBe('boolean');
    expect(json.status).toBe(200);
    expect(Array.isArray(json.items)).toBe(true);

    console.log(`Items count: ${json.items.length}`);
  });

  test('items array contains valid event objects when not empty', async ({ request }) => {
    const { json } = await makeApiRequest(request, `/api/v2/events?brand=${BRAND}&full=true`);

    if (json.items && json.items.length > 0) {
      const firstItem = json.items[0];

      // EventV2Summary required fields
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('slug');
      expect(firstItem).toHaveProperty('name');

      console.log(`First event: ${firstItem.name} (${firstItem.id})`);
    } else {
      console.log('No events in list - empty items array is valid');
    }
  });

  test('defaults to brand=root when no brand specified', async ({ request }) => {
    const { status, json } = await makeApiRequest(request, '/api/v2/events');

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.items)).toBe(true);
  });

  test('includes requestId for tracing', async ({ request }) => {
    const { json, headers } = await makeApiRequest(request, `/api/v2/events?brand=${BRAND}`);

    // Check header
    expect(headers['x-request-id']).toBeDefined();
    console.log(`X-Request-Id: ${headers['x-request-id']}`);
  });

});

// ===========================================================================
// /manage - Admin UI Smoke Tests
// ===========================================================================

test.describe('/manage - Admin UI', () => {
  let smokeHelper: SmokeTestHelper;

  test.beforeEach(async ({ page }) => {
    smokeHelper = new SmokeTestHelper(page, BASE_URL);
  });

  test.afterEach(async () => {
    smokeHelper.printRuntimeInfo();
  });

  test('page loads with HTTP 200', async ({ page }) => {
    const response = await page.goto(`/manage?brand=${BRAND}`);

    expect(response?.status()).toBeLessThan(400);
    console.log(`/manage status: ${response?.status()}`);
  });

  test('page has Worker transparency headers', async ({ page }) => {
    const response = await page.goto(`/manage?brand=${BRAND}`);
    const headers = response?.headers() || {};

    // Should be proxied by worker
    expect(headers['x-proxied-by']).toBe('oursharedevents-worker');
    expect(headers['x-worker-version']).toBeDefined();

    console.log(`Proxied by: ${headers['x-proxied-by']}`);
    console.log(`Worker version: ${headers['x-worker-version']}`);
  });

  test('loads core UI elements (dropdown or wizard)', async ({ page }) => {
    await page.goto(`/manage?brand=${BRAND}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Either wizard OR event selector should be visible
    const launchWizard = page.locator('[data-testid="launch-wizard"]');
    const eventDropdown = page.locator('[data-testid="event-dropdown"]');
    const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

    const wizardVisible = await launchWizard.isVisible().catch(() => false);
    const dropdownVisible = await eventDropdown.isVisible().catch(() => false);
    const selectorBarVisible = await eventSelectorBar.isVisible().catch(() => false);

    console.log(`Launch Wizard visible: ${wizardVisible}`);
    console.log(`Event Dropdown visible: ${dropdownVisible}`);
    console.log(`Event Selector Bar visible: ${selectorBarVisible}`);

    // At least one must be visible
    expect(
      wizardVisible || dropdownVisible || selectorBarVisible,
      'Expected admin UI elements to be visible'
    ).toBe(true);
  });

  test('first API host is staging', async ({ page }) => {
    await page.goto(`/manage?brand=${BRAND}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify staging environment
    if (process.env.USE_PRODUCTION !== 'true') {
      smokeHelper.assertStagingEnvironment();
    }
  });

  test('no GAS HTML markers in page content', async ({ page }) => {
    await page.goto(`/manage?brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const content = await page.content();

    expect(content).not.toContain('Google Apps Script');
    expect(content).not.toContain('Script function not found');
    expect(content).not.toContain('userCodeAppPanel');
  });

});

// ===========================================================================
// /events - Public Events Page
// ===========================================================================

test.describe('/events - Public Events Page', () => {
  let smokeHelper: SmokeTestHelper;

  test.beforeEach(async ({ page }) => {
    smokeHelper = new SmokeTestHelper(page, BASE_URL);
  });

  test.afterEach(async () => {
    smokeHelper.printRuntimeInfo();
  });

  test('page loads with HTTP 200', async ({ page }) => {
    const response = await page.goto('/events');

    expect(response?.status()).toBe(200);
    console.log(`/events status: ${response?.status()}`);
  });

  test('page has correct title containing EventAngle', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('domcontentloaded');

    const title = await page.title();
    expect(title.toLowerCase()).toContain('oursharedevents');
    console.log(`Page title: ${title}`);
  });

  test('renders events-root marker (CI gate)', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    const eventsRoot = page.locator('[data-testid="events-root"]');
    await expect(eventsRoot).toBeAttached({ timeout: 15000 });
  });

  test('no error states displayed', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for error indicators
    const temporaryIssue = page.locator(':text("Temporary Issue"), :text("temporary issue")');
    const errorCard = page.locator('[data-testid="error-card"], .error-card');

    const hasTemporaryIssue = await temporaryIssue.count();
    const hasErrorCard = await errorCard.count();

    expect(hasTemporaryIssue, 'Should not show Temporary Issue').toBe(0);
    expect(hasErrorCard, 'Should not show error card').toBe(0);
  });

  test('first API host is staging', async ({ page }) => {
    await page.goto('/events');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    if (process.env.USE_PRODUCTION !== 'true') {
      smokeHelper.assertStagingEnvironment();
    }
  });

});

// ===========================================================================
// SharedReport Pages
// ===========================================================================

test.describe('SharedReport Pages', () => {
  let smokeHelper: SmokeTestHelper;

  test.beforeEach(async ({ page }) => {
    smokeHelper = new SmokeTestHelper(page, BASE_URL);
  });

  test.afterEach(async () => {
    smokeHelper.printRuntimeInfo();
  });

  test('report page loads without HTTP 500/503', async ({ page }) => {
    const response = await page.goto(`/?page=report&brand=${BRAND}`);

    // FAIL-FAST: 503 indicates deployment issue
    expect(response?.status(), 'HTTP 503 indicates deployment issue').not.toBe(503);
    expect(response?.status()).toBeLessThan(500);

    console.log(`Report page status: ${response?.status()}`);
  });

  test('/analytics friendly URL loads', async ({ page }) => {
    const response = await page.goto(`/analytics?brand=${BRAND}`);

    expect(response?.status()).not.toBe(503);
    expect(response?.status()).toBeLessThan(500);

    console.log(`/analytics status: ${response?.status()}`);
  });

  test('page has valid HTML structure', async ({ page }) => {
    await page.goto(`/?page=report&brand=${BRAND}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('html')).toBeAttached();
    await expect(page.locator('head')).toBeAttached();
    await expect(page.locator('body')).toBeAttached();
  });

  test('no GAS HTML markers in report page', async ({ page }) => {
    await page.goto(`/?page=report&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const content = await page.content();

    expect(content).not.toContain('script.google.com');
    expect(content).not.toContain('Google Apps Script');
    expect(content).not.toContain('userCodeAppPanel');
  });

});

// ===========================================================================
// API Response Time Gate
// ===========================================================================

test.describe('API Response Time Gate', () => {

  test('/api/health/backend responds within 15s', async ({ request }) => {
    const startTime = Date.now();
    const response = await request.get('/api/health/backend');
    const duration = Date.now() - startTime;

    expect(response.ok()).toBe(true);
    expect(duration).toBeLessThan(15000);

    console.log(`Health endpoint response time: ${duration}ms`);
  });

  test('/api/v2/events responds within 15s', async ({ request }) => {
    const startTime = Date.now();
    const response = await request.get(`/api/v2/events?brand=${BRAND}`);
    const duration = Date.now() - startTime;

    expect(response.ok()).toBe(true);
    expect(duration).toBeLessThan(15000);

    console.log(`Events endpoint response time: ${duration}ms`);
  });

});

// ===========================================================================
// Negative Path - Failure Logging
// ===========================================================================

test.describe('Negative Path - Failure Observability', () => {

  test('failed requests include requestId for debugging', async ({ request }) => {
    // Use invalid brand to trigger error
    const response = await request.get('/api/v2/events?brand=invalid_brand_xyz');
    const json = await response.json();
    const headers = response.headers();

    // Log for CI visibility
    console.log(`Status: ${response.status()}`);
    console.log(`X-Request-Id: ${headers['x-request-id'] || 'N/A'}`);
    console.log(`Response: ${JSON.stringify(json).substring(0, 200)}`);

    // Error response should include requestId
    if (!response.ok()) {
      expect(json).toHaveProperty('requestId');
      console.log(`Error requestId: ${json.requestId}`);
    }
  });

  test('503 responses include debugging info', async ({ request }) => {
    // This test validates error format - we don't expect 503 in normal operation
    const response = await request.get('/api/health/backend');
    const headers = response.headers();

    if (response.status() === 503) {
      const json = await response.json();

      console.log('503 ERROR DETECTED:');
      console.log(`  Request ID: ${headers['x-request-id'] || json.requestId}`);
      console.log(`  Error Code: ${json.code || 'N/A'}`);
      console.log(`  Error: ${json.error || 'N/A'}`);

      // 503 should cause test to fail in normal operation
      expect.fail(`Backend returned 503 - check deployment. Request ID: ${json.requestId}`);
    }

    expect(response.status()).not.toBe(503);
  });

});
