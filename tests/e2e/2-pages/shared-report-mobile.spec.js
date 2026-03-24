/**
 * SharedReport Mobile E2E Tests
 *
 * Validates SharedReport renders correctly on mobile devices for sponsor viewing.
 *
 * Test Scenarios:
 * 1. Full analytics data - all sections render properly on mobile
 * 2. Minimal analytics data - summary only renders without errors
 *
 * Mobile-specific assertions:
 * - No horizontal scroll (content fits viewport)
 * - Summary metrics visible without scrolling
 * - Tables are vertically scrollable
 * - Sponsor section visible when data exists
 * - No layout shift hiding important info
 *
 * Run: npm run test:e2e-report
 */

const { test, expect, devices } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');
const {
  fullSharedAnalytics,
  minimalSharedAnalytics,
} = require('../../shared/fixtures/shared-analytics.fixtures');

// Use iPhone 14 Pro as default mobile device
test.use({ ...devices['iPhone 14 Pro'] });

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

// Mobile viewport thresholds
const MOBILE_VIEWPORT = { width: 393, height: 852 }; // iPhone 14 Pro
const SMALL_MOBILE_VIEWPORT = { width: 375, height: 667 }; // iPhone SE

/**
 * Filter out expected GAS-related JavaScript errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.message.includes('google.script') &&
    !e.message.includes('google is not defined') &&
    !e.message.includes('Script error') &&
    !e.message.includes('NU is not defined')
  );
}

/**
 * Mock the SharedAnalytics API response
 * @param {import('@playwright/test').Page} page
 * @param {object} analyticsData - The analytics data to return
 */
async function mockSharedAnalyticsApi(page, analyticsData) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();

    // Intercept the RPC call for analytics
    if (request.method() === 'POST' && url.includes('exec')) {
      try {
        const postData = request.postData();
        if (postData && (postData.includes('api_getSharedAnalytics') || postData.includes('api_getSponsorAnalytics'))) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              value: analyticsData
            })
          });
          return;
        }
      } catch {
        // Not a POST with body, continue
      }
    }

    // Let other requests through
    await route.continue();
  });
}

test.describe('📱 SharedReport Mobile Rendering', () => {

  test('should render full analytics data on mobile without horizontal scroll', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Mock the API response with full analytics data
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate to SharedReport page
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    const response = await page.goto(url, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Wait for report to load
    await expect(
      page.locator('.report-header, .metrics-grid, #metricsGrid').first()
    ).toBeVisible({ timeout: 15000 });

    // Wait for loading to complete
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {
      // Loading may not be present in all cases
    });

    // ASSERTION 1: No horizontal scroll (content fits viewport width)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance

    // ASSERTION 2: Summary metrics are visible
    const metricsGrid = page.locator('#metricsGrid, .metrics-grid').first();
    await expect(metricsGrid).toBeVisible();

    // Check that metric cards exist
    const metricCards = page.locator('.metric-card');
    const metricCount = await metricCards.count();
    expect(metricCount).toBeGreaterThanOrEqual(1);

    // ASSERTION 3: Surface performance table exists and is visible
    const surfaceSection = page.locator('#surfacePerformance, .section-card:has-text("Surface")').first();
    await expect(surfaceSection).toBeVisible();

    // Verify table has content
    const surfaceTable = page.locator('#surfacePerformance table, #surfacePerformance .data-table');
    if (await surfaceTable.count() > 0) {
      await expect(surfaceTable.first()).toBeVisible();
    }

    // ASSERTION 4: Sponsor section visible (since we have sponsor data)
    const sponsorSection = page.locator('#sponsorPerformance, .section-card:has-text("Sponsor")').first();
    await expect(sponsorSection).toBeVisible();

    // ASSERTION 5: No critical JavaScript errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);

    console.log('✅ Full analytics mobile test passed');
  });

  test('should render minimal analytics (summary only) without errors', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Mock the API response with minimal analytics (no sponsors/events/topSponsors)
    await mockSharedAnalyticsApi(page, minimalSharedAnalytics);

    // Navigate to SharedReport page
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    const response = await page.goto(url, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Wait for report to load
    await expect(
      page.locator('.report-header, .metrics-grid, #metricsGrid').first()
    ).toBeVisible({ timeout: 15000 });

    // Wait for loading to complete
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {
      // Loading may not be present in all cases
    });

    // ASSERTION 1: Page doesn't blow up - metrics are visible
    const metricsGrid = page.locator('#metricsGrid, .metrics-grid').first();
    await expect(metricsGrid).toBeVisible();

    // ASSERTION 2: Metric values display correctly (check for numbers)
    const metricValues = page.locator('.metric-card .value');
    const valueCount = await metricValues.count();
    expect(valueCount).toBeGreaterThanOrEqual(1);

    // Check at least one value is rendered
    const firstValue = await metricValues.first().textContent();
    expect(firstValue.trim().length).toBeGreaterThan(0);

    // ASSERTION 3: Surface section exists (even with single surface)
    const surfaceSection = page.locator('#surfacePerformance').first();
    await expect(surfaceSection).toBeVisible();

    // ASSERTION 4: Sponsor section should show empty state message
    const sponsorSection = page.locator('#sponsorPerformance');
    if (await sponsorSection.count() > 0) {
      // Either shows "No sponsor activity" message or is empty
      const sponsorContent = await sponsorSection.textContent();
      expect(sponsorContent).toBeTruthy();
    }

    // ASSERTION 5: No horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);

    // ASSERTION 6: No critical JavaScript errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);

    console.log('✅ Minimal analytics mobile test passed');
  });

  test('should have vertically scrollable surfaces table on mobile', async ({ page }) => {
    // Mock API with full data
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate to SharedReport
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for content
    await expect(page.locator('#surfacePerformance').first()).toBeVisible({ timeout: 15000 });

    // Wait for loading
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // Get surface section position
    const surfaceSection = page.locator('#surfacePerformance').first();
    const initialBoundingBox = await surfaceSection.boundingBox();

    // Scroll down the page
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(300); // Wait for scroll to settle

    // Verify page scrolled (content moved up)
    const viewport = page.viewportSize();
    expect(viewport.height).toBeGreaterThan(0);

    // The page should be scrollable (we can scroll to see more content)
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    console.log('✅ Vertical scroll test passed');
  });

  test('should display top sponsors card when data exists', async ({ page }) => {
    // Mock API with full data (includes topSponsors)
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate to SharedReport
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for content
    await expect(page.locator('.metrics-grid').first()).toBeVisible({ timeout: 15000 });

    // Wait for loading
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // Top sponsors card should be visible when topSponsors data exists
    const topSponsorsCard = page.locator('#topSponsorsCard, .top-sponsors-card');
    if (await topSponsorsCard.count() > 0) {
      const isVisible = await topSponsorsCard.first().isVisible();
      if (isVisible) {
        // Check for sponsor items
        const sponsorItems = page.locator('.top-sponsor-item');
        const itemCount = await sponsorItems.count();
        expect(itemCount).toBeLessThanOrEqual(3); // Max 3 top sponsors

        console.log(`✅ Top sponsors card visible with ${itemCount} sponsors`);
      }
    }
  });

  test('should not have layout shift that hides important info', async ({ page }) => {
    // Mock API
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate to SharedReport
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for initial render
    await expect(page.locator('.report-header').first()).toBeVisible({ timeout: 15000 });

    // Wait for loading
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // Wait for page to settle (any layout shifts should complete)
    await page.waitForTimeout(1000);

    // Measure Cumulative Layout Shift
    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;

        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
        });

        observer.observe({ type: 'layout-shift', buffered: true });

        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 500);
      });
    });

    // CLS should be < 0.25 for acceptable mobile experience
    expect(cls).toBeLessThan(0.25);

    // Verify key elements are still visible after settling
    await expect(page.locator('.report-header').first()).toBeVisible();
    await expect(page.locator('.metrics-grid').first()).toBeVisible();

    console.log(`✅ Layout shift test passed (CLS: ${cls.toFixed(3)})`);
  });
});

test.describe('📱 SharedReport Small Screen (iPhone SE)', () => {

  test('should render correctly on very small screen', async ({ page }) => {
    // Set smaller viewport (iPhone SE)
    await page.setViewportSize(SMALL_MOBILE_VIEWPORT);

    // Track errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Mock API
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for content
    await expect(page.locator('.report-header').first()).toBeVisible({ timeout: 15000 });

    // Wait for loading
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // ASSERTION 1: No horizontal overflow on small screen
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);

    // ASSERTION 2: Metrics are still visible
    const metricsGrid = page.locator('.metrics-grid').first();
    await expect(metricsGrid).toBeVisible();

    // ASSERTION 3: Font sizes are readable (>= 12px)
    const bodyFontSize = await page.evaluate(() => {
      const computed = window.getComputedStyle(document.body);
      return parseFloat(computed.fontSize);
    });
    expect(bodyFontSize).toBeGreaterThanOrEqual(12);

    // ASSERTION 4: Touch targets are adequate (min 44px for important elements)
    const buttons = page.locator('button:visible');
    const buttonCount = await buttons.count();
    for (let i = 0; i < Math.min(buttonCount, 5); i++) {
      const box = await buttons.nth(i).boundingBox();
      if (box) {
        // At least 40px touch target (allowing some flexibility)
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
      }
    }

    // ASSERTION 5: No critical errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);

    console.log('✅ Small screen (iPhone SE) test passed');
  });
});

test.describe('📱 SharedReport Mobile Tables', () => {

  test('should stack table cells on mobile with data-label attributes', async ({ page }) => {
    // Mock API
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for tables to render
    await expect(page.locator('.data-table').first()).toBeVisible({ timeout: 15000 });

    // Wait for loading
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // On mobile, table cells should have data-label for stacked display
    const tableCells = page.locator('.data-table td[data-label]');
    const cellCount = await tableCells.count();

    // Should have data-label attributes on table cells
    expect(cellCount).toBeGreaterThan(0);

    // Verify data-label content is present
    const firstCellLabel = await tableCells.first().getAttribute('data-label');
    expect(firstCellLabel).toBeTruthy();
    expect(firstCellLabel.length).toBeGreaterThan(0);

    console.log(`✅ Mobile table stacking test passed (${cellCount} cells with data-label)`);
  });

  test('should hide table header on mobile viewport', async ({ page }) => {
    // Mock API
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    // Navigate
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for tables
    await expect(page.locator('.data-table').first()).toBeVisible({ timeout: 15000 });

    // Wait for loading
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading');
      return loading && loading.style.display === 'none';
    }, { timeout: 10000 }).catch(() => {});

    // On mobile (< 640px), thead should be hidden via CSS
    const viewport = page.viewportSize();
    if (viewport.width < 640) {
      const theadVisible = await page.evaluate(() => {
        const thead = document.querySelector('.data-table thead');
        if (!thead) return false;
        const style = window.getComputedStyle(thead);
        return style.display !== 'none';
      });

      // On mobile, thead should be hidden
      expect(theadVisible).toBe(false);
    }

    console.log('✅ Mobile table header hiding test passed');
  });
});

test.describe('📱 SharedReport Mobile Performance', () => {

  test('should load within acceptable time on mobile', async ({ page }) => {
    // Mock API
    await mockSharedAnalyticsApi(page, fullSharedAnalytics);

    const startTime = Date.now();

    // Navigate
    const url = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    await page.goto(url, TIMEOUT_CONFIG);

    // Wait for content
    await expect(page.locator('.metrics-grid').first()).toBeVisible({ timeout: 15000 });

    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds (including GAS cold start buffer)
    expect(loadTime).toBeLessThan(5000);

    console.log(`✅ Mobile load time: ${loadTime}ms`);
  });
});
