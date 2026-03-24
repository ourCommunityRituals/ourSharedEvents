/**
 * Reusable Test Fixtures
 *
 * Sustainability: Eliminates code duplication across 20+ test files
 * Easy to understand: Clear fixture names describe what they provide
 * Mobile support: Handles mobile-specific behaviors automatically
 *
 * Story 1.3: Includes request logging for first navigation and first API request
 */

import { test as base, expect } from '@playwright/test';
import { config, getPageUrl, isMobile } from './config';

// Story 1.3: Import request logger for tracking origins
const { createRequestLogger } = require('../config/runtime-logger');

/**
 * Extended test with custom fixtures
 */
export const test = base.extend({
  /**
   * Request logger fixture (Story 1.3)
   * Tracks first navigation URL and first API request host
   *
   * Usage:
   *   test('tracks requests', async ({ page, requestLogger }) => {
   *     await page.goto(url);
   *     requestLogger.logSummary(); // Logs first navigation and API request
   *   });
   */
  requestLogger: async ({ page }, use) => {
    const logger = createRequestLogger();

    // Attach request/response handlers
    page.on('request', (request) => logger.onRequest(request));
    page.on('response', (response) => logger.onResponse(response));

    // Provide logger to test
    await use(logger);

    // Log summary after test completes (Story 1.3 requirement)
    logger.logSummary();
  },

  /**
   * Authenticated admin page fixture
   * Handles dialog prompts automatically and navigates to admin page
   * Story 1.3: Includes request logging
   *
   * Usage:
   *   test('create event', async ({ authenticatedAdminPage }) => {
   *     // Already on admin page with auth handler set up!
   *   });
   */
  authenticatedAdminPage: async ({ page }, use) => {
    // Story 1.3: Set up request logging
    const logger = createRequestLogger();
    page.on('request', (request) => logger.onRequest(request));
    page.on('response', (response) => logger.onResponse(response));

    // Set up dialog handler BEFORE any interactions
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(config.adminKey);
      } else if (dialog.type() === 'alert') {
        await dialog.accept();
      }
    });

    // Navigate to admin page
    const url = getPageUrl('admin');
    await page.goto(url);

    // Wait for page to be ready (auto-waits for network idle)
    await page.waitForLoadState('networkidle');

    // Story 1.3: Log first navigation and API request
    logger.logSummary();

    // Provide page to test
    await use(page);

    // Cleanup happens automatically after test
  },

  /**
   * Public events page fixture
   * No authentication needed
   * Story 1.3: Includes request logging
   *
   * Usage:
   *   test('view events', async ({ publicPage }) => {
   *     // Already on public events page!
   *   });
   */
  publicPage: async ({ page }, use) => {
    // Story 1.3: Set up request logging
    const logger = createRequestLogger();
    page.on('request', (request) => logger.onRequest(request));
    page.on('response', (response) => logger.onResponse(response));

    const url = getPageUrl('events');
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // Story 1.3: Log first navigation and API request
    logger.logSummary();

    await use(page);
  },

  /**
   * Display/TV page fixture
   * For testing digital signage views
   * Story 1.3: Includes request logging
   *
   * Usage:
   *   test('display carousel', async ({ displayPage }) => {
   *     // Already on display page!
   *   });
   */
  displayPage: async ({ page }, use) => {
    // Story 1.3: Set up request logging
    const logger = createRequestLogger();
    page.on('request', (request) => logger.onRequest(request));
    page.on('response', (response) => logger.onResponse(response));

    const url = getPageUrl('display');
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // Story 1.3: Log first navigation and API request
    logger.logSummary();

    await use(page);
  },

  /**
   * Mobile helper fixture
   * Provides mobile-specific utilities
   *
   * Usage:
   *   test('mobile navigation', async ({ page, mobile }) => {
   *     if (mobile.isMobile) {
   *       await mobile.openMenu(); // Handle hamburger menu
   *     }
   *   });
   */
  mobile: async ({ page }, use) => {
    const mobileHelpers = {
      isMobile: isMobile(page),

      /**
       * Open mobile menu (if hamburger exists)
       */
      async openMenu() {
        if (this.isMobile) {
          const menuButton = page.locator('[data-testid="mobile-menu-button"], .hamburger, button[aria-label="Menu"]');
          if (await menuButton.isVisible()) {
            await menuButton.click();
          }
        }
      },

      /**
       * Scroll to element (mobile may need extra scrolling)
       */
      async scrollTo(selector) {
        const element = page.locator(selector);
        await element.scrollIntoViewIfNeeded();

        // Mobile: Extra scroll to account for fixed headers
        if (this.isMobile) {
          await page.evaluate(() => window.scrollBy(0, -100));
        }
      },

      /**
       * Wait for element to be tappable (visible + stable)
       */
      async waitForTappable(selector) {
        const element = page.locator(selector);
        await expect(element).toBeVisible();

        // Mobile: Wait for any animations to complete
        if (this.isMobile) {
          await page.waitForTimeout(300); // Short wait for transitions
        }

        return element;
      },
    };

    await use(mobileHelpers);
  },

  /**
   * API helper fixture
   * For making direct API calls without UI
   *
   * Usage:
   *   test('create event via API', async ({ api }) => {
   *     // CANONICAL: Uses api_saveEvent (ZEVENT-003)
   *     const eventId = await api.createEvent('Test Event');
   *   });
   */
  api: async ({ request }, use) => {
    const apiHelpers = {
      /**
       * Make API call to backend
       */
      async call(endpoint, data = {}) {
        const response = await request.post(config.baseUrl, {
          data: {
            p: endpoint,
            brand: config.brandId,
            adminKey: config.adminKey,
            ...data,
          },
        });

        return await response.json();
      },

      /**
       * Create test event using canonical api_saveEvent (ZEVENT-003)
       * @returns {Promise<string>} Event ID
       */
      async createEvent(name = null) {
        const eventName = name || config.testData.event.name();
        // CANONICAL API: api_saveEvent (ZEVENT-003)
        // Pass full event object per EVENT_CONTRACT.md
        const response = await this.call('saveEvent', {
          scope: 'events',
          event: {
            name: eventName,
            startDateISO: config.testData.event.date,  // v2.0 canonical field
            venue: 'Test Venue',                        // v2.0 canonical field
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to create event: ${response.message}`);
        }

        return response.value.id;
      },

      /**
       * Delete test event
       */
      async deleteEvent(eventId) {
        const response = await this.call('delete', {
          scope: 'events',
          id: eventId,
        });

        if (!response.ok) {
          console.warn(`Failed to delete event ${eventId}: ${response.message}`);
        }
      },
    };

    await use(apiHelpers);
  },
});

/**
 * Export expect for convenience
 */
export { expect };

/**
 * Custom matchers for mobile testing
 */
expect.extend({
  /**
   * Check if element is visible in mobile viewport
   */
  async toBeVisibleInViewport(locator) {
    const box = await locator.boundingBox();
    const viewport = await locator.page().viewportSize();

    const isVisible =
      box &&
      box.y >= 0 &&
      box.y + box.height <= viewport.height &&
      box.x >= 0 &&
      box.x + box.width <= viewport.width;

    return {
      pass: isVisible,
      message: () =>
        isVisible
          ? 'Element is visible in viewport'
          : 'Element is outside viewport bounds',
    };
  },
});
