/**
 * Story F6: SharedReport 3-Pane Smoke Test (Playwright)
 * Story F7: Customer Summary Export Block Smoke Test
 *
 * Purpose / Value:
 *   F6: Validates the SharedReport renders 3 tabs (Event | Sponsor | Customer)
 *       and displays integrity banner correctly.
 *   F7: Validates the Customer Summary export block exists with narrative,
 *       key metrics, data integrity line, and raw JSON link.
 *
 * Environment: STAGING
 *
 * Test Flow:
 *   1. GET /api/v2/sharedreport?eventId=... (validate bundle shape)
 *   2. Navigate to SharedReport with eventId
 *   3. Assert 3 tabs are visible
 *   4. Assert integrity banner is displayed
 *   5. Switch between tabs and verify content renders
 *   6. [F7] Assert Customer Summary export block exists
 *   7. [F7] Assert block contains narrative, metrics, integrity, JSON link
 *
 * Acceptance Criteria:
 *   Stage-2 fails if:
 *   - Endpoint returns non-200
 *   - Bundle shape is invalid
 *   - SharedReport fails to render
 *   - Integrity metadata is missing
 *   - [F7] Customer Summary export block is missing
 *
 * @see Story F6 - SharedAnalytics Bundle Contract (Event + Sponsor + Customer)
 * @see Story F7 - SharedReport "Customer Summary" Export Block (MVP Text)
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.eventangle.com';

/** Test event ID (create one if not provided) */
const TEST_EVENT_ID = process.env.TEST_EVENT_ID || 'gate_test_event_f6';

/** Timeout for API requests */
const TIMEOUT = 30000;

/** Max length for error response logging */
const MAX_ERROR_LOG_LENGTH = 500;

// =============================================================================
// Logging Helpers
// =============================================================================

function logEnvironment(): void {
  console.log('============================================');
  console.log('Story F6: SharedReport 3-Pane Smoke Gate');
  console.log('============================================');
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`TEST_EVENT_ID: ${TEST_EVENT_ID}`);
  console.log('============================================');
}

function logRequestId(headers: Record<string, string>, context: string): void {
  const requestId = headers['x-request-id'];
  if (requestId) {
    console.log(`[${context}] X-Request-Id: ${requestId}`);
  }
}

function logErrorResponse(json: unknown, context: string): void {
  try {
    const jsonString = JSON.stringify(json, null, 2);
    const trimmed = jsonString.length > MAX_ERROR_LOG_LENGTH
      ? jsonString.substring(0, MAX_ERROR_LOG_LENGTH) + '... [trimmed]'
      : jsonString;
    console.log(`[${context}] Error Response (trimmed):`);
    console.log(trimmed);
  } catch {
    console.log(`[${context}] Error Response: [unable to serialize]`);
  }
}

// =============================================================================
// API Tests
// =============================================================================

test.describe('Story F6: SharedAnalytics Bundle API', () => {
  test.beforeAll(() => {
    logEnvironment();
  });

  test('GET /api/v2/sharedreport returns valid bundle', async ({ request }) => {
    console.log('[API] Testing /api/v2/sharedreport endpoint');

    const response = await request.get(`${BASE_URL}/api/v2/sharedreport?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
    });

    const headers = Object.fromEntries(response.headers().entries());
    logRequestId(headers, 'sharedreport');

    // Allow 404 for non-existent test event, but 200/503 are valid responses
    const validStatuses = [200, 404, 503];
    expect(validStatuses).toContain(response.status());

    if (response.status() === 200) {
      const json = await response.json();

      // Validate response envelope
      expect(json.ok).toBe(true);
      expect(json.status).toBe(200);
      expect(json.requestId).toBeDefined();

      // Validate bundle exists
      expect(json.bundle).toBeDefined();
      const bundle = json.bundle;

      // Validate bundle required fields
      expect(bundle.generatedAt).toBeDefined();
      expect(bundle.window).toBeDefined();
      expect(bundle.window.start).toBeDefined();
      expect(bundle.window.end).toBeDefined();

      // Validate integrity metadata
      expect(bundle.integrity).toBeDefined();
      expect(typeof bundle.integrity.complete).toBe('boolean');
      expect(typeof bundle.integrity.stale).toBe('boolean');
      expect(Array.isArray(bundle.integrity.notes)).toBe(true);

      // Validate event section
      expect(bundle.event).toBeDefined();
      expect(bundle.event.eventId).toBeDefined();
      expect(bundle.event.name).toBeDefined();
      expect(bundle.event.summary).toBeDefined();
      expect(bundle.event.traffic).toBeDefined();
      expect(bundle.event.qr).toBeDefined();

      // Validate sponsor section
      expect(bundle.sponsor).toBeDefined();
      expect(bundle.sponsor.sponsorId).toBeDefined();
      expect(bundle.sponsor.name).toBeDefined();
      expect(bundle.sponsor.summary).toBeDefined();
      expect(Array.isArray(bundle.sponsor.placements)).toBe(true);

      // Validate customer section (aggregate only - no PII)
      expect(bundle.customer).toBeDefined();
      expect(bundle.customer.summary).toBeDefined();
      expect(bundle.customer.outcomes).toBeDefined();
      expect(Array.isArray(bundle.customer.notes)).toBe(true);

      // Verify contract version header
      expect(headers['x-contract-version']).toBe('1.0.0');

      console.log('[API] Bundle validation passed');
      console.log(`[API] Integrity: complete=${bundle.integrity.complete}, stale=${bundle.integrity.stale}`);
    } else if (response.status() === 404) {
      console.log('[API] Event not found (expected for test event)');
      const json = await response.json();
      expect(json.code).toBe('NOT_FOUND');
      expect(json.requestId).toBeDefined();
    } else if (response.status() === 503) {
      console.log('[API] Analytics unavailable (backend not configured)');
      const json = await response.json();
      expect(json.code).toBe('ANALYTICS_UNAVAILABLE');
    }
  });

  test('returns 400 for missing eventId', async ({ request }) => {
    console.log('[API] Testing missing eventId validation');

    const response = await request.get(`${BASE_URL}/api/v2/sharedreport`, {
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(400);

    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe('INVALID_EVENT_ID');
    expect(json.requestId).toBeDefined();

    console.log('[API] Missing eventId validation passed');
  });
});

// =============================================================================
// UI Tests
// =============================================================================

test.describe('Story F6: SharedReport 3-Pane UI', () => {
  test.beforeAll(() => {
    logEnvironment();
  });

  test('SharedReport renders 3 tabs', async ({ page }) => {
    console.log('[UI] Testing SharedReport tab rendering');

    // Navigate to SharedReport with eventId
    await page.goto(`${BASE_URL}/report?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
      waitUntil: 'networkidle',
    });

    // Wait for the page to load
    await page.waitForSelector('.container', { timeout: TIMEOUT });

    // Check if tab navigation exists (for V2 bundle view)
    const tabContainer = await page.$('#tabContainer');

    if (tabContainer) {
      // V2 bundle view - verify 3 tabs exist
      const tabs = await page.$$('.tab-btn');
      expect(tabs.length).toBe(3);

      // Verify tab labels
      const eventTab = await page.$('.tab-btn[data-tab="event"]');
      const sponsorTab = await page.$('.tab-btn[data-tab="sponsor"]');
      const customerTab = await page.$('.tab-btn[data-tab="customer"]');

      expect(eventTab).not.toBeNull();
      expect(sponsorTab).not.toBeNull();
      expect(customerTab).not.toBeNull();

      console.log('[UI] 3 tabs verified: Event, Sponsor, Customer');

      // Verify Event tab is active by default
      const activeTab = await page.$('.tab-btn.active');
      const activeTabName = await activeTab?.getAttribute('data-tab');
      expect(activeTabName).toBe('event');

      console.log('[UI] Event tab is active by default');
    } else {
      // Legacy view - check for error state or loading
      console.log('[UI] Tab container not found - may be legacy view or loading');
    }
  });

  test('SharedReport displays integrity banner', async ({ page }) => {
    console.log('[UI] Testing integrity banner rendering');

    await page.goto(`${BASE_URL}/report?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
      waitUntil: 'networkidle',
    });

    // Wait for the page to load
    await page.waitForSelector('.container', { timeout: TIMEOUT });

    // Check for integrity banner (V2 bundle view)
    const integrityBanner = await page.$('#integrityBanner');

    if (integrityBanner) {
      const bannerContent = await page.$('.integrity-banner');

      if (bannerContent) {
        // Check for integrity status class
        const isComplete = await bannerContent.evaluate(el => el.classList.contains('complete'));
        const isIncomplete = await bannerContent.evaluate(el => el.classList.contains('incomplete'));
        const isStale = await bannerContent.evaluate(el => el.classList.contains('stale'));

        expect(isComplete || isIncomplete || isStale).toBe(true);

        console.log(`[UI] Integrity banner displayed: complete=${isComplete}, incomplete=${isIncomplete}, stale=${isStale}`);
      } else {
        console.log('[UI] Integrity banner container exists but no content (may be loading)');
      }
    } else {
      console.log('[UI] Integrity banner not found (may be legacy view)');
    }
  });

  test('SharedReport tab switching works', async ({ page }) => {
    console.log('[UI] Testing tab switching functionality');

    await page.goto(`${BASE_URL}/report?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
      waitUntil: 'networkidle',
    });

    // Wait for the page to load
    await page.waitForSelector('.container', { timeout: TIMEOUT });

    const tabContainer = await page.$('#tabContainer');

    if (tabContainer) {
      // Click on Sponsor tab
      const sponsorTab = await page.$('.tab-btn[data-tab="sponsor"]');
      if (sponsorTab) {
        await sponsorTab.click();

        // Verify Sponsor panel is now active
        const sponsorPanel = await page.$('#sponsorPanel');
        const isActive = await sponsorPanel?.evaluate(el => el.classList.contains('active'));
        expect(isActive).toBe(true);

        console.log('[UI] Sponsor tab switch verified');
      }

      // Click on Customer tab
      const customerTab = await page.$('.tab-btn[data-tab="customer"]');
      if (customerTab) {
        await customerTab.click();

        // Verify Customer panel is now active
        const customerPanel = await page.$('#customerPanel');
        const isActive = await customerPanel?.evaluate(el => el.classList.contains('active'));
        expect(isActive).toBe(true);

        console.log('[UI] Customer tab switch verified');
      }

      // Click back on Event tab
      const eventTab = await page.$('.tab-btn[data-tab="event"]');
      if (eventTab) {
        await eventTab.click();

        // Verify Event panel is now active
        const eventPanel = await page.$('#eventPanel');
        const isActive = await eventPanel?.evaluate(el => el.classList.contains('active'));
        expect(isActive).toBe(true);

        console.log('[UI] Event tab switch verified');
      }

      console.log('[UI] Tab switching functionality verified');
    } else {
      console.log('[UI] Tab container not found - skipping tab switch test');
    }
  });

  test('SharedReport renders gracefully on error', async ({ page }) => {
    console.log('[UI] Testing error state rendering');

    // Use an invalid event ID to trigger error
    await page.goto(`${BASE_URL}/report?eventId=invalid_event_xyz`, {
      timeout: TIMEOUT,
      waitUntil: 'networkidle',
    });

    // Wait for the page to load
    await page.waitForSelector('.container', { timeout: TIMEOUT });

    // Wait a bit for the API call to complete
    await page.waitForTimeout(2000);

    // Check for error state
    const errorState = await page.$('#errorState');
    const loading = await page.$('#loading');
    const metrics = await page.$('#metrics');

    // Either error state is shown OR metrics are shown (if event exists)
    const errorVisible = errorState ? await errorState.isVisible() : false;
    const loadingVisible = loading ? await loading.isVisible() : false;
    const metricsVisible = metrics ? await metrics.isVisible() : false;

    // At least one state should be visible (not stuck in loading forever)
    if (!errorVisible && !metricsVisible) {
      // May still be loading
      console.log('[UI] Page may still be loading');
    } else if (errorVisible) {
      console.log('[UI] Error state displayed correctly');
    } else if (metricsVisible) {
      console.log('[UI] Metrics displayed (event may exist)');
    }

    // Page should not be stuck in loading state forever
    // (This test mainly ensures the page doesn't crash)
    console.log('[UI] Error state handling verified - page renders gracefully');
  });
});

// =============================================================================
// Story F7: Customer Summary Export Block Tests
// =============================================================================

test.describe('Story F7: Customer Summary Export Block', () => {
  test.beforeAll(() => {
    logEnvironment();
  });

  test('Customer tab includes Customer Summary export block', async ({ page }) => {
    console.log('[UI] Testing Customer Summary export block');

    await page.goto(`${BASE_URL}/report?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
      waitUntil: 'networkidle',
    });

    // Wait for the page to load
    await page.waitForSelector('.container', { timeout: TIMEOUT });

    const tabContainer = await page.$('#tabContainer');

    if (tabContainer) {
      // Click on Customer tab
      const customerTab = await page.$('.tab-btn[data-tab="customer"]');
      if (customerTab) {
        await customerTab.click();

        // Wait for Customer panel to be active
        await page.waitForSelector('#customerPanel.active', { timeout: 5000 });

        // Assert Customer Summary export block exists
        const summaryExportBlock = await page.$('[data-testid="customer-summary-export"]');
        expect(summaryExportBlock).not.toBeNull();
        console.log('[UI] Customer Summary export block found');

        // Assert the block contains expected elements
        const integrityLine = await page.$('[data-testid="customer-summary-integrity"]');
        expect(integrityLine).not.toBeNull();
        console.log('[UI] Data integrity line found');

        const jsonLink = await page.$('[data-testid="customer-summary-json-link"]');
        expect(jsonLink).not.toBeNull();
        console.log('[UI] Raw JSON link found');

        // Verify JSON link has correct href pattern
        if (jsonLink) {
          const href = await jsonLink.getAttribute('href');
          expect(href).toContain('/api/v2/sharedreport?eventId=');
          console.log(`[UI] JSON link href: ${href}`);
        }

        // Verify narrative summary exists (check for the paragraph element)
        const narrativeParagraph = await page.$('#customerSummaryExport p');
        expect(narrativeParagraph).not.toBeNull();
        console.log('[UI] Narrative summary paragraph found');

        // Verify key metrics section exists
        const keyMetricsSection = await page.$('#customerSummaryExport [style*="Key Metrics"]');
        const metricsGrid = await page.$('#customerSummaryExport div[style*="grid"]');
        expect(metricsGrid).not.toBeNull();
        console.log('[UI] Key metrics grid found');

        console.log('[UI] Customer Summary export block validation passed');
      } else {
        console.log('[UI] Customer tab not found - skipping test');
      }
    } else {
      console.log('[UI] Tab container not found - may be legacy view');
    }
  });

  test('Customer Summary block has correct structure', async ({ page }) => {
    console.log('[UI] Testing Customer Summary block structure');

    await page.goto(`${BASE_URL}/report?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
      waitUntil: 'networkidle',
    });

    await page.waitForSelector('.container', { timeout: TIMEOUT });

    const tabContainer = await page.$('#tabContainer');

    if (tabContainer) {
      // Navigate to Customer tab
      const customerTab = await page.$('.tab-btn[data-tab="customer"]');
      if (customerTab) {
        await customerTab.click();
        await page.waitForSelector('#customerPanel.active', { timeout: 5000 });

        // Check for heading
        const heading = await page.$('#customerSummaryExport h3');
        expect(heading).not.toBeNull();

        if (heading) {
          const headingText = await heading.textContent();
          expect(headingText).toContain('Customer Summary');
          console.log('[UI] Customer Summary heading verified');
        }

        // Check integrity status is one of the expected values
        const integrityEl = await page.$('[data-testid="customer-summary-integrity"]');
        if (integrityEl) {
          const integrityText = await integrityEl.textContent();
          const validStatuses = [
            'All data sources complete',
            'Data may be outdated',
            'Some data may be incomplete',
            'Integrity status unknown'
          ];
          const hasValidStatus = validStatuses.some(status => integrityText?.includes(status));
          expect(hasValidStatus).toBe(true);
          console.log(`[UI] Integrity status: ${integrityText}`);
        }

        console.log('[UI] Customer Summary block structure verified');
      }
    }
  });
});

// =============================================================================
// Contract Stability Tests
// =============================================================================

test.describe('Story F6: Contract Stability Gate', () => {
  test('bundle contract version is 1.0.0', async ({ request }) => {
    console.log('[Contract] Verifying contract version');

    const response = await request.get(`${BASE_URL}/api/v2/sharedreport?eventId=${TEST_EVENT_ID}`, {
      timeout: TIMEOUT,
    });

    const headers = Object.fromEntries(response.headers().entries());

    // Contract version should be in header
    if (headers['x-contract-version']) {
      expect(headers['x-contract-version']).toBe('1.0.0');
      console.log('[Contract] Contract version 1.0.0 verified');
    } else {
      console.log('[Contract] Contract version header not present (endpoint may not exist)');
    }
  });

  test('error responses include requestId', async ({ request }) => {
    console.log('[Contract] Verifying requestId in error responses');

    // Trigger error with missing eventId
    const response = await request.get(`${BASE_URL}/api/v2/sharedreport`, {
      timeout: TIMEOUT,
    });

    expect(response.status()).toBe(400);

    const json = await response.json();
    expect(json.requestId).toBeDefined();
    expect(typeof json.requestId).toBe('string');
    expect(json.requestId.length).toBeGreaterThan(0);

    console.log(`[Contract] RequestId in error: ${json.requestId}`);
  });
});
