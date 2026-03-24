/**
 * SharedReport Surface Smoke Test - Story 6
 *
 * Happy-path E2E test for SharedReport (Analytics) surface:
 * 1. Load ?page=report&event=<fixtureId>
 * 2. Assert top-level KPIs and at least one table render
 *
 * Run: BASE_URL="https://www.eventangle.com/events" npm run test:smoke
 *
 * Fixture ID: Set FIXTURE_EVENT_ID env var, or test will load default report
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

// Configuration
const BASE_URL = getBaseUrl();
const BRAND_ID = process.env.BRAND_ID || 'root';
const FIXTURE_EVENT_ID = process.env.FIXTURE_EVENT_ID || null;

// Timeout config for GAS cold starts
const TIMEOUT_CONFIG = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

/**
 * Filter out expected GAS-related JavaScript errors
 */
function filterCriticalErrors(errors) {
  return errors.filter(e =>
    !e.message.includes('google.script') &&
    !e.message.includes('google is not defined') &&
    !e.message.includes('Script error')
  );
}

test.describe('SharedReport Surface Smoke Test', () => {
  test('SharedReport: Load page, verify KPIs and tables render', async ({ page }) => {
    // Track JavaScript errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));

    // Step 1: Load SharedReport page
    const url = FIXTURE_EVENT_ID
      ? `${BASE_URL}?page=report&brand=${BRAND_ID}&id=${FIXTURE_EVENT_ID}`
      : `${BASE_URL}?page=report&brand=${BRAND_ID}`;

    const response = await page.goto(url, TIMEOUT_CONFIG);
    expect(response.status()).toBe(200);

    // Step 2: Wait for report container to load
    await expect(
      page.locator('.report-header, .metrics-grid, .analytics-dashboard, #analytics, main, .container, .report-container').first()
    ).toBeVisible({ timeout: 15000 });

    // Step 3: Verify top-level KPIs are rendered
    const kpiSelectors = [
      // Metric card containers
      '.metric-card',
      '.metric',
      '.stat-card',
      '.kpi',
      '.kpi-card',
      '[data-metric]',
      // Specific metric elements
      '#totalImpressions',
      '#totalClicks',
      '#clickThroughRate',
      '#dwellTime',
      '#qrScans',
      '#signups',
      // Alternative metric displays
      '.metrics-grid > *',
      '.stats-container > *',
      '.stats-grid > *',
      '.summary-stats > *',
    ];

    let kpiFound = false;
    let kpiCount = 0;

    for (const selector of kpiSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        kpiFound = true;
        kpiCount = Math.max(kpiCount, count);
      }
    }

    // Fallback: Check for analytics headings that suggest report content
    if (!kpiFound) {
      const analyticsHeadings = page.locator(
        'h1:has-text("Analytics"), h1:has-text("Report"), ' +
        'h2:has-text("Metrics"), h2:has-text("Performance"), ' +
        'h2:has-text("Summary"), h2:has-text("Statistics"), ' +
        '.section-card, .data-card'
      );
      const headingCount = await analyticsHeadings.count();
      if (headingCount > 0) {
        kpiFound = true;
        console.log(`Analytics headings found: ${headingCount}`);
      }
    }

    console.log(`KPI/metric elements found: ${kpiCount}`);
    expect(kpiFound).toBe(true);

    // Step 4: Verify at least one table renders
    const tableSelectors = [
      '.analytics-table',
      'table#analytics',
      'table',
      '.data-table',
      '.report-table',
      'table.table',
      '[role="table"]',
      '.table-container table',
      // Alternative data displays
      '.chart',
      'canvas',
      '.chart-container',
      'svg.chart',
    ];

    let tableFound = false;
    let tableCount = 0;

    for (const selector of tableSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        tableFound = true;
        tableCount += count;
        console.log(`Table/chart found with selector "${selector}": ${count}`);
      }
    }

    // If no explicit table, check for any data rows or list items
    if (!tableFound) {
      const dataRows = page.locator('tr, .data-row, li.metric-item, .list-item');
      const rowCount = await dataRows.count();
      if (rowCount > 3) {
        tableFound = true;
        console.log(`Data rows found: ${rowCount}`);
      }
    }

    console.log(`Total tables/charts found: ${tableCount}`);
    expect(tableFound).toBe(true);

    // Step 5: Verify page structure includes key report sections
    const sectionSelectors = [
      '.report-header',
      '.metrics-grid',
      '.section-card',
      '.analytics-table',
      '.chart',
      'canvas',
      '.summary-section',
      '.data-section',
    ];

    let sectionCount = 0;
    for (const selector of sectionSelectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      sectionCount += count;
    }
    console.log(`Report sections found: ${sectionCount}`);

    // Step 6: Verify no critical JS errors
    const criticalErrors = filterCriticalErrors(errors);
    expect(criticalErrors.length).toBe(0);
  });
});
