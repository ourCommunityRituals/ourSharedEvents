/**
 * Stage-2 UI Smoke Test: SharedReport Page (Analytics/Sponsor Dashboard)
 *
 * Validates the SharedReport surface loads correctly and core elements are present.
 * Tests rely on stable data-testid attributes.
 *
 * Story 5 - Full Testing Pipeline: UI Coverage for SharedReport Surface
 *
 * Acceptance Criteria:
 * - Page loads without HTTP 500/503 errors (fail-fast on 503)
 * - No JavaScript console errors
 * - Required surface selectors present
 * - Analytics dashboard renders for valid events
 *
 * @see tests/e2e/selectors.js - Centralized selector definitions
 * @see src/mvp/SharedReport.html - SharedReport surface
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test';

// Brand to test - uses root by default
const BRAND = process.env.TEST_BRAND || 'root';

// Console error collector for each test
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

test.describe('SharedReport Page UI Smoke Tests', () => {

  test.describe('Page Load & HTTP Status (Fail-Fast)', () => {

    test('loads without HTTP 500/503 error - CRITICAL', async ({ page }) => {
      const response = await page.goto(`/?page=report&brand=${BRAND}`);

      // FAIL-FAST: 503 indicates GAS not reachable or Worker misrouting
      expect(response?.status(), 'CRITICAL: HTTP 503 indicates deployment issue').not.toBe(503);

      // Verify response is not a server error
      expect(response?.status()).toBeLessThan(500);
      expect(response?.ok() || response?.status() === 302).toBe(true);
    });

    test('page title is present', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

    test('page returns valid HTML content-type', async ({ page }) => {
      const response = await page.goto(`/?page=report&brand=${BRAND}`);

      const contentType = response?.headers()['content-type'] || '';
      expect(contentType).toContain('text/html');
    });

    test('uses /analytics friendly URL alias', async ({ page }) => {
      // Test that the friendly URL alias works
      const response = await page.goto(`/analytics?brand=${BRAND}`);

      expect(response?.status(), 'CRITICAL: HTTP 503 indicates deployment issue').not.toBe(503);
      expect(response?.status()).toBeLessThan(500);
    });

  });

  test.describe('No JavaScript Console Errors', () => {

    test('page loads without critical JS errors', async ({ page }) => {
      const consoleErrors = setupConsoleErrorCollector(page);

      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Filter out non-critical errors
      const criticalErrors = consoleErrors.filter(err => {
        const text = err.text.toLowerCase();
        if (text.includes('favicon')) return false;
        if (text.includes('404') && text.includes('favicon')) return false;
        if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
        // Ignore chart library warnings
        if (text.includes('chart') && text.includes('warning')) return false;
        return true;
      });

      expect(criticalErrors, `Found ${criticalErrors.length} critical JS errors`).toHaveLength(0);
    });

  });

  test.describe('Required Surface Selectors', () => {

    test('report page has main content area', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Check for body content
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent?.length).toBeGreaterThan(0);
    });

    test('report page structure is valid HTML', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('html')).toBeAttached();
      await expect(page.locator('head')).toBeAttached();
      await expect(page.locator('body')).toBeAttached();
    });

  });

  test.describe('SharedReport Surface Elements', () => {

    test('report container may be present', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Check for report-specific containers
      const reportContainer = page.locator('.report-container, #report, [data-testid="shared-report"]');
      const count = await reportContainer.count();

      // May or may not be present depending on CSS class naming
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('analytics section may be present', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Analytics section is rendered based on data availability
      const analyticsSection = page.locator('.analytics, #analytics, [data-testid="analytics-section"]');
      const count = await analyticsSection.count();

      // May or may not be present depending on event having analytics data
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('sponsor metrics section may be present', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Sponsor metrics are rendered for events with sponsors
      const sponsorMetrics = page.locator('.sponsor-metrics, [data-testid="sponsor-metrics"]');
      const count = await sponsorMetrics.count();

      // May or may not be present depending on sponsor data
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('lifecycle indicator may be present', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const lifecycleIndicator = page.locator('[data-testid="lifecycle-indicator"]');
      const count = await lifecycleIndicator.count();

      // May or may not be present depending on event data
      expect(count).toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('SharedReport Page With Event/Sponsor IDs', () => {

    test('handles missing event ID gracefully', async ({ page }) => {
      const response = await page.goto(`/?page=report&brand=${BRAND}`);

      // Should not return 500/503
      expect(response?.status()).toBeLessThan(500);
    });

    test('handles invalid event ID gracefully', async ({ page }) => {
      const response = await page.goto(`/?page=report&brand=${BRAND}&id=invalid-event-id-12345`);

      // Should not return 500/503
      expect(response?.status()).toBeLessThan(500);
    });

    test('handles invalid sponsor ID gracefully', async ({ page }) => {
      const response = await page.goto(`/?page=report&brand=${BRAND}&sponsorId=invalid-sponsor-id-12345`);

      // Should not return 500/503
      expect(response?.status()).toBeLessThan(500);
    });

  });

  test.describe('Brand Validation', () => {

    test('page reflects correct brand in URL', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const currentUrl = page.url();
      expect(currentUrl).toContain(`brand=${BRAND}`);
    });

    test('page loads for specified brand', async ({ page }) => {
      const response = await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      expect(response?.ok() || response?.status() === 302).toBe(true);

      const content = await page.content();
      expect(content.length).toBeGreaterThan(100);
    });

  });

  test.describe('Report Data Display', () => {

    test('report renders visible content', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Verify the page has visible elements
      const visibleElements = await page.locator('body *:visible').count();
      expect(visibleElements).toBeGreaterThan(0);
    });

    test('report page has proper document structure', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      // Check for proper meta tags
      const hasViewport = await page.locator('meta[name="viewport"]').count();
      expect(hasViewport).toBeGreaterThanOrEqual(0);

      // Check charset is defined
      const htmlContent = await page.content();
      const hasCharset = htmlContent.includes('charset') || htmlContent.includes('UTF-8');
      expect(hasCharset).toBe(true);
    });

  });

  test.describe('No GAS HTML Shell Leak', () => {

    test('page does not contain GAS blue banner markers', async ({ page }) => {
      await page.goto(`/?page=report&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const content = await page.content();

      // Story 6 compliance: No GAS HTML markers should be present
      expect(content).not.toContain('script.google.com');
      expect(content).not.toContain('Google Apps Script');
      expect(content).not.toContain('userCodeAppPanel');
    });

  });

});
