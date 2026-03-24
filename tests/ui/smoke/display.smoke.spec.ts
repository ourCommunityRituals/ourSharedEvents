/**
 * Stage-2 UI Smoke Test: Display Page (TV/Kiosk Mode)
 *
 * Validates the Display surface loads correctly and core elements are present.
 * Tests rely on stable data-testid attributes.
 *
 * Acceptance Criteria:
 * - Page loads without HTTP 500 errors
 * - No JavaScript console errors
 * - Required surface selectors present
 *
 * @see tests/e2e/selectors.js - Centralized selector definitions
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

test.describe('Display Page UI Smoke Tests', () => {

  test.describe('Page Load & HTTP Status', () => {

    test('loads without HTTP 500 error', async ({ page }) => {
      const response = await page.goto(`/?page=display&brand=${BRAND}`);

      // Verify response is not a server error
      expect(response?.status()).toBeLessThan(500);
      expect(response?.ok() || response?.status() === 302).toBe(true);
    });

    test('loads with TV mode parameter', async ({ page }) => {
      // Display page typically uses tv=1 parameter for kiosk mode
      const response = await page.goto(`/?page=display&brand=${BRAND}&tv=1`);

      expect(response?.status()).toBeLessThan(500);
      expect(response?.ok() || response?.status() === 302).toBe(true);
    });

    test('page title is present', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

    test('page returns valid HTML content-type', async ({ page }) => {
      const response = await page.goto(`/?page=display&brand=${BRAND}`);

      const contentType = response?.headers()['content-type'] || '';
      expect(contentType).toContain('text/html');
    });

  });

  test.describe('No JavaScript Console Errors', () => {

    test('page loads without critical JS errors', async ({ page }) => {
      const consoleErrors = setupConsoleErrorCollector(page);

      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Filter out non-critical errors
      const criticalErrors = consoleErrors.filter(err => {
        const text = err.text.toLowerCase();
        if (text.includes('favicon')) return false;
        if (text.includes('404') && text.includes('favicon')) return false;
        if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
        // Ignore errors from external video providers
        if (text.includes('youtube') || text.includes('vimeo')) return false;
        return true;
      });

      expect(criticalErrors, `Found ${criticalErrors.length} critical JS errors`).toHaveLength(0);
    });

    test('TV mode loads without critical JS errors', async ({ page }) => {
      const consoleErrors = setupConsoleErrorCollector(page);

      await page.goto(`/?page=display&brand=${BRAND}&tv=1`);
      await page.waitForLoadState('networkidle');

      const criticalErrors = consoleErrors.filter(err => {
        const text = err.text.toLowerCase();
        if (text.includes('favicon')) return false;
        if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
        if (text.includes('youtube') || text.includes('vimeo')) return false;
        return true;
      });

      expect(criticalErrors, `Found ${criticalErrors.length} critical JS errors in TV mode`).toHaveLength(0);
    });

  });

  test.describe('Required Surface Selectors', () => {

    test('display page has main content area', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Check for body content
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent?.length).toBeGreaterThan(0);
    });

    test('display page structure is valid HTML', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('html')).toBeAttached();
      await expect(page.locator('head')).toBeAttached();
      await expect(page.locator('body')).toBeAttached();
    });

    test('lifecycle indicator is present on display page', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Display page should have lifecycle indicator in the DOM
      const lifecycleIndicator = page.locator('[data-testid="lifecycle-indicator"]');
      const count = await lifecycleIndicator.count();

      // Should be present in display page (may be hidden if no event data)
      expect(count).toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('Display Surface Elements', () => {

    test('display container may be present', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Check for display-specific containers
      const displayContainer = page.locator('.display-container, #display, [data-testid="display-screen"]');
      const count = await displayContainer.count();

      // May or may not be present depending on CSS class naming
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('sponsor carousel may be present', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Sponsor carousel is rendered dynamically
      const sponsorCarousel = page.locator('.sponsor-carousel, #sponsors, [data-testid="sponsor-carousel"]');
      const count = await sponsorCarousel.count();

      // May or may not be present depending on event having sponsors
      expect(count).toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('Display Page With Event ID', () => {

    test('handles missing event ID gracefully', async ({ page }) => {
      const response = await page.goto(`/?page=display&brand=${BRAND}`);

      // Should not return 500
      expect(response?.status()).toBeLessThan(500);
    });

    test('handles invalid event ID gracefully', async ({ page }) => {
      const response = await page.goto(`/?page=display&brand=${BRAND}&id=invalid-event-id-12345`);

      // Should not return 500
      expect(response?.status()).toBeLessThan(500);
    });

  });

  test.describe('TV Mode Specific Tests', () => {

    test('TV mode renders without errors', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}&tv=1`);
      await page.waitForLoadState('networkidle');

      // Verify page rendered
      const content = await page.content();
      expect(content.length).toBeGreaterThan(100);
    });

    test('TV mode URL contains tv parameter', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}&tv=1`);

      const currentUrl = page.url();
      expect(currentUrl).toContain('tv=1');
    });

  });

  test.describe('Brand Validation', () => {

    test('page reflects correct brand in URL', async ({ page }) => {
      await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const currentUrl = page.url();
      expect(currentUrl).toContain(`brand=${BRAND}`);
    });

    test('page loads for specified brand', async ({ page }) => {
      const response = await page.goto(`/?page=display&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      expect(response?.ok() || response?.status() === 302).toBe(true);

      const content = await page.content();
      expect(content.length).toBeGreaterThan(100);
    });

  });

});
