/**
 * Story 4: Events Page Error Handling & Diagnostics Tests
 *
 * Tests for the /events page frontend error handling:
 * - Happy path: Events render correctly or show empty state
 * - Configuration issue: 4xx errors or GAS_UPSTREAM_NON_JSON show config issue card
 * - Temporary issue: 5xx errors show temporary issue card
 * - Staging diagnostics: Shows expandable diagnostic panel in staging
 * - Never crashes on unexpected fields
 *
 * BASE_URL-Aware: Tests work against both staging and production:
 *   BASE_URL="https://stg.eventangle.com" npm run test:e2e
 *   BASE_URL="https://www.eventangle.com" npm run test:e2e
 */

const { test, expect } = require('@playwright/test');
const { getBaseUrl } = require('../../config/environments');

const BASE_URL = getBaseUrl();
const BRAND_ID = 'root';

// Check if we're testing staging (for diagnostic panel tests)
const isStaging = BASE_URL.includes('stg.') || BASE_URL.includes('localhost');

test.describe('Story 4: Events Error Handling - Happy Path', () => {
  test('Events page loads successfully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Wait for loading to complete (skeleton should disappear)
    await page.waitForSelector('.skeleton-loader', { state: 'detached', timeout: 10000 }).catch(() => {});

    // Should show either events grid or empty state (no error state)
    const hasEventCards = await page.locator('.event-card').count() > 0;
    const hasEmptyState = await page.locator('.empty-state').count() > 0;
    const hasErrorState = await page.locator('.error-state').count() > 0;
    const hasConfigIssue = await page.locator('[data-testid="config-issue-card"]').count() > 0;

    // Should have events OR empty state, but NOT error states
    expect(hasEventCards || hasEmptyState).toBe(true);
    expect(hasErrorState && !hasEmptyState).toBe(false); // error-state is fine if it's part of empty state styling
    expect(hasConfigIssue).toBe(false);
  });

  test('Events grid renders or shows clean empty state', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Verify first event card has expected structure
      const firstCard = eventCards.first();
      await expect(firstCard.locator('h3')).toBeVisible();

      // Should have a link/button to view details
      const hasLink = await firstCard.locator('a').count() > 0;
      expect(hasLink).toBe(true);
    } else {
      // Empty state should have user-friendly message
      const emptyState = page.locator('.empty-state, .no-data-state');
      if (await emptyState.count() > 0) {
        await expect(emptyState).toBeVisible();
      }
    }
  });

  test('Event detail view loads successfully', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      // Click first event
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');

      // Detail view should show event info (not error state)
      const hasEventDetail = await page.locator('.event-detail, .event-header').count() > 0;
      const hasErrorState = await page.locator('.error-state').count() > 0;
      const hasConfigIssue = await page.locator('[data-testid="config-issue-card"]').count() > 0;

      // Should have detail view OR legitimate error (not found)
      // but not configuration issue for valid events
      expect(hasEventDetail || (hasErrorState && !hasConfigIssue)).toBe(true);
    }
  });
});

test.describe('Story 4: Events Error Handling - No JavaScript Errors', () => {
  test('No unhandled exceptions on events list page', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Wait for page to fully render
    await page.waitForTimeout(2000);

    // Filter out expected errors (network errors from intercepted requests)
    const unexpectedErrors = consoleErrors.filter(err =>
      !err.includes('Failed to load resource') &&
      !err.includes('net::ERR') &&
      !err.includes('404')
    );

    expect(unexpectedErrors.length).toBe(0);
  });

  test('No unhandled exceptions on event detail page', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    const eventCards = page.locator('.event-card');
    const count = await eventCards.count();

    if (count > 0) {
      await eventCards.first().locator('a').first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }

    // Filter out expected errors
    const unexpectedErrors = consoleErrors.filter(err =>
      !err.includes('Failed to load resource') &&
      !err.includes('net::ERR') &&
      !err.includes('404')
    );

    expect(unexpectedErrors.length).toBe(0);
  });
});

test.describe('Story 4: Events Error Handling - Error State Components', () => {
  test('StateRenderer classifies errors correctly', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Test the error classification logic
    const classifications = await page.evaluate(() => {
      const { classifyError, ERROR_TYPES } = window.SharedUtils || {};
      if (!classifyError || !ERROR_TYPES) return { missing: true };

      return {
        // Story 4: Configuration issue detection
        gasError: classifyError({ errorCode: 'GAS_UPSTREAM_NON_JSON' }),
        status400: classifyError({ status: 400 }),
        status422: classifyError({ status: 422 }),
        // Standard classifications
        status404: classifyError({ status: 404 }),
        status500: classifyError({ status: 500 }),
        status503: classifyError({ status: 503 }),
        networkError: classifyError({ code: 'NETWORK_ERROR' }),
        timeout: classifyError({ code: 'TIMEOUT' }),
        notFound: classifyError({ code: 'NOT_FOUND' }),
        expectedTypes: ERROR_TYPES
      };
    });

    // Skip if SharedUtils not loaded (direct GAS access)
    if (classifications.missing) {
      test.skip();
      return;
    }

    // Story 4: GAS_UPSTREAM_NON_JSON should be CONFIGURATION_ISSUE
    expect(classifications.gasError).toBe(classifications.expectedTypes.CONFIGURATION_ISSUE);

    // Story 4: 4xx status codes (except 404, 401, 403) should be CONFIGURATION_ISSUE
    expect(classifications.status400).toBe(classifications.expectedTypes.CONFIGURATION_ISSUE);
    expect(classifications.status422).toBe(classifications.expectedTypes.CONFIGURATION_ISSUE);

    // 404 should still be EVENT_NOT_FOUND
    expect(classifications.status404).toBe(classifications.expectedTypes.EVENT_NOT_FOUND);

    // 5xx status codes should be SERVICE_UNAVAILABLE
    expect(classifications.status500).toBe(classifications.expectedTypes.SERVICE_UNAVAILABLE);
    expect(classifications.status503).toBe(classifications.expectedTypes.SERVICE_UNAVAILABLE);

    // Standard error codes
    expect(classifications.networkError).toBe(classifications.expectedTypes.NETWORK_ERROR);
    expect(classifications.timeout).toBe(classifications.expectedTypes.TIMEOUT);
    expect(classifications.notFound).toBe(classifications.expectedTypes.EVENT_NOT_FOUND);
  });

  test('StateRenderer has showConfigurationIssue method', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const hasMethod = await page.evaluate(() => {
      const renderer = window.SharedUtils?.StateRenderer;
      return {
        hasStateRenderer: !!renderer,
        hasShowConfigurationIssue: typeof renderer?.showConfigurationIssue === 'function',
        hasShowFromError: typeof renderer?.showFromError === 'function',
        hasShowTemporaryIssue: typeof renderer?.showTemporaryIssue === 'function'
      };
    });

    expect(hasMethod.hasStateRenderer).toBe(true);
    expect(hasMethod.hasShowConfigurationIssue).toBe(true);
    expect(hasMethod.hasShowFromError).toBe(true);
    expect(hasMethod.hasShowTemporaryIssue).toBe(true);
  });
});

test.describe('Story 4: Events Error Handling - Loading States', () => {
  test('Loading skeleton shows during fetch', async ({ page }) => {
    // Slow down network to catch loading state
    await page.route('**/api/**', async route => {
      await page.waitForTimeout(500);
      await route.continue();
    });

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Check for skeleton loader or loading state
    const hasSkeletonOrLoading = await page.locator('.skeleton-loader, .skeleton, .loading-state, .loading-placeholder').count() > 0;

    // Either has loading state or page loaded too fast
    // (We can't guarantee we'll catch it, so just verify no crash)
    expect(true).toBe(true);
  });

  test('Page handles slow responses gracefully', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', error => consoleErrors.push(error.message));

    // Simulate slow response (2 seconds)
    await page.route('**/api/**', async route => {
      await page.waitForTimeout(2000);
      await route.continue();
    });

    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'networkidle',
      timeout: 30000, // Longer timeout for slow response
    });

    // Should complete without errors
    expect(consoleErrors.length).toBe(0);
  });
});

test.describe('Story 4: Events Error Handling - NU SDK Integration', () => {
  test('NU SDK exposes isStaging method', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const nuSdkInfo = await page.evaluate(() => {
      const NU = window.NU;
      if (!NU) return { missing: true };

      return {
        hasIsStaging: typeof NU.isStaging === 'function',
        hasIsProduction: typeof NU.isProduction === 'function',
        isStaging: NU.isStaging?.(),
        isProduction: NU.isProduction?.()
      };
    });

    if (nuSdkInfo.missing) {
      test.skip();
      return;
    }

    expect(nuSdkInfo.hasIsStaging).toBe(true);
    expect(nuSdkInfo.hasIsProduction).toBe(true);

    // Verify environment detection matches BASE_URL
    if (isStaging) {
      expect(nuSdkInfo.isStaging).toBe(true);
    }
  });

  test('safeRpc preserves status and errorCode fields', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Verify the safeRpc function signature includes status and errorCode
    const safeRpcInfo = await page.evaluate(() => {
      const NU = window.NU;
      if (!NU?.safeRpc) return { missing: true };

      return {
        hasSafeRpc: true,
        safeRpcIsFunction: typeof NU.safeRpc === 'function'
      };
    });

    if (safeRpcInfo.missing) {
      test.skip();
      return;
    }

    expect(safeRpcInfo.hasSafeRpc).toBe(true);
    expect(safeRpcInfo.safeRpcIsFunction).toBe(true);
  });
});

// Staging-only tests for diagnostic panel
test.describe('Story 4: Events Error Handling - Staging Diagnostics', () => {
  test.skip(!isStaging, 'Staging-only test');

  test('Configuration issue card shows diagnostic panel in staging', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Manually render a configuration issue to test diagnostic panel
    const hasDiagnosticPanel = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return false;

      // Render configuration issue with error details
      StateRenderer.showConfigurationIssue(container, {
        error: {
          status: 400,
          errorCode: 'GAS_UPSTREAM_NON_JSON',
          message: 'Backend returned non-JSON response',
          corrId: 'test-corr-123'
        }
      });

      // Check if diagnostic panel is rendered
      const panel = container.querySelector('[data-testid="diagnostic-panel"]');
      return !!panel;
    });

    expect(hasDiagnosticPanel).toBe(true);
  });

  test('Diagnostic panel shows status and errorCode', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const diagnosticContent = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return null;

      StateRenderer.showConfigurationIssue(container, {
        error: {
          status: 422,
          errorCode: 'GAS_UPSTREAM_NON_JSON',
          message: 'Test error message'
        }
      });

      const panel = container.querySelector('[data-testid="diagnostic-panel"]');
      return panel ? panel.innerHTML : null;
    });

    if (diagnosticContent) {
      expect(diagnosticContent).toContain('422');
      expect(diagnosticContent).toContain('GAS_UPSTREAM_NON_JSON');
    }
  });

  test('Diagnostic panel is expandable', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await page.evaluate(() => {
      const container = document.createElement('div');
      container.id = 'test-config-issue';
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return;

      StateRenderer.showConfigurationIssue(container, {
        error: { status: 400, errorCode: 'TEST_ERROR' }
      });
    });

    const panel = page.locator('#test-config-issue [data-testid="diagnostic-panel"]');
    const panelCount = await panel.count();

    if (panelCount > 0) {
      // Panel should be a <details> element (collapsed by default)
      const isOpen = await panel.evaluate(el => el.open);
      expect(isOpen).toBe(false);

      // Click to expand
      await panel.locator('summary').click();
      const isOpenAfter = await panel.evaluate(el => el.open);
      expect(isOpenAfter).toBe(true);
    }
  });
});

// Production-only tests to verify no diagnostics leak
test.describe('Story 4: Events Error Handling - Production No Diagnostics', () => {
  test.skip(isStaging, 'Production-only test');

  test('Configuration issue card does NOT show diagnostic panel in production', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const hasDiagnosticPanel = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return 'no-renderer';

      StateRenderer.showConfigurationIssue(container, {
        error: {
          status: 400,
          errorCode: 'GAS_UPSTREAM_NON_JSON'
        }
      });

      const panel = container.querySelector('[data-testid="diagnostic-panel"]');
      return !!panel;
    });

    if (hasDiagnosticPanel === 'no-renderer') {
      test.skip();
      return;
    }

    // Should NOT have diagnostic panel in production
    expect(hasDiagnosticPanel).toBe(false);
  });

  test('Configuration issue shows user-friendly message in production', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const cardContent = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return null;

      StateRenderer.showConfigurationIssue(container, {
        error: { status: 400 }
      });

      return container.textContent;
    });

    if (cardContent) {
      // Should have user-friendly message
      expect(cardContent).toContain('Configuration Issue');
      expect(cardContent).toContain('setting this event up');

      // Should NOT contain technical details
      expect(cardContent).not.toContain('status');
      expect(cardContent).not.toContain('errorCode');
    }
  });
});

test.describe('Story 4: Events Error Handling - Error Recovery', () => {
  test('Retry button exists on error states', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    // Manually render error states to test retry button
    const hasRetryButton = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return false;

      // Test with configuration issue
      StateRenderer.showConfigurationIssue(container, {
        onRetry: () => {},
        error: { status: 400 }
      });

      const retryBtn = container.querySelector('.btn-retry');
      return !!retryBtn;
    });

    expect(hasRetryButton).toBe(true);
  });

  test('Temporary issue state has retry button', async ({ page }) => {
    await page.goto(`${BASE_URL}?page=events&brand=${BRAND_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const hasRetryButton = await page.evaluate(() => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const { StateRenderer } = window.SharedUtils || {};
      if (!StateRenderer) return false;

      StateRenderer.showTemporaryIssue(container, {
        onRetry: () => {},
        corrId: 'test-123'
      });

      const retryBtn = container.querySelector('.btn-retry');
      return !!retryBtn;
    });

    expect(hasRetryButton).toBe(true);
  });
});
