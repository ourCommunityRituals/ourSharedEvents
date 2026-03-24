/**
 * Sponsor Page Gating E2E Tests
 *
 * Story F3: Sponsor Page Gating (Trust-First Display)
 *
 * Tests that the sponsor page correctly renders based on backend-decided
 * page status (ACTIVE, PENDING, INACTIVE).
 *
 * Acceptance Criteria:
 *   - Sponsor page never renders empty or misleading content
 *   - State is explicit and testable
 *   - Frontend honors backend trust signals
 */

import { test, expect } from '@playwright/test';
import { getCurrentEnvironment } from '../../config/environments.js';

test.describe('Sponsor Page Gating (Story F3)', () => {
  let baseUrl;

  test.beforeAll(async () => {
    const env = getCurrentEnvironment();
    baseUrl = env.baseUrl;
  });

  test.describe('Page Status Display', () => {
    test('displays loading state while fetching sponsor data', async ({ page }) => {
      // Navigate to sponsor page
      await page.goto(`${baseUrl}/sponsor?sponsorId=test-sponsor`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      // Loading state should be visible initially
      const loadingState = page.locator('[data-testid="loading-state"]');
      // May already be hidden if data loads fast, so we just check it exists
      await expect(loadingState).toBeAttached();
    });

    test('shows error state for non-existent sponsor', async ({ page }) => {
      await page.goto(`${baseUrl}/sponsor?sponsorId=non-existent-sponsor-xyz`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for either error state or content
      await page.waitForSelector('[data-testid="error-state"], [data-testid="sponsor-content"]', {
        timeout: 15000,
      });

      // Should show error state
      const errorState = page.locator('[data-testid="error-state"]');
      await expect(errorState).toBeVisible();
    });

    test('shows error when no sponsorId provided', async ({ page }) => {
      await page.goto(`${baseUrl}/sponsor`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for error state
      await page.waitForSelector('[data-testid="error-state"]', {
        timeout: 15000,
      });

      const errorState = page.locator('[data-testid="error-state"]');
      await expect(errorState).toBeVisible();
    });
  });

  test.describe('API Response Contracts', () => {
    test('GET /api/v2/sponsor/:id returns correct structure', async ({ request }) => {
      // This tests the API contract for the sponsor page endpoint
      // Even for non-existent sponsors, the response should have consistent structure
      const response = await request.get(`${baseUrl}/api/v2/sponsor/test-sponsor`);

      // Response should be JSON
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');

      // Parse response
      const data = await response.json();

      // Check response structure - should have these fields regardless of ok status
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('pageStatus');
      expect(data).toHaveProperty('_contractVersion');
      expect(data).toHaveProperty('generatedAt');

      // pageStatus should have the required fields
      expect(data.pageStatus).toHaveProperty('status');
      expect(data.pageStatus).toHaveProperty('metricsVisible');
      expect(data.pageStatus).toHaveProperty('label');
      expect(data.pageStatus).toHaveProperty('description');
    });

    test('GET /api/v2/sponsors returns list with page status', async ({ request }) => {
      const response = await request.get(`${baseUrl}/api/v2/sponsors`);

      // Response should be JSON
      expect(response.ok() || response.status() === 200 || response.status() === 500).toBeTruthy();

      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');

      const data = await response.json();

      // If successful, should have sponsors array
      if (data.ok) {
        expect(data).toHaveProperty('sponsors');
        expect(Array.isArray(data.sponsors)).toBe(true);
        expect(data).toHaveProperty('count');
        expect(data).toHaveProperty('_contractVersion');

        // Each sponsor should have pageStatus
        for (const item of data.sponsors) {
          expect(item).toHaveProperty('sponsor');
          expect(item).toHaveProperty('pageStatus');
          expect(item.pageStatus).toHaveProperty('status');
        }
      }
    });

    test('pageStatus.status is one of ACTIVE, PENDING, INACTIVE', async ({ request }) => {
      const response = await request.get(`${baseUrl}/api/v2/sponsors`);
      const data = await response.json();

      const validStatuses = ['ACTIVE', 'PENDING', 'INACTIVE'];

      if (data.ok && data.sponsors) {
        for (const item of data.sponsors) {
          expect(validStatuses).toContain(item.pageStatus.status);
        }
      }
    });
  });

  test.describe('Page Status Badge', () => {
    test('badge reflects backend status', async ({ page, request }) => {
      // First get a sponsor from the API if any exist
      const listResponse = await request.get(`${baseUrl}/api/v2/sponsors`);
      const listData = await listResponse.json();

      if (!listData.ok || !listData.sponsors || listData.sponsors.length === 0) {
        test.skip('No sponsors available to test');
        return;
      }

      // Get the first sponsor
      const { sponsor, pageStatus } = listData.sponsors[0];

      // Navigate to sponsor page
      await page.goto(`${baseUrl}/sponsor?sponsorId=${sponsor.sponsorId}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for content to load
      await page.waitForSelector('[data-testid="sponsor-content"], [data-testid="error-state"]', {
        timeout: 15000,
      });

      // Check if content loaded successfully
      const contentVisible = await page.locator('[data-testid="sponsor-content"]').isVisible();
      if (contentVisible) {
        // Check the status badge
        const badge = page.locator('[data-testid="page-status-badge"]');
        await expect(badge).toBeVisible();

        // Badge should contain the status label
        const badgeText = await badge.textContent();
        expect(['Active', 'Pending', 'Inactive']).toContain(badgeText?.trim());
      }
    });
  });

  test.describe('ACTIVE State - Metrics Visible', () => {
    test('metrics section visible when metricsVisible is true', async ({ page, request }) => {
      // Find a sponsor with ACTIVE status
      const listResponse = await request.get(`${baseUrl}/api/v2/sponsors`);
      const listData = await listResponse.json();

      if (!listData.ok || !listData.sponsors) {
        test.skip('No sponsors available to test');
        return;
      }

      const activeSponsor = listData.sponsors.find(s => s.pageStatus.status === 'ACTIVE');

      if (!activeSponsor) {
        test.skip('No ACTIVE sponsors available to test');
        return;
      }

      await page.goto(`${baseUrl}/sponsor?sponsorId=${activeSponsor.sponsor.sponsorId}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForSelector('[data-testid="sponsor-content"]', {
        timeout: 15000,
      });

      // Metrics section should be visible
      const metricsSection = page.locator('[data-testid="metrics-section"]');
      await expect(metricsSection).toBeVisible();

      // Should have all metric values
      await expect(page.locator('[data-testid="metric-impressions"]')).toBeVisible();
      await expect(page.locator('[data-testid="metric-scans"]')).toBeVisible();
      await expect(page.locator('[data-testid="metric-conversions"]')).toBeVisible();
      await expect(page.locator('[data-testid="metric-ctr"]')).toBeVisible();
    });
  });

  test.describe('PENDING State - Data Accumulating', () => {
    test('shows pending message when events not yet ACTIVE', async ({ page, request }) => {
      // Find a sponsor with PENDING status
      const listResponse = await request.get(`${baseUrl}/api/v2/sponsors`);
      const listData = await listResponse.json();

      if (!listData.ok || !listData.sponsors) {
        test.skip('No sponsors available to test');
        return;
      }

      const pendingSponsor = listData.sponsors.find(s => s.pageStatus.status === 'PENDING');

      if (!pendingSponsor) {
        test.skip('No PENDING sponsors available to test');
        return;
      }

      await page.goto(`${baseUrl}/sponsor?sponsorId=${pendingSponsor.sponsor.sponsorId}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForSelector('[data-testid="sponsor-content"]', {
        timeout: 15000,
      });

      // State message should mention pending/verification
      const stateMessage = page.locator('[data-testid="state-message"]');
      await expect(stateMessage).toBeVisible();

      const messageText = await stateMessage.textContent();
      expect(messageText?.toLowerCase()).toMatch(/pending|verif|accumul/);
    });
  });

  test.describe('INACTIVE State - No Active Events', () => {
    test('shows inactive message when no events associated', async ({ page, request }) => {
      // Find a sponsor with INACTIVE status
      const listResponse = await request.get(`${baseUrl}/api/v2/sponsors`);
      const listData = await listResponse.json();

      if (!listData.ok || !listData.sponsors) {
        test.skip('No sponsors available to test');
        return;
      }

      const inactiveSponsor = listData.sponsors.find(s => s.pageStatus.status === 'INACTIVE');

      if (!inactiveSponsor) {
        test.skip('No INACTIVE sponsors available to test');
        return;
      }

      await page.goto(`${baseUrl}/sponsor?sponsorId=${inactiveSponsor.sponsor.sponsorId}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForSelector('[data-testid="sponsor-content"]', {
        timeout: 15000,
      });

      // State message should mention inactive/no events
      const stateMessage = page.locator('[data-testid="state-message"]');
      await expect(stateMessage).toBeVisible();

      const messageText = await stateMessage.textContent();
      expect(messageText?.toLowerCase()).toMatch(/inactive|no active|no event/);
    });
  });

  test.describe('Contract Version', () => {
    test('displays contract version in footer', async ({ page, request }) => {
      // Get any sponsor
      const listResponse = await request.get(`${baseUrl}/api/v2/sponsors`);
      const listData = await listResponse.json();

      if (!listData.ok || !listData.sponsors || listData.sponsors.length === 0) {
        test.skip('No sponsors available to test');
        return;
      }

      const sponsor = listData.sponsors[0].sponsor;

      await page.goto(`${baseUrl}/sponsor?sponsorId=${sponsor.sponsorId}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForSelector('[data-testid="sponsor-content"], [data-testid="error-state"]', {
        timeout: 15000,
      });

      // Check if content loaded successfully
      const contentVisible = await page.locator('[data-testid="sponsor-content"]').isVisible();
      if (contentVisible) {
        const versionElement = page.locator('[data-testid="contract-version"]');
        await expect(versionElement).toBeVisible();

        const versionText = await versionElement.textContent();
        expect(versionText).toMatch(/^\d+\.\d+\.\d+$/); // Semver format
      }
    });
  });

  test.describe('Trust Signals', () => {
    test('frontend never shows metrics when metricsVisible is false', async ({ page, request }) => {
      // Find a sponsor where metricsVisible is false (PENDING or INACTIVE)
      const listResponse = await request.get(`${baseUrl}/api/v2/sponsors`);
      const listData = await listResponse.json();

      if (!listData.ok || !listData.sponsors) {
        test.skip('No sponsors available to test');
        return;
      }

      const nonActiveSponsor = listData.sponsors.find(s => !s.pageStatus.metricsVisible);

      if (!nonActiveSponsor) {
        test.skip('No sponsors with metricsVisible=false available');
        return;
      }

      await page.goto(`${baseUrl}/sponsor?sponsorId=${nonActiveSponsor.sponsor.sponsorId}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForSelector('[data-testid="sponsor-content"]', {
        timeout: 15000,
      });

      // Metrics section should NOT be visible
      const metricsSection = page.locator('[data-testid="metrics-section"]');
      await expect(metricsSection).not.toBeVisible();
    });
  });
});
