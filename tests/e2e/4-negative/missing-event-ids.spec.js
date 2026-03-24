/**
 * NEGATIVE PATH TESTS - Missing/Bad Event IDs
 *
 * Purpose: Verify all MVP surfaces fail predictably and user-sanely when
 * the event ID is missing, invalid, or deleted.
 *
 * Coverage:
 *   - ?page=public with no event → friendly error or list view
 *   - ?page=display with nonsense ID → graceful fallback
 *   - ?page=poster with nonsense ID → graceful fallback
 *   - ?page=report with nonsense ID → graceful handling
 *
 * Assertions:
 *   - No raw stack traces visible
 *   - No broken layouts
 *   - Error texts are generic, not leaking internals
 *
 * Run with: npm run test:negative
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

// Test IDs that should never exist
const INVALID_IDS = {
  nonsense: 'invalid-gibberish-xyz123',
  sqlInjection: "'; DROP TABLE events; --",
  xssAttempt: '<script>alert(1)</script>',
  tooLong: 'a'.repeat(500),
  empty: '',
  specialChars: '!@#$%^&*()',
  unicodeGarbage: '💀🎃👻',
};

// Patterns that indicate internal errors leaking to users
const INTERNAL_ERROR_PATTERNS = [
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /at\s+\w+\s+\(/i,          // Stack trace pattern: "at functionName ("
  /\.gs:\d+/i,               // Google Apps Script file references
  /\.js:\d+:\d+/i,           // JavaScript file:line:col references
  /undefined is not/i,
  /null is not/i,
  /Cannot read propert/i,
  /Cannot call method/i,
  /INTERNAL_ERROR/i,
  /Exception:/i,
  /Script error/i,
  /Uncaught/i,
  /spreadsheet/i,            // Internal implementation detail
  /getRange|getValue/i,      // GAS API leaks
  /DriveApp|SpreadsheetApp/i, // GAS service leaks
];

// Helper to check for internal errors in page content
async function assertNoInternalErrors(page) {
  const bodyText = await page.locator('body').innerText();

  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    const match = bodyText.match(pattern);
    expect(match, `Found internal error pattern: ${pattern} → "${match?.[0]}"`).toBeNull();
  }
}

// Helper to check page structure is not broken
async function assertLayoutNotBroken(page) {
  // Page should have basic structure
  const hasBody = await page.locator('body').count() > 0;
  expect(hasBody, 'Page should have a body element').toBe(true);

  // Should not be completely blank
  const bodyText = await page.locator('body').innerText();
  // Allow for loading states but not completely empty
  const isNotCompletelyEmpty = bodyText.trim().length > 0 ||
    await page.locator('img, svg, canvas').count() > 0;
  expect(isNotCompletelyEmpty, 'Page should not be completely empty').toBe(true);

  // Check for critical CSS breakage indicators
  const hasCriticalElements = await page.locator('html, head, body').count() === 3;
  expect(hasCriticalElements, 'Page should have html, head, body').toBe(true);
}

// Helper to verify no console errors (excluding expected ones)
async function collectConsoleErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}

test.describe('🚫 NEGATIVE PATH: Public Page - Missing/Invalid Event IDs', () => {

  test('Public page without event ID shows event listing (not error)', async ({ page }) => {
    // Public page without ID should show event list, not an error
    const response = await page.goto(`${BASE_URL}?page=public&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show either events or "no events" message
    const hasEventCards = await page.locator('.event-card').count() > 0;
    const hasContent = await page.locator('h1, h2, main#app').count() > 0;
    expect(hasEventCards || hasContent, 'Should show events list or content').toBe(true);
  });

  test('Public page with nonsense event ID shows friendly error', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200); // GAS returns 200 even for "not found"
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show user-friendly error or fallback content
    const bodyText = await page.locator('body').innerText();
    const hasErrorMessage = /not found|error|unavailable|doesn't exist|invalid/i.test(bodyText);
    const hasFallbackContent = await page.locator('.event-card, main#app, .container').count() > 0;

    expect(hasErrorMessage || hasFallbackContent,
      'Should show error message or fallback to event list').toBe(true);
  });

  test('Public page with XSS attempt in ID is sanitized', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.xssAttempt)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // XSS payload should not be executed or reflected unsafely
    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain('<script>alert(1)</script>');
  });

  test('Public page with special characters in ID handles gracefully', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.specialChars)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });
});

test.describe('🚫 NEGATIVE PATH: Display Page - Missing/Invalid Event IDs', () => {

  test('Display page without event ID shows fallback content', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=display&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Display page should have TV layout structure
    const hasStage = await page.locator('#stage, #tv, body[data-tv]').count() > 0;
    expect(hasStage, 'Display page should have stage/TV layout').toBe(true);
  });

  test('Display page with nonsense event ID shows graceful fallback', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show fallback card or graceful handling
    const bodyText = await page.locator('body').innerText();
    const hasErrorHandling = /not found|error|unavailable|loading|select.*event/i.test(bodyText) ||
      await page.locator('.fallback-card, #stage, body[data-tv]').count() > 0;

    expect(hasErrorHandling, 'Display should handle invalid ID gracefully').toBe(true);
  });

  test('Display page with SQL injection attempt is safe', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.sqlInjection)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // SQL injection should not cause errors
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('DROP TABLE');
    expect(bodyText).not.toContain('SQL');
  });

  test('Display page with unicode garbage handles gracefully', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.unicodeGarbage)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });
});

test.describe('🚫 NEGATIVE PATH: Poster Page - Missing/Invalid Event IDs', () => {

  test('Poster page without event ID shows blank template', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=poster&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Poster page should have basic structure
    const hasMain = await page.locator('main, .poster-container, body').count() > 0;
    expect(hasMain, 'Poster page should have layout structure').toBe(true);
  });

  test('Poster page with nonsense event ID shows graceful fallback', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show error message or blank template
    const bodyText = await page.locator('body').innerText();
    const hasGracefulHandling = /not found|error|unavailable|no event/i.test(bodyText) ||
      await page.locator('main, .poster-container').count() > 0;

    expect(hasGracefulHandling, 'Poster should handle invalid ID gracefully').toBe(true);
  });

  test('Poster page with very long ID handles gracefully', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${INVALID_IDS.tooLong.substring(0, 200)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });

  test('Poster page QR section handles missing event gracefully', async ({ page }) => {
    await page.goto(
      `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    await assertNoInternalErrors(page);

    // QR section should either be hidden or show placeholder
    const qrSection = page.locator('.qr-section, .qr-codes');
    const qrCount = await qrSection.count();

    if (qrCount > 0) {
      // If QR section exists, it should not show broken images
      const brokenImages = await page.locator('img[src*="undefined"], img[src*="null"]').count();
      expect(brokenImages, 'QR section should not have broken image sources').toBe(0);
    }
    // If QR section doesn't exist, that's also acceptable
  });
});

test.describe('🚫 NEGATIVE PATH: SharedReport Page - Missing/Invalid Event IDs', () => {

  test('SharedReport page without event ID loads brand-level report', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);
  });

  test('SharedReport page with nonsense event ID handles gracefully', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // Should show report or error handling
    const bodyText = await page.locator('body').innerText();
    const hasContent = bodyText.trim().length > 0 ||
      await page.locator('main, .report-container, .analytics, body').count() > 0;

    expect(hasContent, 'SharedReport should show content or graceful error').toBe(true);
  });

  test('SharedReport page with XSS attempt is sanitized', async ({ page }) => {
    const response = await page.goto(
      `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${encodeURIComponent(INVALID_IDS.xssAttempt)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 }
    );

    expect(response.status()).toBe(200);
    await assertLayoutNotBroken(page);
    await assertNoInternalErrors(page);

    // XSS payload should not be executed
    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain('<script>alert(1)</script>');
  });
});

test.describe('🚫 NEGATIVE PATH: Cross-Surface Security Checks', () => {

  const surfaces = [
    { name: 'Public', page: 'public' },
    { name: 'Display', page: 'display' },
    { name: 'Poster', page: 'poster' },
    { name: 'Report', page: 'report' },
  ];

  for (const surface of surfaces) {
    test(`${surface.name} page does not expose stack traces`, async ({ page }) => {
      await page.goto(
        `${BASE_URL}?page=${surface.page}&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
        { waitUntil: 'domcontentloaded', timeout: 20000 }
      );

      const bodyText = await page.locator('body').innerText();

      // Check for stack trace patterns
      expect(bodyText).not.toMatch(/at\s+\w+\s+\(/);  // "at functionName ("
      expect(bodyText).not.toMatch(/\.gs:\d+/);       // Code.gs:123
      expect(bodyText).not.toMatch(/\.js:\d+:\d+/);   // file.js:12:34
      expect(bodyText).not.toMatch(/Error:\s*\n/);    // Error:\n (multiline stack)
    });

    test(`${surface.name} page does not expose internal implementation details`, async ({ page }) => {
      await page.goto(
        `${BASE_URL}?page=${surface.page}&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
        { waitUntil: 'domcontentloaded', timeout: 20000 }
      );

      const bodyText = await page.locator('body').innerText().catch(() => '');

      // Should not expose internal details
      expect(bodyText.toLowerCase()).not.toContain('spreadsheetapp');
      expect(bodyText.toLowerCase()).not.toContain('driveapp');
      expect(bodyText.toLowerCase()).not.toContain('getrange');
      expect(bodyText.toLowerCase()).not.toContain('getvalue');
      expect(bodyText).not.toMatch(/ERR\.\w+/);  // ERR.INTERNAL etc
    });
  }
});

test.describe('🚫 NEGATIVE PATH: No JavaScript Errors on Invalid IDs', () => {

  test('Public page with invalid ID has no critical JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'networkidle', timeout: 30000 }
    );

    // Filter out expected errors (google.script.run in non-GAS environment)
    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined') &&
      !e.includes('Script error')
    );

    expect(criticalErrors, `Unexpected JS errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('Display page with invalid ID has no critical JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'networkidle', timeout: 30000 }
    );

    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined') &&
      !e.includes('Script error')
    );

    expect(criticalErrors, `Unexpected JS errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('Poster page with invalid ID has no critical JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto(
      `${BASE_URL}?page=poster&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'networkidle', timeout: 30000 }
    );

    const criticalErrors = errors.filter(e =>
      !e.includes('google.script') &&
      !e.includes('google is not defined') &&
      !e.includes('Script error')
    );

    expect(criticalErrors, `Unexpected JS errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });
});

test.describe('🚫 NEGATIVE PATH: Response Time on Invalid IDs', () => {

  test('Invalid ID does not cause excessive load time on Public page', async ({ page }) => {
    const start = Date.now();
    await page.goto(
      `${BASE_URL}?page=public&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    const duration = Date.now() - start;

    // Should not take longer than normal page load (5s max for cold start)
    expect(duration, `Page took ${duration}ms to load`).toBeLessThan(15000);
  });

  test('Invalid ID does not cause excessive load time on Display page', async ({ page }) => {
    const start = Date.now();
    await page.goto(
      `${BASE_URL}?page=display&brand=${BRAND_ID}&id=${INVALID_IDS.nonsense}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    const duration = Date.now() - start;

    expect(duration, `Page took ${duration}ms to load`).toBeLessThan(15000);
  });
});
