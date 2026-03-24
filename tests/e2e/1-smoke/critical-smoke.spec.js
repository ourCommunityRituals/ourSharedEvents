/**
 * SMOKE TESTS - Level 1: Quick Health Checks
 *
 * Purpose: Verify system is alive and basic functionality works
 * Run Time: < 30 seconds (accounting for Google Apps Script cold starts)
 * Run Frequency: Every deployment, every commit
 *
 * Test Hierarchy:
 * 1. Smoke Tests (this file) - Quick health checks
 * 2. Page Tests - Component and interaction testing
 * 3. Flow Tests - End-to-end user journeys
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 *
 * CRITICAL: No retries configured - tests must pass reliably on first run
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

// Validate environment configuration before running tests
test.beforeAll(async () => {
  if (!BASE_URL || BASE_URL.includes('YOUR_SCRIPT_ID') || BASE_URL.includes('.../exec')) {
    throw new Error(
      '❌ BASE_URL not configured! Set BASE_URL or GOOGLE_SCRIPT_URL environment variable.\n' +
      'Example: export BASE_URL=https://zeventbooks.com\n' +
      'See .env.example for details.'
    );
  }
  console.log(`✅ Running smoke tests against: ${BASE_URL}`);
});

test.describe('🚨 SMOKE: Critical Endpoints', () => {

  test('Status API responds with 200 and valid schema (pure flat format)', async ({ page }) => {
    // Wait for load state to handle Google Apps Script cold starts
    const response = await page.goto(`${BASE_URL}?page=status&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000, // Allow time for cold start
    });

    expect(response.status()).toBe(200);

    const json = await response.json();

    // STRICT: Pure status API contract validation (flat format, no envelope)
    expect(json).toHaveProperty('ok', true);
    // Validate buildId exists and has valid format (not hardcoded version)
    expect(json).toHaveProperty('buildId');
    expect(typeof json.buildId).toBe('string');
    expect(json.buildId.length).toBeGreaterThan(0);
    expect(json).toHaveProperty('brandId', BRAND_ID);
    expect(json).toHaveProperty('timestamp');

    // STRICT: Response must be JSON (not HTML error page)
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('Health check endpoint is alive', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    expect(response.status()).toBe(200);
  });

  test('Public page loads', async ({ page }) => {
    const targetUrl = `${BASE_URL}?page=events&brand=${BRAND_ID}`;
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Log details if status is not 200 for easier debugging in CI
    const status = response.status();
    if (status !== 200) {
      console.error(`❌ Public page failed: ${status} at ${response.url()}`);
      console.error(`   Original URL: ${targetUrl}`);
    }
    expect(status).toBe(200);

    // Wait for main container (Public.html uses div.container, Admin uses main#app)
    await expect(page.locator('.container, main#app')).toBeVisible({ timeout: 10000 });
  });

  test('Admin page loads', async ({ page }) => {
    const targetUrl = `${BASE_URL}?page=admin&brand=${BRAND_ID}`;
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Log details if status is not 200 for easier debugging in CI
    const status = response.status();
    if (status !== 200) {
      console.error(`❌ Admin page failed: ${status} at ${response.url()}`);
      console.error(`   Original URL: ${targetUrl}`);
    }
    expect(status).toBe(200);

    // Wait for admin page to fully initialize
    await expect(page.locator('h2:has-text("Create Event")')).toBeVisible({ timeout: 10000 });
  });

  test('Display page loads', async ({ page }) => {
    const targetUrl = `${BASE_URL}?page=display&brand=${BRAND_ID}`;
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Log details if status is not 200 for easier debugging in CI
    const status = response.status();
    if (status !== 200) {
      console.error(`❌ Display page failed: ${status} at ${response.url()}`);
      console.error(`   Original URL: ${targetUrl}`);
    }
    expect(status).toBe(200);

    // Wait for stage element to be visible
    await expect(page.locator('#stage')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('🚨 SMOKE: Performance Baselines', () => {

  test('Status API responds within reasonable time', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=status&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const duration = Date.now() - start;

    // Allow more time for Google Apps Script cold starts
    // Warm: <2s, Cold start: <15s
    expect(duration).toBeLessThan(15000);

    // Log performance for monitoring
    console.log(`Status API response time: ${duration}ms`);
  });

  test('Page loads within reasonable time', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('domcontentloaded');
    const duration = Date.now() - start;

    // Allow more time for Google Apps Script cold starts and page rendering
    // Warm: <5s, Cold start: <20s
    expect(duration).toBeLessThan(20000);

    // Log performance for monitoring
    console.log(`Page load time: ${duration}ms`);
  });
});

test.describe('🚨 SMOKE: No JavaScript Errors', () => {

  test('Admin page loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for page to stabilize (with timeout)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      // Networkidle might timeout on slow connections - that's OK
      console.log('⚠️  Network idle timeout - continuing test');
    });

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );

    if (criticalErrors.length > 0) {
      console.error('❌ Critical JavaScript errors found:', criticalErrors.map(e => e.message));
    }

    expect(criticalErrors.length).toBe(0);
  });

  test('Public page loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for page to stabilize (with timeout)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      // Networkidle might timeout on slow connections - that's OK
      console.log('⚠️  Network idle timeout - continuing test');
    });

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );

    if (criticalErrors.length > 0) {
      console.error('❌ Critical JavaScript errors found:', criticalErrors.map(e => e.message));
    }

    expect(criticalErrors.length).toBe(0);
  });
});
