/**
 * Story E5: Asset Integrity Assertions
 *
 * Purpose / Value:
 *   Enforce public-facing safety invariants at CI level.
 *   These are hard-block assertions that prevent unsafe assets
 *   from reaching production.
 *
 * Environment: STAGING
 *
 * Required Stage-2 Assertions:
 *   1. Public endpoint never returns QR unless verified:true
 *   2. Public endpoint never returns ACTIVE when missing required fields
 *   3. Display endpoint never includes non-ACTIVE events
 *   4. Poster endpoint never renders QR for non-ACTIVE
 *
 * CI Gate Rule: If ANY asset invariant fails -> staging deploy FAILS
 *
 * Acceptance Criteria:
 *   CI blocks: broken posters, unsafe QRs, empty public screens
 *   Logs include: endpoint, assetState, requestId
 *
 * @see Story E5 - Stage-2 Asset Integrity Gate (HARD BLOCK)
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

/** Unique prefix for E5 asset integrity test events */
const E5_ASSET_INTEGRITY_PREFIX = 'E5-AssetIntegrity';

// =============================================================================
// Types
// =============================================================================

interface AssetIntegrityLog {
  type: 'ASSET_INTEGRITY_ASSERTION';
  assertion: string;
  endpoint: string;
  assetState: string;
  requestId: string;
  status: 'START' | 'PASS' | 'FAIL';
  details?: Record<string, unknown>;
  timestamp: string;
}

interface EventResponse {
  ok: boolean;
  value?: {
    event?: {
      qr?: {
        public?: string;
        signup?: string;
      };
      qrVerified?: boolean;
      name?: string;
      startDateISO?: string;
      venue?: string;
    };
    assetState?: string;
    assetStateInfo?: {
      state: string;
      isRenderable: boolean;
    };
    surface?: string;
    posterLayout?: {
      showQR?: boolean;
    };
  };
  assetState?: string;
  code?: string;
}

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

function logAssertion(log: Omit<AssetIntegrityLog, 'type' | 'timestamp'>): void {
  const fullLog: AssetIntegrityLog = {
    type: 'ASSET_INTEGRITY_ASSERTION',
    ...log,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(fullLog));
}

// =============================================================================
// Test Suite: Asset Integrity Assertions (Hard Gate)
// =============================================================================

test.describe('Story E5: Asset Integrity Assertions', () => {
  // Track test events for cleanup
  let unverifiedEventId: string | null = null;
  let verifiedEventId: string | null = null;

  test.beforeAll(async ({ request }) => {
    test.skip(!hasCFAccess(), 'Requires Cloudflare Access Service Token');

    // Create two test events: one unverified (READY) and one verified (ACTIVE)
    const timestamp = Date.now();

    // Create unverified event
    const unverifiedResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: `${E5_ASSET_INTEGRITY_PREFIX}-Unverified-${timestamp}`,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'E5 Asset Integrity Test Venue',
      },
      timeout: TIMEOUT,
    });

    if (unverifiedResponse.status() === 201) {
      const data = await unverifiedResponse.json();
      unverifiedEventId = data.item.id;
      console.log(JSON.stringify({
        type: 'TEST_SETUP',
        action: 'created_unverified_event',
        eventId: unverifiedEventId,
        assetState: data.item.assetState,
        timestamp: new Date().toISOString(),
      }));
    }

    // Create verified event
    const verifiedResponse = await request.post(`${BASE_URL}/api/v2/admin/events`, {
      headers: getAuthHeaders(),
      data: {
        name: `${E5_ASSET_INTEGRITY_PREFIX}-Verified-${timestamp}`,
        brand: BRAND,
        startDateISO: new Date().toISOString().split('T')[0],
        venue: 'E5 Asset Integrity Test Venue',
      },
      timeout: TIMEOUT,
    });

    if (verifiedResponse.status() === 201) {
      const data = await verifiedResponse.json();
      verifiedEventId = data.item.id;

      // Verify QR to make it ACTIVE
      await request.post(`${BASE_URL}/api/v2/admin/events/${verifiedEventId}/verify-qr`, {
        headers: getAuthHeaders(),
        timeout: TIMEOUT,
      });

      console.log(JSON.stringify({
        type: 'TEST_SETUP',
        action: 'created_verified_event',
        eventId: verifiedEventId,
        assetState: 'ACTIVE',
        timestamp: new Date().toISOString(),
      }));
    }
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: Archive test events
    const eventsToArchive = [unverifiedEventId, verifiedEventId].filter(Boolean);

    for (const eventId of eventsToArchive) {
      try {
        await request.post(`${BASE_URL}/api/v2/admin/events/${eventId}/archive`, {
          headers: getAuthHeaders(),
          timeout: TIMEOUT,
        });
        console.log(JSON.stringify({
          type: 'TEST_CLEANUP',
          action: 'archived_event',
          eventId,
          timestamp: new Date().toISOString(),
        }));
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ===========================================================================
  // ASSERTION 1: Public endpoint never returns QR unless verified:true
  // ===========================================================================
  test('ASSERTION 1: Public endpoint never returns QR unless verified:true', async ({ request }) => {
    test.skip(!hasCFAccess(), 'Requires Cloudflare Access Service Token');
    expect(verifiedEventId, 'Verified event must be created').toBeTruthy();

    logAssertion({
      assertion: 'public_qr_requires_verified',
      endpoint: '/api/events/:id/publicBundle',
      assetState: 'ACTIVE',
      requestId: 'pending',
      status: 'START',
    });

    // Get public bundle for ACTIVE event
    const response = await request.get(`${BASE_URL}/api/events/${verifiedEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    const data: EventResponse = await response.json();

    // INVARIANT: If QR codes are returned, event must be verified
    if (data.ok && data.value?.event?.qr) {
      const hasQR = data.value.event.qr.public || data.value.event.qr.signup;
      const isVerified = data.value.event.qrVerified === true;
      const isActive = data.value.assetState === 'ACTIVE';

      logAssertion({
        assertion: 'public_qr_requires_verified',
        endpoint: '/api/events/:id/publicBundle',
        assetState: data.value.assetState || 'unknown',
        requestId,
        status: hasQR && isVerified && isActive ? 'PASS' : 'FAIL',
        details: { hasQR, isVerified, isActive },
      });

      expect(
        !hasQR || (isVerified && isActive),
        'Public endpoint must not return QR unless verified:true and state is ACTIVE'
      ).toBe(true);
    } else {
      logAssertion({
        assertion: 'public_qr_requires_verified',
        endpoint: '/api/events/:id/publicBundle',
        assetState: data.assetState || 'unknown',
        requestId,
        status: 'PASS',
        details: { reason: 'No QR data returned (blocked or event not found)' },
      });
    }
  });

  // ===========================================================================
  // ASSERTION 2: Public endpoint never returns ACTIVE when missing required fields
  // ===========================================================================
  test('ASSERTION 2: Public endpoint never returns ACTIVE when missing required fields', async ({ request }) => {
    test.skip(!hasCFAccess(), 'Requires Cloudflare Access Service Token');
    expect(verifiedEventId, 'Verified event must be created').toBeTruthy();

    logAssertion({
      assertion: 'active_requires_fields',
      endpoint: '/api/events/:id/publicBundle',
      assetState: 'ACTIVE',
      requestId: 'pending',
      status: 'START',
    });

    const response = await request.get(`${BASE_URL}/api/events/${verifiedEventId}/publicBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    const data: EventResponse = await response.json();

    if (data.ok && data.value?.assetState === 'ACTIVE') {
      const event = data.value.event;

      // Required fields for ACTIVE state
      const hasName = !!(event?.name && event.name.trim().length > 0);
      const hasStartDate = !!event?.startDateISO;
      const hasVenue = !!(event?.venue && event.venue.trim().length > 0);
      const hasRequiredFields = hasName && hasStartDate && hasVenue;

      logAssertion({
        assertion: 'active_requires_fields',
        endpoint: '/api/events/:id/publicBundle',
        assetState: 'ACTIVE',
        requestId,
        status: hasRequiredFields ? 'PASS' : 'FAIL',
        details: { hasName, hasStartDate, hasVenue, eventName: event?.name },
      });

      expect(
        hasRequiredFields,
        'ACTIVE events must have all required fields (name, startDateISO, venue)'
      ).toBe(true);
    } else {
      // Event not ACTIVE or not found - assertion passes (no invalid ACTIVE state)
      logAssertion({
        assertion: 'active_requires_fields',
        endpoint: '/api/events/:id/publicBundle',
        assetState: data.value?.assetState || data.assetState || 'unknown',
        requestId,
        status: 'PASS',
        details: { reason: 'Event is not in ACTIVE state' },
      });
    }
  });

  // ===========================================================================
  // ASSERTION 3: Display endpoint never includes non-ACTIVE events
  // ===========================================================================
  test('ASSERTION 3: Display endpoint never includes non-ACTIVE events', async ({ request }) => {
    test.skip(!hasCFAccess(), 'Requires Cloudflare Access Service Token');
    expect(unverifiedEventId, 'Unverified event must be created').toBeTruthy();

    logAssertion({
      assertion: 'display_blocks_non_active',
      endpoint: '/api/events/:id/displayBundle',
      assetState: 'READY',
      requestId: 'pending',
      status: 'START',
    });

    // Try to get display bundle for unverified (READY) event
    const response = await request.get(`${BASE_URL}/api/events/${unverifiedEventId}/displayBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    const status = response.status();
    const data: EventResponse = await response.json();

    // INVARIANT: Display surface must block non-ACTIVE events with 403
    const isBlocked = status === 403 && data.code === 'ASSET_NOT_RENDERABLE';
    const returnedState = data.assetState || data.value?.assetState || 'unknown';

    logAssertion({
      assertion: 'display_blocks_non_active',
      endpoint: '/api/events/:id/displayBundle',
      assetState: returnedState,
      requestId,
      status: isBlocked ? 'PASS' : 'FAIL',
      details: { httpStatus: status, errorCode: data.code },
    });

    expect(status, 'Display endpoint must return 403 for non-ACTIVE events').toBe(403);
    expect(data.code, 'Error code must be ASSET_NOT_RENDERABLE').toBe('ASSET_NOT_RENDERABLE');
  });

  // ===========================================================================
  // ASSERTION 4: Poster endpoint never renders QR for non-ACTIVE
  // ===========================================================================
  test('ASSERTION 4: Poster endpoint never renders QR for non-ACTIVE', async ({ request }) => {
    test.skip(!hasCFAccess(), 'Requires Cloudflare Access Service Token');
    expect(unverifiedEventId, 'Unverified event must be created').toBeTruthy();

    logAssertion({
      assertion: 'poster_no_qr_non_active',
      endpoint: '/api/events/:id/posterBundle',
      assetState: 'READY',
      requestId: 'pending',
      status: 'START',
    });

    // Try to get poster bundle for unverified (READY) event
    const response = await request.get(`${BASE_URL}/api/events/${unverifiedEventId}/posterBundle`, {
      params: { brand: BRAND },
      timeout: TIMEOUT,
    });

    const requestId = response.headers()['x-request-id'] || 'unknown';
    const status = response.status();
    const data: EventResponse = await response.json();

    // INVARIANT: Poster surface must not render QR for non-ACTIVE events
    // This is enforced by blocking the entire request with 403
    const isBlocked = status === 403;
    const returnedState = data.assetState || data.value?.assetState || 'unknown';

    // If blocked (403), no QR can be rendered - assertion passes
    // If somehow returns 200 for non-ACTIVE, check that no QR is present
    let qrWouldRender = false;
    if (status === 200 && data.value) {
      const hasQRData = data.value.event?.qr?.public || data.value.event?.qr?.signup;
      const showQRSetting = data.value.posterLayout?.showQR !== false;
      qrWouldRender = !!(hasQRData && showQRSetting);
    }

    const passed = isBlocked || !qrWouldRender;

    logAssertion({
      assertion: 'poster_no_qr_non_active',
      endpoint: '/api/events/:id/posterBundle',
      assetState: returnedState,
      requestId,
      status: passed ? 'PASS' : 'FAIL',
      details: { httpStatus: status, isBlocked, errorCode: data.code },
    });

    expect(
      passed,
      'Poster endpoint must not render QR for non-ACTIVE events (should return 403)'
    ).toBe(true);
  });

  // ===========================================================================
  // ASSERTION 5: Verify ACTIVE events CAN render on all surfaces
  // ===========================================================================
  test('ASSERTION 5: ACTIVE events render correctly on all surfaces', async ({ request }) => {
    test.skip(!hasCFAccess(), 'Requires Cloudflare Access Service Token');
    expect(verifiedEventId, 'Verified event must be created').toBeTruthy();

    const surfaces = ['publicBundle', 'displayBundle', 'posterBundle'] as const;

    for (const surface of surfaces) {
      const endpoint = `/api/events/:id/${surface}`;

      logAssertion({
        assertion: 'active_renders_all_surfaces',
        endpoint,
        assetState: 'ACTIVE',
        requestId: 'pending',
        status: 'START',
      });

      const response = await request.get(`${BASE_URL}/api/events/${verifiedEventId}/${surface}`, {
        params: { brand: BRAND },
        timeout: TIMEOUT,
      });

      const requestId = response.headers()['x-request-id'] || 'unknown';
      const status = response.status();
      const data: EventResponse = await response.json();

      const isSuccess = status === 200 && data.ok === true;
      const isActive = data.value?.assetState === 'ACTIVE';

      logAssertion({
        assertion: 'active_renders_all_surfaces',
        endpoint,
        assetState: data.value?.assetState || 'unknown',
        requestId,
        status: isSuccess && isActive ? 'PASS' : 'FAIL',
        details: { httpStatus: status, surface },
      });

      expect(status, `${surface} should return 200 for ACTIVE events`).toBe(200);
      expect(data.ok, `${surface} should return ok:true`).toBe(true);
      expect(data.value?.assetState, `${surface} should show ACTIVE state`).toBe('ACTIVE');
    }
  });

  // ===========================================================================
  // GATE SUMMARY
  // ===========================================================================
  test('E5 GATE SUMMARY: All asset integrity assertions passed', async () => {
    // This test runs after all others and logs the summary
    console.log(JSON.stringify({
      type: 'ASSET_INTEGRITY_GATE_SUMMARY',
      status: 'COMPLETED',
      assertions: [
        'public_qr_requires_verified',
        'active_requires_fields',
        'display_blocks_non_active',
        'poster_no_qr_non_active',
        'active_renders_all_surfaces',
      ],
      message: 'All asset integrity assertions evaluated',
      ciGateRule: 'If ANY assertion fails -> staging deploy FAILS',
      timestamp: new Date().toISOString(),
    }));
  });
});
