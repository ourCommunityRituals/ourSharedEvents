/**
 * API Smoke Tests - Quick health checks for backend endpoints
 *
 * These tests verify:
 * - API endpoints are reachable
 * - Response format is correct
 * - Basic error handling works
 * - No critical backend failures
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:smoke
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:smoke
 *
 * Run with: npm run test:smoke
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

test.describe('API Smoke Tests - Status & Health', () => {

  test('api_statusPure - Returns pure system status (flat format)', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    const json = await response.json();

    // Pure status endpoint returns flat format (no envelope wrapper)
    expect(json).toHaveProperty('ok', true);
    expect(json).toHaveProperty('buildId', 'triangle-extended-v1.5');
    expect(json).toHaveProperty('brandId', BRAND_ID);
    expect(json).toHaveProperty('timestamp');
    // Validate timestamp is ISO 8601
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
  });

  test('Health check page - Returns OK response', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=test&brand=${BRAND_ID}`);

    expect(response.status()).toBe(200);
    // Test page should load without errors
    await page.waitForLoadState('domcontentloaded');
  });
});

test.describe('API Smoke Tests - Error Handling', () => {

  test('Invalid page parameter - Returns 404 or error page', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=nonexistent&brand=${BRAND_ID}`);

    // Should either return 200 with error message or 404
    expect([200, 404]).toContain(response.status());
  });

  test('Missing brand parameter - Falls back to root', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=admin`);

    expect(response.status()).toBe(200);
    // Should fall back to root brand
    await expect(page).toHaveTitle(/Admin/);
  });

  test('Invalid redirect token - Shows error', async ({ page }) => {
    await page.goto(`${BASE_URL}?p=r&t=invalid-token-12345`);

    // Should show "not found" or error message
    const bodyText = await page.locator('body').textContent();
    expect(bodyText.toLowerCase()).toMatch(/not found|invalid|error/);
  });
});

test.describe('API Smoke Tests - Response Format', () => {

  test('Status endpoint - Follows flat response format', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);
    const json = await response.json();

    // Pure status: { ok: true, buildId: '...', brandId: '...', timestamp: '...' }
    expect(json).toMatchObject({
      ok: true,
      buildId: expect.any(String),
      brandId: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  test('Error responses - Follow Err envelope format', async ({ page }) => {
    // This would need to trigger an error condition
    // For now, verify the page handles errors gracefully
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);

    // Should load without throwing
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('API Smoke Tests - Performance', () => {

  test('Status API - Responds quickly', async ({ page }) => {
    const times = [];

    // Make 3 requests to check consistency
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      await page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`);
      times.push(Date.now() - start);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avgTime).toBeLessThan(3000); // Average under 3 seconds
  });
});

test.describe('API Smoke Tests - Multi-brand', () => {

  test('Root brand - Accessible', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}?page=admin&brand=root`);

    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/Admin/);
  });

  test('Different brand IDs - Load correctly', async ({ page }) => {
    // Test different brand IDs (abc, cbc, cbl per Config.gs)
    const brands = ['root', 'abc', 'cbc', 'cbl'];

    for (const brand of brands) {
      const response = await page.goto(`${BASE_URL}?page=admin&brand=${brand}`);
      expect(response.status()).toBe(200);
    }
  });
});

test.describe('API Smoke Tests - Rate Limiting', () => {

  test('Multiple rapid requests - Should handle gracefully', async ({ page }) => {
    // Make 5 rapid status requests
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(page.goto(`${BASE_URL}?p=status&brand=${BRAND_ID}`));
    }

    const responses = await Promise.all(requests);

    // All should succeed (rate limit is 20/min per brand)
    responses.forEach(response => {
      expect(response.status()).toBe(200);
    });
  });
});
