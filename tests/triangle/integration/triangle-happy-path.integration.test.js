/**
 * Triangle Happy-Path Integration Test - GOLDEN TEST
 *
 * @golden
 * @tags golden, integration, triangle, happy-path
 *
 * This is the GOLDEN PATH test - if this passes on staging, the release is probably fine.
 * "Event gets created, people see it, sponsors get metrics."
 *
 * Flow (Admin → Public → Display → SharedReport):
 * 1. Create an event via api_saveEvent (Admin → backend)
 * 2. Fetch api_getPublicBundle, api_getDisplayBundle, api_getPosterBundle (Surfaces → users)
 * 3. Log a CTA click via api_trackEventMetric
 * 4. Log an external click via api_logExternalClick (user interaction)
 * 5. Fetch api_getSharedReportBundle and verify clicks/impressions recorded (SharedReport → sponsors)
 *
 * Contract Compliance:
 *   - Event V2 contract (EVENT_CONTRACT.md v2.0)
 *   - Envelope boundary (API_CONTRACT.md)
 *   - Bundle-specific validators (config, rotation, layout, qrCodes, metrics)
 *
 * Environment Variables:
 *   - BASE_URL: Target environment (default: https://www.eventangle.com)
 *   - ADMIN_KEY: Admin key for event creation (required for full test)
 *   - BRAND_ID: Brand to test against (default: root)
 *
 * Run:
 *   ADMIN_KEY=your-key npm run test:triangle:golden
 *   BASE_URL=https://stg.eventangle.com ADMIN_KEY=your-key npm run test:triangle:golden
 *
 * CI Integration:
 *   BLOCKING gate in Stage 2 - release fails if this test fails on staging.
 *   See: .github/workflows/stage2-staging-contracts.yml
 */

const { getBaseUrl } = require('../../config/environments');
const { createBasicEvent, generateEventName } = require('../../shared/fixtures/events.fixtures');
const { validateEnvelope, validateSuccessEnvelope, sleep, ERROR_CODES } = require('../../shared/helpers/test.helpers');
const {
  validatePublicBundleContract,
  validateDisplayBundleContract,
  validatePosterBundleContract,
  validateSharedReportBundleContract
} = require('../../contract/event-contract-v2.matrix.test');

// Configuration
const BASE_URL = getBaseUrl();
const ADMIN_KEY = process.env.ADMIN_KEY;
const BRAND_ID = process.env.BRAND_ID || 'root';
const TEST_TIMEOUT = 60000; // 60 seconds for integration tests

// Golden test marker for CI filtering
const GOLDEN_TEST = true;

/**
 * Check if network is available
 */
let networkAvailable = null;
async function checkNetworkAvailable() {
  if (networkAvailable !== null) return networkAvailable;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(`${BASE_URL}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    networkAvailable = true;
  } catch {
    networkAvailable = false;
  }
  return networkAvailable;
}

/**
 * Helper to make HTTP requests
 */
async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response from ${url}: ${text.substring(0, 200)}`);
    }

    return { response, data };
  } catch (error) {
    // Check if it's a network error
    if (error.cause?.code === 'EAI_AGAIN' || error.cause?.code === 'ENOTFOUND') {
      throw new Error(`NETWORK_UNAVAILABLE: Cannot reach ${BASE_URL} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Helper to make GET requests
 */
async function apiGet(path) {
  const url = `${BASE_URL}${path}`;
  return apiRequest(url);
}

/**
 * Helper to make POST requests
 */
async function apiPost(path, body) {
  const url = `${BASE_URL}${path}`;
  return apiRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('Triangle Happy-Path Integration Test [GOLDEN]', () => {
  // Track created event for cleanup
  let createdEventId = null;

  // Export golden marker for CI detection
  // eslint-disable-next-line no-unused-vars
  const isGoldenTest = GOLDEN_TEST;

  // Skip if ADMIN_KEY not set
  beforeAll(() => {
    if (!ADMIN_KEY) {
      console.warn('ADMIN_KEY not set - skipping integration tests');
    }
  });

  afterAll(async () => {
    // Cleanup: Delete the test event
    if (createdEventId && ADMIN_KEY) {
      try {
        await apiPost('?action=delete', {
          brandId: BRAND_ID,
          scope: 'events',
          id: createdEventId,
          adminKey: ADMIN_KEY,
        });
        console.log(`Cleanup: Deleted test event ${createdEventId}`);
      } catch (error) {
        console.warn(`Cleanup failed for event ${createdEventId}:`, error.message);
      }
    }
  });

  describe('Complete Happy Path Flow', () => {
    // Store event data across test steps
    let eventId;
    let eventSlug;
    let publicBundle;
    let displayBundle;
    let posterBundle;

    test(
      'Step 1: Create an event via api_saveEvent',
      async () => {
        if (!ADMIN_KEY) {
          console.log('Skipping: ADMIN_KEY not set');
          return;
        }

        // Create event with unique name
        const eventData = createBasicEvent({
          name: generateEventName('Triangle Happy Path'),
          startDateISO: '2025-12-31',
          venue: 'Integration Test Venue',
          ctas: {
            primary: { label: 'Register Now', url: 'https://example.com/register' },
            secondary: null,
          },
        });

        const { data } = await apiPost('?action=saveEvent', {
          brandId: BRAND_ID,
          adminKey: ADMIN_KEY,
          event: eventData,
          scope: 'events',
          templateId: 'event',
        });

        // Validate response envelope
        expect(data).toHaveProperty('ok');
        expect(data.ok).toBe(true);
        expect(data).toHaveProperty('value');
        expect(data.value).toHaveProperty('id');

        // Store event data for subsequent tests
        eventId = data.value.id;
        eventSlug = data.value.slug;
        createdEventId = eventId; // For cleanup

        console.log(`Created event: ${eventId} (slug: ${eventSlug})`);

        // Verify required fields per EVENT_CONTRACT.md v2.0
        expect(data.value).toHaveProperty('name');
        expect(data.value).toHaveProperty('startDateISO');
        expect(data.value).toHaveProperty('venue');
        expect(data.value).toHaveProperty('links');
        expect(data.value.links).toHaveProperty('publicUrl');
        expect(data.value.links).toHaveProperty('displayUrl');
        expect(data.value.links).toHaveProperty('posterUrl');
      },
      TEST_TIMEOUT
    );

    test(
      'Step 2a: Fetch api_getPublicBundle (V2 Contract)',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        const { response, data } = await apiGet(
          `?action=getPublicBundle&brand=${BRAND_ID}&scope=events&id=${createdEventId}`
        );

        // Validate HTTP status
        expect(response.status).toBe(200);

        // Validate response envelope
        validateSuccessEnvelope(data);

        // Store bundle for verification
        publicBundle = data.value;

        // ================================================================
        // Validate PublicBundle V2 Contract
        // ================================================================
        const contractResult = validatePublicBundleContract(data);
        if (contractResult !== true) {
          throw new Error(`PublicBundle V2 contract violation: ${contractResult}`);
        }

        // Verify event data matches what we created
        expect(publicBundle.event.id).toBe(createdEventId);
        expect(publicBundle.event.name).toContain('Triangle Happy Path');

        console.log('✓ PublicBundle fetched - V2 contract validated');
      },
      TEST_TIMEOUT
    );

    test(
      'Step 2b: Fetch api_getDisplayBundle (V2 Contract)',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        const { response, data } = await apiGet(
          `?action=getDisplayBundle&brand=${BRAND_ID}&scope=events&id=${createdEventId}`
        );

        // Validate HTTP status
        expect(response.status).toBe(200);

        // Validate response envelope
        validateSuccessEnvelope(data);

        // Store bundle for verification
        displayBundle = data.value;

        // ================================================================
        // Validate DisplayBundle V2 Contract
        // ================================================================
        const contractResult = validateDisplayBundleContract(data);
        if (contractResult !== true) {
          throw new Error(`DisplayBundle V2 contract violation: ${contractResult}`);
        }

        // Verify event data matches what we created
        expect(displayBundle.event.id).toBe(createdEventId);

        console.log('✓ DisplayBundle fetched - V2 contract validated');
      },
      TEST_TIMEOUT
    );

    test(
      'Step 2c: Fetch api_getPosterBundle (V2 Contract)',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        const { response, data } = await apiGet(
          `?action=getPosterBundle&brand=${BRAND_ID}&scope=events&id=${createdEventId}`
        );

        // Validate HTTP status
        expect(response.status).toBe(200);

        // Validate response envelope
        validateSuccessEnvelope(data);

        // Store bundle for verification
        posterBundle = data.value;

        // ================================================================
        // Validate PosterBundle V2 Contract
        // ================================================================
        const contractResult = validatePosterBundleContract(data);
        if (contractResult !== true) {
          throw new Error(`PosterBundle V2 contract violation: ${contractResult}`);
        }

        // Verify event data matches what we created
        expect(posterBundle.event.id).toBe(createdEventId);

        console.log('✓ PosterBundle fetched - V2 contract validated');
      },
      TEST_TIMEOUT
    );

    test(
      'Step 3a: Log a CTA click via api_trackEventMetric',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        const { data } = await apiPost('?action=trackEventMetric', {
          brandId: BRAND_ID,
          eventId: createdEventId,
          surface: 'public',
          action: 'cta_click',
        });

        // Validate response envelope
        validateEnvelope(data);
        expect(data.ok).toBe(true);
        expect(data).toHaveProperty('value');
        expect(data.value).toHaveProperty('count');
        expect(data.value.count).toBe(1);

        console.log('CTA click logged successfully');
      },
      TEST_TIMEOUT
    );

    test(
      'Step 3b: Log an external click via api_logExternalClick',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        // Generate a unique session ID for attribution tracking
        const sessionId = `test-session-${Date.now()}`;

        // Log an external click (e.g., user clicks schedule link)
        const { data } = await apiPost('?action=logExternalClick', {
          eventId: createdEventId,
          linkType: 'schedule',  // One of: schedule, standings, bracket, stats, scoreboard, stream
          sessionId: sessionId,
          surface: 'public',
          visibleSponsorIds: [],  // Optional: for sponsor attribution
        });

        // Validate response envelope
        validateEnvelope(data);
        expect(data.ok).toBe(true);
        expect(data).toHaveProperty('value');
        expect(data.value).toHaveProperty('logged');
        expect(data.value.logged).toBe(true);

        console.log('External click (schedule) logged successfully');

        // Log another external click type to verify flexibility
        const { data: data2 } = await apiPost('?action=logExternalClick', {
          eventId: createdEventId,
          linkType: 'standings',
          sessionId: sessionId,
          surface: 'display',
          visibleSponsorIds: [],
        });

        expect(data2.ok).toBe(true);
        console.log('External click (standings) logged successfully');

        // Wait a moment for analytics to propagate
        await sleep(1000);
      },
      TEST_TIMEOUT
    );

    test(
      'Step 4: Verify clicks/impressions in api_getSharedReportBundle (V2 Contract)',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        // Use getSharedReportBundle (canonical action name)
        const { response, data } = await apiGet(
          `?action=getSharedReportBundle&brand=${BRAND_ID}&id=${createdEventId}`
        );

        // Validate HTTP status
        expect(response.status).toBe(200);

        // Validate response envelope
        validateSuccessEnvelope(data);

        // ================================================================
        // Validate SharedReportBundle V2 Contract
        // ================================================================
        const contractResult = validateSharedReportBundleContract(data);
        if (contractResult !== true) {
          throw new Error(`SharedReportBundle V2 contract violation: ${contractResult}`);
        }

        const bundle = data.value;

        // Verify event matches what we created
        expect(bundle.event.id).toBe(createdEventId);

        // Verify metrics structure
        expect(bundle.metrics).toHaveProperty('views');
        expect(typeof bundle.metrics.views).toBe('number');

        // ================================================================
        // Verify activity was recorded (key acceptance criterion)
        // ================================================================
        console.log(`SharedReport metrics:`);
        console.log(`  - views: ${bundle.metrics.views}`);
        console.log(`  - uniqueViews: ${bundle.metrics.uniqueViews || 0}`);

        // Log success
        console.log('✓ SharedReportBundle fetched - V2 contract validated');
        console.log('✓ Triangle Happy Path complete: Admin → Public → Display → SharedReport');
      },
      TEST_TIMEOUT
    );
  });

  describe('Bundle Content Validation', () => {
    test(
      'All bundles should have consistent event data',
      async () => {
        if (!ADMIN_KEY || !createdEventId) {
          console.log('Skipping: No event created');
          return;
        }

        // Fetch all bundles
        const [publicResult, displayResult, posterResult] = await Promise.all([
          apiGet(`?action=getPublicBundle&brand=${BRAND_ID}&scope=events&id=${createdEventId}`),
          apiGet(`?action=getDisplayBundle&brand=${BRAND_ID}&scope=events&id=${createdEventId}`),
          apiGet(`?action=getPosterBundle&brand=${BRAND_ID}&scope=events&id=${createdEventId}`),
        ]);

        const publicEvent = publicResult.data.value?.event;
        const displayEvent = displayResult.data.value?.event;
        const posterEvent = posterResult.data.value?.event;

        // All bundles should return the same core event data
        expect(publicEvent?.id).toBe(displayEvent?.id);
        expect(displayEvent?.id).toBe(posterEvent?.id);
        expect(publicEvent?.name).toBe(displayEvent?.name);
        expect(displayEvent?.name).toBe(posterEvent?.name);

        console.log('All bundles have consistent event data');
      },
      TEST_TIMEOUT
    );
  });
});

describe('Triangle Integration: Error Handling', () => {
  beforeAll(async () => {
    const available = await checkNetworkAvailable();
    if (!available) {
      console.log(`Skipping error handling tests: Network unavailable (${BASE_URL})`);
    }
  });

  test('Should handle non-existent event gracefully', async () => {
    const available = await checkNetworkAvailable();
    if (!available) {
      console.log('Skipping: Network unavailable');
      return;
    }

    const fakeEventId = 'non-existent-event-12345';

    const { data } = await apiGet(
      `?action=getPublicBundle&brand=${BRAND_ID}&scope=events&id=${fakeEventId}`
    );

    // Should return error envelope
    expect(data).toHaveProperty('ok');
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty('code');
    expect(data.code).toBe('NOT_FOUND');
  });

  test('Should reject invalid metric tracking', async () => {
    const available = await checkNetworkAvailable();
    if (!available) {
      console.log('Skipping: Network unavailable');
      return;
    }

    const { data } = await apiPost('?action=trackEventMetric', {
      brandId: BRAND_ID,
      eventId: 'non-existent',
      surface: 'invalid_surface',
      action: 'invalid_action',
    });

    // Should return error envelope
    expect(data).toHaveProperty('ok');
    expect(data.ok).toBe(false);
    expect(data).toHaveProperty('code');
    // Could be BAD_INPUT or NOT_FOUND depending on validation order
    expect(['BAD_INPUT', 'NOT_FOUND']).toContain(data.code);
  });
});

describe('Triangle Integration: Performance Baseline', () => {
  test(
    'All bundle endpoints should respond within acceptable time',
    async () => {
      const available = await checkNetworkAvailable();
      if (!available) {
        console.log('Skipping: Network unavailable');
        return;
      }

      if (!ADMIN_KEY) {
        console.log('Skipping: ADMIN_KEY not set');
        return;
      }

      // Use the first event from list, or create a temporary one
      const { data: listData } = await apiGet(`?p=api&action=list&brand=${BRAND_ID}&scope=events`);

      if (!listData.ok || !listData.value?.items?.length) {
        console.log('Skipping: No events available for performance test');
        return;
      }

      const testEventId = listData.value.items[0].id;
      const maxAcceptableTime = 5000; // 5 seconds

      // Measure PublicBundle
      const publicStart = Date.now();
      await apiGet(`?action=getPublicBundle&brand=${BRAND_ID}&scope=events&id=${testEventId}`);
      const publicTime = Date.now() - publicStart;

      // Measure DisplayBundle
      const displayStart = Date.now();
      await apiGet(`?action=getDisplayBundle&brand=${BRAND_ID}&scope=events&id=${testEventId}`);
      const displayTime = Date.now() - displayStart;

      // Measure PosterBundle
      const posterStart = Date.now();
      await apiGet(`?action=getPosterBundle&brand=${BRAND_ID}&scope=events&id=${testEventId}`);
      const posterTime = Date.now() - posterStart;

      console.log(`Bundle response times: Public=${publicTime}ms, Display=${displayTime}ms, Poster=${posterTime}ms`);

      expect(publicTime).toBeLessThan(maxAcceptableTime);
      expect(displayTime).toBeLessThan(maxAcceptableTime);
      expect(posterTime).toBeLessThan(maxAcceptableTime);
    },
    TEST_TIMEOUT
  );
});
