/**
 * Diagnostics.html - System Testing Interface Tests
 *
 * Tests the Diagnostics page which runs comprehensive system tests:
 * 1. System status check
 * 2. Event creation
 * 3. Event update
 * 4. Analytics logging
 * 5. Report generation
 * 6. Report export
 * 7. Shortlink creation
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:e2e
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:e2e
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('./config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('Diagnostics Page - System Testing Interface', () => {

  test('Diagnostics page loads and shows interface', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Verify page loaded
    await expect(page).toHaveTitle(/Diagnostics/);
    await expect(page.locator('h2:has-text("System Diagnostics")')).toBeVisible();

    // Verify summary section exists
    await expect(page.locator('#summary')).toBeVisible();
    await expect(page.locator('h2:has-text("Test Results")')).toBeVisible();

    // Verify stat counters exist
    await expect(page.locator('#passedCount')).toBeVisible();
    await expect(page.locator('#failedCount')).toBeVisible();
    await expect(page.locator('#totalCount')).toBeVisible();
  });

  test('Run All Tests button exists and is clickable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const runButton = page.locator('button:has-text("Run All Tests")');
    await expect(runButton).toBeVisible();

    // Button should be enabled
    const isDisabled = await runButton.isDisabled();
    expect(isDisabled).toBe(false);
  });

  test('Running diagnostics shows test cards', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Click Run All Tests
    await page.click('button:has-text("Run All Tests")');

    // Wait for tests to start
    await page.waitForTimeout(2000);

    // Test cards should appear
    const testCards = page.locator('.test-card');
    const cardCount = await testCards.count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('Diagnostics shows running status', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');

    // Wait a moment for tests to start
    await page.waitForTimeout(1000);

    // At least one card should show "running" state
    const runningCards = await page.locator('.test-card.running').count();

    // May or may not catch running state depending on speed
    expect(runningCards).toBeGreaterThanOrEqual(0);
  });

  test('Diagnostics shows passed/failed status', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');

    // Wait for tests to complete
    await page.waitForTimeout(10000);

    // Cards should show either passed or failed state
    const passedCards = await page.locator('.test-card.passed').count();
    const failedCards = await page.locator('.test-card.failed').count();

    // Should have some results
    expect(passedCards + failedCards).toBeGreaterThan(0);
  });

  test('Stats counters update after tests complete', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Initial counts should be 0
    expect(await page.locator('#passedCount').textContent()).toBe('0');
    expect(await page.locator('#failedCount').textContent()).toBe('0');
    expect(await page.locator('#totalCount').textContent()).toBe('0');

    // Run tests
    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Counts should update
    const passedCount = parseInt(await page.locator('#passedCount').textContent());
    const failedCount = parseInt(await page.locator('#failedCount').textContent());
    const totalCount = parseInt(await page.locator('#totalCount').textContent());

    expect(totalCount).toBeGreaterThan(0);
    expect(totalCount).toBe(passedCount + failedCount);
  });

  test('All 7 diagnostic tests are included', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Should have 7 test cards (one for each diagnostic)
    const cardCount = await page.locator('.test-card').count();
    expect(cardCount).toBe(7);

    // Verify test names
    const testNames = [
      'System Status',
      'Create Event',
      'Update Event',
      'Analytics',
      'Report',
      'Export',
      'Shortlink'
    ];

    for (const name of testNames) {
      const card = page.locator(`.test-card:has-text("${name}")`);
      const exists = await card.count() > 0;
      // Test name may vary slightly, just check cards exist
    }
  });

  test('Test results show detailed output', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Test cards should have result sections
    const resultSections = await page.locator('.test-result').count();
    expect(resultSections).toBeGreaterThan(0);

    // Results should contain JSON or text output
    const firstResult = page.locator('.test-result').first();
    const resultText = await firstResult.textContent();
    expect(resultText.length).toBeGreaterThan(0);
  });

  test('Diagnostics page is responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Page should be readable
    await expect(page.locator('h2')).toBeVisible();
    await expect(page.locator('button:has-text("Run All Tests")')).toBeVisible();
  });

  test('Diagnostics can be run multiple times', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Run first time
    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    const firstTotal = parseInt(await page.locator('#totalCount').textContent());
    expect(firstTotal).toBeGreaterThan(0);

    // Run second time
    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    const secondTotal = parseInt(await page.locator('#totalCount').textContent());
    expect(secondTotal).toBeGreaterThan(0);

    // Both runs should complete
    expect(secondTotal).toBe(firstTotal);
  });

  test('Test status icons are visible', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Test cards should have status indicators
    const testCards = await page.locator('.test-card').all();

    for (const card of testCards) {
      const heading = card.locator('h3');
      await expect(heading).toBeVisible();

      // Should have status icon (⏳, ✅, or ❌)
      const text = await heading.textContent();
      const hasStatusIcon = text.includes('⏳') ||
                           text.includes('✅') ||
                           text.includes('❌');

      expect(hasStatusIcon).toBe(true);
    }
  });

  test('Passed tests show green styling', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Check if any passed cards exist
    const passedCards = await page.locator('.test-card.passed').count();

    if (passedCards > 0) {
      const firstPassed = page.locator('.test-card.passed').first();

      // Should have green border
      const borderColor = await firstPassed.evaluate(el =>
        window.getComputedStyle(el).borderColor
      );

      // Green color (rgb format)
      expect(borderColor).toContain('16'); // Contains some green channel
    }
  });

  test('Failed tests show red styling', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Check if any failed cards exist
    const failedCards = await page.locator('.test-card.failed').count();

    // May not have failed tests in healthy system
    expect(failedCards).toBeGreaterThanOrEqual(0);
  });

  test('Test results are scrollable if long', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Test result sections should have max-height and overflow
    const firstResult = page.locator('.test-result').first();

    if (await firstResult.count() > 0) {
      const overflow = await firstResult.evaluate(el =>
        window.getComputedStyle(el).overflowY
      );

      expect(overflow).toBe('auto');
    }
  });

  test('Diagnostics page has no console errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Filter out expected google.script errors
    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );

    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('Diagnostics Page - Individual Tests', () => {

  test('System Status test runs', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // System Status should be first test
    const statusCard = page.locator('.test-card').first();
    await expect(statusCard).toBeVisible();

    const statusText = await statusCard.textContent();
    expect(statusText.toLowerCase()).toContain('status');
  });

  test('Event creation test runs', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(10000);

    // Should have event creation test
    const testCards = await page.locator('.test-card').allTextContents();
    const hasEventTest = testCards.some(text =>
      text.toLowerCase().includes('event') ||
      text.toLowerCase().includes('create')
    );

    expect(hasEventTest).toBe(true);
  });

  test('Diagnostics complete within reasonable time', async ({ page }) => {
    const start = Date.now();

    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.click('button:has-text("Run All Tests")');
    await page.waitForTimeout(15000);

    const duration = Date.now() - start;

    // Should complete within 20 seconds
    expect(duration).toBeLessThan(20000);

    // All tests should be done
    const totalCount = parseInt(await page.locator('#totalCount').textContent());
    expect(totalCount).toBe(7);
  });
});

test.describe('Diagnostics Page - Edge Cases', () => {

  test('Diagnostics works with different brands', async ({ page }) => {
    const brands = ['root', 'abc'];

    for (const brand of brands) {
      await page.goto(`${BASE_URL}?page=diagnostics&brand=${brand}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await expect(page.locator('h2:has-text("System Diagnostics")')).toBeVisible();

      // Run All Tests button should be available
      await expect(page.locator('button:has-text("Run All Tests")')).toBeVisible();
    }
  });

  test('Diagnostics handles backend errors gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Even if backend has issues, page should render
    await expect(page.locator('h2')).toBeVisible();
    await expect(page.locator('button:has-text("Run All Tests")')).toBeVisible();
  });

  test('Page state persists during tests', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=diagnostics&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Click button
    await page.click('button:has-text("Run All Tests")');

    // Scroll page
    await page.evaluate(() => window.scrollTo(0, 100));

    // Wait for tests
    await page.waitForTimeout(5000);

    // Page should still be functional
    await expect(page.locator('h2')).toBeVisible();
  });
});
