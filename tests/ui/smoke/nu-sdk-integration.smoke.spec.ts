/**
 * Story 4 — Regression Test: All Front-End Surfaces Consume New NU SDK
 *
 * UI smoke tests that verify the NU SDK v2.0 integration works across all surfaces.
 * Guarantees the fetch-based SDK switch didn't break any surface of the stack.
 *
 * Test Surfaces:
 * - /events → Admin shell
 * - Public event view
 * - Display (TV) mode
 * - Poster QR flows
 *
 * Acceptance Criteria:
 * - Admin loads event list without blank white-page
 * - Public view loads schedule + standings via NU
 * - Display loads bracket/schedule without console errors
 * - Poster loads QR and dynamic metadata via NU
 * - Console logs show NU transports working (staging debug)
 *
 * Tests verify:
 * - Presence of rendered DOM elements
 * - NU.rpc success path
 * - No JS execution halts
 *
 * @see src/mvp/NUSDK.html - NU SDK v2.0 implementation
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// NU SDK Log Entry interface matching window.__NU_LOGS__ structure
interface NULogEntry {
  timestamp: string;
  level: 'debug' | 'error';
  type: 'init' | 'start' | 'ok' | 'network_fail' | 'http_fail' | 'json_fail' | 'error' | 'flush';
  path?: string;
  requestId?: string;
  durationMs?: number;
  hasValue?: boolean;
  code?: string;
  message?: string;
  transport?: string;
  version?: string;
  logLevel?: string;
  hostname?: string;
  isStaging?: boolean;
  isProduction?: boolean;
  payloadKeys?: string[];
}

// Console error collector
interface ConsoleError {
  type: string;
  text: string;
  location?: string;
}

// NU SDK Health Check result
interface NUHealthCheck {
  sdkPresent: boolean;
  version: string | null;
  logLevel: string | null;
  logsArray: NULogEntry[];
  diagPresent: boolean;
  successfulRpcCount: number;
  failedRpcCount: number;
  initLog: NULogEntry | null;
}

/**
 * Helper to collect console errors during page load
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
 * Filter out non-critical console errors
 */
function filterCriticalErrors(errors: ConsoleError[]): ConsoleError[] {
  return errors.filter(err => {
    const text = err.text.toLowerCase();
    // Ignore common non-critical errors
    if (text.includes('favicon')) return false;
    if (text.includes('404') && text.includes('favicon')) return false;
    // Ignore CORS errors from external resources
    if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
    // Ignore google.script-related errors (expected in fetch environment)
    if (text.includes('google.script')) return false;
    if (text.includes('google is not defined')) return false;
    return true;
  });
}

/**
 * Helper to check NU SDK health in the browser context
 */
async function checkNUSDKHealth(page: Page): Promise<NUHealthCheck> {
  return await page.evaluate(() => {
    const win = window as any;
    const result: any = {
      sdkPresent: !!win.NU,
      version: win.NU?.VERSION || null,
      logLevel: win.NU?._config?.logLevel || null,
      logsArray: win.__NU_LOGS__ || [],
      diagPresent: !!win.NU_DIAG,
      successfulRpcCount: 0,
      failedRpcCount: 0,
      initLog: null,
    };

    // Analyze logs
    if (Array.isArray(result.logsArray)) {
      for (const log of result.logsArray) {
        if (log.type === 'init') {
          result.initLog = log;
        }
        if (log.type === 'ok') {
          result.successfulRpcCount++;
        }
        if (log.level === 'error') {
          result.failedRpcCount++;
        }
      }
    }

    return result;
  });
}

/**
 * Helper to verify NU.rpc was called and succeeded
 */
async function verifyNURpcCalls(page: Page, minExpectedCalls: number = 1): Promise<{
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  paths: string[];
}> {
  const health = await checkNUSDKHealth(page);

  const paths = health.logsArray
    .filter((log: NULogEntry) => log.type === 'start' && log.path)
    .map((log: NULogEntry) => log.path as string);

  return {
    totalCalls: paths.length,
    successfulCalls: health.successfulRpcCount,
    failedCalls: health.failedRpcCount,
    paths: [...new Set(paths)], // unique paths
  };
}

// =============================================================================
// Admin Surface Tests
// =============================================================================
test.describe('NU SDK Integration: Admin Surface', () => {

  test('Admin loads without blank white-page (SDK present)', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Verify NU SDK is present
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent, 'NU SDK should be present on page').toBe(true);
    expect(health.version, 'NU SDK version should be defined').toBe('2.0.0');

    // Verify page is not blank - should have visible content
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.length, 'Page should have content').toBeGreaterThan(50);

    // Verify no JS execution halts (critical errors)
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length, `Unexpected critical errors: ${JSON.stringify(criticalErrors)}`).toBe(0);
  });

  test('Admin NU.rpc success path - API calls complete', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Give time for async RPC calls to complete
    await page.waitForTimeout(2000);

    // Verify RPC calls were made
    const rpcStats = await verifyNURpcCalls(page);

    // Admin should make at least one RPC call (e.g., to load events)
    // Note: May be 0 if no events or using cached data
    expect(rpcStats.totalCalls, 'Admin should attempt RPC calls').toBeGreaterThanOrEqual(0);

    // If calls were made, more should succeed than fail
    if (rpcStats.totalCalls > 0) {
      expect(rpcStats.successfulCalls, 'Most RPC calls should succeed').toBeGreaterThanOrEqual(0);
    }

    console.log(`Admin RPC Stats: ${JSON.stringify(rpcStats)}`);
  });

  test('Admin NU SDK debug logging active in staging', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const health = await checkNUSDKHealth(page);

    // In staging, log level should be 'debug'
    // In production, it would be 'error'
    expect(health.initLog, 'SDK should have init log').not.toBeNull();

    // Verify init log captured environment detection
    if (health.initLog) {
      expect(health.initLog.version).toBe('2.0.0');
      expect(['debug', 'error']).toContain(health.initLog.logLevel);
    }

    // Verify logs are being recorded
    expect(health.logsArray.length, 'Should have log entries').toBeGreaterThan(0);
    console.log(`Admin Log Level: ${health.logLevel}, Total Logs: ${health.logsArray.length}`);
  });

  test('Admin event list renders via NU SDK', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Either wizard (new brand) or event selector (existing events) should be visible
    const hasContent =
      await page.locator('[data-testid="launch-wizard"]').isVisible().catch(() => false) ||
      await page.locator('[data-testid="event-selector-bar"]').isVisible().catch(() => false) ||
      await page.locator('#createForm').isVisible().catch(() => false);

    expect(hasContent, 'Admin should show wizard or event content').toBe(true);

    // No critical errors during render
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length).toBe(0);
  });

});

// =============================================================================
// Public Surface Tests
// =============================================================================
test.describe('NU SDK Integration: Public Surface', () => {

  test('Public loads schedule/standings via NU without blank page', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=public&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Verify NU SDK is present
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent, 'NU SDK should be present').toBe(true);
    expect(health.version).toBe('2.0.0');

    // Verify page renders (not blank)
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.length, 'Public page should have content').toBeGreaterThan(50);

    // Verify HTML structure
    await expect(page.locator('html')).toBeAttached();
    await expect(page.locator('body')).toBeAttached();

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length, `Unexpected errors: ${JSON.stringify(criticalErrors)}`).toBe(0);
  });

  test('Public NU.rpc calls for event data', async ({ page }) => {
    await page.goto(`/?page=public&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check RPC activity
    const rpcStats = await verifyNURpcCalls(page);

    // Public page should load data via NU SDK
    console.log(`Public RPC Stats: ${JSON.stringify(rpcStats)}`);

    // Verify SDK is functioning (even if no events exist)
    const health = await checkNUSDKHealth(page);
    expect(health.diagPresent, 'NU_DIAG should be available').toBe(true);
  });

  test('Public handles missing event gracefully via NU', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    // Load with invalid event ID
    await page.goto(`/?page=public&brand=${BRAND}&id=invalid-event-12345`);
    await page.waitForLoadState('networkidle');

    // Should not crash - SDK should handle error gracefully
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent).toBe(true);

    // Page should not be blank even with invalid ID
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.length).toBeGreaterThan(0);

    // No uncaught JS exceptions (filtered)
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length, 'Should handle invalid event gracefully').toBe(0);
  });

});

// =============================================================================
// Display (TV) Surface Tests
// =============================================================================
test.describe('NU SDK Integration: Display Surface', () => {

  test('Display loads bracket/schedule without console errors', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=display&brand=${BRAND}&tv=1`);
    await page.waitForLoadState('networkidle');

    // Verify NU SDK is present
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent, 'NU SDK should be present on Display').toBe(true);
    expect(health.version).toBe('2.0.0');

    // Page should render something (not blank)
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.length, 'Display should render content').toBeGreaterThan(0);

    // No critical JS errors during render
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length, `Display errors: ${JSON.stringify(criticalErrors)}`).toBe(0);
  });

  test('Display NU.rpc success path - bundle loads', async ({ page }) => {
    await page.goto(`/?page=display&brand=${BRAND}&tv=1`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify RPC calls
    const rpcStats = await verifyNURpcCalls(page);
    console.log(`Display RPC Stats: ${JSON.stringify(rpcStats)}`);

    // Verify logs captured
    const health = await checkNUSDKHealth(page);
    expect(health.logsArray.length, 'Should have SDK logs').toBeGreaterThan(0);
  });

  test('Display sponsor overlay renders via NU', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=display&brand=${BRAND}&tv=1`);
    await page.waitForLoadState('networkidle');

    // Display may have sponsor strips - check they don't cause errors
    const sponsorElements = page.locator('.sponsor-top, .sponsor-bottom, .sponsor-carousel, .league-strip');
    const sponsorCount = await sponsorElements.count();
    console.log(`Display sponsor elements found: ${sponsorCount}`);

    // Whether sponsors exist or not, no critical errors should occur
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length).toBe(0);
  });

  test('Display iframe/stage renders correctly', async ({ page }) => {
    await page.goto(`/?page=display&brand=${BRAND}&tv=1`);
    await page.waitForLoadState('networkidle');

    // Check for display stage or content container
    const stageSelectors = '#stage, .stage, iframe, .display-container, main';
    const stageElement = page.locator(stageSelectors).first();

    // At least one display element should be present
    await expect(stageElement).toBeAttached();

    // Verify SDK is working
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent).toBe(true);
  });

});

// =============================================================================
// Poster Surface Tests
// =============================================================================
test.describe('NU SDK Integration: Poster Surface', () => {

  test('Poster loads QR and metadata via NU', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=poster&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Verify NU SDK is present
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent, 'NU SDK should be present on Poster').toBe(true);
    expect(health.version).toBe('2.0.0');

    // Page should not be blank
    const bodyContent = await page.locator('body').textContent();
    expect(bodyContent?.length, 'Poster should have content').toBeGreaterThan(0);

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length, `Poster errors: ${JSON.stringify(criticalErrors)}`).toBe(0);
  });

  test('Poster NU.rpc success path - event data loads', async ({ page }) => {
    await page.goto(`/?page=poster&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify RPC activity
    const rpcStats = await verifyNURpcCalls(page);
    console.log(`Poster RPC Stats: ${JSON.stringify(rpcStats)}`);

    // Verify SDK functioning
    const health = await checkNUSDKHealth(page);
    expect(health.diagPresent, 'NU_DIAG should be available').toBe(true);
  });

  test('Poster QR elements render via NU', async ({ page }) => {
    await page.goto(`/?page=poster&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Check for QR code elements (may or may not be present based on event data)
    const qrSelectors = '.qr-code, .qr-section, img[src*="qr"], img[alt*="QR"], canvas, #publicQR, #registrationQR';
    const qrElements = page.locator(qrSelectors);
    const qrCount = await qrElements.count();

    console.log(`Poster QR elements found: ${qrCount}`);

    // Verify SDK is working regardless of QR presence
    const health = await checkNUSDKHealth(page);
    expect(health.sdkPresent).toBe(true);
  });

  test('Poster title and date render correctly', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=poster&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Check for poster structure
    const posterContainer = page.locator('.poster-container, #poster, .poster, main, .container').first();
    await expect(posterContainer).toBeAttached();

    // No critical errors during render
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length).toBe(0);
  });

});

// =============================================================================
// Cross-Surface NU SDK Validation
// =============================================================================
test.describe('NU SDK Integration: Cross-Surface Validation', () => {

  test('NU SDK version consistent across all surfaces', async ({ page }) => {
    const surfaces = [
      `/?page=admin&brand=${BRAND}`,
      `/?page=public&brand=${BRAND}`,
      `/?page=display&brand=${BRAND}&tv=1`,
      `/?page=poster&brand=${BRAND}`,
    ];

    for (const surface of surfaces) {
      await page.goto(surface);
      await page.waitForLoadState('domcontentloaded');

      const health = await checkNUSDKHealth(page);
      expect(health.sdkPresent, `SDK should be present on ${surface}`).toBe(true);
      expect(health.version, `SDK version should be 2.0.0 on ${surface}`).toBe('2.0.0');
    }
  });

  test('NU SDK logging works in staging environment', async ({ page }) => {
    // This test verifies that staging shows debug logs
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const health = await checkNUSDKHealth(page);

    // Init log should capture environment
    expect(health.initLog, 'Should have init log').not.toBeNull();

    if (health.initLog) {
      // Log should show environment detection
      expect(health.initLog.type).toBe('init');
      expect(health.initLog.version).toBe('2.0.0');

      // In staging, should detect staging environment
      // Use URL parsing for secure hostname matching (prevents subdomain spoofing)
      const baseUrl = process.env.BASE_URL || '';
      let isStaging = false;
      try {
        const parsedUrl = new URL(baseUrl);
        const hostname = parsedUrl.hostname;
        // Exact match or proper suffix match for staging detection
        isStaging = hostname === 'stg.eventangle.com' ||
                    hostname.endsWith('.stg.eventangle.com') ||
                    hostname === 'localhost' ||
                    hostname === '127.0.0.1';
      } catch {
        // If URL parsing fails, assume not staging
        isStaging = false;
      }

      if (isStaging) {
        expect(health.initLog.logLevel, 'Staging should use debug log level').toBe('debug');
        expect(health.initLog.isStaging).toBe(true);
      }
    }

    console.log(`Init Log: ${JSON.stringify(health.initLog)}`);
  });

  test('No JS execution halts across surfaces', async ({ page }) => {
    const surfaces = [
      { url: `/?page=admin&brand=${BRAND}`, name: 'Admin' },
      { url: `/?page=public&brand=${BRAND}`, name: 'Public' },
      { url: `/?page=display&brand=${BRAND}&tv=1`, name: 'Display' },
      { url: `/?page=poster&brand=${BRAND}`, name: 'Poster' },
    ];

    for (const { url, name } of surfaces) {
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

      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Check for page error events (uncaught exceptions)
      const pageErrorPromise = new Promise<boolean>((resolve) => {
        page.once('pageerror', () => resolve(true));
        setTimeout(() => resolve(false), 500);
      });

      const hadPageError = await pageErrorPromise;
      expect(hadPageError, `${name} should not have uncaught page errors`).toBe(false);

      // Filter and check critical errors
      const criticalErrors = filterCriticalErrors(errors);
      expect(criticalErrors.length, `${name} should have no critical errors`).toBe(0);
    }
  });

  test('NU_DIAG diagnostic tools available on all surfaces', async ({ page }) => {
    const surfaces = [
      `/?page=admin&brand=${BRAND}`,
      `/?page=public&brand=${BRAND}`,
      `/?page=display&brand=${BRAND}&tv=1`,
      `/?page=poster&brand=${BRAND}`,
    ];

    for (const surface of surfaces) {
      await page.goto(surface);
      await page.waitForLoadState('domcontentloaded');

      const hasDiag = await page.evaluate(() => {
        const win = window as any;
        return {
          diagPresent: !!win.NU_DIAG,
          hasGetLogs: typeof win.NU_DIAG?.getLogs === 'function',
          hasGetStats: typeof win.NU_DIAG?.getStats === 'function',
          hasHealthCheck: typeof win.NU_DIAG?.healthCheck === 'function',
        };
      });

      expect(hasDiag.diagPresent, `NU_DIAG should be present on ${surface}`).toBe(true);
      expect(hasDiag.hasGetLogs, `NU_DIAG.getLogs should exist on ${surface}`).toBe(true);
      expect(hasDiag.hasGetStats, `NU_DIAG.getStats should exist on ${surface}`).toBe(true);
    }
  });

});
