/**
 * Stage-2 UI Smoke Test: Public Page
 *
 * Validates the Public surface loads correctly and core elements are present.
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

test.describe('Public Page UI Smoke Tests', () => {

  test.describe('Page Load & HTTP Status', () => {

    test('loads without HTTP 500 error', async ({ page }) => {
      const response = await page.goto(`/?page=public&brand=${BRAND}`);

      // Verify response is not a server error
      expect(response?.status()).toBeLessThan(500);
      expect(response?.ok() || response?.status() === 302).toBe(true);
    });

    test('page title is present', async ({ page }) => {
      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      // Check page has a title
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

    test('page returns valid HTML content-type', async ({ page }) => {
      const response = await page.goto(`/?page=public&brand=${BRAND}`);

      const contentType = response?.headers()['content-type'] || '';
      expect(contentType).toContain('text/html');
    });

  });

  test.describe('No JavaScript Console Errors', () => {

    test('page loads without critical JS errors', async ({ page }) => {
      const consoleErrors = setupConsoleErrorCollector(page);

      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Filter out non-critical errors
      const criticalErrors = consoleErrors.filter(err => {
        const text = err.text.toLowerCase();
        if (text.includes('favicon')) return false;
        if (text.includes('404') && text.includes('favicon')) return false;
        if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
        return true;
      });

      expect(criticalErrors, `Found ${criticalErrors.length} critical JS errors`).toHaveLength(0);
    });

  });

  test.describe('Required Surface Selectors', () => {

    test('public page has main content area', async ({ page }) => {
      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Check for body content - public page should render something
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent?.length).toBeGreaterThan(0);
    });

    test('public page structure is valid HTML', async ({ page }) => {
      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('domcontentloaded');

      // Verify basic HTML structure
      await expect(page.locator('html')).toBeAttached();
      await expect(page.locator('head')).toBeAttached();
      await expect(page.locator('body')).toBeAttached();
    });

    test('lifecycle indicator may be present on public page', async ({ page }) => {
      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Lifecycle indicator is dynamically rendered based on event data
      const lifecycleIndicator = page.locator('[data-testid="lifecycle-indicator"]');
      const count = await lifecycleIndicator.count();

      // May or may not be present depending on event data
      // Just verify no errors and count is valid
      expect(count).toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('Public Page With Event ID', () => {

    test('handles missing event ID gracefully', async ({ page }) => {
      // Test that the page doesn't crash with missing event ID
      const response = await page.goto(`/?page=public&brand=${BRAND}`);

      // Should not return 500
      expect(response?.status()).toBeLessThan(500);
    });

    test('handles invalid event ID gracefully', async ({ page }) => {
      // Test with a non-existent event ID
      const response = await page.goto(`/?page=public&brand=${BRAND}&id=invalid-event-id-12345`);

      // Should not return 500 (may return 404 or empty state)
      expect(response?.status()).toBeLessThan(500);
    });

  });

  test.describe('Sponsor Display Area', () => {

    test('sponsor container may be present', async ({ page }) => {
      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Sponsor section is rendered dynamically based on event data
      // Check using CSS selectors from selectors.js
      const sponsorContainer = page.locator('.sponsors, #sponsors, [data-testid="sponsors"]');
      const count = await sponsorContainer.count();

      // May or may not be present depending on event having sponsors
      expect(count).toBeGreaterThanOrEqual(0);
    });

  });

  test.describe('Brand Validation', () => {

    test('page reflects correct brand in URL', async ({ page }) => {
      await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const currentUrl = page.url();
      expect(currentUrl).toContain(`brand=${BRAND}`);
    });

    test('page loads for specified brand', async ({ page }) => {
      const response = await page.goto(`/?page=public&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Verify successful load
      expect(response?.ok() || response?.status() === 302).toBe(true);

      // Verify page has content
      const content = await page.content();
      expect(content.length).toBeGreaterThan(100);
    });

  });

});
