/**
 * Story E5: Stage-2 Asset Integrity Gate
 *
 * Purpose / Value:
 *   Verify that asset state enforcement is working correctly before
 *   promoting to production. This is a hard gate - if any test fails,
 *   the deployment is blocked.
 *
 * Environment: STAGING
 *
 * Gate Validation Flow:
 *   1. Create unverified event (READY state)
 *   2. Verify publicBundle returns 403 ASSET_NOT_RENDERABLE
 *   3. Verify displayBundle returns 403 ASSET_NOT_RENDERABLE
 *   4. Verify posterBundle returns 403 ASSET_NOT_RENDERABLE
 *   5. Verify QR and mark event ACTIVE
 *   6. Verify all bundles now return 200
 *   7. Cleanup (archive test event)
 *
 * CI Gate Rule: If ANY step fails -> deploy FAILS
 *
 * @see Story E5 - Stage-2 Asset Integrity Gate
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// Configuration
// =============================================================================

/** Base URL for staging environment */
const BASE_URL = process.env.BASE_URL || 'https://stg.oursharedevents.com';

/** Cloudflare Access Service Token headers (Story D4) */
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

/** Brand used for test */
const BRAND = process.env.TEST_BRAND || 'root';

/** Timeout for API requests (staging cold start tolerance) */
const TIMEOUT = 30000;

/** Unique prefix for E5 gate test events */
const E5_GATE_EVENT_PREFIX = 'E5-AssetIntegrityGate';

// =============================================================================
// Auth Helper
// =============================================================================

/**
 * Returns authorization headers for Cloudflare Access Service Token
 */
function getAuthHeaders(): Record<string, string> {
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    return {
      'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
      'Content-Type': 'application/json',
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

/**
 * Checks if Cloudflare Access is configured
 */
function hasCFAccess(): boolean {
  return !!(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET);
}

// =============================================================================
// Structured Logging (CI-friendly)
// =============================================================================

function logGateStep(step: number, description: string, status: 'START' | 'PASS' | 'FAIL'): void {
  console.log(
    JSON.stringify({
      type: 'ASSET_INTEGRITY_GATE',
      step,
      description,
      status,
      timestamp: new Date().toISOString(),
    })
  );
}

function logApiResponse(
  endpoint: string,
  status: number,
  requestId: string,
  assetState?: string
): void {
  console.log(
    JSON.stringify({
      type: 'API_RESPONSE',
      endpoint,
      status,
      requestId,
      assetState,
      timestamp: new Date().toISOString(),
    })
  );
}

// =============================================================================
// Test Suite: Asset Integrity Gate (Hard Gate)
// =============================================================================

test.describe('Story E5: Asset Integrity Gate (Hard Gate)', () => {
  // Test state
  let testEventId: string | null = null;

  test.afterAll(async ({ request }) => {
    // Final cleanup - archive test event
    if (testEventId && hasCFAccess()) {
      try {
        await request.post(`${BASE_URL}/api/v2/admin/events/${testEventId}/archive`, {
          headers: getAuthHeaders(),
          timeout: TIMEOUT,
        });
        console.log(
          JSON.stringify({
            type: 'CLEANUP',
            eventId: testEventId,
            status: 'archived',
            timestamp: new Date().toISOString(),
          })
        );
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('E5 HARD GATE: Complete asset integrity validation flow', async ({ request }) => {
    test.skip(
      !hasCFAccess(),
      'Requires Cloudflare Access Service Token (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET)'
    );

    const uniqueName = `${E5_GATE_EVENT_PREFIX}-${Date.now()}`;

    // =========================================================================
    // STEP 1: Create unverified event (should be in READY state)
    // =========================================================================
    logGateStep(1, 'Create unverified event', 'START');

    const createResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: uniqueName,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'E5 Gate Test Venue',
      },
      timeout: TIMEOUT,
    });

    expect(createResponse.status(), 'Create event should return 201').toBe(201);

    const createData = await createResponse.json();
    testEventId = createData.item.id;

    expect(createData.item.assetState, 'New event should NOT be ACTIVE').not.toBe('ACTIVE');
    expect(createData.item.qrVerified, 'New event should not be QR verified').toBeFalsy();

    logGateStep(1, `Created event ${testEventId} in ${createData.item.assetState} state`, 'PASS');

    // =========================================================================
    // STEP 2: Verify publicBundle returns 403 ASSET_NOT_RENDERABLE
    // =========================================================================
    logGateStep(2, 'publicBundle must return 403 for unverified event', 'START');

    const publicBundleResponse = await request.get(
      `${BASE_URL}/api/events/${testEventId}/publicBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    const publicRequestId = publicBundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/events/:id/publicBundle', publicBundleResponse.status(), publicRequestId);

    expect(
      publicBundleResponse.status(),
      'publicBundle should return 403 for unverified event'
    ).toBe(403);

    const publicData = await publicBundleResponse.json();
    expect(publicData.code, 'Error code should be ASSET_NOT_RENDERABLE').toBe(
      'ASSET_NOT_RENDERABLE'
    );
    expect(publicData.assetState, 'Response should include assetState').toBeDefined();
    expect(
      publicData.assetStateInfo?.isRenderable,
      'assetStateInfo.isRenderable should be false'
    ).toBe(false);

    logGateStep(2, 'publicBundle correctly blocked unverified event', 'PASS');

    // =========================================================================
    // STEP 3: Verify displayBundle returns 403 ASSET_NOT_RENDERABLE
    // =========================================================================
    logGateStep(3, 'displayBundle must return 403 for unverified event', 'START');

    const displayBundleResponse = await request.get(
      `${BASE_URL}/api/events/${testEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    const displayRequestId = displayBundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse(
      '/api/events/:id/displayBundle',
      displayBundleResponse.status(),
      displayRequestId
    );

    expect(
      displayBundleResponse.status(),
      'displayBundle should return 403 for unverified event'
    ).toBe(403);

    const displayData = await displayBundleResponse.json();
    expect(displayData.code, 'Error code should be ASSET_NOT_RENDERABLE').toBe(
      'ASSET_NOT_RENDERABLE'
    );

    logGateStep(3, 'displayBundle correctly blocked unverified event', 'PASS');

    // =========================================================================
    // STEP 4: Verify posterBundle returns 403 ASSET_NOT_RENDERABLE
    // =========================================================================
    logGateStep(4, 'posterBundle must return 403 for unverified event', 'START');

    const posterBundleResponse = await request.get(
      `${BASE_URL}/api/events/${testEventId}/posterBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    const posterRequestId = posterBundleResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/events/:id/posterBundle', posterBundleResponse.status(), posterRequestId);

    expect(
      posterBundleResponse.status(),
      'posterBundle should return 403 for unverified event'
    ).toBe(403);

    const posterData = await posterBundleResponse.json();
    expect(posterData.code, 'Error code should be ASSET_NOT_RENDERABLE').toBe(
      'ASSET_NOT_RENDERABLE'
    );

    logGateStep(4, 'posterBundle correctly blocked unverified event', 'PASS');

    // =========================================================================
    // STEP 5: Verify QR and mark event ACTIVE
    // =========================================================================
    logGateStep(5, 'Verify QR to transition event to ACTIVE', 'START');

    const verifyResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/verify-qr`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );

    const verifyRequestId = verifyResponse.headers()['x-request-id'] || 'unknown';
    logApiResponse('/api/v2/admin/events/:id/verify-qr', verifyResponse.status(), verifyRequestId);

    expect(verifyResponse.status(), 'verify-qr should return 200').toBe(200);

    const verifyData = await verifyResponse.json();
    expect(verifyData.item.assetState, 'Event should now be ACTIVE').toBe('ACTIVE');
    expect(verifyData.item.qrVerified, 'Event should be QR verified').toBe(true);

    logGateStep(5, 'Event verified and transitioned to ACTIVE', 'PASS');

    // =========================================================================
    // STEP 6: Verify all bundles now return 200
    // =========================================================================
    logGateStep(6, 'All bundles must return 200 for ACTIVE event', 'START');

    // 6a: publicBundle
    const publicBundle2Response = await request.get(
      `${BASE_URL}/api/events/${testEventId}/publicBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    expect(publicBundle2Response.status(), 'publicBundle should return 200 for ACTIVE event').toBe(
      200
    );

    const publicBundle2Data = await publicBundle2Response.json();
    expect(publicBundle2Data.ok, 'Response should be ok').toBe(true);
    expect(publicBundle2Data.value.assetState, 'assetState should be ACTIVE').toBe('ACTIVE');
    expect(publicBundle2Data.value.assetStateInfo.isRenderable, 'isRenderable should be true').toBe(
      true
    );

    // 6b: displayBundle
    const displayBundle2Response = await request.get(
      `${BASE_URL}/api/events/${testEventId}/displayBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    expect(
      displayBundle2Response.status(),
      'displayBundle should return 200 for ACTIVE event'
    ).toBe(200);

    const displayBundle2Data = await displayBundle2Response.json();
    expect(displayBundle2Data.ok, 'Response should be ok').toBe(true);
    expect(displayBundle2Data.value.surface, 'surface should be display').toBe('display');
    expect(
      displayBundle2Data.value.displayRotation,
      'displayRotation should be present'
    ).toBeDefined();

    // 6c: posterBundle
    const posterBundle2Response = await request.get(
      `${BASE_URL}/api/events/${testEventId}/posterBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    expect(posterBundle2Response.status(), 'posterBundle should return 200 for ACTIVE event').toBe(
      200
    );

    const posterBundle2Data = await posterBundle2Response.json();
    expect(posterBundle2Data.ok, 'Response should be ok').toBe(true);
    expect(posterBundle2Data.value.surface, 'surface should be poster').toBe('poster');
    expect(posterBundle2Data.value.posterLayout, 'posterLayout should be present').toBeDefined();

    logGateStep(6, 'All bundles correctly allow ACTIVE event', 'PASS');

    // =========================================================================
    // STEP 7: Cleanup - Archive test event
    // =========================================================================
    logGateStep(7, 'Cleanup - archive test event', 'START');

    const archiveResponse = await request.post(
      `${BASE_URL}/api/v2/admin/events/${testEventId}/archive`,
      {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      }
    );

    expect(archiveResponse.status(), 'Archive should return 200').toBe(200);

    // Verify archived event is blocked
    const publicBundle3Response = await request.get(
      `${BASE_URL}/api/events/${testEventId}/publicBundle`,
      {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      }
    );

    expect(publicBundle3Response.status(), 'Archived event should return 403').toBe(403);

    const publicBundle3Data = await publicBundle3Response.json();
    expect(publicBundle3Data.assetState, 'assetState should be ARCHIVED').toBe('ARCHIVED');

    // Clear testEventId since event is archived
    testEventId = null;

    logGateStep(7, 'Test event archived and confirmed blocked', 'PASS');

    // =========================================================================
    // GATE SUMMARY
    // =========================================================================
    console.log(
      JSON.stringify({
        type: 'ASSET_INTEGRITY_GATE_SUMMARY',
        status: 'PASSED',
        steps: 7,
        message: 'All asset integrity checks passed',
        timestamp: new Date().toISOString(),
      })
    );
  });

  test('E5 GATE: assetState.js module contains required exports', async ({ request }) => {
    logGateStep(0, 'Verify assetState.js module integrity', 'START');

    const response = await request.get(`${BASE_URL}/web/shared/assetState.js`, {
      timeout: TIMEOUT,
    });

    expect(response.status(), 'assetState.js should return 200').toBe(200);

    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('javascript');

    const body = await response.text();

    // Verify required exports
    const requiredExports = [
      'AssetState', // Module namespace
      'STATES', // State constants
      'SURFACES', // Surface constants
      'assertRenderable', // Core assertion function
      'canRender', // Convenience function
      'guardRender', // E3: Guard function
      'showBlockedState', // UI function
    ];

    for (const exportName of requiredExports) {
      expect(body, `assetState.js should contain ${exportName}`).toContain(exportName);
    }

    // Verify state values
    expect(body).toContain('DRAFT');
    expect(body).toContain('READY');
    expect(body).toContain('ACTIVE');
    expect(body).toContain('ARCHIVED');

    logGateStep(0, 'assetState.js module integrity verified', 'PASS');
  });
});
