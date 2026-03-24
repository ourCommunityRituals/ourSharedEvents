/**
 * Stage-2 UI Smoke Test: Comprehensive Surface Coverage
 *
 * Story 5 - Full Testing Pipeline: UI Coverage for All MVP Surfaces
 *
 * This test suite validates that ALL 5 MVP surfaces load correctly for
 * ALL brands. It's a comprehensive smoke test that ensures:
 * - Every surface renders without errors
 * - Brand-specific URLs work correctly
 * - No GAS HTML shell leaks
 * - HTTP 503 is detected early (fail-fast)
 *
 * Acceptance Criteria:
 * - All 5 MVP surfaces (Admin, Public, Display, Poster, Report) load
 * - Root brand and at least one child brand tested
 * - Essential UI elements present (or page returned 200 OK)
 * - No 503 errors (fail-fast)
 * - Tests cover brand-prefixed URL variations
 *
 * @see src/mvp/Admin.html, Public.html, Display.html, Poster.html, SharedReport.html
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test';

// Brands to test - root and one child brand
const TEST_BRANDS = ['root', 'abc'];

// All MVP Surfaces with their page parameters and friendly URL aliases
const MVP_SURFACES = [
  {
    name: 'Public',
    page: 'public',
    friendlyUrl: '/events',
    expectedContent: ['event', 'Event', 'schedule', 'Schedule'],
  },
  {
    name: 'Admin',
    page: 'admin',
    friendlyUrl: '/manage',
    expectedContent: ['admin', 'Admin', 'wizard', 'event', 'manage'],
  },
  {
    name: 'Display',
    page: 'display',
    friendlyUrl: '/display',
    expectedContent: ['display', 'Display', 'tv', 'screen'],
  },
  {
    name: 'Poster',
    page: 'poster',
    friendlyUrl: '/poster',
    expectedContent: ['poster', 'Poster', 'qr', 'QR'],
  },
  {
    name: 'Report',
    page: 'report',
    friendlyUrl: '/analytics',
    expectedContent: ['report', 'Report', 'analytics', 'Analytics'],
  },
];

// Console error collector
interface ConsoleError {
  type: string;
  text: string;
  location?: string;
}

function setupConsoleErrorCollector(page: Page): ConsoleError[] {
  const errors: ConsoleError[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      errors.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url,
      });
    }
  });

  return errors;
}

function filterCriticalErrors(errors: ConsoleError[]): ConsoleError[] {
  return errors.filter(err => {
    const text = err.text.toLowerCase();
    // Ignore common non-critical errors
    if (text.includes('favicon')) return false;
    if (text.includes('404') && text.includes('favicon')) return false;
    if (text.includes('cors') && !err.location?.includes(process.env.BASE_URL || '')) return false;
    if (text.includes('google') && text.includes('maps')) return false;
    if (text.includes('youtube') || text.includes('vimeo')) return false;
    if (text.includes('chart') && text.includes('warning')) return false;
    return true;
  });
}

test.describe('Comprehensive Surface Coverage Smoke Tests (Story 5)', () => {

  test.describe('Root Brand - All Surfaces via ?page= Parameter', () => {

    for (const surface of MVP_SURFACES) {
      test(`ROOT: ${surface.name} page loads without HTTP 503/500`, async ({ page }) => {
        const response = await page.goto(`/?page=${surface.page}&brand=root`);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response?.status(), `CRITICAL: ${surface.name} returned 503`).not.toBe(503);
        expect(response?.status()).toBeLessThan(500);
        expect(response?.ok() || response?.status() === 302).toBe(true);
      });

      test(`ROOT: ${surface.name} page has valid HTML structure`, async ({ page }) => {
        await page.goto(`/?page=${surface.page}&brand=root`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('html')).toBeAttached();
        await expect(page.locator('head')).toBeAttached();
        await expect(page.locator('body')).toBeAttached();
      });

      test(`ROOT: ${surface.name} page has content`, async ({ page }) => {
        await page.goto(`/?page=${surface.page}&brand=root`);
        await page.waitForLoadState('networkidle');

        const content = await page.content();
        expect(content.length).toBeGreaterThan(500);
      });

      test(`ROOT: ${surface.name} page has no critical JS errors`, async ({ page }) => {
        const consoleErrors = setupConsoleErrorCollector(page);

        await page.goto(`/?page=${surface.page}&brand=root`);
        await page.waitForLoadState('networkidle');

        const criticalErrors = filterCriticalErrors(consoleErrors);
        expect(criticalErrors, `${surface.name} has ${criticalErrors.length} JS errors`).toHaveLength(0);
      });
    }

  });

  test.describe('Root Brand - All Surfaces via Friendly URLs', () => {

    for (const surface of MVP_SURFACES) {
      test(`ROOT: ${surface.name} page loads via ${surface.friendlyUrl}`, async ({ page }) => {
        const response = await page.goto(surface.friendlyUrl);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response?.status(), `CRITICAL: ${surface.friendlyUrl} returned 503`).not.toBe(503);
        expect(response?.status()).toBeLessThan(500);
      });
    }

  });

  test.describe('Child Brand (abc) - All Surfaces', () => {

    for (const surface of MVP_SURFACES) {
      test(`ABC: ${surface.name} page loads via ?page= parameter`, async ({ page }) => {
        const response = await page.goto(`/?page=${surface.page}&brand=abc`);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response?.status(), `CRITICAL: ABC ${surface.name} returned 503`).not.toBe(503);
        expect(response?.status()).toBeLessThan(500);
        expect(response?.ok() || response?.status() === 302).toBe(true);
      });

      test(`ABC: ${surface.name} page loads via brand-prefixed URL /abc${surface.friendlyUrl}`, async ({ page }) => {
        const response = await page.goto(`/abc${surface.friendlyUrl}`);

        // FAIL-FAST: 503 indicates deployment issue
        expect(response?.status(), `CRITICAL: /abc${surface.friendlyUrl} returned 503`).not.toBe(503);
        expect(response?.status()).toBeLessThan(500);
      });

      test(`ABC: ${surface.name} page has valid content`, async ({ page }) => {
        await page.goto(`/?page=${surface.page}&brand=abc`);
        await page.waitForLoadState('networkidle');

        const content = await page.content();
        expect(content.length).toBeGreaterThan(500);
      });
    }

  });

  test.describe('No GAS HTML Shell Leak - All Surfaces', () => {

    for (const surface of MVP_SURFACES) {
      test(`${surface.name} page does not contain GAS HTML markers`, async ({ page }) => {
        await page.goto(`/?page=${surface.page}&brand=root`);
        await page.waitForLoadState('networkidle');

        const content = await page.content();

        // Story 6 compliance: No GAS HTML markers
        expect(content, `${surface.name} has GAS script.google.com marker`).not.toContain('script.google.com');
        expect(content, `${surface.name} has GAS userCodeAppPanel marker`).not.toContain('userCodeAppPanel');
        expect(content, `${surface.name} has GAS blue banner text`).not.toContain('Google Apps Script');
      });
    }

  });

  test.describe('Surface Content Validation', () => {

    for (const surface of MVP_SURFACES) {
      test(`${surface.name} page has a title`, async ({ page }) => {
        await page.goto(`/?page=${surface.page}&brand=root`);
        await page.waitForLoadState('domcontentloaded');

        const title = await page.title();
        expect(title.length).toBeGreaterThan(0);
      });

      test(`${surface.name} page returns HTML content-type`, async ({ page }) => {
        const response = await page.goto(`/?page=${surface.page}&brand=root`);

        const contentType = response?.headers()['content-type'] || '';
        expect(contentType).toContain('text/html');
      });
    }

  });

  test.describe('Error Handling - All Surfaces', () => {

    for (const surface of MVP_SURFACES) {
      test(`${surface.name} handles invalid event ID gracefully`, async ({ page }) => {
        const response = await page.goto(
          `/?page=${surface.page}&brand=root&id=invalid-event-id-xyz123`
        );

        // Should not return 500/503
        expect(response?.status()).not.toBe(503);
        expect(response?.status()).toBeLessThan(500);
      });
    }

  });

  test.describe('Parallel Surface Access', () => {

    test('all surfaces accessible in rapid succession', async ({ page }) => {
      // Load all surfaces rapidly to simulate real-world access patterns
      for (const surface of MVP_SURFACES) {
        const response = await page.goto(`/?page=${surface.page}&brand=root`);

        expect(response?.status(), `${surface.name} failed`).not.toBe(503);
        expect(response?.status()).toBeLessThan(500);
      }
    });

  });

  test.describe('Comprehensive Coverage Report', () => {

    test('generates surface coverage report', async ({ page }) => {
      const results: {
        surface: string;
        brand: string;
        status: number;
        loadTime: number;
        hasContent: boolean;
        hasErrors: boolean;
      }[] = [];

      for (const brand of TEST_BRANDS) {
        for (const surface of MVP_SURFACES) {
          const consoleErrors = setupConsoleErrorCollector(page);
          const startTime = Date.now();

          const response = await page.goto(`/?page=${surface.page}&brand=${brand}`);
          await page.waitForLoadState('networkidle');

          const endTime = Date.now();
          const content = await page.content();
          const criticalErrors = filterCriticalErrors(consoleErrors);

          results.push({
            surface: surface.name,
            brand: brand,
            status: response?.status() || 0,
            loadTime: endTime - startTime,
            hasContent: content.length > 500,
            hasErrors: criticalErrors.length > 0,
          });
        }
      }

      // Log coverage report
      console.log('\n========== SURFACE COVERAGE REPORT ==========');
      console.log(JSON.stringify(results, null, 2));

      // Calculate summary
      const totalTests = results.length;
      const passed = results.filter(r => r.status < 500 && r.hasContent && !r.hasErrors).length;
      const failed503 = results.filter(r => r.status === 503).length;
      const failed5xx = results.filter(r => r.status >= 500 && r.status !== 503).length;

      console.log('\n========== SUMMARY ==========');
      console.log(`Total: ${totalTests}`);
      console.log(`Passed: ${passed}`);
      console.log(`Failed (503): ${failed503}`);
      console.log(`Failed (5xx): ${failed5xx}`);
      console.log('='.repeat(40));

      // All tests should pass
      expect(failed503, 'CRITICAL: Some surfaces returned 503').toBe(0);
      expect(failed5xx, 'Some surfaces returned 5xx errors').toBe(0);
      expect(passed).toBe(totalTests);
    });

  });

});
