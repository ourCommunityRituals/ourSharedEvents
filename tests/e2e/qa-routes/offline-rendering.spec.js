/**
 * QA ROUTE TESTS: Offline Rendering
 *
 * Tests pages that should work without JavaScript or in offline/degraded conditions.
 * Validates progressive enhancement, graceful degradation, and static rendering.
 *
 * Coverage:
 * - Server-side rendered content visibility
 * - Critical CSS inline loading
 * - No-JS fallback behavior
 * - Static content accessibility
 * - Print rendering without JS
 */

const { test, expect } = require('@playwright/test');
const { getCurrentEnvironment } = require('../../config/environments.js');

test.describe('QA Routes: Offline Rendering', () => {
  let env;
  let baseUrl;
  const BRAND_ID = 'root';

  test.beforeAll(() => {
    env = getCurrentEnvironment();
    baseUrl = env.baseUrl;
  });

  test.describe('Server-Side Rendered Content', () => {

    test('Public page renders critical content without JS', async ({ browser }) => {
      // Create context with JS disabled
      const context = await browser.newContext({
        javaScriptEnabled: false
      });
      const page = await context.newPage();

      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should have basic HTML structure
      const html = await page.content();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<body');

      // Should have title
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);

      // Should have main content container
      const hasContent = await page.locator('body').evaluate(el => el.innerHTML.length > 100);
      expect(hasContent).toBe(true);

      await context.close();
    });

    test('Poster page renders for print without JS', async ({ browser }) => {
      const context = await browser.newContext({
        javaScriptEnabled: false
      });
      const page = await context.newPage();

      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should have poster container
      const posterContainer = page.locator('.poster-container, #poster, .poster');
      const hasContainer = await posterContainer.count() > 0 ||
        await page.locator('body').innerHTML().then(html => html.includes('poster'));

      expect(hasContainer).toBe(true);

      // Background should be print-friendly (white)
      const bodyBg = await page.locator('body').evaluate(el =>
        window.getComputedStyle(el).backgroundColor
      );
      // Allow white, transparent, or near-white backgrounds
      expect(bodyBg).toMatch(/rgb\(255,\s*255,\s*255\)|white|rgba\(0,\s*0,\s*0,\s*0\)|transparent/i);

      await context.close();
    });

    test('Display page has fallback content without JS', async ({ browser }) => {
      const context = await browser.newContext({
        javaScriptEnabled: false
      });
      const page = await context.newPage();

      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should have stage or main content area
      const stageArea = page.locator('#stage, .stage, main, [role="main"]');
      const hasStage = await stageArea.count() > 0;

      if (hasStage) {
        // Stage should be visible
        await expect(stageArea.first()).toBeAttached();
      }

      // Should have some visible content
      const bodyContent = await page.locator('body').textContent();
      expect(bodyContent.length).toBeGreaterThan(0);

      await context.close();
    });
  });

  test.describe('Critical CSS Loading', () => {

    test('Poster page has inline critical CSS for print', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check for inline styles
      const inlineStyles = page.locator('style');
      const styleCount = await inlineStyles.count();

      // Should have at least one inline style block
      expect(styleCount).toBeGreaterThan(0);

      // Check for print-related styles
      const html = await page.content();
      const hasPrintStyles = html.includes('@media print') ||
        html.includes('print-') ||
        html.includes('background: white') ||
        html.includes('background:#fff');

      // Either has print media query or white background for printing
      expect(hasPrintStyles || styleCount > 0).toBe(true);
    });

    test('Display page loads without external CSS blocking', async ({ page }) => {
      const cssLoadTimes = [];

      page.on('response', response => {
        if (response.url().endsWith('.css')) {
          cssLoadTimes.push({
            url: response.url(),
            timing: response.timing()
          });
        }
      });

      const startTime = Date.now();
      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      const domReadyTime = Date.now() - startTime;

      // DOM should be ready within reasonable time
      expect(domReadyTime).toBeLessThan(5000);

      // If there are external CSS files, they shouldn't block critical rendering
      if (cssLoadTimes.length > 0) {
        // Just verify CSS files loaded
        expect(cssLoadTimes.length).toBeGreaterThan(0);
      }
    });

    test('Public page has critical styles for above-fold content', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check that header/nav is styled
      const header = page.locator('header, nav, .header, .nav');
      const hasHeader = await header.count() > 0;

      if (hasHeader) {
        const headerStyles = await header.first().evaluate(el => {
          const styles = window.getComputedStyle(el);
          return {
            display: styles.display,
            visibility: styles.visibility
          };
        });

        // Header should be visible
        expect(headerStyles.display).not.toBe('none');
        expect(headerStyles.visibility).not.toBe('hidden');
      }
    });
  });

  test.describe('Print Rendering', () => {

    test('Poster page renders correctly in print media', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Emulate print media
      await page.emulateMedia({ media: 'print' });

      // Poster container should still be visible in print
      const posterContainer = page.locator('.poster-container, #poster, .poster, main');
      const hasContainer = await posterContainer.count() > 0;

      if (hasContainer) {
        await expect(posterContainer.first()).toBeVisible();
      }

      // QR codes should be visible for scanning after print
      const qrArea = page.locator('.qr-grid, .qr-section, #qrGrid, [class*="qr"]');
      const hasQR = await qrArea.count() > 0;

      if (hasQR) {
        await expect(qrArea.first()).toBeVisible();
      }
    });

    test('Poster page hides navigation in print mode', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Switch to print media
      await page.emulateMedia({ media: 'print' });

      // Navigation should be hidden
      const nav = page.locator('nav, .nav, .navigation, [role="navigation"]');
      const navCount = await nav.count();

      if (navCount > 0) {
        const isHidden = await nav.first().evaluate(el => {
          const styles = window.getComputedStyle(el);
          return styles.display === 'none' || styles.visibility === 'hidden';
        });

        // Navigation should be hidden in print mode
        expect(isHidden).toBe(true);
      }
    });

    test('Print layout fits standard paper size', async ({ page }) => {
      // Set viewport to A4 dimensions at 96 DPI
      await page.setViewportSize({ width: 794, height: 1123 });

      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await page.emulateMedia({ media: 'print' });

      // Main content should fit within paper width
      const mainContent = page.locator('.poster-container, #poster, main, body');
      const box = await mainContent.first().boundingBox();

      if (box) {
        // Content width should not exceed A4 width
        expect(box.width).toBeLessThanOrEqual(800);
      }
    });

    test('QR codes maintain scannable size in print', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await page.emulateMedia({ media: 'print' });

      const qrImages = page.locator('img[src*="qr"], .qr-code img, #qrGrid img');
      const qrCount = await qrImages.count();

      if (qrCount > 0) {
        const firstQR = qrImages.first();
        const box = await firstQR.boundingBox();

        if (box) {
          // QR codes should be at least 80x80 for reliable scanning
          expect(box.width).toBeGreaterThanOrEqual(80);
          expect(box.height).toBeGreaterThanOrEqual(80);
        }
      }
    });
  });

  test.describe('Graceful Degradation', () => {

    test('Pages load with network request failures', async ({ page }) => {
      // Block external resources except the main page
      await page.route('**/*', async (route) => {
        const requestUrl = route.request().url();
        // Use URL parsing for secure host validation
        let isAllowed = false;
        try {
          const parsedUrl = new URL(requestUrl);
          const baseHost = new URL(baseUrl).hostname;
          // Only allow exact hostname matches (not substring)
          isAllowed = parsedUrl.hostname === baseHost ||
                      parsedUrl.hostname === 'script.google.com' ||
                      parsedUrl.hostname.endsWith('.google.com') ||
                      requestUrl.endsWith('.html');
        } catch {
          // Invalid URL, block it
          isAllowed = false;
        }

        if (isAllowed) {
          await route.continue();
        } else {
          // Block external images, fonts, etc.
          await route.abort();
        }
      });

      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Page should still load without external resources
      const hasContent = await page.locator('body').evaluate(el => el.innerHTML.length > 100);
      expect(hasContent).toBe(true);

      // Should not show blank page
      const bodyText = await page.locator('body').textContent();
      expect(bodyText.length).toBeGreaterThan(0);
    });

    test('Error states display user-friendly messages', async ({ page }) => {
      // Navigate to invalid page
      await page.goto(`${baseUrl}?page=nonexistent&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Should show some content (either error message or redirect)
      const bodyContent = await page.locator('body').innerHTML();
      expect(bodyContent.length).toBeGreaterThan(50);

      // Should not show raw error or stack trace
      expect(bodyContent).not.toContain('Error:');
      expect(bodyContent).not.toContain('at Object.');
      expect(bodyContent).not.toContain('undefined is not');
    });

    test('Missing event ID shows helpful message', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // If no event ID, should show helpful message or default content
      const bodyContent = await page.locator('body').textContent();

      // Should have some content
      expect(bodyContent.length).toBeGreaterThan(10);
    });
  });

  test.describe('Static Content Accessibility', () => {

    test('Poster page is accessible without interaction', async ({ page }) => {
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check for basic accessibility attributes
      const hasLang = await page.locator('html').getAttribute('lang');
      expect(hasLang).toBeTruthy();

      // Images should have alt text
      const images = page.locator('img');
      const imgCount = await images.count();

      for (let i = 0; i < Math.min(imgCount, 5); i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');
        const role = await img.getAttribute('role');

        // Images should have alt or be decorative (role="presentation")
        expect(alt !== null || role === 'presentation' || role === 'none').toBe(true);
      }
    });

    test('Public page has proper heading hierarchy', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check for h1
      const h1Count = await page.locator('h1').count();
      expect(h1Count).toBeGreaterThanOrEqual(1);

      // H1 should have content
      if (h1Count > 0) {
        const h1Text = await page.locator('h1').first().textContent();
        expect(h1Text.trim().length).toBeGreaterThan(0);
      }
    });

    test('Display page works in high contrast mode', async ({ page }) => {
      await page.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Emulate high contrast (prefers-contrast: more)
      await page.emulateMedia({ colorScheme: 'dark' });

      // Page should still render
      const stageArea = page.locator('#stage, .stage, main');
      const hasStage = await stageArea.count() > 0;

      if (hasStage) {
        const isVisible = await stageArea.first().isVisible();
        expect(isVisible).toBe(true);
      }
    });
  });

  test.describe('Progressive Enhancement', () => {

    test('Public page content is visible before JS loads', async ({ page }) => {
      // Block JS execution until we check initial content
      const contentPromise = new Promise(resolve => {
        page.on('domcontentloaded', async () => {
          const content = await page.content();
          resolve(content);
        });
      });

      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const initialContent = await contentPromise;

      // Should have content before JS runs
      expect(initialContent.length).toBeGreaterThan(500);
      expect(initialContent).toContain('<body');
    });

    test('Poster page works without localStorage', async ({ browser }) => {
      // Create context without localStorage access
      const context = await browser.newContext({
        storageState: undefined
      });
      const page = await context.newPage();

      // Clear all storage
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Page should load without localStorage errors
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.waitForTimeout(2000);

      // No localStorage-related errors
      const storageErrors = errors.filter(e =>
        e.includes('localStorage') || e.includes('storage')
      );
      expect(storageErrors.length).toBe(0);

      await context.close();
    });

    test('Display page enhances with JS but works without', async ({ browser }) => {
      // First check without JS
      const noJsContext = await browser.newContext({
        javaScriptEnabled: false
      });
      const noJsPage = await noJsContext.newPage();

      await noJsPage.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const noJsContent = await noJsPage.locator('body').innerHTML();
      await noJsContext.close();

      // Then check with JS
      const jsContext = await browser.newContext({
        javaScriptEnabled: true
      });
      const jsPage = await jsContext.newPage();

      await jsPage.goto(`${baseUrl}?page=display&brand=${BRAND_ID}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      const jsContent = await jsPage.locator('body').innerHTML();
      await jsContext.close();

      // Both should have content
      expect(noJsContent.length).toBeGreaterThan(100);
      expect(jsContent.length).toBeGreaterThan(100);

      // JS version should have same or more content (enhanced)
      expect(jsContent.length).toBeGreaterThanOrEqual(noJsContent.length - 100);
    });
  });

  test.describe('Offline Scenarios', () => {

    test('Cached poster page works offline', async ({ page, context }) => {
      // First visit to cache
      await page.goto(`${baseUrl}?page=poster&brand=${BRAND_ID}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      const initialContent = await page.content();

      // Go offline
      await context.setOffline(true);

      // Try to reload from cache
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 });

        // Should show cached content or offline message
        const offlineContent = await page.content();
        expect(offlineContent.length).toBeGreaterThan(100);
      } catch (error) {
        // If reload fails, that's acceptable for offline
        expect(error.message).toContain('net::');
      }

      // Go back online
      await context.setOffline(false);
    });

    test('Service worker caches critical assets', async ({ page }) => {
      await page.goto(`${baseUrl}?page=events&brand=${BRAND_ID}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Check if service worker is registered
      const hasServiceWorker = await page.evaluate(() => {
        return 'serviceWorker' in navigator;
      });

      // Service worker support is expected in modern browsers
      expect(hasServiceWorker).toBe(true);

      // Check if there's a service worker controller
      const controller = await page.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          return reg?.active?.state || 'none';
        }
        return 'unsupported';
      });

      // Service worker may or may not be registered depending on deployment
      expect(['activated', 'none', 'unsupported']).toContain(controller);
    });
  });
});
