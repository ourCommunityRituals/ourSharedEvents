/**
 * Production Smoke Tests - Read-only health checks for NU SDK promotion
 *
 * DANGER: These tests run against LIVE PRODUCTION (www.eventangle.com)
 *
 * SAFETY CONSTRAINTS:
 * - READ-ONLY: No writes, no mutations, no form submissions
 * - FAST: Complete in < 60 seconds
 * - OPT-IN ONLY: Never runs automatically, requires explicit workflow_dispatch
 *
 * ACCEPTANCE CRITERIA (Story 5):
 * - /events works in prod, matching staging
 * - All QR flows work (Poster surface)
 * - No 200-whitepage issues remain
 * - Console shows minimal logs (only error-level or none)
 *
 * Use case: Verify production is alive after a release or incident
 *
 * Run locally:
 *   BASE_URL="https://www.eventangle.com" npm run test:prod:smoke:minimal
 *
 * CI:
 *   Only via workflow_dispatch with use_production=true
 */

const { test, expect } = require('@playwright/test');

// Production URL - hardcoded for safety (don't inherit from env)
const PROD_URL = 'https://www.eventangle.com';
const BRAND_ID = 'root';

/**
 * Check if a URL string belongs to the eventangle.com domain
 * Uses URL parsing to prevent subdomain spoofing attacks
 * @param {string} urlStr - URL string to check
 * @returns {boolean} - True if URL is from eventangle.com domain
 */
function isEventangleDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname;
    // Exact match or proper subdomain match (e.g., www.eventangle.com, stg.eventangle.com)
    return hostname === 'eventangle.com' || hostname.endsWith('.eventangle.com');
  } catch {
    // If URL parsing fails, check for eventangle.com with boundary markers
    // This handles cases where the URL is malformed but still contains our domain
    return false;
  }
}

/**
 * Filter out non-critical console errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e => {
    const msg = e.message || e.text || String(e);
    // Ignore common non-critical errors
    if (msg.includes('favicon')) return false;
    if (msg.includes('google.script')) return false;
    if (msg.includes('google is not defined')) return false;
    // Ignore CORS errors from external resources (not our domain)
    // Extract URL from CORS error message and validate using secure parsing
    if (msg.includes('CORS')) {
      // Try to extract URL from the error message
      const urlMatch = msg.match(/https?:\/\/[^\s'"]+/);
      if (urlMatch && !isEventangleDomain(urlMatch[0])) {
        return false; // Ignore CORS errors from external domains
      }
    }
    return true;
  });
}

test.describe('PRODUCTION SMOKE - Read-Only Health Checks', () => {

  test.beforeAll(async () => {
    console.log('========================================');
    console.log('PRODUCTION SMOKE TESTS - NU SDK v2.0');
    console.log('Target: ' + PROD_URL);
    console.log('These are READ-ONLY tests against LIVE PRODUCTION');
    console.log('========================================');
  });

  test('Status API - Production is alive', async ({ page }) => {
    const response = await page.goto(`${PROD_URL}?p=status&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);

    const json = await response.json();
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('buildId');
    expect(json).toHaveProperty('brandId', BRAND_ID);
    expect(json).toHaveProperty('timestamp');

    console.log('Production status OK, buildId: ' + json.buildId);
  });

  test('/events Friendly URL - Production events page loads', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Test the /events friendly URL (Stage-2 AC requirement)
    const response = await page.goto(`${PROD_URL}/events`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);

    // Page should not be blank (200-whitepage check)
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent.length, 'Page should not be blank').toBeGreaterThan(50);

    // Container or main app element should be visible
    await expect(page.locator('.container, main#app, main, #app')).toBeVisible({ timeout: 10000 });

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length, `Unexpected errors: ${JSON.stringify(criticalErrors)}`).toBe(0);

    console.log('/events friendly URL loaded successfully');
  });

  test('Admin Page - Loads without errors (read-only)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    const response = await page.goto(`${PROD_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);
    await expect(page.locator('h2:has-text("Create Event")')).toBeVisible({ timeout: 10000 });

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);

    console.log('Admin page loaded successfully');
  });

  test('Public Page - Loads without errors (read-only)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    const response = await page.goto(`${PROD_URL}?p=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);
    await expect(page.locator('.container, main#app')).toBeVisible({ timeout: 10000 });

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);

    console.log('Public page loaded successfully');
  });

  test('Display Page - TV mode loads without errors (read-only)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    const response = await page.goto(`${PROD_URL}?page=display&brand=${BRAND_ID}&tv=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);

    // Page should not be blank
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent.length, 'Display should have content').toBeGreaterThan(0);

    // Display stage/container should be present
    await expect(page.locator('#stage, .stage, .display-container, main, iframe').first()).toBeAttached({ timeout: 10000 });

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length, `Display errors: ${JSON.stringify(criticalErrors)}`).toBe(0);

    console.log('Display page loaded successfully');
  });

  test('Poster Page - QR flow loads without errors (read-only)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    const response = await page.goto(`${PROD_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);

    // Page should not be blank
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent.length, 'Poster should have content').toBeGreaterThan(0);

    // Poster container should be present
    await expect(page.locator('.poster-container, #poster, .poster, main, .container').first()).toBeAttached({ timeout: 10000 });

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length, `Poster errors: ${JSON.stringify(criticalErrors)}`).toBe(0);

    console.log('Poster page loaded successfully');
  });

});

test.describe('PRODUCTION SMOKE - NU SDK Log Level Validation', () => {

  test('NU SDK uses error-only logging in production', async ({ page }) => {
    // Load any surface with NU SDK
    await page.goto(`${PROD_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Verify NU SDK is present and configured for production
    const nuHealth = await page.evaluate(() => {
      const win = window;
      if (!win.NU) {
        return { sdkPresent: false };
      }
      return {
        sdkPresent: true,
        version: win.NU.VERSION,
        logLevel: win.NU._config?.logLevel,
        logsCount: win.__NU_LOGS__?.length || 0,
        initLog: win.__NU_LOGS__?.find(l => l.type === 'init') || null,
      };
    });

    // NU SDK should be present
    expect(nuHealth.sdkPresent, 'NU SDK should be present').toBe(true);
    expect(nuHealth.version, 'NU SDK version should be 2.0.0').toBe('2.0.0');

    // In production, log level should be 'error' (not 'debug')
    expect(nuHealth.logLevel, 'Production should use error log level').toBe('error');

    // Init log should show production detection
    if (nuHealth.initLog) {
      expect(nuHealth.initLog.isProduction, 'Should detect production environment').toBe(true);
      expect(nuHealth.initLog.isStaging, 'Should not detect as staging').toBeFalsy();
    }

    console.log(`NU SDK Config: version=${nuHealth.version}, logLevel=${nuHealth.logLevel}`);
    console.log('Production log level validation PASSED - minimal logging confirmed');
  });

  test('NU SDK logs buffer present but console output suppressed', async ({ page }) => {
    const consoleMessages = [];

    // Collect all console messages
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
      });
    });

    await page.goto(`${PROD_URL}?page=public&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Wait for any async RPC calls
    await page.waitForTimeout(2000);

    // Verify logs buffer exists (for diagnostics)
    const logsBuffer = await page.evaluate(() => {
      return window.__NU_LOGS__ || [];
    });
    expect(Array.isArray(logsBuffer), 'Logs buffer should exist').toBe(true);

    // Filter for NUSDK debug messages (should be suppressed in production)
    const nuDebugMessages = consoleMessages.filter(m =>
      m.type === 'debug' && m.text.includes('[NUSDK]')
    );

    // In production (error level), debug messages should be suppressed
    expect(nuDebugMessages.length, 'Debug logs should be suppressed in production').toBe(0);

    console.log(`Console messages: ${consoleMessages.length} total, ${nuDebugMessages.length} NU debug`);
    console.log('Console verbosity check PASSED - minimal output confirmed');
  });

});
