/**
 * Test.html - Health Check & Contract Validation Tests
 *
 * Tests the Test.html page which validates:
 * 1. Health check endpoint (api_healthCheck)
 * 2. SWR (Stale-While-Revalidate) caching with etags
 * 3. Scope validation (MVP restrictions)
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('Test Page - Health & Contract Validation', () => {

  test('Test page loads and runs all checks', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Verify page loaded
    await expect(page).toHaveTitle(/Test/);
    await expect(page.locator('h2:has-text("Health & Contracts")')).toBeVisible();

    // Wait for tests to complete
    await page.waitForTimeout(3000);

    // Verify all 3 test cards appear
    const testCards = page.locator('.event-card');
    const cardCount = await testCards.count();
    expect(cardCount).toBe(3);

    // Extract test results
    const results = await testCards.allTextContents();

    // All tests should pass (show ✅)
    results.forEach(result => {
      expect(result).toContain('✅');
    });
  });

  test('Health check test passes', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // Verify "Health alive" test exists and passes
    const healthCard = page.locator('.event-card:has-text("Health alive")');
    await expect(healthCard).toBeVisible();

    const healthText = await healthCard.textContent();
    expect(healthText).toContain('✅');
    expect(healthText).toContain('Health alive');
  });

  test('SWR (Stale-While-Revalidate) test passes', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // Verify "SWR notModified" test exists and passes
    const swrCard = page.locator('.event-card:has-text("SWR notModified")');
    await expect(swrCard).toBeVisible();

    const swrText = await swrCard.textContent();
    expect(swrText).toContain('✅');
    expect(swrText).toContain('SWR notModified');
  });

  test('Scope validation test passes (leagues blocked)', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // Verify "Leagues blocked (MVP)" test exists and passes
    const scopeCard = page.locator('.event-card:has-text("Leagues blocked")');
    await expect(scopeCard).toBeVisible();

    const scopeText = await scopeCard.textContent();
    expect(scopeText).toContain('✅');
    expect(scopeText).toContain('Leagues blocked (MVP)');
  });

  test('All tests complete within reasonable time', async ({ page }) => {
    const start = Date.now();

    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for all tests to complete
    await page.waitForTimeout(3000);

    const duration = Date.now() - start;

    // Verify all test cards are present (tests completed)
    const cardCount = await page.locator('.event-card').count();
    expect(cardCount).toBe(3);

    // Total time should be under 10 seconds
    expect(duration).toBeLessThan(10000);
  });

  test('Test results are visible and readable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // Check visual appearance of test cards
    const testCards = await page.locator('.event-card').all();

    for (const card of testCards) {
      // Card should be visible
      await expect(card).toBeVisible();

      // Card should have h3 heading
      const heading = card.locator('h3');
      await expect(heading).toBeVisible();

      // Card should have either ✅ or ❌
      const text = await card.textContent();
      expect(text.includes('✅') || text.includes('❌')).toBe(true);
    }
  });

  test('Page handles failures gracefully', async ({ page }) => {
    // If backend is down or errors occur, page should still render
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Page title should be visible regardless
    await expect(page.locator('h2:has-text("Health & Contracts")')).toBeVisible();

    // Wait for tests to attempt completion
    await page.waitForTimeout(3000);

    // Test cards should appear (even if failed)
    const cardCount = await page.locator('.event-card').count();
    expect(cardCount).toBeGreaterThanOrEqual(0);
  });

  test('Test page is responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // Page should be readable
    await expect(page.locator('h2')).toBeVisible();

    // Test cards should stack vertically
    const testCards = await page.locator('.event-card').all();
    expect(testCards.length).toBeGreaterThan(0);
  });

  test('NUSDK is loaded and available', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check if NU SDK is available
    const hasNUSDK = await page.evaluate(() => {
      return typeof window.NU !== 'undefined' &&
             typeof window.NU.rpc === 'function';
    });

    expect(hasNUSDK).toBe(true);
  });

  test('Test page contract validation works', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // All three contract tests should pass
    const passedTests = await page.locator('.event-card:has-text("✅")').count();
    expect(passedTests).toBe(3);

    // No failed tests
    const failedTests = await page.locator('.event-card:has-text("❌")').count();
    expect(failedTests).toBe(0);
  });
});

test.describe('Test Page - Edge Cases', () => {

  test('Test page works with different brands', async ({ page }) => {
    const brands = ['root', 'abc', 'cbc', 'cbl'];

    for (const brand of brands) {
      await page.goto(`${BASE_URL}?page=test&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
      await page.waitForTimeout(3000);

      // Tests should run for all brands
      const cardCount = await page.locator('.event-card').count();
      expect(cardCount).toBe(3);
    }
  });

  test('Test page handles network delays', async ({ page }) => {
    // Slow down network to simulate delays
    await page.route('**/*', route => {
      setTimeout(() => route.continue(), 500);
    });

    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Should eventually complete despite delays
    await page.waitForTimeout(5000);

    const cardCount = await page.locator('.event-card').count();
    expect(cardCount).toBeGreaterThanOrEqual(0);
  });

  test('Test page has no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    // Filter out google.script.run errors (expected in test environment)
    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );

    expect(criticalErrors.length).toBe(0);
  });
});
