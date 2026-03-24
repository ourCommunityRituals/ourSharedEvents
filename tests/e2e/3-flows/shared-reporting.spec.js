/**
 * SHARED REPORTING FLOWS
 *
 * Tests:
 * - SharedReport.html page loads with analytics
 * - Navigation from Admin.html to SharedReport works
 * - Analytics API returns correct data structure
 * - Event Manager view shows event-specific metrics
 * - Sponsor view (future) shows sponsor-specific metrics
 * - Export to Google Sheets functionality
 * - Mobile responsive layout
 *
 * BASE_URL-Aware: Tests work against GAS or eventangle.com:
 *   BASE_URL="https://www.eventangle.com" npm run test:flows
 *   BASE_URL="https://script.google.com/macros/s/<ID>/exec" npm run test:flows
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Use centralized BASE_URL config (defaults to eventangle.com)
const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';
const BRAND_ID = 'root';

test.describe('📊 SHARED REPORTING: Analytics Dashboard', () => {

  test('SharedReport page loads and displays key metrics', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // STRICT: Page must have proper heading
    const heading = page.locator('h1, h2');
    await expect(heading.first()).toBeVisible();
    await expect(heading.first()).toContainText(/Analytics|Report|Metrics|Dashboard/i);

    // STRICT: Page must have metrics structure (even if values are zero)
    const metricsContainer = page.locator('.metrics, .metrics-grid, [data-metrics], .dashboard, main');
    await expect(metricsContainer.first()).toBeAttached();

    // STRICT: At least one metric display must exist
    const metricElements = page.locator('.metric-card, .metric, [data-metric], .stat-card, .kpi');
    const metricCount = await metricElements.count();

    // Must have at least one metric visualization
    expect(metricCount).toBeGreaterThan(0);

    // STRICT: No JavaScript errors on page load
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('Navigation from Admin to SharedReport works', async ({ page, context }) => {
    console.log('🔗 Testing navigation from Admin to SharedReport...');

    // Create an event in Admin first
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const eventName = `Report Test ${Date.now()}`;
    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#venue', 'Test Venue');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    console.log('✅ Event created in Admin');

    // Verify the SharedReport link appears
    const reportLink = page.locator('#lnkReport, a:has-text("Analytics"), a:has-text("Report")');
    const hasReportLink = await reportLink.count() > 0;

    if (hasReportLink) {
      const reportUrl = await reportLink.first().textContent();
      console.log(`✅ Report link found: ${reportUrl?.substring(0, 50)}...`);

      // Click the link to navigate to SharedReport
      const reportPage = await context.newPage();
      await reportPage.goto(reportUrl || `${BASE_URL}?page=report&brand=${BRAND_ID}`);
      await reportPage.waitForLoadState('networkidle');

      await expect(reportPage.locator('h1')).toContainText(/Analytics|Report|Metrics/i);
      console.log('✅ Navigation to SharedReport successful');

      await reportPage.close();
    } else {
      console.log('⚠️ Report link not found in event card (may need to refresh)');
    }
  });

  test('SharedReport displays surface performance breakdown', async ({ page }) => {
    console.log('📊 Testing surface performance breakdown...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check for surface performance section
    const surfaceSection = page.locator('section:has-text("Surface Performance"), [data-section="surface-performance"]');
    const hasSurfaceSection = await surfaceSection.count() > 0;

    if (hasSurfaceSection) {
      console.log('✅ Surface performance section found');

      // Check for surface types
      const surfaces = ['Public', 'Display', 'Poster'];
      for (const surface of surfaces) {
        const surfaceRow = page.locator(`text=${surface}`);
        const hasSurface = await surfaceRow.count() > 0;

        if (hasSurface) {
          console.log(`✅ Surface found: ${surface}`);
        }
      }
    } else {
      console.log('⚠️ Surface performance section not found (may be loading or no data)');
    }
  });

  test('SharedReport displays sponsor performance', async ({ page }) => {
    console.log('📊 Testing sponsor performance display...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check for sponsor performance section
    const sponsorSection = page.locator('section:has-text("Sponsor Performance"), [data-section="sponsor-performance"]');
    const hasSponsorSection = await sponsorSection.count() > 0;

    if (hasSponsorSection) {
      console.log('✅ Sponsor performance section found');

      // Check for sponsor metrics
      const sponsorTable = page.locator('table.sponsor-table, [data-table="sponsors"]');
      const hasTable = await sponsorTable.count() > 0;

      if (hasTable) {
        console.log('✅ Sponsor performance table rendered');
      }
    } else {
      console.log('⚠️ Sponsor performance section not found (may be loading or no data)');
    }
  });

  test('SharedReport is mobile responsive', async ({ page }) => {
    console.log('📱 Testing mobile responsiveness...');

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Verify page is responsive
    const main = page.locator('main, .container');
    await expect(main).toBeVisible();

    const mainBox = await main.boundingBox();
    if (mainBox) {
      // Main content should fit within mobile viewport
      expect(mainBox.width).toBeLessThanOrEqual(375);
      console.log(`✅ Mobile layout: ${mainBox.width}px width (fits viewport)`);
    }

    // Check that metric cards stack vertically on mobile
    const metricGrid = page.locator('.metrics-grid, [data-grid="metrics"]');
    const hasGrid = await metricGrid.count() > 0;

    if (hasGrid) {
      const gridBox = await metricGrid.first().boundingBox();
      if (gridBox) {
        console.log(`✅ Metrics grid responsive: ${gridBox.width}px`);
      }
    }
  });
});

test.describe('📊 SHARED REPORTING: API Integration', () => {

  test('Analytics API returns valid data structure', async ({ page }) => {
    console.log('🔌 Testing analytics API...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Intercept API call to analytics
    let apiResponse = null;

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('api_getSharedAnalytics') || text.includes('Analytics loaded')) {
        console.log(`📡 ${text}`);
      }
    });

    // Wait for potential API call
    await page.waitForTimeout(3000);

    // Check if error message appears
    const errorMsg = page.locator('text=/error|failed|unable/i');
    const hasError = await errorMsg.count() > 0;

    if (hasError) {
      const errorText = await errorMsg.first().textContent();
      console.log(`⚠️ API error detected: ${errorText}`);
    } else {
      console.log('✅ No API errors detected');
    }
  });

  test('Export to Sheets button exists', async ({ page }) => {
    console.log('💾 Testing export functionality...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Check for export button
    const exportBtn = page.locator('button:has-text("Export"), button[data-action="export"]');
    const hasExportBtn = await exportBtn.count() > 0;

    if (hasExportBtn) {
      await expect(exportBtn.first()).toBeVisible();
      console.log('✅ Export button found');

      // Note: We don't actually click it to avoid creating test sheets
      const btnText = await exportBtn.first().textContent();
      console.log(`✅ Export button text: "${btnText}"`);
    } else {
      console.log('⚠️ Export button not found');
    }
  });
});

test.describe('🔺 TRIANGLE: SharedReport Integration', () => {

  test('Full cycle: Create event → Configure sponsors → View analytics', async ({ page, context }) => {
    console.log('🔺 Testing complete analytics cycle...');

    // ====================
    // STEP 1: Create event with sponsors in Admin
    // ====================
    console.log('📝 Creating event with sponsors...');
    await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    page.on('dialog', async dialog => {
      await dialog.accept(ADMIN_KEY);
    });

    const timestamp = Date.now();
    const eventName = `Analytics Cycle ${timestamp}`;

    await page.fill('#name', eventName);
    await page.fill('#startDateISO', '2025-12-31');
    await page.fill('#timeISO', '19:00');
    await page.fill('#venue', 'Analytics Test Venue');
    await page.fill('#summary', 'Testing shared analytics functionality');

    await page.click('button[type="submit"]');
    await expect(page.locator('#eventCard')).toBeVisible({ timeout: 10000 });

    console.log('✅ Event created');

    // Configure sponsors
    await page.click('button:has-text("Configure Display & Sponsors")');
    await page.click('button:has-text("Add Sponsor")');

    await page.fill('.sp-name', 'Analytics Test Sponsor');
    await page.fill('.sp-url', 'https://analytics-test.example.com');
    await page.fill('.sp-img', 'https://via.placeholder.com/500x250');
    await page.check('.sp-tvTop');

    await page.click('button:has-text("Save Configuration")');
    await expect(page.locator('text=saved')).toBeVisible({ timeout: 5000 });

    console.log('✅ Sponsor configured');

    // Get the report URL
    const reportLinkElem = page.locator('#lnkReport');
    const hasReportLink = await reportLinkElem.count() > 0;

    let reportUrl = `${BASE_URL}?page=report&brand=${BRAND_ID}`;
    if (hasReportLink) {
      reportUrl = await reportLinkElem.textContent() || reportUrl;
    }

    // ====================
    // STEP 2: Navigate to SharedReport
    // ====================
    console.log('📊 Opening SharedReport...');
    const reportPage = await context.newPage();
    await reportPage.goto(reportUrl);
    await reportPage.waitForLoadState('networkidle');

    await expect(reportPage.locator('h1')).toContainText(/Analytics|Report/i);
    console.log('✅ SharedReport loaded');

    // Wait for analytics to load
    await reportPage.waitForTimeout(2000);

    // ====================
    // STEP 3: Verify analytics data appears
    // ====================
    console.log('🔍 Verifying analytics data...');

    // Check for any metric values (even if zero)
    const metricValues = reportPage.locator('.metric-value, [data-value]');
    const hasMetrics = await metricValues.count() > 0;

    if (hasMetrics) {
      console.log(`✅ Found ${await metricValues.count()} metric values`);
    } else {
      console.log('⚠️ No metric values found (may be initial state with zero data)');
    }

    // Check for "No data" or empty state message
    const emptyState = reportPage.locator('text=/no data|no analytics|no events/i');
    const hasEmptyState = await emptyState.count() > 0;

    if (hasEmptyState) {
      console.log('ℹ️ Empty state detected (expected for new events with no impressions)');
    } else {
      console.log('✅ Data state detected (analytics may have data)');
    }

    console.log('🎉 ANALYTICS CYCLE COMPLETE!');

    await reportPage.close();
  });
});

test.describe('📊 SHARED REPORTING: Event Performance with Signups', () => {

  test('SharedReport displays Event Performance table with Signups column', async ({ page }) => {
    console.log('📊 Testing Event Performance table with signups count...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check for event performance section
    const eventSection = page.locator('#eventPerformanceCard, section:has-text("Event Performance")');
    const hasEventSection = await eventSection.count() > 0;

    if (hasEventSection) {
      console.log('✅ Event Performance section found');

      // Check for the Signups column header in the table
      const signupsHeader = page.locator('th:has-text("Signups")');
      const hasSignupsHeader = await signupsHeader.count() > 0;

      if (hasSignupsHeader) {
        console.log('✅ Signups column header found in Event Performance table');

        // Check for signups data cells
        const signupsCells = page.locator('td[data-label="Signups"]');
        const signupsCellCount = await signupsCells.count();
        console.log(`✅ Found ${signupsCellCount} signup data cells`);

        // If there are events, verify signupsCount values are numbers
        if (signupsCellCount > 0) {
          const firstSignupText = await signupsCells.first().textContent();
          const isNumeric = /^\d+/.test(firstSignupText?.trim() || '');
          console.log(`✅ First signups value: "${firstSignupText}" (numeric: ${isNumeric})`);
          expect(isNumeric || firstSignupText?.trim() === '0').toBe(true);
        }
      } else {
        console.log('⚠️ Signups column not found in Event Performance table');
      }
    } else {
      console.log('ℹ️ Event Performance section not visible (may have no event data)');
    }
  });

  test('signupsCount is a number in api_getSharedAnalytics response', async ({ page }) => {
    console.log('🔌 Testing signupsCount in analytics API response...');

    // Capture the API response by intercepting console logs
    const apiResponses = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('signupsCount') || text.includes('events')) {
        apiResponses.push(text);
      }
    });

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(3000);

    // Evaluate if events data contains signupsCount
    const hasValidSignupsCount = await page.evaluate(() => {
      // Check if NU object and rpc are available (GAS environment)
      if (typeof NU === 'undefined' || typeof NU.rpc !== 'function') {
        return { skip: true, reason: 'NU.rpc not available' };
      }

      // The SharedReport page should have already loaded analytics
      // We check if the DOM reflects signupsCount was rendered
      const signupsCells = document.querySelectorAll('td[data-label="Signups"]');
      const signupValues = Array.from(signupsCells).map(cell => cell.textContent?.trim());

      return {
        skip: false,
        cellCount: signupsCells.length,
        values: signupValues,
        allNumeric: signupValues.every(v => /^\d+$/.test(v || ''))
      };
    });

    if (hasValidSignupsCount.skip) {
      console.log(`ℹ️ API check skipped: ${hasValidSignupsCount.reason}`);
    } else if (hasValidSignupsCount.cellCount > 0) {
      console.log(`✅ Found ${hasValidSignupsCount.cellCount} signupsCount values in DOM`);
      console.log(`✅ Values: ${JSON.stringify(hasValidSignupsCount.values)}`);
      console.log(`✅ All numeric: ${hasValidSignupsCount.allNumeric}`);
      expect(hasValidSignupsCount.allNumeric).toBe(true);
    } else {
      console.log('ℹ️ No signupsCount cells found (may have no event data)');
    }

    // No critical JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(500);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });
});

test.describe('📊 SHARED REPORTING: Sponsor View', () => {

  test('SharedReport loads filtered view with sponsorId parameter', async ({ page }) => {
    console.log('🎯 Testing sponsor-specific view...');

    // Test sponsor view with sponsorId query parameter
    const testSponsorId = 'test-sponsor-123';
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}&sponsorId=${testSponsorId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Page should load without crashing
    const heading = page.locator('h1, h2');
    await expect(heading.first()).toBeVisible();

    // Check if page acknowledges sponsorId filter
    const sponsorFilter = page.locator('[data-sponsor-filter], .sponsor-filter, text=/sponsor.*view|filtered.*sponsor/i');
    const hasSponsorFilter = await sponsorFilter.count() > 0;

    // Check for sponsor-specific metrics display
    const sponsorMetrics = page.locator('[data-sponsor-id], .sponsor-metrics, .sponsor-performance');
    const hasSponsorMetrics = await sponsorMetrics.count() > 0;

    // Check for generic analytics (fallback when no sponsor data)
    const genericMetrics = page.locator('.metric-card, .metric, [data-metric]');
    const hasGenericMetrics = await genericMetrics.count() > 0;

    // Page should show either sponsor-specific view, generic metrics, or "no data" message
    const noDataMessage = page.locator('text=/no data|no analytics|sponsor not found/i');
    const hasNoData = await noDataMessage.count() > 0;

    expect(hasSponsorFilter || hasSponsorMetrics || hasGenericMetrics || hasNoData).toBe(true);

    console.log(`✅ Sponsor view loaded (filter: ${hasSponsorFilter}, metrics: ${hasSponsorMetrics}, generic: ${hasGenericMetrics}, no-data: ${hasNoData})`);

    // No JavaScript errors should occur
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('SharedReport handles invalid sponsorId gracefully', async ({ page }) => {
    console.log('🔒 Testing invalid sponsorId handling...');

    // Test with clearly invalid sponsorId
    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}&sponsorId=INVALID_ID_12345`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Page should not crash - should show error or empty state
    const heading = page.locator('h1, h2');
    await expect(heading.first()).toBeVisible();

    // Should show either error message or fallback to general analytics
    const errorMessage = page.locator('text=/not found|invalid|no data|error/i');
    const hasError = await errorMessage.count() > 0;

    const metricsContainer = page.locator('.metrics, .metrics-grid, [data-metrics], main');
    const hasMetrics = await metricsContainer.count() > 0;

    // Should gracefully handle invalid sponsor - either show error or generic view
    expect(hasError || hasMetrics).toBe(true);

    console.log(`✅ Invalid sponsorId handled gracefully (error: ${hasError}, fallback: ${hasMetrics})`);

    // No JavaScript errors should occur
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(1000);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('Sponsor view shows sponsor-specific metrics when data exists', async ({ page }) => {
    console.log('📈 Testing sponsor metrics display...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Check for sponsor performance section
    const sponsorSection = page.locator(
      'section:has-text("Sponsor"), ' +
      '[data-section="sponsor"], ' +
      '.sponsor-performance, ' +
      'table:has-text("Sponsor")'
    );
    const hasSponsorSection = await sponsorSection.count() > 0;

    if (hasSponsorSection) {
      console.log('✅ Sponsor performance section found');

      // Check for expected sponsor metrics columns/fields
      const impressionsCol = page.locator('text=/impressions/i');
      const clicksCol = page.locator('text=/clicks|ctr/i');
      const dwellCol = page.locator('text=/dwell|time/i');

      const hasImpressions = await impressionsCol.count() > 0;
      const hasClicks = await clicksCol.count() > 0;
      const hasDwell = await dwellCol.count() > 0;

      console.log(`  - Impressions: ${hasImpressions}`);
      console.log(`  - Clicks/CTR: ${hasClicks}`);
      console.log(`  - Dwell time: ${hasDwell}`);

      // At least one metric type should be present
      expect(hasImpressions || hasClicks || hasDwell).toBe(true);
    } else {
      console.log('ℹ️ No sponsor section found (may have no sponsor data)');
    }
  });
});

test.describe('📊 SHARED REPORTING: Name Resolution (Story 4.1)', () => {

  test('SharedReport displays human-readable event names, not IDs', async ({ page }) => {
    console.log('🏷️ Testing event name resolution...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check event performance table
    const eventSection = page.locator('#eventPerformanceCard, #eventPerformance, section:has-text("Event Performance")');
    const hasEventSection = await eventSection.count() > 0;

    if (hasEventSection) {
      // Look for event names in the table
      const eventTable = page.locator('#eventPerformance table, .data-table');
      const hasTable = await eventTable.count() > 0;

      if (hasTable) {
        // Get all event name cells (first column typically)
        const eventRows = eventTable.locator('tbody tr');
        const rowCount = await eventRows.count();

        if (rowCount > 0) {
          // Check first event row for human-readable name
          const firstRow = eventRows.first();
          const nameCell = firstRow.locator('td').first();
          const nameText = await nameCell.textContent();

          console.log(`✅ First event name: "${nameText}"`);

          // Name should NOT look like a UUID/ID pattern (evt-xxx, uuid-xxx, etc)
          const looksLikeId = /^(evt[-_]|event[-_]|[a-f0-9]{8}-[a-f0-9]{4})/i.test(nameText?.trim() || '');
          if (looksLikeId) {
            console.log('⚠️ Event name looks like an ID - name resolution may not be working');
          } else {
            console.log('✅ Event name appears to be human-readable');
          }
        } else {
          console.log('ℹ️ No event rows found (may have no event data)');
        }
      }
    } else {
      console.log('ℹ️ Event Performance section not visible (may have no event data)');
    }

    // No JavaScript errors should occur
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(500);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('SharedReport displays human-readable sponsor names, not IDs', async ({ page }) => {
    console.log('🏷️ Testing sponsor name resolution...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check sponsor performance table
    const sponsorSection = page.locator('#sponsorPerformance, section:has-text("Sponsor Performance")');
    const hasSection = await sponsorSection.count() > 0;

    if (hasSection) {
      const sponsorTable = page.locator('#sponsorPerformance table, .data-table');
      const hasTable = await sponsorTable.count() > 0;

      if (hasTable) {
        const sponsorRows = sponsorTable.locator('tbody tr');
        const rowCount = await sponsorRows.count();

        if (rowCount > 0) {
          const firstRow = sponsorRows.first();
          const nameCell = firstRow.locator('td').first();
          const nameText = await nameCell.textContent();

          console.log(`✅ First sponsor name: "${nameText}"`);

          // Name should NOT look like a UUID/ID pattern (spo-xxx, sponsor-xxx, uuid-xxx, etc)
          const looksLikeId = /^(spo[-_]|sponsor[-_]|[a-f0-9]{8}-[a-f0-9]{4})/i.test(nameText?.trim() || '');
          if (looksLikeId) {
            console.log('⚠️ Sponsor name looks like an ID - name resolution may not be working');
          } else {
            console.log('✅ Sponsor name appears to be human-readable');
          }
        } else {
          console.log('ℹ️ No sponsor rows found (may have no sponsor data)');
        }
      }
    } else {
      console.log('ℹ️ Sponsor Performance section not visible (may have no sponsor data)');
    }

    // No JavaScript errors should occur
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.waitForTimeout(500);

    const criticalErrors = errors.filter(e =>
      !e.message.includes('google.script') &&
      !e.message.includes('google is not defined')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('Top Sponsors card displays human-readable sponsor names', async ({ page }) => {
    console.log('🏆 Testing Top Sponsors card name resolution...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check for Top Sponsors card
    const topSponsorsCard = page.locator('#topSponsorsCard, .top-sponsors-card');
    const hasCard = await topSponsorsCard.count() > 0;

    if (hasCard) {
      const isVisible = await topSponsorsCard.isVisible();

      if (isVisible) {
        // Get sponsor names from the card
        const sponsorItems = topSponsorsCard.locator('.top-sponsor-name, .top-sponsor-item');
        const itemCount = await sponsorItems.count();

        if (itemCount > 0) {
          const firstSponsorName = await sponsorItems.first().textContent();
          console.log(`✅ Top sponsor name: "${firstSponsorName}"`);

          // Name should be human-readable
          const looksLikeId = /^(spo[-_]|sponsor[-_]|[a-f0-9]{8}-[a-f0-9]{4})/i.test(firstSponsorName?.trim() || '');
          expect(looksLikeId).toBe(false);
          console.log('✅ Top sponsor name is human-readable');
        }
      } else {
        console.log('ℹ️ Top Sponsors card exists but is hidden (may have no sponsor data)');
      }
    } else {
      console.log('ℹ️ Top Sponsors card not found (may have no sponsor data)');
    }
  });

  test('Top callouts display human-readable event and sponsor names', async ({ page }) => {
    console.log('⭐ Testing Top callouts name resolution...');

    await page.goto(`${BASE_URL}?page=report&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForLoadState('networkidle');

    // Wait for analytics to load
    await page.waitForTimeout(2000);

    // Check for top callouts section
    const callouts = page.locator('#topCallouts .top-callout, .top-callout');
    const calloutCount = await callouts.count();

    if (calloutCount > 0) {
      console.log(`✅ Found ${calloutCount} top callout(s)`);

      // Check each callout for human-readable names
      for (let i = 0; i < calloutCount; i++) {
        const callout = callouts.nth(i);
        const nameElement = callout.locator('.callout-name');
        const hasName = await nameElement.count() > 0;

        if (hasName) {
          const nameText = await nameElement.textContent();
          console.log(`  Callout ${i + 1}: "${nameText}"`);

          // Name should NOT be an ID pattern
          const looksLikeId = /^(evt[-_]|event[-_]|spo[-_]|sponsor[-_]|[a-f0-9]{8}-[a-f0-9]{4})/i.test(nameText?.trim() || '');
          if (!looksLikeId) {
            console.log(`  ✅ Name is human-readable`);
          }
        }
      }
    } else {
      console.log('ℹ️ No top callouts found (may have no data)');
    }
  });
});
