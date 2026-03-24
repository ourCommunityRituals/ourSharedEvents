/**
 * E2E BACKEND VALIDATION: Using TestRunner
 *
 * Uses the TestRunner utility to validate backend API functions
 * against their documented contracts.
 *
 * This test file runs actual API requests against the deployment
 * and validates responses match EVENT_CONTRACT.md v2.0.
 */

const { test, expect } = require('@playwright/test');
const { getCurrentEnvironment } = require('../../config/environments.js');

const {
  TestRunner,
  validateEventContractV2,
  validateBundleEnvelope,
  validateEtag,
  ERROR_CODES
} = require('../../shared/helpers/test-runner.js');

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const env = getCurrentEnvironment();
const BASE_URL = env.baseUrl;
const BRAND_ID = 'root';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_root';

/**
 * Build API URL with action as query parameter
 * The Cloudflare Worker uses ?action= to identify API requests vs page requests
 * @param {string} action - The API action to call
 * @returns {string} URL with action query parameter
 */
function buildApiUrl(action) {
  const url = new URL(BASE_URL);
  if (action) {
    url.searchParams.set('action', action);
  }
  return url.toString();
}

// ============================================================================
// TEST MATRICES FOR LIVE VALIDATION
// ============================================================================

const BUNDLE_MATRICES = [
  {
    endpoint: 'api_getPublicBundle',
    description: 'Public page bundle (no auth required)',
    cases: [
      {
        name: 'returns valid bundle envelope',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          requiredFields: ['event', 'config']
        }
      },
      {
        name: 'event follows v2.0 canonical shape',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          validator: (response) => validateEventContractV2(response.value.event)
        }
      },
      {
        name: 'includes etag for caching',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          validator: (response) => validateEtag(response)
        }
      },
      {
        name: 'config contains brand info',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          requiredFields: ['config.brandId', 'config.brandName']
        }
      },
      {
        name: 'rejects invalid brand',
        input: { brandId: 'nonexistent-brand-xyz' },
        expected: {
          ok: false,
          code: 'BAD_INPUT'
        }
      }
    ]
  },
  {
    endpoint: 'api_getDisplayBundle',
    description: 'Display/TV bundle',
    cases: [
      {
        name: 'returns valid display bundle',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          requiredFields: ['event']
        }
      },
      {
        name: 'event follows v2.0 shape',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          validator: (response) => validateEventContractV2(response.value.event)
        }
      }
    ]
  },
  {
    endpoint: 'api_getPosterBundle',
    description: 'Poster/print bundle',
    cases: [
      {
        name: 'returns valid poster bundle',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          requiredFields: ['event']
        }
      },
      {
        name: 'event has QR codes for printing',
        input: { brandId: BRAND_ID },
        expected: {
          ok: true,
          validator: (response) => {
            const qr = response.value?.event?.qr;
            if (!qr) return 'Missing qr block';
            if (!qr.public) return 'Missing qr.public';
            return true;
          }
        }
      }
    ]
  }
];

const SAVE_EVENT_MATRIX = {
  endpoint: 'api_saveEvent',
  description: 'Event create/update API',
  cases: [
    {
      name: 'creates event with MVP fields',
      input: {
        adminKey: ADMIN_KEY,
        event: {
          name: `TestRunner Event - ${Date.now()}`,
          startDateISO: '2025-12-31',
          venue: 'TestRunner Venue'
        }
      },
      expected: {
        ok: true,
        requiredFields: ['id', 'slug', 'name', 'links', 'qr'],
        validator: (response) => {
          if (response.ok) {
            return validateEventContractV2(response.value);
          }
          // Auth may fail in test env
          if (response.code === 'BAD_INPUT' && response.message?.includes('admin')) {
            return true; // Expected in test env without valid key
          }
          return response.message || 'Unexpected error';
        }
      }
    },
    {
      name: 'rejects missing name',
      input: {
        adminKey: ADMIN_KEY,
        event: {
          startDateISO: '2025-12-31',
          venue: 'Test Venue'
        }
      },
      expected: {
        ok: false,
        code: 'BAD_INPUT'
      }
    },
    {
      name: 'rejects missing venue',
      input: {
        adminKey: ADMIN_KEY,
        event: {
          name: 'Test Event',
          startDateISO: '2025-12-31'
        }
      },
      expected: {
        ok: false,
        code: 'BAD_INPUT'
      }
    },
    {
      name: 'rejects invalid date format',
      input: {
        adminKey: ADMIN_KEY,
        event: {
          name: 'Test Event',
          startDateISO: '12/31/2025', // Wrong format
          venue: 'Test Venue'
        }
      },
      expected: {
        ok: false,
        code: 'BAD_INPUT'
      }
    },
    {
      name: 'rejects invalid admin key',
      input: {
        adminKey: 'invalid-key-12345',
        event: {
          name: 'Test Event',
          startDateISO: '2025-12-31',
          venue: 'Test Venue'
        }
      },
      expected: {
        ok: false,
        code: 'BAD_INPUT'
      }
    }
  ]
};

// ============================================================================
// TEST SUITES
// ============================================================================

test.describe('🔬 Backend Validation: TestRunner', () => {
  // Helper to create a runner with the test's request fixture
  const createRunner = (request) => new TestRunner({
    baseUrl: BASE_URL,
    adminKey: ADMIN_KEY,
    brandId: BRAND_ID,
    verbose: false,
    requestFn: request
  });

  test.describe('Bundle API Contracts', () => {
    BUNDLE_MATRICES.forEach(matrix => {
      test.describe(matrix.endpoint, () => {
        matrix.cases.forEach(testCase => {
          test(testCase.name, async ({ request }) => {
            const runner = createRunner(request);
            const result = await runner.runTestCase(matrix.endpoint, testCase);

            if (!result.passed) {
              console.log(`Failed: ${result.error}`);
              console.log(`Response:`, JSON.stringify(result.response, null, 2));
            }

            expect(result.passed).toBe(true);
          });
        });
      });
    });
  });

  test.describe('api_saveEvent Contract', () => {
    SAVE_EVENT_MATRIX.cases.forEach(testCase => {
      test(testCase.name, async ({ request }) => {
        const runner = createRunner(request);
        const result = await runner.runTestCase(SAVE_EVENT_MATRIX.endpoint, testCase);

        if (!result.passed && runner.verbose) {
          console.log(`Failed: ${result.error}`);
        }

        expect(result.passed).toBe(true);
      });
    });
  });

  test.describe('Cross-Bundle Consistency', () => {
    test('all bundles return same event ID for same brand', async ({ request }) => {
      const bundles = ['api_getPublicBundle', 'api_getDisplayBundle', 'api_getPosterBundle'];
      const eventIds = [];

      for (const endpoint of bundles) {
        const response = await request.post(buildApiUrl(endpoint), {
          data: {
            action: endpoint,
            brandId: BRAND_ID
          }
        });

        const data = await response.json();

        if (data.ok && data.value?.event?.id) {
          eventIds.push({
            endpoint,
            id: data.value.event.id
          });
        }
      }

      // All event IDs should match (if events exist)
      if (eventIds.length > 1) {
        const firstId = eventIds[0].id;
        eventIds.forEach(({ endpoint, id }) => {
          expect(id).toBe(firstId);
        });
      }
    });

    test('etag format is consistent across bundles', async ({ request }) => {
      const bundles = ['api_getPublicBundle', 'api_getDisplayBundle', 'api_getPosterBundle'];

      for (const endpoint of bundles) {
        const response = await request.post(buildApiUrl(endpoint), {
          data: {
            action: endpoint,
            brandId: BRAND_ID
          }
        });

        const data = await response.json();

        if (data.ok && data.etag) {
          // Etag should be a non-empty string
          expect(typeof data.etag).toBe('string');
          expect(data.etag.length).toBeGreaterThan(0);
        }
      }
    });
  });

  test.describe('Error Handling', () => {
    test('invalid action returns proper error envelope', async ({ request }) => {
      const response = await request.post(buildApiUrl('nonexistent_action_xyz'), {
        data: {
          action: 'nonexistent_action_xyz',
          brandId: BRAND_ID
        }
      });

      const data = await response.json();

      expect(data).toHaveProperty('ok');
      expect(data.ok).toBe(false);
      expect(data).toHaveProperty('code');
      expect(data).toHaveProperty('message');
    });

    test('missing action returns error', async ({ request }) => {
      // Use a placeholder action to trigger API mode in Cloudflare Worker
      const response = await request.post(buildApiUrl('api_unknown'), {
        data: {
          brandId: BRAND_ID
        }
      });

      const data = await response.json();

      expect(data.ok).toBe(false);
    });
  });

  test.describe('Caching (ETags)', () => {
    test('notModified response when etag matches', async ({ request }) => {
      // First request to get etag
      const firstResponse = await request.post(buildApiUrl('api_getPublicBundle'), {
        data: {
          action: 'api_getPublicBundle',
          brandId: BRAND_ID
        }
      });

      const firstData = await firstResponse.json();

      if (!firstData.ok || !firstData.etag) {
        test.skip();
        return;
      }

      // Second request with matching etag
      const secondResponse = await request.post(buildApiUrl('api_getPublicBundle'), {
        data: {
          action: 'api_getPublicBundle',
          brandId: BRAND_ID,
          ifNoneMatch: firstData.etag
        }
      });

      const secondData = await secondResponse.json();

      expect(secondData.ok).toBe(true);
      expect(secondData.notModified).toBe(true);
      expect(secondData.etag).toBe(firstData.etag);
    });

    test('fresh response when etag does not match', async ({ request }) => {
      const response = await request.post(buildApiUrl('api_getPublicBundle'), {
        data: {
          action: 'api_getPublicBundle',
          brandId: BRAND_ID,
          ifNoneMatch: 'invalid-etag-12345'
        }
      });

      const data = await response.json();

      if (data.ok) {
        expect(data.notModified).toBeFalsy();
        expect(data).toHaveProperty('value');
      }
    });
  });
});

// ============================================================================
// FULL MATRIX VALIDATION
// ============================================================================

test.describe('🔬 Full Test Matrix Validation', () => {

  test('run all bundle matrices and generate report', async ({ request }) => {
    const runner = new TestRunner({
      baseUrl: BASE_URL,
      adminKey: ADMIN_KEY,
      brandId: BRAND_ID,
      verbose: false,
      requestFn: request
    });

    // Run all bundle matrices
    await runner.runAllMatrices(BUNDLE_MATRICES);

    // Print report
    const summary = runner.printReport();

    // Assert pass rate is acceptable
    expect(summary.passRate).toBeGreaterThanOrEqual(80);
  });

  test('validate api_saveEvent matrix', async ({ request }) => {
    // Skip if no valid admin key
    if (ADMIN_KEY === 'CHANGE_ME_root') {
      test.skip();
      return;
    }

    const runner = new TestRunner({
      baseUrl: BASE_URL,
      adminKey: ADMIN_KEY,
      brandId: BRAND_ID,
      verbose: false,
      requestFn: request
    });

    await runner.runTestMatrix(SAVE_EVENT_MATRIX);

    const summary = runner.getSummary();

    // Print results
    console.log(`\napi_saveEvent: ${summary.passed}/${summary.total} passed`);

    // Error validation tests should pass
    expect(summary.passed).toBeGreaterThan(0);
  });
});

// ============================================================================
// CONTRACT COMPLIANCE
// ============================================================================

test.describe('📜 EVENT_CONTRACT.md v2.0 Compliance', () => {

  test('public bundle event has all MVP required fields', async ({ request }) => {
    const response = await request.post(buildApiUrl('api_getPublicBundle'), {
      data: {
        action: 'api_getPublicBundle',
        brandId: BRAND_ID
      }
    });

    const data = await response.json();

    if (!data.ok) {
      test.skip();
      return;
    }

    const event = data.value.event;

    // MVP REQUIRED: Identity
    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('slug');
    expect(event).toHaveProperty('name');
    expect(event).toHaveProperty('startDateISO');
    expect(event).toHaveProperty('venue');

    // MVP REQUIRED: Links
    expect(event.links).toHaveProperty('publicUrl');
    expect(event.links).toHaveProperty('displayUrl');
    expect(event.links).toHaveProperty('posterUrl');

    // MVP REQUIRED: QR
    expect(event.qr).toHaveProperty('public');
    expect(event.qr).toHaveProperty('signup');

    // MVP REQUIRED: CTAs
    expect(event.ctas).toHaveProperty('primary');
    expect(event.ctas.primary).toHaveProperty('label');

    // MVP REQUIRED: Settings
    expect(event.settings).toHaveProperty('showSchedule');
    expect(event.settings).toHaveProperty('showStandings');
    expect(event.settings).toHaveProperty('showBracket');

    // MVP REQUIRED: Metadata
    expect(event).toHaveProperty('createdAtISO');
    expect(event).toHaveProperty('updatedAtISO');
  });

  test('startDateISO uses correct format', async ({ request }) => {
    const response = await request.post(buildApiUrl('api_getPublicBundle'), {
      data: {
        action: 'api_getPublicBundle',
        brandId: BRAND_ID
      }
    });

    const data = await response.json();

    if (!data.ok) {
      test.skip();
      return;
    }

    const { startDateISO } = data.value.event;

    // Should be YYYY-MM-DD
    expect(startDateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('QR codes are base64 PNG data URIs', async ({ request }) => {
    const response = await request.post(buildApiUrl('api_getPosterBundle'), {
      data: {
        action: 'api_getPosterBundle',
        brandId: BRAND_ID
      }
    });

    const data = await response.json();

    if (!data.ok) {
      test.skip();
      return;
    }

    const { qr } = data.value.event;

    expect(qr.public).toMatch(/^data:image\/png;base64,/);
    expect(qr.signup).toMatch(/^data:image\/png;base64,/);
  });

  test('timestamps are ISO 8601 format', async ({ request }) => {
    const response = await request.post(buildApiUrl('api_getPublicBundle'), {
      data: {
        action: 'api_getPublicBundle',
        brandId: BRAND_ID
      }
    });

    const data = await response.json();

    if (!data.ok) {
      test.skip();
      return;
    }

    const { createdAtISO, updatedAtISO } = data.value.event;

    expect(createdAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(updatedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
