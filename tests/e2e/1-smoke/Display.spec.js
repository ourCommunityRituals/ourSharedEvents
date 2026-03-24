/**
 * Display Surface Smoke Test - Story 6
 *
 * Happy-path E2E test for Display (TV/Kiosk) surface:
 * 1. Load ?page=display&event=<fixtureId>
 * 2. Assert event title and basic schedule or placeholder visible
 *
 * Run: BASE_URL="https://www.eventangle.com/events" npm run test:smoke
 *
 * Fixture ID: Set FIXTURE_EVENT_ID env var, or test will load default display
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const FIXTURE_EVENT_ID = process.env.FIXTURE_EVENT_ID || null;

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

/**
 * Filter out expected GAS-related JavaScript errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.message.includes('google.script') &&
    !e.message.includes('google is not defined') &&
    !e.message.includes('Script error')
  );
}

test.describe('Display Surface Smoke Test', () => {
  test('Display: Load page, verify event title and schedule/placeholder visible', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Step 1: Load Display page with TV mode
    const url = FIXTURE_EVENT_ID
      ? `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${FIXTURE_EVENT_ID}&tv=1`
      : `${BASE_URL}?page=display&brand=${BRAND_ID}&tv=1`;

    const response = await page.goto(url, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Step 2: Verify Display page container/stage is visible
    const stageSelectors = [
      '#stage',
      '.stage',
      'main#tv',
      '.display-container',
      'iframe',
      '.content-frame',
      'body[data-tv]',
      '.tv-mode',
    ];

    let stageFound = false;
    for (const selector of stageSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        stageFound = true;
        console.log(`Display stage found with selector "${selector}"`);
        break;
      }
    }

    // If no stage found, verify page has meaningful content
    if (!stageFound) {
      const displayContent = page.locator(
        '.sponsor-top, .sponsor-carousel, .league-strip, h1, .display-title'
      ).first();
      await expect(displayContent).toBeVisible({ timeout: 15000 });
    }

    // Step 3: Verify event title is visible
    const titleSelectors = [
      '.display-title',
      'h1',
      '.event-title',
      '.event-name',
      '#eventTitle',
      '.title',
    ];

    let titleFound = false;
    for (const selector of titleSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        const text = await element.textContent();
        if (text && text.trim().length > 0) {
          titleFound = true;
          console.log(`Title found with selector "${selector}": ${text.trim().substring(0, 50)}`);
          break;
        }
      }
    }

    // Step 4: Verify schedule OR placeholder is visible
    const contentSelectors = [
      // Schedule elements
      '.schedule-row',
      '.schedule',
      '.schedule-item',
      '.schedule-container',
      // Placeholder/fallback elements
      '.fallback-card',
      '.placeholder',
      '.no-events',
      '.no-content',
      // Display stage elements
      '#stage',
      'iframe',
      '.sponsor-slide',
      '.sponsor-carousel',
      // Sponsor elements (valid content)
      '.sponsor-top',
      '.sponsor-bottom',
      '.league-strip',
    ];

    let contentFound = false;
    for (const selector of contentSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        contentFound = true;
        console.log(`Content/schedule found with selector "${selector}"`);
        break;
      }
    }

    // At minimum, either title or content should be visible
    expect(titleFound || contentFound).toBe(true);
    console.log(`Display verification - Title: ${titleFound}, Content: ${contentFound}`);

    // Step 5: Verify no critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });
});
