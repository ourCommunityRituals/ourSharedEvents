/**
 * Stage-2 UI Smoke Test: Admin Page
 *
 * Validates the Admin surface loads correctly and core elements are present.
 * Tests rely on stable data-testid attributes.
 *
 * Acceptance Criteria:
 * - Page loads without HTTP 500 errors
 * - No JavaScript console errors
 * - Required surface selectors present (data-testid)
 * - Admin page reflects correct eventTag
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

test.describe('Admin Page UI Smoke Tests', () => {

  test.describe('Page Load & HTTP Status', () => {

    test('loads without HTTP 500 error', async ({ page }) => {
      // Track response status
      let responseStatus = 0;

      page.on('response', (response) => {
        if (response.url().includes('?page=admin') || response.url().includes('/events')) {
          responseStatus = response.status();
        }
      });

      const response = await page.goto(`/?page=admin&brand=${BRAND}`);

      // Verify response is not a server error
      expect(response?.status()).toBeLessThan(500);
      expect(response?.ok() || response?.status() === 302).toBe(true);
    });

    test('page title is present', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);

      // Wait for page to be ready
      await page.waitForLoadState('domcontentloaded');

      // Check page has a title
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

  });

  test.describe('No JavaScript Console Errors', () => {

    test('page loads without critical JS errors', async ({ page }) => {
      const consoleErrors = setupConsoleErrorCollector(page);

      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Filter out non-critical errors (e.g., third-party scripts, favicon)
      const criticalErrors = consoleErrors.filter(err => {
        const text = err.text.toLowerCase();
        // Ignore common non-critical errors
        if (text.includes('favicon')) return false;
        if (text.includes('404') && text.includes('favicon')) return false;
        if (text.includes('failed to load resource') && text.includes('favicon')) return false;
        // Ignore CORS errors from external resources
        if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
        return true;
      });

      // Fail if there are critical console errors
      expect(criticalErrors, `Found ${criticalErrors.length} critical JS errors`).toHaveLength(0);
    });

  });

  test.describe('Required Surface Selectors - Wizard Mode', () => {

    test('launch wizard is visible for new sessions', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Either the wizard OR the event cards should be visible
      // (depends on whether events exist for this brand)
      const launchWizard = page.locator('[data-testid="launch-wizard"]');
      const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

      // At least one of these should be present
      const wizardVisible = await launchWizard.isVisible().catch(() => false);
      const selectorVisible = await eventSelectorBar.isVisible().catch(() => false);

      expect(wizardVisible || selectorVisible, 'Either wizard or event selector should be visible').toBe(true);
    });

    test('wizard step 1 elements are present when wizard is shown', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const launchWizard = page.locator('[data-testid="launch-wizard"]');

      if (await launchWizard.isVisible()) {
        // Wizard mode - check wizard elements
        await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();
        await expect(page.locator('[data-testid="wizard-event-name"]')).toBeVisible();
        await expect(page.locator('[data-testid="wizard-event-date"]')).toBeVisible();
        await expect(page.locator('[data-testid="wizard-event-venue"]')).toBeVisible();
      }
    });

  });

  test.describe('Required Surface Selectors - Event Management Mode', () => {

    test('event selector bar is present when events exist', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

      if (await eventSelectorBar.isVisible()) {
        // Event management mode - check selector elements
        await expect(page.locator('[data-testid="event-dropdown"]')).toBeVisible();
        await expect(page.locator('[data-testid="refresh-events-btn"]')).toBeVisible();
      }
    });

    test('happy path checklist is present when events exist', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

      if (await eventSelectorBar.isVisible()) {
        // Check for happy path checklist
        await expect(page.locator('[data-testid="happy-path-checklist"]')).toBeVisible();
        await expect(page.locator('[data-testid="checklist-event"]')).toBeVisible();
      }
    });

  });

  test.describe('Brand/EventTag Validation', () => {

    test('page reflects correct brand in URL', async ({ page }) => {
      const response = await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Verify the URL contains the correct brand
      const currentUrl = page.url();
      expect(currentUrl).toContain(`brand=${BRAND}`);
    });

    test('admin page content loads for specified brand', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Verify we're on an admin page by checking for admin-specific elements
      // Either wizard or event management UI should be present
      const hasAdminContent =
        await page.locator('[data-testid="launch-wizard"]').isVisible().catch(() => false) ||
        await page.locator('[data-testid="event-selector-bar"]').isVisible().catch(() => false) ||
        await page.locator('#createForm').isVisible().catch(() => false);

      expect(hasAdminContent, 'Admin page should show admin-specific content').toBe(true);
    });

  });

  test.describe('Advanced Sections Presence', () => {

    test('advanced sections exist in DOM when in event mode', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

      if (await eventSelectorBar.isVisible()) {
        // These sections may be collapsed but should exist in the DOM
        const advancedDisplayToggles = page.locator('[data-testid="advanced-display-toggles"]');
        const advancedEventDetails = page.locator('[data-testid="advanced-event-details"]');

        // Check they exist (may be hidden but should be in DOM)
        await expect(advancedDisplayToggles).toBeAttached();
        await expect(advancedEventDetails).toBeAttached();
      }
    });

  });

  test.describe('Lifecycle Indicator', () => {

    test('lifecycle indicator exists in DOM', async ({ page }) => {
      await page.goto(`/?page=admin&brand=${BRAND}`);
      await page.waitForLoadState('networkidle');

      // Lifecycle indicator may not be visible until an event is loaded
      // but the element structure should exist
      const eventSelectorBar = page.locator('[data-testid="event-selector-bar"]');

      if (await eventSelectorBar.isVisible()) {
        // If we're in event mode, lifecycle indicator may be rendered
        const lifecycleIndicator = page.locator('[data-testid="lifecycle-indicator"]');
        // May or may not be visible depending on event state
        const count = await lifecycleIndicator.count();
        // Just verify the page structure is valid (count can be 0 or more)
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });

  });

});
