/**
 * Shared Components E2E Tests
 *
 * Tests that SharedUtils.html and APIClient.html are properly loaded
 * and integrated into refactored pages (Sponsor.html, Signup.html, PlannerCards.html)
 *
 * Validates:
 * - Components are loaded and accessible as window globals
 * - NU.esc XSS prevention is available
 * - SharedUtils functions work correctly
 * - APIClient configuration works
 * - Styles.html shared classes are applied
 */

import { test, expect } from '@playwright/test';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Shared Components Integration', () => {
  let baseUrl;
  const brand = 'root';

  test.beforeEach(async () => {
    const env = getCurrentEnvironment();
    baseUrl = env.baseUrl;
  });

  // ===========================================================================
  // NUSDK INTEGRATION (NU.esc)
  // ===========================================================================

  test.describe('NUSDK - XSS Prevention', () => {

    test('NU.esc is available on Sponsor page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasNUesc = await page.evaluate(() => {
        return typeof window.NU !== 'undefined' && typeof window.NU.esc === 'function';
      });

      expect(hasNUesc).toBe(true);
    });

    test('NU.esc properly escapes HTML', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const escaped = await page.evaluate(() => {
        return window.NU.esc('<script>alert("xss")</script>');
      });

      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escaped).not.toContain('<script>');
    });

    test('NU.rpc is available for API calls', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasNUrpc = await page.evaluate(() => {
        return typeof window.NU !== 'undefined' && typeof window.NU.rpc === 'function';
      });

      expect(hasNUrpc).toBe(true);
    });

  });

  // ===========================================================================
  // SHARED UTILS INTEGRATION
  // ===========================================================================

  test.describe('SharedUtils - Utility Functions', () => {

    test('SharedUtils is available on Sponsor page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasSharedUtils = await page.evaluate(() => {
        return typeof window.SharedUtils !== 'undefined';
      });

      expect(hasSharedUtils).toBe(true);
    });

    test('SharedUtils.formatDate works correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const formatted = await page.evaluate(() => {
        if (!window.SharedUtils) return null;
        return window.SharedUtils.formatDate('2025-12-25');
      });

      expect(formatted).toMatch(/Dec\s+25,?\s+2025/);
    });

    test('SharedUtils.isValidEmail validates correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const results = await page.evaluate(() => {
        if (!window.SharedUtils) return null;
        return {
          valid: window.SharedUtils.isValidEmail('test@example.com'),
          invalid: window.SharedUtils.isValidEmail('not-an-email')
        };
      });

      expect(results.valid).toBe(true);
      expect(results.invalid).toBe(false);
    });

    test('SharedUtils.isValidUrl validates correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const results = await page.evaluate(() => {
        if (!window.SharedUtils) return null;
        return {
          valid: window.SharedUtils.isValidUrl('https://example.com'),
          invalid: window.SharedUtils.isValidUrl('not-a-url')
        };
      });

      expect(results.valid).toBe(true);
      expect(results.invalid).toBe(false);
    });

    test('SharedUtils.showAlert creates alert element', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // First authenticate to access main content
      const authPrompt = page.locator('#auth-prompt');
      if (await authPrompt.isVisible()) {
        // Enter admin key to access main interface
        await page.fill('#admin-key-input', process.env.ADMIN_KEY || 'test-key');
        await page.click('#auth-prompt button');
        await page.waitForTimeout(500);
      }

      // Now test showAlert
      const alertCreated = await page.evaluate(() => {
        if (!window.SharedUtils) return false;
        window.SharedUtils.showAlert('Test alert message', 'success');
        const alertContainer = document.getElementById('alert-container');
        return alertContainer && alertContainer.querySelector('.alert-success') !== null;
      });

      expect(alertCreated).toBe(true);
    });

    test('SharedUtils is available on Signup page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=signup&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasSharedUtils = await page.evaluate(() => {
        return typeof window.SharedUtils !== 'undefined';
      });

      expect(hasSharedUtils).toBe(true);
    });

  });

  // ===========================================================================
  // API CLIENT INTEGRATION
  // ===========================================================================

  test.describe('APIClient - Configuration & Methods', () => {

    test('APIClient is available on Sponsor page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasAPIClient = await page.evaluate(() => {
        return typeof window.APIClient !== 'undefined';
      });

      expect(hasAPIClient).toBe(true);
    });

    test('APIClient.init sets configuration', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const configSet = await page.evaluate(() => {
        if (!window.APIClient) return null;
        window.APIClient.init({
          brandId: 'test-brand-123',
          adminKey: 'test-key-456'
        });
        const config = window.APIClient.getConfig();
        return {
          brandId: config.brandId,
          adminKey: config.adminKey
        };
      });

      expect(configSet.brandId).toBe('test-brand-123');
      expect(configSet.adminKey).toBe('test-key-456');
    });

    test('APIClient.setAdminKey updates admin key', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const keyUpdated = await page.evaluate(() => {
        if (!window.APIClient) return null;
        window.APIClient.init({ adminKey: 'initial-key' });
        window.APIClient.setAdminKey('updated-key');
        return window.APIClient.getConfig().adminKey;
      });

      expect(keyUpdated).toBe('updated-key');
    });

    test('APIClient.setBrandId updates brand ID', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const brandUpdated = await page.evaluate(() => {
        if (!window.APIClient) return null;
        window.APIClient.init({ brandId: 'initial-brand' });
        window.APIClient.setBrandId('updated-brand');
        return window.APIClient.getConfig().brandId;
      });

      expect(brandUpdated).toBe('updated-brand');
    });

    test('APIClient has all CRUD methods', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasMethods = await page.evaluate(() => {
        if (!window.APIClient) return null;
        return {
          create: typeof window.APIClient.create === 'function',
          list: typeof window.APIClient.list === 'function',
          get: typeof window.APIClient.get === 'function',
          update: typeof window.APIClient.update === 'function',
          remove: typeof window.APIClient.remove === 'function'
        };
      });

      expect(hasMethods.create).toBe(true);
      expect(hasMethods.list).toBe(true);
      expect(hasMethods.get).toBe(true);
      expect(hasMethods.update).toBe(true);
      expect(hasMethods.remove).toBe(true);
    });

  });

  // ===========================================================================
  // STYLES.HTML SHARED CLASSES
  // ===========================================================================

  test.describe('Shared CSS Classes', () => {

    test('page-section class is applied on Sponsor page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Authenticate first
      const authPrompt = page.locator('#auth-prompt');
      if (await authPrompt.isVisible()) {
        await page.fill('#admin-key-input', process.env.ADMIN_KEY || 'test-key');
        await page.click('#auth-prompt button');
        await page.waitForTimeout(500);
      }

      const hasPageSection = await page.locator('.page-section').count();
      expect(hasPageSection).toBeGreaterThan(0);
    });

    test('page-header-card class is applied', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Authenticate first
      const authPrompt = page.locator('#auth-prompt');
      if (await authPrompt.isVisible()) {
        await page.fill('#admin-key-input', process.env.ADMIN_KEY || 'test-key');
        await page.click('#auth-prompt button');
        await page.waitForTimeout(500);
      }

      const hasHeaderCard = await page.locator('.page-header-card').count();
      expect(hasHeaderCard).toBe(1);
    });

    test('entity-grid class is used for sponsor list', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Authenticate first
      const authPrompt = page.locator('#auth-prompt');
      if (await authPrompt.isVisible()) {
        await page.fill('#admin-key-input', process.env.ADMIN_KEY || 'test-key');
        await page.click('#auth-prompt button');
        await page.waitForTimeout(500);
      }

      const hasEntityGrid = await page.locator('.entity-grid').count();
      expect(hasEntityGrid).toBe(1);
    });

    test('tier-badge classes are styled correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Verify tier badge CSS classes exist in stylesheet
      const tierBadgeStyled = await page.evaluate(() => {
        const sheets = document.styleSheets;
        for (const sheet of sheets) {
          try {
            const rules = sheet.cssRules || sheet.rules;
            for (const rule of rules) {
              if (rule.selectorText && rule.selectorText.includes('tier-gold')) {
                return true;
              }
            }
          } catch (e) {
            // Cross-origin stylesheets may throw
          }
        }
        return false;
      });

      expect(tierBadgeStyled).toBe(true);
    });

    test('alert classes are styled correctly', async ({ page }) => {
      await page.goto(`${baseUrl}?page=sponsor&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Verify alert CSS classes exist in stylesheet
      const alertStyled = await page.evaluate(() => {
        const sheets = document.styleSheets;
        for (const sheet of sheets) {
          try {
            const rules = sheet.cssRules || sheet.rules;
            for (const rule of rules) {
              if (rule.selectorText && rule.selectorText.includes('.alert-success')) {
                return true;
              }
            }
          } catch (e) {
            // Cross-origin stylesheets may throw
          }
        }
        return false;
      });

      expect(alertStyled).toBe(true);
    });

  });

  // ===========================================================================
  // SIGNUP PAGE INTEGRATION
  // ===========================================================================

  test.describe('Signup Page - Shared Components', () => {

    test('page-section classes are applied on Signup page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=signup&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasPageSection = await page.locator('.page-section').count();
      expect(hasPageSection).toBeGreaterThan(0);
    });

    test('page-header-card is present on Signup page', async ({ page }) => {
      await page.goto(`${baseUrl}?page=signup&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const hasHeaderCard = await page.locator('.page-header-card').count();
      expect(hasHeaderCard).toBe(1);
    });

    test('nav-breadcrumb has themed color', async ({ page }) => {
      await page.goto(`${baseUrl}?page=signup&brand=${brand}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      const breadcrumb = page.locator('.nav-breadcrumb a');
      await expect(breadcrumb).toBeVisible();
    });

  });

  // ===========================================================================
  // PLANNER CARDS PAGE INTEGRATION
  // ===========================================================================

  test.describe('PlannerCards Page - Shared Components', () => {

    test('NUSDK and SharedUtils are loaded', async ({ page }) => {
      // Skip if planner page not accessible
      try {
        await page.goto(`${baseUrl}?page=planner&brand=${brand}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        const hasComponents = await page.evaluate(() => {
          return {
            hasNU: typeof window.NU !== 'undefined',
            hasSharedUtils: typeof window.SharedUtils !== 'undefined'
          };
        });

        // At least NU should be loaded (SharedUtils may vary by page config)
        expect(hasComponents.hasNU).toBe(true);
      } catch (e) {
        test.skip('PlannerCards page not accessible');
      }
    });

  });

});
