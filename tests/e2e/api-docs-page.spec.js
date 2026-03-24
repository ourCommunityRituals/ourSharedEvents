/**
 * E2E Tests for Interactive API Documentation Page
 *
 * Tests the ApiDocs.html page including:
 * - Page load and structure
 * - Navigation
 * - "Try it out" functionality
 * - Live endpoint testing
 * - Code samples
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../config/environments');

const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';

test.describe('API Documentation Page', () => {

  test.describe('Page Load and Structure', () => {
    test('should load API docs page', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check title
      await expect(page).toHaveTitle(/API Documentation/);

      // Check header
      await expect(page.locator('h1')).toContainText('MVP Event Toolkit API');
      await expect(page.locator('.subtitle')).toContainText('Complete REST API documentation');
    });

    test('should display navigation menu', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check navigation links
      await expect(page.locator('nav a:has-text("Overview")')).toBeVisible();
      await expect(page.locator('nav a:has-text("Authentication")')).toBeVisible();
      await expect(page.locator('nav a:has-text("Endpoints")')).toBeVisible();
      await expect(page.locator('nav a:has-text("Examples")')).toBeVisible();
      await expect(page.locator('nav a:has-text("Errors")')).toBeVisible();
    });

    test('should display base URL automatically', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check that base URL is populated
      const baseUrlElement = page.locator('#base-url');
      await expect(baseUrlElement).toBeVisible();

      const baseUrlText = await baseUrlElement.textContent();
      expect(baseUrlText).toContain('script.google.com');
    });

    test('should have sticky navigation', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Scroll down
      await page.evaluate(() => window.scrollTo(0, 500));

      // Navigation should still be visible (sticky)
      const nav = page.locator('nav');
      await expect(nav).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should navigate to sections when clicking nav links', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Click Authentication link
      await page.click('nav a:has-text("Authentication")');

      // Should scroll to authentication section
      const authSection = page.locator('#authentication');
      await expect(authSection).toBeInViewport();
    });

    test('should highlight active section in navigation', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Click a navigation link
      const authLink = page.locator('nav a:has-text("Authentication")');
      await authLink.click();

      // Link should have hover/active styling (check for color change)
      await expect(authLink).toHaveCSS('color', /.+/); // Has some color
    });
  });

  test.describe('Authentication Section', () => {
    test('should display all three authentication methods', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for authentication method cards
      await expect(page.locator('.auth-card:has-text("Admin Key")')).toBeVisible();
      await expect(page.locator('.auth-card:has-text("Bearer Token")')).toBeVisible();
      await expect(page.locator('.auth-card:has-text("API Key Header")')).toBeVisible();
    });

    test('should show JWT token generation form', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for token generation try-it form
      await expect(page.locator('#token-admin-key')).toBeVisible();
      await expect(page.locator('#token-expires')).toBeVisible();
      await expect(page.locator('button:has-text("Generate Token")')).toBeVisible();
    });
  });

  test.describe('Endpoints Section', () => {
    test('should display public endpoints', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for public endpoint badges
      await expect(page.locator('.auth-public')).toHaveCount(3); // status, list, get

      // Check endpoint headers
      await expect(page.locator('.method-get')).toHaveCount(3); // GET endpoints
    });

    test('should display admin endpoints', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for admin endpoint badges
      const authRequired = page.locator('.auth-required');
      await expect(authRequired.first()).toBeVisible();

      // Check POST methods
      const postMethods = page.locator('.method-post');
      await expect(postMethods.first()).toBeVisible();
    });

    test('should display request/response samples', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for code blocks
      const codeBlocks = page.locator('pre');
      await expect(codeBlocks.first()).toBeVisible();

      // Should contain JSON
      const firstCodeBlock = await codeBlocks.first().textContent();
      expect(firstCodeBlock).toContain('{');
    });
  });

  test.describe('Interactive "Try It Out" - Status Endpoint', () => {
    test('should test status endpoint successfully', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Click "Test Status Endpoint" button
      await page.click('button:has-text("Test Status Endpoint")');

      // Wait for response
      await page.waitForSelector('#status-response', { timeout: 10000 });

      // Check response
      const response = page.locator('#status-response');
      await expect(response).toBeVisible();

      const responseText = await response.textContent();
      expect(responseText).toContain('"ok": true');
      expect(responseText).toContain('build');

      // Should have success styling
      await expect(response).toHaveClass(/response-success/);
    });

    test('should display response with proper formatting', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await page.click('button:has-text("Test Status Endpoint")');
      await page.waitForSelector('#status-response');

      const response = page.locator('#status-response');
      const responseText = await response.textContent();

      // Should be formatted JSON
      expect(responseText).toMatch(/\{\s+"ok":\s+true/);
    });
  });

  test.describe('Interactive "Try It Out" - List Events', () => {
    test('should list events with custom parameters', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Fill in brand and scope
      await page.fill('#list-brand', 'root');
      await page.fill('#list-scope', 'events');

      // Click "List Events" button
      await page.click('button:has-text("List Events")');

      // Wait for response
      await page.waitForSelector('#list-response', { timeout: 10000 });

      // Check response
      const response = page.locator('#list-response');
      const responseText = await response.textContent();

      expect(responseText).toContain('"ok": true');
      expect(responseText).toContain('items');
    });
  });

  test.describe('Interactive "Try It Out" - Generate Token', () => {
    test('should generate JWT token', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Fill in admin key
      await page.fill('#token-admin-key', ADMIN_KEY);
      await page.fill('#token-expires', '3600');

      // Click generate button
      await page.click('button:has-text("Generate Token")');

      // Wait for response
      await page.waitForSelector('#token-response', { timeout: 10000 });

      // Check response
      const response = page.locator('#token-response');
      const responseText = await response.textContent();

      expect(responseText).toContain('"ok": true');
      expect(responseText).toContain('token');
      expect(responseText).toContain('expiresIn');
      expect(responseText).toContain('expiresAt');
    });

    test('should show error for invalid admin key', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Fill in invalid admin key
      await page.fill('#token-admin-key', 'INVALID_KEY');

      // Click generate button
      await page.click('button:has-text("Generate Token")');

      // Wait for response
      await page.waitForSelector('#token-response', { timeout: 10000 });

      // Check error response
      const response = page.locator('#token-response');
      const responseText = await response.textContent();

      expect(responseText).toContain('"ok": false');

      // Should have error styling
      await expect(response).toHaveClass(/response-error/);
    });
  });

  test.describe('Interactive "Try It Out" - Create Event', () => {
    test('should create event with admin key', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Update the create body with valid admin key
      const createBody = {
        action: 'create',
        brandId: 'root',
        adminKey: ADMIN_KEY,
        scope: 'events',
        templateId: 'Event',
        data: {
          eventName: 'API Docs Test Event',
          eventDate: '2025-07-15',
          eventTime: '19:00',
          locationName: 'Test Venue'
        }
      };

      await page.fill('#create-body', JSON.stringify(createBody, null, 2));

      // Click create button
      await page.click('button:has-text("Create Event")');

      // Wait for response
      await page.waitForSelector('#create-response', { timeout: 15000 });

      // Check response
      const response = page.locator('#create-response');
      const responseText = await response.textContent();

      expect(responseText).toContain('"ok": true');
      expect(responseText).toContain('id');
      expect(responseText).toContain('publicUrl');
    });

    test('should show validation error for invalid JSON', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Enter invalid JSON
      await page.fill('#create-body', '{ invalid json }');

      // Click create button
      await page.click('button:has-text("Create Event")');

      // Should show error (either from server or client-side validation)
      await page.waitForSelector('#create-response', { timeout: 10000 });

      const response = page.locator('#create-response');
      await expect(response).toBeVisible();
    });
  });

  test.describe('Code Examples Section', () => {
    test('should display JavaScript examples', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Navigate to examples section
      await page.click('nav a:has-text("Examples")');

      // Check for JavaScript code
      const examples = page.locator('#examples');
      const examplesText = await examples.textContent();

      expect(examplesText).toContain('JavaScript');
      expect(examplesText).toContain('fetch');
      expect(examplesText).toContain('async');
    });

    test('should display cURL examples', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await page.click('nav a:has-text("Examples")');

      const examples = page.locator('#examples');
      const examplesText = await examples.textContent();

      expect(examplesText).toContain('cURL');
      expect(examplesText).toContain('curl');
    });

    test('should show code with actual base URL', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Code samples should have the actual base URL, not placeholder
      const codeBlocks = page.locator('pre');
      const firstCodeBlock = await codeBlocks.first().textContent();

      // Should contain actual URL (script.google.com or localhost)
      expect(firstCodeBlock).toMatch(/(script\.google\.com|localhost)/);
    });
  });

  test.describe('Error Handling Section', () => {
    test('should display error codes table', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await page.click('nav a:has-text("Errors")');

      // Check for error codes
      await expect(page.locator('text=BAD_INPUT')).toBeVisible();
      await expect(page.locator('text=NOT_FOUND')).toBeVisible();
      await expect(page.locator('text=RATE_LIMITED')).toBeVisible();
      await expect(page.locator('text=INTERNAL')).toBeVisible();
      await expect(page.locator('text=CONTRACT')).toBeVisible();
    });

    test('should display error envelope format', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await page.click('nav a:has-text("Errors")');

      const errorsSection = page.locator('#errors');
      const errorsText = await errorsSection.textContent();

      expect(errorsText).toContain('"ok": false');
      expect(errorsText).toContain('"code"');
      expect(errorsText).toContain('"message"');
    });
  });

  test.describe('Responsive Design', () => {
    test('should be mobile-friendly', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Page should still be usable
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('nav')).toBeVisible();

      // Navigation should wrap on mobile
      const nav = page.locator('nav ul');
      await expect(nav).toBeVisible();
    });

    test('should be tablet-friendly', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 }); // iPad
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.container')).toBeVisible();
    });
  });

  test.describe('Footer Links', () => {
    test('should have links to other pages', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check footer links
      await expect(page.locator('footer a:has-text("Admin Dashboard")')).toBeVisible();
      await expect(page.locator('footer a:has-text("Test Page")')).toBeVisible();
    });

    test('should navigate to admin page', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Click admin link
      await page.click('footer a:has-text("Admin Dashboard")');

      // Should navigate to admin page
      await expect(page).toHaveURL(/page=admin/);
    });
  });

  test.describe('Performance', () => {
    test('should load quickly', async ({ page }) => {
      const startTime = Date.now();
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
      const loadTime = Date.now() - startTime;

      // Should load in under 5 seconds
      expect(loadTime).toBeLessThan(5000);
    });

    test('should not have console errors', async ({ page }) => {
      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Wait a bit for any async errors
      await page.waitForTimeout(2000);

      // Should have no console errors
      expect(consoleErrors).toHaveLength(0);
    });
  });

  test.describe('Accessibility', () => {
    test('should have semantic HTML', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check for semantic elements
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('nav')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();
    });

    test('should have proper heading hierarchy', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Should have h1
      await expect(page.locator('h1')).toBeVisible();

      // Should have h2 sections
      const h2Count = await page.locator('h2').count();
      expect(h2Count).toBeGreaterThan(0);

      // Should have h3 subsections
      const h3Count = await page.locator('h3').count();
      expect(h3Count).toBeGreaterThan(0);
    });

    test('should have form labels', async ({ page }) => {
      await page.goto(`${BASE_URL}?page=docs`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

      // Check that form inputs have labels
      const adminKeyInput = page.locator('#token-admin-key');
      const label = page.locator('label:has-text("Admin Key")');

      await expect(label).toBeVisible();
      await expect(adminKeyInput).toBeVisible();
    });
  });
});
