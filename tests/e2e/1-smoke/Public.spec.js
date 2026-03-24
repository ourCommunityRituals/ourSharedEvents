/**
 * Public Surface Smoke Test - Story 6
 *
 * Happy-path E2E test for Public surface:
 * 1. Load ?page=public&event=<fixtureId>
 * 2. Assert title, date, and at least one section render
 *
 * Run: BASE_URL="https://www.eventangle.com/events" npm run test:smoke
 *
 * Fixture ID: Set FIXTURE_EVENT_ID env var, or test will use events list
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

test.describe('Public Surface Smoke Test', () => {
  test('Public: Load page, verify title/date/sections render', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Step 1: Load Public page (with event ID if provided)
    const url = FIXTURE_EVENT_ID
      ? `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${FIXTURE_EVENT_ID}`
      : `${BASE_URL}?page=events&brand=${BRAND_ID}`;

    const response = await page.goto(url, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Step 2: Wait for main container to be visible
    await expect(
      page.locator('.container, main#app, main, [role="main"], .events-container').first()
    ).toBeVisible({ timeout: 15000 });

    // Step 3: Verify title is rendered
    const titleSelectors = [
      '.event-title',
      '.event-name',
      'h1',
      'h2.event-title',
      '.card-title',
      '.event-card h2',
      '.event-card h3',
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
    expect(titleFound).toBe(true);

    // Step 4: Verify date is rendered
    const dateSelectors = [
      '.event-date',
      'time',
      '[datetime]',
      '.date',
      '.event-info time',
      '[class*="date"]',
    ];

    let dateFound = false;
    for (const selector of dateSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        dateFound = true;
        console.log(`Date element found with selector "${selector}"`);
        break;
      }
    }
    // Date might be embedded in text, so check page content as fallback
    if (!dateFound) {
      const pageText = await page.textContent('body');
      // Look for date patterns (YYYY-MM-DD, Month Day, etc.)
      const hasDatePattern = /\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}/i.test(pageText);
      if (hasDatePattern) {
        dateFound = true;
        console.log('Date found in page text content');
      }
    }
    expect(dateFound).toBe(true);

    // Step 5: Verify at least one section renders
    const sectionSelectors = [
      '.section',
      '.event-section',
      '.schedule',
      '.event-info',
      '.event-card',
      '.event-details',
      '.sponsor-banner',
      '.sponsors',
      'article',
      'section',
      '.events-grid > *',
      '.card',
    ];

    let sectionCount = 0;
    for (const selector of sectionSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        sectionCount += count;
      }
    }
    console.log(`Total sections/elements found: ${sectionCount}`);
    expect(sectionCount).toBeGreaterThanOrEqual(1);

    // Step 6: Verify no critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });
});
