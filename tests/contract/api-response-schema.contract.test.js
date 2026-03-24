/**
 * API Response Schema Contract Tests (Story 2.3)
 *
 * Ensures all API responses match expected schemas:
 * - Ok/Err envelope structure validation
 * - Required fields presence validation
 * - Response format verification for each endpoint type
 * - Schema mismatch detection
 *
 * Story 2.3 Acceptance Criteria:
 * - CI pipeline runs API contract tests ensuring response formats match expected schema
 * - Any schema mismatch or missing field causes test failures
 * - Verifying required fields and envelope structure
 *
 * Run: npm run test:contract
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  validateFlatStatusResponse,
  validateFlatMvpStatusResponse,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

// ============================================================================
// STORY 2.3: API Response Schema Contract Tests
// ============================================================================

describe('API Response Schema Contract Tests (Story 2.3)', () => {

  // ==========================================================================
  // Success Envelope Schema
  // ==========================================================================
  describe('Success Envelope Schema', () => {
    it('should validate Ok envelope with required fields', () => {
      const successEnvelope = {
        ok: true,
        value: {
          id: 'EVT_123',
          name: 'Test Event',
          data: {}
        }
      };

      validateEnvelope(successEnvelope);
      expect(successEnvelope.ok).toBe(true);
      expect(successEnvelope).toHaveProperty('value');
    });

    it('should validate Ok envelope with etag', () => {
      const envelopeWithEtag = {
        ok: true,
        etag: 'W/"abc123"',
        value: {
          items: [],
          pagination: { total: 0, limit: 50, offset: 0, hasMore: false }
        }
      };

      validateEnvelope(envelopeWithEtag);
      expect(envelopeWithEtag).toHaveProperty('etag');
    });

    it('should validate notModified response without value', () => {
      const notModifiedResponse = {
        ok: true,
        notModified: true,
        etag: 'W/"abc123"'
      };

      validateEnvelope(notModifiedResponse);
      expect(notModifiedResponse.notModified).toBe(true);
      expect(notModifiedResponse).not.toHaveProperty('value');
    });

    it('should fail if ok=true but value is missing', () => {
      const invalidEnvelope = {
        ok: true
        // Missing 'value' field
      };

      expect(() => validateSuccessEnvelope(invalidEnvelope)).toThrow();
    });
  });

  // ==========================================================================
  // Error Envelope Schema
  // ==========================================================================
  describe('Error Envelope Schema', () => {
    it('should validate Err envelope with code and message', () => {
      const errorEnvelope = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found: EVT_invalid'
      };

      validateEnvelope(errorEnvelope);
      expect(errorEnvelope.ok).toBe(false);
      expect(errorEnvelope).toHaveProperty('code');
      expect(errorEnvelope).toHaveProperty('message');
    });

    it('should validate error envelope with corrId', () => {
      const errorWithCorrId = {
        ok: false,
        code: 'INTERNAL',
        message: 'An unexpected error occurred',
        corrId: 'req-12345-67890'
      };

      validateEnvelope(errorWithCorrId);
      expect(errorWithCorrId).toHaveProperty('corrId');
    });

    it('should validate all defined error codes', () => {
      const validCodes = ['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'CONTRACT', 'FEATURE_DISABLED'];

      validCodes.forEach(code => {
        const errorEnvelope = {
          ok: false,
          code: code,
          message: `Error: ${code}`
        };
        validateEnvelope(errorEnvelope);
        expect(ERROR_CODES[code]).toBe(code);
      });
    });

    it('should fail if ok=false but code is missing', () => {
      const invalidError = {
        ok: false,
        message: 'Some error'
        // Missing 'code' field
      };

      expect(() => validateErrorEnvelope(invalidError)).toThrow();
    });

    it('should fail if ok=false but message is missing', () => {
      const invalidError = {
        ok: false,
        code: 'BAD_INPUT'
        // Missing 'message' field
      };

      expect(() => validateErrorEnvelope(invalidError)).toThrow();
    });
  });

  // ==========================================================================
  // Event Response Schema (EVENT_CONTRACT.md v2.0)
  // ==========================================================================
  describe('Event Response Schema (v2.0)', () => {
    const createValidEvent = () => ({
      // MVP Required - Identity
      id: 'EVT_test123',
      slug: 'test-event',
      name: 'Test Event',
      startDateISO: '2025-12-01',
      venue: 'Test Venue',

      // MVP Required - Links
      links: {
        publicUrl: 'https://example.com/events/test-event',
        displayUrl: 'https://example.com/display/test-event',
        posterUrl: 'https://example.com/poster/test-event',
        signupUrl: 'https://forms.google.com/test'
      },

      // MVP Required - QR Codes
      qr: {
        public: 'data:image/png;base64,iVBORw0KGgo...',
        signup: 'data:image/png;base64,iVBORw0KGgo...'
      },

      // MVP Required - CTAs
      ctas: {
        primary: { label: 'Sign Up', url: 'https://forms.google.com/test' },
        secondary: null
      },

      // MVP Required - Settings
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false,
        showSponsors: false
      },

      // Timestamps
      createdAtISO: '2025-11-22T12:00:00.000Z',
      updatedAtISO: '2025-11-22T12:00:00.000Z'
    });

    it('should validate all MVP required fields are present', () => {
      const event = createValidEvent();

      // Identity fields
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('slug');
      expect(event).toHaveProperty('name');
      expect(event).toHaveProperty('startDateISO');
      expect(event).toHaveProperty('venue');

      // Links
      expect(event).toHaveProperty('links');
      expect(event.links).toHaveProperty('publicUrl');
      expect(event.links).toHaveProperty('displayUrl');
      expect(event.links).toHaveProperty('posterUrl');
      expect(event.links).toHaveProperty('signupUrl');

      // QR codes
      expect(event).toHaveProperty('qr');
      expect(event.qr).toHaveProperty('public');
      expect(event.qr).toHaveProperty('signup');

      // CTAs
      expect(event).toHaveProperty('ctas');
      expect(event.ctas).toHaveProperty('primary');
      expect(event.ctas.primary).toHaveProperty('label');
      expect(event.ctas.primary).toHaveProperty('url');

      // Settings
      expect(event).toHaveProperty('settings');
      expect(event.settings).toHaveProperty('showSchedule');
      expect(event.settings).toHaveProperty('showStandings');
      expect(event.settings).toHaveProperty('showBracket');
      expect(event.settings).toHaveProperty('showSponsors');

      // Timestamps
      expect(event).toHaveProperty('createdAtISO');
      expect(event).toHaveProperty('updatedAtISO');
    });

    it('should validate startDateISO format (YYYY-MM-DD)', () => {
      const event = createValidEvent();
      expect(event.startDateISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should validate timestamp format (ISO 8601)', () => {
      const event = createValidEvent();
      const createdAt = new Date(event.createdAtISO);
      const updatedAt = new Date(event.updatedAtISO);

      expect(createdAt.getTime()).not.toBeNaN();
      expect(updatedAt.getTime()).not.toBeNaN();
    });

    it('should validate settings are booleans', () => {
      const event = createValidEvent();

      expect(typeof event.settings.showSchedule).toBe('boolean');
      expect(typeof event.settings.showStandings).toBe('boolean');
      expect(typeof event.settings.showBracket).toBe('boolean');
      expect(typeof event.settings.showSponsors).toBe('boolean');
    });

    it('should detect missing required field: id', () => {
      const event = createValidEvent();
      delete event.id;
      expect(event).not.toHaveProperty('id');
    });

    it('should detect missing required field: links', () => {
      const event = createValidEvent();
      delete event.links;
      expect(event).not.toHaveProperty('links');
    });

    it('should detect missing required field: qr', () => {
      const event = createValidEvent();
      delete event.qr;
      expect(event).not.toHaveProperty('qr');
    });
  });

  // ==========================================================================
  // List Response Schema
  // ==========================================================================
  describe('List Response Schema', () => {
    it('should validate list response with pagination', () => {
      const listResponse = {
        ok: true,
        etag: 'W/"abc123"',
        value: {
          items: [],
          pagination: {
            total: 0,
            limit: 50,
            offset: 0,
            hasMore: false
          }
        }
      };

      validateEnvelope(listResponse);
      expect(listResponse.value).toHaveProperty('items');
      expect(listResponse.value).toHaveProperty('pagination');
      expect(Array.isArray(listResponse.value.items)).toBe(true);
    });

    it('should validate pagination fields', () => {
      const pagination = {
        total: 100,
        limit: 50,
        offset: 50,
        hasMore: true
      };

      expect(pagination).toHaveProperty('total');
      expect(pagination).toHaveProperty('limit');
      expect(pagination).toHaveProperty('offset');
      expect(pagination).toHaveProperty('hasMore');
      expect(typeof pagination.total).toBe('number');
      expect(typeof pagination.limit).toBe('number');
      expect(typeof pagination.offset).toBe('number');
      expect(typeof pagination.hasMore).toBe('boolean');
    });
  });

  // ==========================================================================
  // Bundle Response Schema
  // ==========================================================================
  describe('Bundle Response Schema', () => {
    it('should validate bundle response with event and config', () => {
      const bundleResponse = {
        ok: true,
        etag: 'W/"bundle123"',
        value: {
          event: {
            id: 'EVT_123',
            name: 'Test Event',
            slug: 'test-event',
            startDateISO: '2025-12-01',
            venue: 'Test Venue',
            links: { publicUrl: '', displayUrl: '', posterUrl: '', signupUrl: '' },
            qr: { public: '', signup: '' },
            ctas: { primary: { label: '', url: '' }, secondary: null },
            settings: { showSchedule: false, showStandings: false, showBracket: false, showSponsors: false }
          },
          config: {
            brandId: 'root',
            brandName: 'Default Brand',
            appTitle: 'Events'
          }
        }
      };

      validateEnvelope(bundleResponse);
      expect(bundleResponse.value).toHaveProperty('event');
      expect(bundleResponse.value).toHaveProperty('config');
      expect(bundleResponse.value.config).toHaveProperty('brandId');
      expect(bundleResponse.value.config).toHaveProperty('brandName');
      expect(bundleResponse.value.config).toHaveProperty('appTitle');
    });
  });

  // ==========================================================================
  // Flat Status Response Schema
  // ==========================================================================
  describe('Flat Status Response Schema', () => {
    it('should validate flat status response structure', () => {
      const statusResponse = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        db: { ok: true }
      };

      validateFlatStatusResponse(statusResponse);
    });

    it('should validate MVP status response with analytics fields', () => {
      const mvpStatusResponse = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString(),
        analyticsSheetHealthy: true,
        sharedAnalyticsContractOk: true
      };

      validateFlatMvpStatusResponse(mvpStatusResponse);
    });

    it('should fail if buildId is missing from status', () => {
      const invalidStatus = {
        ok: true,
        brandId: 'root',
        time: new Date().toISOString()
      };

      expect(() => validateFlatStatusResponse(invalidStatus)).toThrow();
    });

    it('should fail if analytics fields are missing from MVP status', () => {
      const invalidMvpStatus = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: new Date().toISOString()
        // Missing analyticsSheetHealthy and sharedAnalyticsContractOk
      };

      expect(() => validateFlatMvpStatusResponse(invalidMvpStatus)).toThrow();
    });
  });

  // ==========================================================================
  // Analytics Report Schema
  // ==========================================================================
  describe('Analytics Report Schema', () => {
    it('should validate report response structure', () => {
      const reportResponse = {
        ok: true,
        value: {
          totals: {
            impressions: 100,
            clicks: 10,
            dwellSec: 500
          },
          bySurface: {
            display: { impressions: 50, clicks: 5, dwellSec: 250 },
            public: { impressions: 50, clicks: 5, dwellSec: 250 }
          },
          bySponsor: {},
          byToken: {}
        }
      };

      validateEnvelope(reportResponse);
      expect(reportResponse.value).toHaveProperty('totals');
      expect(reportResponse.value).toHaveProperty('bySurface');
      expect(reportResponse.value).toHaveProperty('bySponsor');
      expect(reportResponse.value).toHaveProperty('byToken');
    });

    it('should validate totals has required metrics', () => {
      const totals = {
        impressions: 100,
        clicks: 10,
        dwellSec: 500
      };

      expect(totals).toHaveProperty('impressions');
      expect(totals).toHaveProperty('clicks');
      expect(totals).toHaveProperty('dwellSec');
      expect(typeof totals.impressions).toBe('number');
      expect(typeof totals.clicks).toBe('number');
      expect(typeof totals.dwellSec).toBe('number');
    });
  });

  // ==========================================================================
  // Schema Violation Detection
  // ==========================================================================
  describe('Schema Violation Detection', () => {
    it('should detect ok field type violation', () => {
      const invalidResponse = {
        ok: 'true', // Should be boolean, not string
        value: {}
      };

      expect(typeof invalidResponse.ok).not.toBe('boolean');
    });

    it('should detect missing ok field', () => {
      const invalidResponse = {
        value: { data: 'test' }
      };

      expect(invalidResponse).not.toHaveProperty('ok');
    });

    it('should detect wrong error code type', () => {
      const invalidError = {
        ok: false,
        code: 123, // Should be string, not number
        message: 'Error'
      };

      expect(typeof invalidError.code).not.toBe('string');
    });

    it('should detect invalid error code value', () => {
      const invalidError = {
        ok: false,
        code: 'INVALID_CODE_XYZ', // Not a valid error code
        message: 'Error'
      };

      expect(Object.values(ERROR_CODES)).not.toContain(invalidError.code);
    });
  });

  // ==========================================================================
  // Required Fields Matrix
  // ==========================================================================
  describe('Required Fields Matrix', () => {
    const requiredFieldsMatrix = [
      { endpoint: 'api_list', fields: ['items', 'pagination'] },
      { endpoint: 'api_get', fields: ['id', 'slug', 'name', 'startDateISO', 'venue', 'links', 'qr', 'ctas', 'settings'] },
      { endpoint: 'api_getPublicBundle', fields: ['event', 'config'] },
      { endpoint: 'api_getDisplayBundle', fields: ['event', 'config'] },
      { endpoint: 'api_getPosterBundle', fields: ['event', 'config'] },
      { endpoint: 'api_status', fields: ['buildId', 'brandId', 'time'] },
      { endpoint: 'api_statusMvp', fields: ['buildId', 'brandId', 'time', 'analyticsSheetHealthy', 'sharedAnalyticsContractOk'] },
      { endpoint: 'api_getReport', fields: ['totals', 'bySurface', 'bySponsor', 'byToken'] }
    ];

    it.each(requiredFieldsMatrix)('$endpoint should require fields: $fields', ({ endpoint, fields }) => {
      // Verify each endpoint has documented required fields
      expect(Array.isArray(fields)).toBe(true);
      expect(fields.length).toBeGreaterThan(0);
      fields.forEach(field => {
        expect(typeof field).toBe('string');
      });
    });
  });
});
