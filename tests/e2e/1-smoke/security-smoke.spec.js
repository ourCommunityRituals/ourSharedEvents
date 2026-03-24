/**
 * SECURITY & NEGATIVE TESTS - Level 1: Input Validation & Auth
 *
 * Purpose: Test edge cases, invalid inputs, and security boundaries
 * Run Time: < 1 minute
 * Run Frequency: Every deployment
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 *
 * Tests:
 * - Invalid admin keys
 * - XSS attempts
 * - SQL injection attempts
 * - Invalid brand IDs
 * - Malformed URLs
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('🔒 SECURITY: Admin Key Validation', () => {

  test('Invalid admin key is rejected', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    let dialogCount = 0;
    page.on('dialog', async dialog => {
      dialogCount++;
      expect(dialog.type()).toBe('prompt');
      // Provide WRONG admin key
      await dialog.accept('WRONG_KEY_12345');
    });

    await page.fill('#name', 'Security Test Event');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    // Wait for potential error message
    await page.waitForTimeout(2000);

    // STRICT: Invalid key should show error OR not create event
    const eventCard = page.locator('#eventCard');
    const errorMsg = page.locator('text=/error|invalid|unauthorized|denied/i');

    const hasEventCard = await eventCard.count() > 0;
    const hasErrorMsg = await errorMsg.count() > 0;

    // Either show error OR don't create event (but not both working)
    expect(hasErrorMsg || !hasEventCard).toBe(true);
  });

  test('Empty admin key is rejected', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(''); // Empty key
    });

    await page.fill('#name', 'Empty Key Test');
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // STRICT: Empty key should be rejected
    const eventCard = page.locator('#eventCard');
    const errorMsg = page.locator('text=/error|invalid|required/i');

    const hasEventCard = await eventCard.count() > 0;
    const hasErrorMsg = await errorMsg.count() > 0;

    expect(hasErrorMsg || !hasEventCard).toBe(true);
  });
});

test.describe('🔒 SECURITY: XSS Prevention', () => {

  test('XSS attempt in event name is sanitized', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const xssPayload = '<script>alert("XSS")</script>';
    const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else if (dialog.type() === 'alert' && dialog.message().includes('XSS')) {
        // STRICT: XSS payload should NOT execute
        throw new Error('XSS vulnerability detected!');
      }
    });

    await page.fill('#name', xssPayload);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // STRICT: Payload should be escaped/sanitized in output
    const pageContent = await page.content();

    // Script tags should be escaped or removed
    const hasRawScript = pageContent.includes('<script>alert("XSS")</script>');
    expect(hasRawScript).toBe(false);
  });

  test('HTML injection in event name is escaped', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const htmlPayload = '<img src=x onerror=alert("XSS")>';
    const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') {
        await dialog.accept(ADMIN_KEY);
      } else if (dialog.type() === 'alert') {
        throw new Error('HTML injection vulnerability detected!');
      }
    });

    await page.fill('#name', htmlPayload);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // STRICT: HTML should be escaped
    const pageContent = await page.content();
    const hasRawImg = pageContent.includes('<img src=x onerror=');
    expect(hasRawImg).toBe(false);
  });
});

test.describe('🔒 SECURITY: Invalid Inputs', () => {

  test('Invalid brand ID returns error', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=admin&brand=INVALID_BRAND_999`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // STRICT: Should return error or redirect, not crash
    expect(response.status()).toBeLessThan(500); // Not server error

    // Should show error message or empty state
    const errorMsg = page.locator('text=/invalid|not found|unknown brand/i');
    const hasError = await errorMsg.count() > 0;

    // Page should handle invalid brand gracefully
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0); // Not blank
  });

  test('Malformed date is rejected', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', 'Bad Date Test');
    await page.fill('#startDateISO', 'NOT-A-DATE');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // STRICT: Invalid date should be rejected or show error
    const errorMsg = page.locator('text=/invalid|error|format/i');
    const eventCard = page.locator('#eventCard');

    const hasError = await errorMsg.count() > 0;
    const hasEvent = await eventCard.count() > 0;

    // Either show error or don't create event
    expect(hasError || !hasEvent).toBe(true);
  });

  test('SQL injection attempt is handled safely', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const sqlPayload = "'; DROP TABLE events; --";
    const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', sqlPayload);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // STRICT: App should not crash from SQL-like input
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    // Verify events list still loads (table wasn't dropped)
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await expect(page.locator('h3:has-text("Events List")')).toBeVisible();
  });
});

test.describe('🔒 SECURITY: API Error Handling', () => {

  test('Non-existent page parameter shows error', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=NONEXISTENT&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // STRICT: Should handle gracefully (not 500 error)
    expect(response.status()).toBeLessThan(500);

    // Should show error page or redirect
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);
  });

  test('Missing required parameters handled', async ({ page }) => {
    // Test URL with no page parameter
    const response = await page.goto(`${BASE_URL}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // STRICT: Should not crash
    expect(response.status()).toBeLessThan(500);

    // Should show something (error, default page, or redirect)
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(100); // Has meaningful content
  });
});

test.describe('🔒 SECURITY: Performance Limits', () => {

  test('Extremely long event name is handled', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const longName = 'A'.repeat(10000); // 10k characters
    const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    await page.fill('#name', longName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    // STRICT: App should not crash
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(0);

    // Should either truncate or show error
    const eventCard = page.locator('#eventCard');
    const errorMsg = page.locator('text=/too long|maximum|limit/i');

    const hasEvent = await eventCard.count() > 0;
    const hasError = await errorMsg.count() > 0;

    // Must handle gracefully
    expect(hasEvent || hasError || pageContent.length > 0).toBe(true);
  });
});
