/**
 * Envelope Boundary Contract Tests
 *
 * Validates that API responses strictly adhere to the envelope/flat boundary
 * defined in API_CONTRACT.md.
 *
 * Purpose:
 * - Flat endpoints (status, statusmvp) must NEVER return envelope-wrapped responses
 * - Envelope endpoints must ALWAYS wrap data in { ok, value } or { ok, code, message }
 * - Prevents accidental contract violations that would break tools and test harnesses
 *
 * Run: npm run test:contract
 */

const {
  validateEnvelope,
  validateFlatResponse,
  validateFlatStatusResponse,
  validateFlatMvpStatusResponse,
  assertIsEnvelope,
  assertNotEnvelope,
  isEnvelope,
  isFlatResponse,
  FLAT_ENDPOINTS,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

// --- CI Detection ---
const isCI = process.env.CI === 'true' || process.env.CI === true;
const skipNetworkTests = isCI || process.env.SKIP_NETWORK_TESTS === 'true';
const describeNetwork = skipNetworkTests ? describe.skip : describe;

// --- Test Configuration ---
const { getBaseUrl, isGoogleAppsScript } = require('../config/environments');
const BASE_URL = getBaseUrl();
const TIMEOUT_MS = 30000;

// --- URL Builders ---
function buildUrl(page, brand = 'root') {
  if (isGoogleAppsScript()) {
    const params = new URLSearchParams({ page });
    if (brand !== 'root') params.set('brand', brand);
    return `${BASE_URL}?${params.toString()}`;
  }
  const basePath = brand === 'root' ? '' : `/${brand}`;
  return `${BASE_URL}${basePath}/${page}`;
}

// --- HTTP Client ---
async function fetchEndpoint(page, brand = 'root') {
  const url = buildUrl(page, brand);
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.json();
}

// ============================================================================
// UNIT TESTS - Validate helper functions work correctly (no network)
// ============================================================================

describe('Envelope Boundary Validators (Unit Tests)', () => {
  describe('isEnvelope()', () => {
    it('returns true for success envelope with value', () => {
      expect(isEnvelope({ ok: true, value: { foo: 'bar' } })).toBe(true);
    });

    it('returns true for error envelope with code and message', () => {
      expect(isEnvelope({ ok: false, code: 'NOT_FOUND', message: 'Not found' })).toBe(true);
    });

    it('returns false for flat success response', () => {
      expect(isEnvelope({ ok: true, buildId: 'v1', brandId: 'root', time: '2025-01-01' })).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isEnvelope(null)).toBe(false);
      expect(isEnvelope(undefined)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isEnvelope('string')).toBe(false);
      expect(isEnvelope(123)).toBe(false);
    });
  });

  describe('isFlatResponse()', () => {
    it('returns true for flat status response', () => {
      expect(isFlatResponse({
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-01-01T00:00:00.000Z',
        db: { ok: true }
      })).toBe(true);
    });

    it('returns true for flat error response with buildId', () => {
      expect(isFlatResponse({
        ok: false,
        buildId: 'mvp-v19',
        brandId: 'unknown',
        time: '2025-01-01T00:00:00.000Z',
        message: 'Brand not found'
      })).toBe(true);
    });

    it('returns false for envelope response', () => {
      expect(isFlatResponse({ ok: true, value: { foo: 'bar' } })).toBe(false);
    });

    it('returns false for envelope error', () => {
      expect(isFlatResponse({ ok: false, code: 'NOT_FOUND', message: 'Not found' })).toBe(false);
    });
  });

  describe('assertIsEnvelope()', () => {
    it('passes for valid success envelope', () => {
      expect(() => assertIsEnvelope({ ok: true, value: { data: 'test' } })).not.toThrow();
    });

    it('passes for valid error envelope', () => {
      expect(() => assertIsEnvelope({ ok: false, code: 'BAD_INPUT', message: 'Invalid' })).not.toThrow();
    });

    it('passes for notModified envelope without value', () => {
      expect(() => assertIsEnvelope({ ok: true, notModified: true, etag: 'abc123' })).not.toThrow();
    });

    it('fails for flat response', () => {
      expect(() => assertIsEnvelope({
        ok: true,
        buildId: 'v1',
        brandId: 'root',
        time: '2025-01-01'
      })).toThrow();
    });

    it('fails when value is missing on success', () => {
      expect(() => assertIsEnvelope({ ok: true })).toThrow();
    });
  });

  describe('assertNotEnvelope()', () => {
    it('passes for valid flat response', () => {
      expect(() => assertNotEnvelope({
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-01-01T00:00:00.000Z'
      })).not.toThrow();
    });

    it('fails for envelope response with value', () => {
      expect(() => assertNotEnvelope({ ok: true, value: { foo: 'bar' } })).toThrow();
    });
  });

  describe('validateFlatStatusResponse()', () => {
    it('validates correct flat status response', () => {
      expect(() => validateFlatStatusResponse({
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-01-01T00:00:00.000Z',
        db: { ok: true }
      })).not.toThrow();
    });

    it('fails when value wrapper is present', () => {
      expect(() => validateFlatStatusResponse({
        ok: true,
        value: {
          buildId: 'mvp-v19',
          brandId: 'root',
          time: '2025-01-01T00:00:00.000Z'
        }
      })).toThrow();
    });

    it('fails when required fields are missing', () => {
      expect(() => validateFlatStatusResponse({
        ok: true,
        buildId: 'mvp-v19'
        // missing brandId and time
      })).toThrow();
    });
  });

  describe('validateFlatMvpStatusResponse()', () => {
    it('validates correct MVP status response', () => {
      expect(() => validateFlatMvpStatusResponse({
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-01-01T00:00:00.000Z',
        analyticsSheetHealthy: true,
        sharedAnalyticsContractOk: true
      })).not.toThrow();
    });

    it('fails when analytics fields are missing', () => {
      expect(() => validateFlatMvpStatusResponse({
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-01-01T00:00:00.000Z'
        // missing analyticsSheetHealthy and sharedAnalyticsContractOk
      })).toThrow();
    });
  });

  describe('FLAT_ENDPOINTS constant', () => {
    it('contains expected flat endpoints', () => {
      expect(FLAT_ENDPOINTS).toContain('status');
      expect(FLAT_ENDPOINTS).toContain('statusmvp');
    });

    it('does not contain envelope endpoints', () => {
      expect(FLAT_ENDPOINTS).not.toContain('setup');
      expect(FLAT_ENDPOINTS).not.toContain('permissions');
      expect(FLAT_ENDPOINTS).not.toContain('statusFull');
    });
  });
});

// ============================================================================
// CONTRACT TESTS - Mock response validation (CI-safe, no network)
// ============================================================================

describe('Envelope Boundary Contract Validation (Mock)', () => {
  describe('Rule 1: Flat endpoints never emit envelope structure', () => {
    it('api_statusPure mock response should be flat', () => {
      const mockStatusPure = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: true }
      };

      // Should pass flat validation
      validateFlatStatusResponse(mockStatusPure);
      assertNotEnvelope(mockStatusPure);

      // Should NOT pass envelope validation
      expect(isEnvelope(mockStatusPure)).toBe(false);
    });

    it('api_statusMvp mock response should be flat', () => {
      const mockStatusMvp = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        analyticsSheetHealthy: true,
        sharedAnalyticsContractOk: true
      };

      // Should pass flat validation
      validateFlatMvpStatusResponse(mockStatusMvp);
      assertNotEnvelope(mockStatusMvp);

      // Should NOT pass envelope validation
      expect(isEnvelope(mockStatusMvp)).toBe(false);
    });

    it('VIOLATION: flat endpoint with value wrapper should fail', () => {
      const badStatusResponse = {
        ok: true,
        value: {
          buildId: 'mvp-v19',
          brandId: 'root',
          time: new Date().toISOString()
        }
      };

      // This IS an envelope (contract violation for flat endpoint)
      expect(isEnvelope(badStatusResponse)).toBe(true);

      // Should fail flat validation
      expect(() => assertNotEnvelope(badStatusResponse)).toThrow();
      expect(() => validateFlatStatusResponse(badStatusResponse)).toThrow();
    });
  });

  describe('Rule 2: Envelope endpoints always wrap in value', () => {
    it('api_status (envelope) mock response should have value wrapper', () => {
      const mockStatusEnvelope = {
        ok: true,
        value: {
          build: 'mvp-v19',
          contract: '1.0.3',
          brand: 'root',
          time: new Date().toISOString(),
          db: { ok: true, id: 'spreadsheet123' }
        }
      };

      // Should pass envelope validation
      validateEnvelope(mockStatusEnvelope);
      assertIsEnvelope(mockStatusEnvelope);

      // Should NOT pass flat validation
      expect(isFlatResponse(mockStatusEnvelope)).toBe(false);
    });

    it('VIOLATION: envelope endpoint without value wrapper should fail', () => {
      const badEnvelopeResponse = {
        ok: true,
        build: 'mvp-v19',
        contract: '1.0.3',
        brand: 'root',
        time: new Date().toISOString()
      };

      // This is NOT an envelope (contract violation)
      expect(isEnvelope(badEnvelopeResponse)).toBe(false);

      // Should fail envelope validation
      expect(() => assertIsEnvelope(badEnvelopeResponse)).toThrow();
    });
  });

  describe('Rule 3: Error responses follow their format pattern', () => {
    it('flat error has message but no code', () => {
      const flatError = {
        ok: false,
        buildId: 'mvp-v19',
        brandId: 'unknown',
        time: new Date().toISOString(),
        db: { ok: false },
        message: 'Brand not found: invalid'
      };

      // Flat errors have message at root but no 'code' field
      expect(flatError).toHaveProperty('message');
      expect(flatError).toHaveProperty('buildId');
      expect(flatError).not.toHaveProperty('value');
    });

    it('envelope error has code and message', () => {
      const envelopeError = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Brand not found: invalid',
        corrId: 'abc123'
      };

      // Envelope errors have code and message
      validateEnvelope(envelopeError);
      expect(envelopeError).toHaveProperty('code');
      expect(envelopeError).toHaveProperty('message');
      expect(envelopeError).not.toHaveProperty('buildId');
    });
  });

  describe('Rule 4: notModified omits value', () => {
    it('notModified response should not have value', () => {
      const notModifiedResponse = {
        ok: true,
        notModified: true,
        etag: 'abc123def456'
      };

      // Should pass envelope validation (notModified is a special case)
      validateEnvelope(notModifiedResponse);
      assertIsEnvelope(notModifiedResponse);

      // Should not have value field
      expect(notModifiedResponse).not.toHaveProperty('value');
    });
  });
});

// ============================================================================
// NETWORK TESTS - Live endpoint validation (skipped in CI)
// ============================================================================

describeNetwork('Envelope Boundary Contract (Network Tests)', () => {
  beforeAll(() => {
    console.log('\n==============================================');
    console.log('Envelope Boundary Contract - Network Tests');
    console.log('==============================================');
    console.log(`BASE_URL: ${BASE_URL}`);
    console.log(`URL Pattern: ${isGoogleAppsScript() ? 'GAS Query Params' : 'Friendly URLs'}`);
    console.log('==============================================\n');
  });

  describe('Flat Endpoints (MUST NOT return envelope)', () => {
    it('?p=status returns flat response (no value wrapper)', async () => {
      const response = await fetchEndpoint('status');

      // Validate it's flat format
      assertNotEnvelope(response);
      validateFlatStatusResponse(response);

      // Explicitly verify no envelope structure
      expect(response).not.toHaveProperty('value');
      expect(response).toHaveProperty('buildId');
      expect(response).toHaveProperty('brandId');
      expect(response).toHaveProperty('time');
    }, TIMEOUT_MS);

    it('?p=statusmvp returns flat response (no value wrapper)', async () => {
      const response = await fetchEndpoint('statusmvp');

      // Validate it's flat format
      assertNotEnvelope(response);
      validateFlatMvpStatusResponse(response);

      // Explicitly verify no envelope structure
      expect(response).not.toHaveProperty('value');
      expect(response).toHaveProperty('analyticsSheetHealthy');
      expect(response).toHaveProperty('sharedAnalyticsContractOk');
    }, TIMEOUT_MS);

    it.each(['root', 'abc', 'cbc', 'cbl'])('?p=status for brand %s returns flat', async (brand) => {
      try {
        const response = await fetchEndpoint('status', brand);
        assertNotEnvelope(response);
        expect(response.brandId).toBe(brand);
      } catch (error) {
        // Brand may not be configured - that's ok, just verify error format is flat
        if (error.message && error.message.includes('HTTP')) {
          // HTTP error, skip
          return;
        }
        throw error;
      }
    }, TIMEOUT_MS);
  });

  describe('Envelope Endpoints (MUST return envelope)', () => {
    it('?p=statusFull returns envelope response', async () => {
      try {
        const response = await fetchEndpoint('statusFull');

        // Validate it's envelope format
        assertIsEnvelope(response);
        validateEnvelope(response);

        if (response.ok) {
          expect(response.value).toHaveProperty('build');
          expect(response.value).toHaveProperty('brand');
          expect(response.value).toHaveProperty('time');
        }
      } catch (error) {
        // statusFull might not be exposed via friendly URL
        if (error.message.includes('HTTP')) {
          console.log('statusFull not available via friendly URL, skipping');
          return;
        }
        throw error;
      }
    }, TIMEOUT_MS);

    it('?p=setup returns envelope response', async () => {
      const response = await fetchEndpoint('setup');

      // Validate it's envelope format
      assertIsEnvelope(response);
      validateEnvelope(response);

      if (response.ok) {
        expect(response.value).toHaveProperty('checks');
      }
    }, TIMEOUT_MS);

    it('?p=permissions returns envelope response', async () => {
      const response = await fetchEndpoint('permissions');

      // Validate it's envelope format
      assertIsEnvelope(response);
      validateEnvelope(response);

      if (response.ok) {
        expect(response.value).toHaveProperty('details');
      }
    }, TIMEOUT_MS);
  });

  describe('Contract Violation Detection', () => {
    it('detects if flat endpoint accidentally returns envelope', async () => {
      const response = await fetchEndpoint('status');

      // This should NOT be an envelope
      const hasEnvelopeStructure = isEnvelope(response);
      expect(hasEnvelopeStructure).toBe(false);

      if (hasEnvelopeStructure) {
        throw new Error(
          'CONTRACT VIOLATION: status endpoint returned envelope format!\n' +
          'Expected flat: { ok, buildId, brandId, time, ... }\n' +
          'Got envelope: { ok, value: {...} }\n' +
          'See API_CONTRACT.md for correct format.'
        );
      }
    }, TIMEOUT_MS);

    it('detects if envelope endpoint accidentally returns flat', async () => {
      const response = await fetchEndpoint('setup');

      // This SHOULD be an envelope
      const hasEnvelopeStructure = isEnvelope(response);
      expect(hasEnvelopeStructure).toBe(true);

      if (!hasEnvelopeStructure) {
        throw new Error(
          'CONTRACT VIOLATION: setup endpoint returned flat format!\n' +
          'Expected envelope: { ok, value: {...} } or { ok, code, message }\n' +
          'Got flat data without value wrapper.\n' +
          'See API_CONTRACT.md for correct format.'
        );
      }
    }, TIMEOUT_MS);
  });
});
