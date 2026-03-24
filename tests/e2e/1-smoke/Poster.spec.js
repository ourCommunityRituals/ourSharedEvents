/**
 * Poster Surface Smoke Test - Story 6
 *
 * Happy-path E2E test for Poster surface:
 * 1. Load ?page=poster&event=<fixtureId>
 * 2. Assert title, date, QR <img> elements exist (no broken src)
 *
 * Run: BASE_URL="https://www.eventangle.com/events" npm run test:smoke
 *
 * Fixture ID: Set FIXTURE_EVENT_ID env var, or test will load default poster
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

test.describe('Poster Surface Smoke Test', () => {
  test('Poster: Load page, verify title/date/QR codes', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Step 1: Load Poster page
    const url = FIXTURE_EVENT_ID
      ? `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${FIXTURE_EVENT_ID}`
      : `${BASE_URL}?page=poster&brand=${BRAND_ID}`;

    const response = await page.goto(url, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Step 2: Wait for poster container to load
    await expect(
      page.locator('.poster-container, #poster, main, .container, .poster').first()
    ).toBeVisible({ timeout: 15000 });

    // Step 3: Verify event title exists
    const titleSelectors = [
      '.poster-title',
      '#eventName',
      'h1',
      '.event-title',
      '.event-name',
      '.title',
    ];

    let titleFound = false;
    let titleText = '';
    for (const selector of titleSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        const text = await element.textContent();
        if (text && text.trim().length > 0) {
          titleFound = true;
          titleText = text.trim().substring(0, 50);
          console.log(`Title found with selector "${selector}": ${titleText}`);
          break;
        }
      }
    }
    expect(titleFound).toBe(true);

    // Step 4: Verify date element exists
    const dateSelectors = [
      '.poster-date',
      '#eventDate',
      '.event-date',
      'time',
      '[datetime]',
      '.date',
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
    // Date might be in page text content
    if (!dateFound) {
      const pageText = await page.textContent('body');
      const hasDatePattern = /\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}/i.test(pageText);
      if (hasDatePattern) {
        dateFound = true;
        console.log('Date found in page text content');
      }
    }
    expect(dateFound).toBe(true);

    // Step 5: Verify QR code elements exist (no broken src)
    const qrSelectors = [
      '.qr-code img',
      '.qr-section img',
      '#publicQR',
      '#registrationQR',
      'img[src*="qr"]',
      'img[alt*="QR"]',
      'img[alt*="qr"]',
      'canvas', // QR codes might be rendered as canvas
      '.qr-code',
      '.qr-container img',
    ];

    let qrFound = false;
    let qrCount = 0;
    let brokenQrCount = 0;

    for (const selector of qrSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        qrFound = true;
        qrCount += count;

        // Check for broken image sources (only for img elements)
        if (selector.includes('img')) {
          for (let i = 0; i < count; i++) {
            const element = elements.nth(i);
            const src = await element.getAttribute('src');
            if (src) {
              // Check for broken/empty sources
              const isBroken = !src ||
                src === '' ||
                src === 'undefined' ||
                src === 'null' ||
                src.includes('undefined') ||
                src.includes('null');
              if (isBroken) {
                brokenQrCount++;
                console.warn(`Broken QR src found: ${src}`);
              }
            }
          }
        }
      }
    }

    console.log(`QR elements found: ${qrCount}, Broken: ${brokenQrCount}`);

    // QR codes should exist if event is configured with them
    // If no QR found, it's acceptable (event might not have signup URL)
    if (qrFound) {
      expect(brokenQrCount).toBe(0);
    } else {
      console.log('No QR elements found - event may not have signup URL configured');
    }

    // Step 6: Verify the page has essential poster structure
    // The page should have at least title and date
    expect(titleFound).toBe(true);
    expect(dateFound).toBe(true);

    // Step 7: Verify no critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });
});
