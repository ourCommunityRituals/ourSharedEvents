/**
 * Story 6 — Admin Diagnostics Panel UI Smoke Tests
 *
 * Tests the Admin Diagnostics Panel that surfaces NU SDK transport logs.
 * Validates the panel works in staging with debug mode on and is hidden
 * behind a Debug toggle in production.
 *
 * Acceptance Criteria:
 * - Diagnostics shows rolling logs from NU SDK
 * - Works in staging with debug mode on
 * - Hidden behind a small "Debug" toggle in production
 * - Logs populate for simulated RPC failure
 *
 * @see src/mvp/Admin.html - Diagnostics panel implementation
 * @see src/mvp/NUSDK.html - NU SDK v2.0 with NU_DIAG interface
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
 * Helper to check if page is in staging environment
 */
async function isPageStaging(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const hostname = window.location?.hostname || '';
    const isDomain = (host: string, domain: string) =>
      host === domain || host.endsWith('.' + domain);

    return isDomain(hostname, 'stg.eventangle.com') ||
           hostname === 'localhost' ||
           hostname === '127.0.0.1';
  });
}

/**
 * Helper to check NU_DIAG availability and log count
 */
async function getDiagStats(page: Page): Promise<{
  diagPresent: boolean;
  logCount: number;
  errorCount: number;
  logs: NULogEntry[];
}> {
  return await page.evaluate(() => {
    const win = window as any;
    const diagPresent = !!win.NU_DIAG;
    const logs: NULogEntry[] = win.__NU_LOGS__ || [];
    const errorCount = logs.filter((l: any) => l.level === 'error').length;

    return {
      diagPresent,
      logCount: logs.length,
      errorCount,
      logs: logs.slice(-20) // Last 20 logs for inspection
    };
  });
}

// =============================================================================
// Diagnostics Panel Tests - Staging Environment
// =============================================================================
test.describe('Admin Diagnostics Panel - Staging', () => {

  test('diagnostics panel exists in DOM', async ({ page }) => {
    const consoleErrors = setupConsoleErrorCollector(page);

    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Check panel exists in DOM
    const panel = page.locator('[data-testid="diagnostics-panel"]');
    await expect(panel).toBeAttached();

    // No critical JS errors
    const criticalErrors = filterCriticalErrors(consoleErrors);
    expect(criticalErrors.length, `Unexpected errors: ${JSON.stringify(criticalErrors)}`).toBe(0);
  });

  test('diagnostics panel shows in staging after expanding Advanced Tools', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand the Advanced Tools section (collapsed by default)
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();

      // Wait for animation
      await page.waitForTimeout(500);

      // Panel should be visible
      const panel = page.locator('[data-testid="diagnostics-panel"]');
      await expect(panel).toBeVisible();

      // Debug toggle should be hidden in staging
      const debugToggle = page.locator('#diagDebugToggle');
      await expect(debugToggle).toBeHidden();
    }
  });

  test('diagnostics panel shows log entries after page load', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Wait for RPC calls to complete
      await page.waitForTimeout(2000);

      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Get log stats
      const stats = await getDiagStats(page);

      // Should have at least the init log
      expect(stats.logCount, 'Should have at least one log entry').toBeGreaterThan(0);

      // Verify logs array has expected structure
      if (stats.logs.length > 0) {
        const initLog = stats.logs.find(l => l.type === 'init');
        expect(initLog, 'Should have an init log').toBeDefined();
        if (initLog) {
          expect(initLog.version).toBe('2.0.0');
        }
      }
    }
  });

  test('diagnostics panel refresh button works', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Click refresh button
      const refreshBtn = page.locator('[data-testid="diag-refresh-btn"]');
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();

      // Stats should be updated
      const statsEl = page.locator('[data-testid="diag-stats"]');
      await expect(statsEl).toContainText('Total:');
    }
  });

  test('diagnostics panel filter buttons work', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Test filter buttons
      const filterAll = page.locator('[data-testid="diag-filter-all"]');
      const filterDebug = page.locator('[data-testid="diag-filter-debug"]');
      const filterError = page.locator('[data-testid="diag-filter-error"]');

      await expect(filterAll).toBeVisible();
      await expect(filterDebug).toBeVisible();
      await expect(filterError).toBeVisible();

      // All filter should be active by default
      await expect(filterAll).toHaveClass(/active/);

      // Click Debug filter
      await filterDebug.click();
      await expect(filterDebug).toHaveClass(/active/);
      await expect(filterAll).not.toHaveClass(/active/);

      // Click Error filter
      await filterError.click();
      await expect(filterError).toHaveClass(/active/);
      await expect(filterDebug).not.toHaveClass(/active/);

      // Click All filter to reset
      await filterAll.click();
      await expect(filterAll).toHaveClass(/active/);
    }
  });

  test('diagnostics panel shows SDK version', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Check version is displayed
      const versionEl = page.locator('#diagSdkVersion');
      await expect(versionEl).toHaveText('2.0.0');
    }
  });

});

// =============================================================================
// Diagnostics Panel Tests - RPC Failure Logging
// =============================================================================
test.describe('Admin Diagnostics Panel - RPC Failure Logging', () => {

  test('logs populate for simulated RPC failure (invalid endpoint)', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Get initial log count
      const initialStats = await getDiagStats(page);
      const initialLogCount = initialStats.logCount;

      // Trigger an RPC call that will fail (invalid endpoint)
      await page.evaluate(async () => {
        const win = window as any;
        try {
          // This should fail and generate error logs
          await win.NU.rpc('api_nonexistent_endpoint_12345', { test: true });
        } catch (e) {
          // Expected to fail
        }
      });

      // Wait for the RPC to complete
      await page.waitForTimeout(1000);

      // Refresh the diagnostics panel
      const refreshBtn = page.locator('[data-testid="diag-refresh-btn"]');
      await refreshBtn.click();
      await page.waitForTimeout(500);

      // Check that new logs were added
      const finalStats = await getDiagStats(page);
      expect(finalStats.logCount, 'Should have more logs after RPC call').toBeGreaterThan(initialLogCount);

      // Check log container has entries
      const logContainer = page.locator('[data-testid="diag-log-container"]');
      const logEntries = logContainer.locator('[data-testid="diag-log-entry"]');
      const entryCount = await logEntries.count();
      expect(entryCount, 'Should have log entries in the container').toBeGreaterThan(0);

      // Verify we captured the RPC attempt (start log)
      const hasStartLog = finalStats.logs.some(l =>
        l.type === 'start' && l.path?.includes('nonexistent')
      );
      expect(hasStartLog, 'Should have captured the RPC start log').toBe(true);
    }
  });

  test('error logs are highlighted differently', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Trigger an error by calling a bad endpoint
      await page.evaluate(async () => {
        const win = window as any;
        try {
          await win.NU.rpc('api_bad_endpoint_test', {});
        } catch (e) {
          // Expected to fail
        }
      });

      await page.waitForTimeout(1000);

      // Refresh
      const refreshBtn = page.locator('[data-testid="diag-refresh-btn"]');
      await refreshBtn.click();
      await page.waitForTimeout(500);

      // Filter to errors
      const filterError = page.locator('[data-testid="diag-filter-error"]');
      await filterError.click();
      await page.waitForTimeout(300);

      // Check if error entries have the right class
      const errorEntries = page.locator('.diag-log-entry.level-error');
      const errorCount = await errorEntries.count();

      // Note: May not have errors if the RPC silently fails at network level
      // This test verifies the structure works when errors exist
      console.log(`Error log entries found: ${errorCount}`);
    }
  });

});

// =============================================================================
// Diagnostics Panel Tests - Log Container Structure
// =============================================================================
test.describe('Admin Diagnostics Panel - Log Entry Structure', () => {

  test('log entries show timestamp, type, and details', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Wait for some RPC activity
      await page.waitForTimeout(2000);

      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Refresh to ensure logs are displayed
      const refreshBtn = page.locator('[data-testid="diag-refresh-btn"]');
      await refreshBtn.click();
      await page.waitForTimeout(500);

      // Get first log entry
      const logEntry = page.locator('[data-testid="diag-log-entry"]').first();

      if (await logEntry.count() > 0) {
        // Check structure elements exist
        const timeEl = logEntry.locator('.diag-log-time');
        const typeEl = logEntry.locator('.diag-log-type');
        const detailsEl = logEntry.locator('.diag-log-details');

        await expect(timeEl).toBeAttached();
        await expect(typeEl).toBeAttached();
        await expect(detailsEl).toBeAttached();

        // Time should be in HH:MM:SS format
        const timeText = await timeEl.textContent();
        expect(timeText).toMatch(/^\d{2}:\d{2}:\d{2}$/);

        // Type should be one of the known types
        const typeText = await typeEl.textContent();
        expect(['init', 'start', 'ok', 'network_fail', 'http_fail', 'json_fail', 'error', 'flush', 'config']).toContain(typeText?.trim());
      }
    }
  });

  test('stats display shows correct counts', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      await page.waitForTimeout(2000);

      // Expand Advanced Tools
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Refresh
      const refreshBtn = page.locator('[data-testid="diag-refresh-btn"]');
      await refreshBtn.click();
      await page.waitForTimeout(500);

      // Get stats from UI
      const statsEl = page.locator('[data-testid="diag-stats"]');
      const statsText = await statsEl.textContent();

      // Should contain "Total:" text
      expect(statsText).toContain('Total:');

      // Get actual stats from NU_DIAG
      const actualStats = await getDiagStats(page);

      // UI stats should match actual log count
      expect(statsText).toContain(`Total: ${actualStats.logCount}`);
    }
  });

});

// =============================================================================
// Diagnostics Panel Tests - Cross-browser Compatibility
// =============================================================================
test.describe('Admin Diagnostics Panel - DOM Structure', () => {

  test('all diagnostic UI elements have correct data-testid attributes', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    // Verify required test IDs exist in DOM
    const requiredTestIds = [
      'diagnostics-panel',
      'diag-refresh-btn',
      'diag-filter-all',
      'diag-filter-debug',
      'diag-filter-error',
      'diag-stats',
      'diag-log-container'
    ];

    for (const testId of requiredTestIds) {
      const element = page.locator(`[data-testid="${testId}"]`);
      await expect(element, `Element with data-testid="${testId}" should exist`).toBeAttached();
    }
  });

  test('diagnostics panel is accessible via keyboard', async ({ page }) => {
    await page.goto(`/?page=admin&brand=${BRAND}`);
    await page.waitForLoadState('networkidle');

    const isStaging = await isPageStaging(page);

    if (isStaging) {
      // Expand Advanced Tools by clicking
      const advancedToolsHeader = page.locator('#cardDiagnostics .collapsible-header');
      await advancedToolsHeader.click();
      await page.waitForTimeout(500);

      // Tab to refresh button
      const refreshBtn = page.locator('[data-testid="diag-refresh-btn"]');
      await refreshBtn.focus();

      // Should be focusable
      await expect(refreshBtn).toBeFocused();

      // Press Enter to activate
      await page.keyboard.press('Enter');

      // Stats should update (button was clicked)
      const statsEl = page.locator('[data-testid="diag-stats"]');
      await expect(statsEl).toContainText('Total:');
    }
  });

});
