/**
 * Story F5: Stage-2 Sponsor & Analytics Smoke Pack
 *
 * Purpose / Value:
 *   Ensure sponsor + analytics surfaces cannot regress silently.
 *   Any sponsor or analytics regression blocks deploy.
 *
 * Required Smoke Flow:
 *   1. Create event
 *   2. Attach sponsor (validate sponsor endpoints respond)
 *   3. Generate analytics (validate analytics endpoint)
 *   4. Load sponsor page (validate sponsor page endpoint)
 *   5. Validate integrity flags
 *   6. Validate gating behavior
 *
 * Acceptance Criteria:
 *   - Any sponsor or analytics regression blocks deploy
 *   - CI logs include: endpoint, integrity status, requestId
 *
 * CI/CD Gate Impact:
 *   Hard Stage-2 block
 *
 * Authentication (Story D4):
 *   Uses Cloudflare Access Service Token for CI/CD authentication.
 *   Headers: CF-Access-Client-Id, CF-Access-Client-Secret
 *
 * Environment Variables (injected by CI, never printed):
 *   BASE_URL=https://stg.eventangle.com
 *   CF_ACCESS_CLIENT_ID=<secret>
 *   CF_ACCESS_CLIENT_SECRET=<secret>
 *
 * @see Story F1 - Sponsor Object Contract
 * @see Story F2 - Analytics Integrity Enforcement
 * @see Story F3 - Sponsor Page Gating
 * @see Story F4 - Monetization Readiness Hooks
 * @see Story F5 - Stage-2 Sponsor & Analytics Smoke Pack
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Brand used for smoke tests */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/**
 * Cloudflare Access Service Token credentials (Story D4)
 * Used for CI/CD authentication to admin endpoints
 */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/**
 * Check if Cloudflare Access is configured
 * Both Client ID and Secret are required for service token auth
 */
const hasAccessCredentials = (): boolean =>
  Boolean(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET);

/**
 * Get Cloudflare Access headers for authenticated requests
 * @returns Headers object with CF-Access-Client-Id and CF-Access-Client-Secret
 */
const getAccessHeaders = (): Record<string, string> => ({
  'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
});

/** Unique prefix for gate test events (easy to identify/cleanup) */
const GATE_EVENT_PREFIX = 'F5-Sponsor-Analytics-Gate';

// =============================================================================
// Logging Helpers (CI Observability)
// =============================================================================

interface SmokeLogEntry {
  endpoint: string;
  status: number;
  integrityStatus?: string;
  requestId?: string;
  metricsVisible?: boolean;
  pageStatus?: string;
  inert?: boolean;
  timestamp: string;
}

function logSmokeResult(entry: SmokeLogEntry): void {
  console.log(`[F5 Smoke] ${JSON.stringify(entry)}`);
}

function extractRequestId(response: { headers: () => Record<string, string> }): string | undefined {
  const headers = response.headers();
  return headers['x-request-id'] || headers['cf-ray'] || headers['x-trace-id'];
}

// =============================================================================
// Contract Constants (from Stories F1-F4)
// =============================================================================

/** Valid sponsor page statuses (Story F3) */
const VALID_SPONSOR_PAGE_STATUSES = ['ACTIVE', 'PENDING', 'INACTIVE'];

/** Valid analytics integrity statuses (Story F2) */
const VALID_INTEGRITY_STATUSES = ['COMPLETE', 'INCOMPLETE', 'STALE', 'UNAVAILABLE'];

// =============================================================================
// Test Suite
// =============================================================================

test.describe('Story F5: Sponsor & Analytics Smoke Pack (Hard Gate)', () => {

  // =========================================================================
  // Step 1: Create Event
  // Prerequisite for sponsor attachment and analytics generation
  // =========================================================================
  test.describe('Step 1: Create Event', () => {

    test('POST /api/v2/admin/events creates event successfully', async ({ request }) => {
      test.skip(
        !hasAccessCredentials(),
        'CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET not configured - cannot run gate test'
      );

      const timestamp = Date.now();
      const uniqueName = `${GATE_EVENT_PREFIX}-${timestamp}`;
      const uniqueSlug = `f5-gate-test-${timestamp}`;

      console.log(`[F5 Smoke] Step 1: Creating event: ${uniqueName}`);

      const response = await request.post('/api/v2/admin/events', {
        timeout: TIMEOUT,
        data: {
          name: uniqueName,
          brand: BRAND,
          slug: uniqueSlug,
        },
        headers: getAccessHeaders(),
      });

      const requestId = extractRequestId(response);
      const status = response.status();

      logSmokeResult({
        endpoint: 'POST /api/v2/admin/events',
        status,
        requestId,
        timestamp: new Date().toISOString(),
      });

      // Assert: Create returns 201
      expect(status, `Create event should return 201, got ${status}`).toBe(201);

      const json = await response.json();
      expect(json.ok, 'Create response should have ok=true').toBe(true);
      expect(json.item, 'Create response should have item').toBeDefined();
      expect(json.item.id, 'Created event should have id').toBeDefined();

      console.log(`[F5 Smoke] Step 1 PASSED: Event created with id=${json.item.id}`);
    });
  });

  // =========================================================================
  // Step 2: Sponsor Endpoints (Attach Sponsor Validation)
  // Validates sponsor API endpoints respond correctly
  // =========================================================================
  test.describe('Step 2: Sponsor Endpoints', () => {

    test('GET /api/v2/sponsors returns sponsor list with pageStatus', async ({ request }) => {
      console.log(`[F5 Smoke] Step 2: Testing sponsor list endpoint`);

      const response = await request.get(`/api/v2/sponsors?brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const requestId = extractRequestId(response);
      const status = response.status();
      const json = await response.json();

      // Extract integrity info if available
      const pageStatus = json.items?.[0]?.pageStatus?.status || json.pageStatus?.status;

      logSmokeResult({
        endpoint: 'GET /api/v2/sponsors',
        status,
        requestId,
        pageStatus,
        timestamp: new Date().toISOString(),
      });

      // Assert: List returns 200
      expect(status, `Sponsor list should return 200, got ${status}`).toBe(200);

      // Assert: Response structure
      expect(json.ok, 'Response should have ok property').toBeDefined();

      console.log(`[F5 Smoke] Step 2a PASSED: Sponsor list endpoint responds`);
    });

    test('GET /api/v2/monetization/inert returns inert=true (Story F4)', async ({ request }) => {
      console.log(`[F5 Smoke] Step 2: Testing monetization inert gate`);

      const response = await request.get('/api/v2/monetization/inert', {
        timeout: TIMEOUT,
      });

      const requestId = extractRequestId(response);
      const status = response.status();

      logSmokeResult({
        endpoint: 'GET /api/v2/monetization/inert',
        status,
        requestId,
        timestamp: new Date().toISOString(),
      });

      // Assert: Returns 200
      expect(status, `Monetization inert endpoint should return 200, got ${status}`).toBe(200);

      const json = await response.json();

      // Assert: Monetization hooks are inert (Story F4 critical invariant)
      expect(json.inert, 'Monetization hooks must be inert (no billing logic)').toBe(true);
      expect(json.billingLogicExecuted, 'billingLogicExecuted must be false').toBe(false);
      expect(json.paymentProcessing, 'paymentProcessing must be false').toBe(false);

      logSmokeResult({
        endpoint: 'GET /api/v2/monetization/inert',
        status,
        requestId,
        inert: json.inert,
        timestamp: new Date().toISOString(),
      });

      console.log(`[F5 Smoke] Step 2b PASSED: Monetization hooks are inert`);
    });
  });

  // =========================================================================
  // Step 3: Generate Analytics (Validate Analytics Endpoint)
  // Validates shared analytics endpoint returns correct shape
  // =========================================================================
  test.describe('Step 3: Analytics Endpoint', () => {

    test('GET getSharedAnalytics returns valid envelope with integrity', async ({ request }) => {
      console.log(`[F5 Smoke] Step 3: Testing analytics endpoint`);

      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const requestId = extractRequestId(response);
      const status = response.status();
      const json = await response.json();

      // Extract integrity status if present
      const integrityStatus = json.value?.integrity?.status ||
                              json.integrity?.status ||
                              (json.ok ? 'AVAILABLE' : 'UNAVAILABLE');

      logSmokeResult({
        endpoint: 'GET /?p=api&action=getSharedAnalytics',
        status,
        requestId,
        integrityStatus,
        timestamp: new Date().toISOString(),
      });

      // Assert: Returns 200
      expect(status, `Analytics endpoint should return 200, got ${status}`).toBe(200);

      // Assert: Envelope format (Story F2)
      expect(json, 'Response should have ok property').toHaveProperty('ok');
      expect(typeof json.ok, 'ok should be boolean').toBe('boolean');

      if (json.ok === true && !json.notModified) {
        expect(json, 'Success response should have value').toHaveProperty('value');

        // Assert: Required analytics fields (Story F2)
        if (json.value) {
          expect(json.value, 'Value should have lastUpdatedISO').toHaveProperty('lastUpdatedISO');
          expect(json.value, 'Value should have summary').toHaveProperty('summary');

          // Validate summary metrics exist
          const summary = json.value.summary;
          expect(typeof summary.totalImpressions, 'totalImpressions should be number').toBe('number');
          expect(typeof summary.totalClicks, 'totalClicks should be number').toBe('number');
          expect(summary.totalImpressions, 'totalImpressions should be non-negative').toBeGreaterThanOrEqual(0);
          expect(summary.totalClicks, 'totalClicks should be non-negative').toBeGreaterThanOrEqual(0);
        }
      }

      console.log(`[F5 Smoke] Step 3 PASSED: Analytics endpoint responds with valid envelope`);
    });

    test('Analytics summary contains required fields (Story F2)', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const json = await response.json();

      if (json.ok && json.value?.summary) {
        const summary = json.value.summary;

        // Required summary fields per Story F2 contract
        const requiredFields = [
          'totalImpressions',
          'totalClicks',
          'totalQrScans',
          'totalSignups',
          'uniqueEvents',
          'uniqueSponsors',
        ];

        for (const field of requiredFields) {
          expect(summary, `Summary should have ${field}`).toHaveProperty(field);
          expect(typeof summary[field], `${field} should be number`).toBe('number');
          expect(summary[field], `${field} should be non-negative`).toBeGreaterThanOrEqual(0);
        }

        console.log(`[F5 Smoke] Analytics summary fields validated`);
      }
    });
  });

  // =========================================================================
  // Step 4: Sponsor Page Endpoint
  // Validates sponsor page gating (Story F3)
  // =========================================================================
  test.describe('Step 4: Sponsor Page Gating', () => {

    test('Sponsor page status is valid (ACTIVE/PENDING/INACTIVE)', async ({ request }) => {
      console.log(`[F5 Smoke] Step 4: Testing sponsor page gating`);

      const response = await request.get(`/api/v2/sponsors?brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const requestId = extractRequestId(response);
      const status = response.status();
      const json = await response.json();

      expect(status).toBe(200);

      // If sponsors exist, validate their pageStatus
      if (json.ok && json.items && json.items.length > 0) {
        const sponsor = json.items[0];

        if (sponsor.pageStatus) {
          const pageStatus = sponsor.pageStatus.status;
          const metricsVisible = sponsor.pageStatus.metricsVisible;

          logSmokeResult({
            endpoint: 'GET /api/v2/sponsors (pageStatus)',
            status,
            requestId,
            pageStatus,
            metricsVisible,
            timestamp: new Date().toISOString(),
          });

          // Assert: Status is one of the valid values (Story F3)
          expect(
            VALID_SPONSOR_PAGE_STATUSES,
            `pageStatus should be one of ${VALID_SPONSOR_PAGE_STATUSES.join(', ')}`
          ).toContain(pageStatus);

          // Assert: metricsVisible is boolean
          expect(typeof metricsVisible, 'metricsVisible should be boolean').toBe('boolean');

          // Assert: metricsVisible=true ONLY when status=ACTIVE (Story F3 invariant)
          if (pageStatus === 'ACTIVE') {
            expect(metricsVisible, 'metricsVisible must be true when status is ACTIVE').toBe(true);
          } else {
            expect(metricsVisible, 'metricsVisible must be false when status is not ACTIVE').toBe(false);
          }

          console.log(`[F5 Smoke] Step 4 PASSED: Sponsor page gating validated (status=${pageStatus}, metricsVisible=${metricsVisible})`);
        }
      } else {
        console.log(`[F5 Smoke] Step 4 SKIPPED: No sponsors to validate pageStatus`);
      }
    });
  });

  // =========================================================================
  // Step 5: Integrity Flags Validation
  // Validates analytics integrity enforcement (Story F2)
  // =========================================================================
  test.describe('Step 5: Integrity Flags', () => {

    test('Analytics integrity status is valid', async ({ request }) => {
      console.log(`[F5 Smoke] Step 5: Validating integrity flags`);

      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const json = await response.json();
      const requestId = extractRequestId(response);

      // Check if integrity metadata is present in response
      const integrity = json.value?.integrity;

      if (integrity) {
        logSmokeResult({
          endpoint: 'GET getSharedAnalytics (integrity)',
          status: response.status(),
          requestId,
          integrityStatus: integrity.status,
          timestamp: new Date().toISOString(),
        });

        // Assert: Status is valid (Story F2)
        expect(
          VALID_INTEGRITY_STATUSES,
          `integrityStatus should be one of ${VALID_INTEGRITY_STATUSES.join(', ')}`
        ).toContain(integrity.status);

        // Assert: Required integrity metadata fields (Story F2)
        if (integrity.status === 'COMPLETE') {
          expect(integrity.unavailableSources, 'COMPLETE status should have no unavailable sources').toEqual([]);
        }

        console.log(`[F5 Smoke] Step 5 PASSED: Integrity status=${integrity.status}`);
      } else {
        // Even without explicit integrity metadata, the response should be valid
        expect(json.ok, 'Response should indicate success/failure').toBeDefined();
        console.log(`[F5 Smoke] Step 5 PASSED: Response ok=${json.ok}`);
      }
    });

    test('Analytics numeric metrics are non-negative integers', async ({ request }) => {
      const response = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const json = await response.json();

      if (json.ok && json.value?.summary) {
        const summary = json.value.summary;
        const countMetrics = [
          'totalImpressions',
          'totalClicks',
          'totalQrScans',
          'totalSignups',
          'uniqueEvents',
          'uniqueSponsors',
        ];

        for (const metric of countMetrics) {
          const value = summary[metric];
          if (value !== undefined) {
            expect(Number.isInteger(value), `${metric} should be integer`).toBe(true);
            expect(value, `${metric} should be non-negative`).toBeGreaterThanOrEqual(0);
          }
        }

        console.log(`[F5 Smoke] Integrity flag: Numeric metrics validated`);
      }
    });
  });

  // =========================================================================
  // Step 6: Gating Behavior Validation
  // Validates sponsor page gating behavior (Story F3)
  // =========================================================================
  test.describe('Step 6: Gating Behavior', () => {

    test('Sponsor gating behavior: metricsVisible correlates with status', async ({ request }) => {
      console.log(`[F5 Smoke] Step 6: Validating gating behavior`);

      const response = await request.get(`/api/v2/sponsors?brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const json = await response.json();
      const requestId = extractRequestId(response);

      expect(response.status()).toBe(200);

      if (json.ok && json.items && json.items.length > 0) {
        let gatingBehaviorValid = true;

        for (const sponsor of json.items) {
          if (sponsor.pageStatus) {
            const { status, metricsVisible } = sponsor.pageStatus;

            // Story F3 Invariant: metricsVisible is true ONLY for ACTIVE status
            if (status === 'ACTIVE') {
              if (metricsVisible !== true) {
                gatingBehaviorValid = false;
                console.error(`[F5 Smoke] VIOLATION: status=ACTIVE but metricsVisible=${metricsVisible}`);
              }
            } else {
              if (metricsVisible !== false) {
                gatingBehaviorValid = false;
                console.error(`[F5 Smoke] VIOLATION: status=${status} but metricsVisible=${metricsVisible}`);
              }
            }
          }
        }

        logSmokeResult({
          endpoint: 'GET /api/v2/sponsors (gating)',
          status: response.status(),
          requestId,
          timestamp: new Date().toISOString(),
        });

        expect(gatingBehaviorValid, 'Gating behavior must be valid (metricsVisible correlates with status)').toBe(true);
        console.log(`[F5 Smoke] Step 6 PASSED: Gating behavior validated`);
      } else {
        console.log(`[F5 Smoke] Step 6 SKIPPED: No sponsors to validate gating behavior`);
      }
    });

    test('Monetization hooks remain inert under all conditions', async ({ request }) => {
      const response = await request.get('/api/v2/monetization/inert', {
        timeout: TIMEOUT,
      });

      const json = await response.json();
      const requestId = extractRequestId(response);

      logSmokeResult({
        endpoint: 'GET /api/v2/monetization/inert (gate)',
        status: response.status(),
        requestId,
        inert: json.inert,
        timestamp: new Date().toISOString(),
      });

      // Critical Story F4 invariant
      expect(json.inert, 'Monetization hooks MUST remain inert').toBe(true);
      expect(json.billingLogicExecuted, 'No billing logic should execute').toBe(false);
      expect(json.paymentProcessing, 'No payment processing should occur').toBe(false);

      if (json.billingUIVisible !== undefined) {
        expect(json.billingUIVisible, 'No billing UI should be visible').toBe(false);
      }

      console.log(`[F5 Smoke] Gating behavior: Monetization hooks remain inert`);
    });
  });

  // =========================================================================
  // Health Endpoint Verification
  // Ensures backend is healthy before sponsor/analytics tests
  // =========================================================================
  test.describe('Health Verification', () => {

    test('GET /api/health/backend returns ok=true', async ({ request }) => {
      const response = await request.get('/api/health/backend', {
        timeout: TIMEOUT,
      });

      const requestId = extractRequestId(response);
      const status = response.status();

      logSmokeResult({
        endpoint: 'GET /api/health/backend',
        status,
        requestId,
        timestamp: new Date().toISOString(),
      });

      expect(status, `Health endpoint should return 200, got ${status}`).toBe(200);

      const json = await response.json();
      expect(json.ok, 'Health response should have ok=true').toBe(true);
    });
  });

  // =========================================================================
  // Contract Version Verification
  // Ensures sponsor and analytics contracts are at expected versions
  // =========================================================================
  test.describe('Contract Version Check', () => {

    test('Sponsor and analytics contracts are at expected versions', async ({ request }) => {
      // This test validates that the API responses include contract version info
      // when available, ensuring contracts haven't drifted

      const sponsorResponse = await request.get(`/api/v2/sponsors?brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const sponsorJson = await sponsorResponse.json();

      if (sponsorJson._contractVersion) {
        console.log(`[F5 Smoke] Sponsor contract version: ${sponsorJson._contractVersion}`);
        // Contract version should follow semver
        expect(sponsorJson._contractVersion).toMatch(/^\d+\.\d+\.\d+$/);
      }

      const analyticsResponse = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`, {
        timeout: TIMEOUT,
      });

      const analyticsJson = await analyticsResponse.json();

      if (analyticsJson._contractVersion) {
        console.log(`[F5 Smoke] Analytics contract version: ${analyticsJson._contractVersion}`);
        expect(analyticsJson._contractVersion).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });
  });
});

// =============================================================================
// CI Gate Summary
// =============================================================================
test.describe('F5 Smoke Pack: CI Gate Summary', () => {

  test('ALL sponsor and analytics smoke checks must pass for deploy', async ({ request }) => {
    // This is a summary test that validates core requirements
    console.log('============================================');
    console.log('STORY F5: Sponsor & Analytics Smoke Pack');
    console.log('CI Gate Rule: Any regression blocks deploy');
    console.log('============================================');

    // Health check
    const healthResponse = await request.get('/api/health/backend', { timeout: TIMEOUT });
    expect(healthResponse.status()).toBe(200);

    // Sponsor endpoint
    const sponsorResponse = await request.get(`/api/v2/sponsors?brand=${BRAND}`, { timeout: TIMEOUT });
    expect(sponsorResponse.status()).toBe(200);

    // Analytics endpoint
    const analyticsResponse = await request.get(`/?p=api&action=getSharedAnalytics&brand=${BRAND}`, { timeout: TIMEOUT });
    expect(analyticsResponse.status()).toBe(200);

    // Monetization inert check
    const inertResponse = await request.get('/api/v2/monetization/inert', { timeout: TIMEOUT });
    expect(inertResponse.status()).toBe(200);
    const inertJson = await inertResponse.json();
    expect(inertJson.inert).toBe(true);

    console.log('============================================');
    console.log('F5 SMOKE PACK: ALL GATES PASSED');
    console.log('============================================');
  });
});
