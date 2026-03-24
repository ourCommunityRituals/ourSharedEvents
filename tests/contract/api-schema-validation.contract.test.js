/**
 * API Schema Validation Contract Tests (Story 3.1)
 *
 * Validates all API responses against JSON schemas using AJV.
 * Ensures schema compliance and detects mismatches early in CI.
 *
 * Story 3.1 Acceptance Criteria:
 * - JSON schemas defined for all API responses
 * - Automated tests validate responses against schemas
 * - Test failures triggered on schema mismatch
 * - Schema files version-controlled
 *
 * Run: npm run test:schema-validation
 */

const {
  validateAgainstSchema,
  validateResponse,
  validateEndpointResponse,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  validateFlatStatus,
  validateEvent,
  validateSponsor,
  validateSharedAnalytics,
  getAvailableSchemas,
  schemaExists,
  validateAllSchemas,
  loadSchema,
  getValidator,
  clearSchemaCache,
  extendJestWithSchemaMatchers,
  SCHEMA_REGISTRY,
  ENDPOINT_SCHEMAS
} = require('../shared/helpers/schema-validator');

// Extend Jest with schema matchers
extendJestWithSchemaMatchers();

// ============================================================================
// STORY 3.1: API SCHEMA VALIDATION CONTRACT TESTS
// ============================================================================

describe('API Schema Validation (Story 3.1)', () => {
  // Clean up between tests
  afterEach(() => {
    clearSchemaCache();
  });

  // ==========================================================================
  // Schema Loading & Compilation
  // ==========================================================================
  describe('Schema Loading & Compilation', () => {
    it('should load all registered schemas successfully', () => {
      const result = validateAllSchemas();

      expect(result.success).toBe(true);
      expect(result.loaded.length).toBeGreaterThan(0);
      expect(result.failed).toEqual([]);
    });

    it('should have all required API response schemas', () => {
      const requiredSchemas = [
        'api-envelope',
        'list-response',
        'bundle-response',
        'get-response',
        'save-response',
        'delete-response',
        'analytics-response',
        'event',
        'sponsor',
        'shared-analytics',
        'status',
        'status-mvp'
      ];

      for (const schemaId of requiredSchemas) {
        expect(schemaExists(schemaId)).toBe(true);
      }
    });

    it('should compile schemas without errors', () => {
      const schemas = getAvailableSchemas();

      for (const schemaId of schemas) {
        expect(() => getValidator(schemaId)).not.toThrow();
      }
    });

    it('should throw for unknown schema IDs', () => {
      expect(() => validateAgainstSchema({}, 'nonexistent-schema'))
        .toThrow(/Unknown schema ID/);
    });

    it('should cache compiled validators', () => {
      const validator1 = getValidator('api-envelope');
      const validator2 = getValidator('api-envelope');

      expect(validator1).toBe(validator2);
    });
  });

  // ==========================================================================
  // API Envelope Schema Validation
  // ==========================================================================
  describe('API Envelope Schema', () => {
    describe('Success Envelope', () => {
      it('should validate success envelope with value', () => {
        const response = {
          ok: true,
          value: { id: 'test-123', name: 'Test' }
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(true);
      });

      it('should validate success envelope with etag', () => {
        const response = {
          ok: true,
          value: { items: [] },
          etag: 'W/"abc123"'
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(true);
      });

      it('should validate notModified response', () => {
        const response = {
          ok: true,
          notModified: true,
          etag: 'W/"abc123"'
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(true);
      });

      it('should fail if value is missing (non-notModified)', () => {
        const response = {
          ok: true
          // Missing value
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(false);
      });
    });

    describe('Error Envelope', () => {
      it('should validate error envelope with required fields', () => {
        const response = {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Resource not found'
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(true);
      });

      it('should validate error envelope with corrId', () => {
        const response = {
          ok: false,
          code: 'INTERNAL',
          message: 'Server error',
          corrId: 'req-12345'
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(true);
      });

      it('should validate all error codes', () => {
        const errorCodes = ['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'CONTRACT', 'FEATURE_DISABLED', 'UNAUTHORIZED'];

        for (const code of errorCodes) {
          const response = {
            ok: false,
            code,
            message: `Error: ${code}`
          };

          const result = validateAgainstSchema(response, 'api-envelope');
          expect(result.valid).toBe(true);
        }
      });

      it('should fail if code is missing', () => {
        const response = {
          ok: false,
          message: 'Error'
          // Missing code
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(false);
      });

      it('should fail if message is missing', () => {
        const response = {
          ok: false,
          code: 'BAD_INPUT'
          // Missing message
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(false);
      });

      it('should fail for invalid error code', () => {
        const response = {
          ok: false,
          code: 'INVALID_CODE',
          message: 'Error'
        };

        const result = validateAgainstSchema(response, 'api-envelope');
        expect(result.valid).toBe(false);
      });
    });
  });

  // ==========================================================================
  // List Response Schema Validation
  // ==========================================================================
  describe('List Response Schema', () => {
    it('should validate list response with items and pagination', () => {
      const response = {
        ok: true,
        value: {
          items: [
            { id: 'EVT_001', name: 'Event 1' },
            { id: 'EVT_002', name: 'Event 2' }
          ],
          pagination: {
            total: 50,
            limit: 20,
            offset: 0,
            hasMore: true
          }
        },
        etag: 'W/"list-123"'
      };

      const result = validateAgainstSchema(response, 'list-response');
      expect(result.valid).toBe(true);
    });

    it('should validate empty list response', () => {
      const response = {
        ok: true,
        value: {
          items: [],
          pagination: {
            total: 0,
            limit: 20,
            offset: 0,
            hasMore: false
          }
        }
      };

      const result = validateAgainstSchema(response, 'list-response');
      expect(result.valid).toBe(true);
    });

    it('should fail if pagination is missing', () => {
      const response = {
        ok: true,
        value: {
          items: []
          // Missing pagination
        }
      };

      const result = validateAgainstSchema(response, 'list-response');
      expect(result.valid).toBe(false);
    });

    it('should fail if items is missing', () => {
      const response = {
        ok: true,
        value: {
          pagination: { total: 0, limit: 20, offset: 0, hasMore: false }
          // Missing items
        }
      };

      const result = validateAgainstSchema(response, 'list-response');
      expect(result.valid).toBe(false);
    });

    it('should validate pagination fields types', () => {
      const response = {
        ok: true,
        value: {
          items: [],
          pagination: {
            total: 'invalid',  // Should be number
            limit: 20,
            offset: 0,
            hasMore: false
          }
        }
      };

      const result = validateAgainstSchema(response, 'list-response');
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Bundle Response Schema Validation
  // ==========================================================================
  describe('Bundle Response Schema', () => {
    const createValidBundle = () => ({
      ok: true,
      value: {
        event: {
          id: 'EVT_123',
          slug: 'test-event',
          name: 'Test Event'
        },
        config: {
          brandId: 'root',
          brandName: 'Event Toolkit',
          appTitle: 'Events'
        }
      },
      etag: 'W/"bundle-123"'
    });

    it('should validate bundle response with event and config', () => {
      const response = createValidBundle();

      const result = validateAgainstSchema(response, 'bundle-response');
      expect(result.valid).toBe(true);
    });

    it('should fail if event is missing', () => {
      const response = {
        ok: true,
        value: {
          config: { brandId: 'root', brandName: 'Test', appTitle: 'Events' }
          // Missing event
        }
      };

      const result = validateAgainstSchema(response, 'bundle-response');
      expect(result.valid).toBe(false);
    });

    it('should fail if config is missing', () => {
      const response = {
        ok: true,
        value: {
          event: { id: 'EVT_123', slug: 'test', name: 'Test' }
          // Missing config
        }
      };

      const result = validateAgainstSchema(response, 'bundle-response');
      expect(result.valid).toBe(false);
    });

    it('should fail if config.brandId is missing', () => {
      const response = {
        ok: true,
        value: {
          event: { id: 'EVT_123', slug: 'test', name: 'Test' },
          config: {
            brandName: 'Test',
            appTitle: 'Events'
            // Missing brandId
          }
        }
      };

      const result = validateAgainstSchema(response, 'bundle-response');
      expect(result.valid).toBe(false);
    });

    it('should validate notModified bundle response', () => {
      const response = {
        ok: true,
        notModified: true,
        etag: 'W/"bundle-123"'
      };

      const result = validateAgainstSchema(response, 'bundle-response');
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // Event Entity Schema Validation
  // ==========================================================================
  describe('Event Entity Schema', () => {
    const createValidEvent = () => ({
      id: 'EVT_test123',
      slug: 'test-event',
      name: 'Test Event',
      startDateISO: '2025-12-01',
      venue: 'Test Venue',
      links: {
        publicUrl: 'https://example.com/events/test',
        displayUrl: 'https://example.com/display/test',
        posterUrl: 'https://example.com/poster/test',
        signupUrl: 'https://forms.google.com/test'
      },
      qr: {
        public: 'data:image/png;base64,iVBORw0KGgo...',
        signup: 'data:image/png;base64,iVBORw0KGgo...'
      },
      ctas: {
        primary: { label: 'Sign Up', url: 'https://forms.google.com/test' },
        secondary: null
      },
      settings: {
        showSchedule: false,
        showStandings: false,
        showBracket: false
      },
      createdAtISO: '2025-11-22T12:00:00.000Z',
      updatedAtISO: '2025-11-22T12:00:00.000Z'
    });

    it('should validate complete event with all required fields', () => {
      const event = createValidEvent();

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    it('should fail if id is missing', () => {
      const event = createValidEvent();
      delete event.id;

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should fail if slug is missing', () => {
      const event = createValidEvent();
      delete event.slug;

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should fail if links is missing', () => {
      const event = createValidEvent();
      delete event.links;

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should fail if qr is missing', () => {
      const event = createValidEvent();
      delete event.qr;

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should fail for invalid startDateISO format', () => {
      const event = createValidEvent();
      event.startDateISO = '12/01/2025';  // Wrong format

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should fail for invalid slug pattern', () => {
      const event = createValidEvent();
      event.slug = 'Invalid Slug!';  // Should be lowercase-hyphenated

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should validate event with optional schedule', () => {
      const event = createValidEvent();
      event.schedule = [
        { time: '10:00 AM', title: 'Opening' },
        { time: '11:00 AM', title: 'Main Event', description: 'Description' }
      ];

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });

    it('should validate event with optional standings', () => {
      const event = createValidEvent();
      event.standings = [
        { rank: 1, team: 'Team A', wins: 5, losses: 0 },
        { rank: 2, team: 'Team B', wins: 4, losses: 1, points: 12 }
      ];

      const result = validateEvent(event);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // Sponsor Entity Schema Validation
  // ==========================================================================
  describe('Sponsor Entity Schema', () => {
    it('should validate sponsor with single placement', () => {
      const sponsor = {
        id: 'SPO_123',
        name: 'Test Sponsor',
        logoUrl: 'https://example.com/logo.png',
        placement: 'poster'
      };

      const result = validateSponsor(sponsor);
      expect(result.valid).toBe(true);
    });

    it('should validate sponsor with placements object', () => {
      const sponsor = {
        id: 'SPO_123',
        name: 'Test Sponsor',
        logoUrl: 'https://example.com/logo.png',
        placements: {
          posterTop: true,
          tvTop: true,
          tvSide: false,
          mobileBanner: true
        }
      };

      const result = validateSponsor(sponsor);
      expect(result.valid).toBe(true);
    });

    it('should validate sponsor with tracking tokens', () => {
      const sponsor = {
        id: 'SPO_123',
        name: 'Test Sponsor',
        logoUrl: 'https://example.com/logo.png',
        placement: 'display',
        clickToken: 'click-token-123',
        impressionToken: 'impression-token-456'
      };

      const result = validateSponsor(sponsor);
      expect(result.valid).toBe(true);
    });

    it('should validate sponsor with tier', () => {
      const sponsor = {
        id: 'SPO_123',
        name: 'Premium Sponsor',
        logoUrl: 'https://example.com/logo.png',
        placement: 'poster',
        tier: 'gold'
      };

      const result = validateSponsor(sponsor);
      expect(result.valid).toBe(true);
    });

    it('should fail if logoUrl is missing', () => {
      const sponsor = {
        id: 'SPO_123',
        name: 'Test Sponsor',
        placement: 'poster'
        // Missing logoUrl
      };

      const result = validateSponsor(sponsor);
      expect(result.valid).toBe(false);
    });

    it('should fail if both placement and placements are missing', () => {
      const sponsor = {
        id: 'SPO_123',
        name: 'Test Sponsor',
        logoUrl: 'https://example.com/logo.png'
        // Missing placement/placements
      };

      const result = validateSponsor(sponsor);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Flat Status Schema Validation
  // ==========================================================================
  describe('Flat Status Schema', () => {
    it('should validate flat status response', () => {
      const response = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-12-11T10:00:00.000Z',
        db: { ok: true }
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(true);
    });

    it('should validate flat status without db field', () => {
      const response = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root',
        time: '2025-12-11T10:00:00.000Z'
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(true);
    });

    it('should validate flat status with error message', () => {
      const response = {
        ok: false,
        buildId: 'mvp-v19',
        brandId: 'unknown',
        time: '2025-12-11T10:00:00.000Z',
        message: 'Brand not found'
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(true);
    });

    it('should fail if buildId is missing', () => {
      const response = {
        ok: true,
        brandId: 'root',
        time: '2025-12-11T10:00:00.000Z'
        // Missing buildId
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(false);
    });

    it('should fail if brandId is missing', () => {
      const response = {
        ok: true,
        buildId: 'mvp-v19',
        time: '2025-12-11T10:00:00.000Z'
        // Missing brandId
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(false);
    });

    it('should fail if time is missing', () => {
      const response = {
        ok: true,
        buildId: 'mvp-v19',
        brandId: 'root'
        // Missing time
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(false);
    });

    it('should reject envelope-wrapped status (not flat)', () => {
      const response = {
        ok: true,
        value: { buildId: 'mvp-v19', brandId: 'root' }  // Wrapped in value = not flat
      };

      const result = validateFlatStatus(response);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Shared Analytics Schema Validation
  // ==========================================================================
  describe('Shared Analytics Schema', () => {
    const createValidAnalytics = () => ({
      lastUpdatedISO: '2025-12-11T10:00:00.000Z',
      summary: {
        totalImpressions: 1000,
        totalClicks: 50,
        totalQrScans: 25,
        totalSignups: 10,
        uniqueEvents: 5,
        uniqueSponsors: 3
      },
      surfaces: [
        { id: 'public', label: 'Public Page', impressions: 500, clicks: 25, qrScans: 15 },
        { id: 'display', label: 'TV Display', impressions: 500, clicks: 25, qrScans: 10 }
      ]
    });

    it('should validate complete shared analytics', () => {
      const analytics = createValidAnalytics();

      const result = validateSharedAnalytics(analytics);
      expect(result.valid).toBe(true);
    });

    it('should validate with optional sponsors array', () => {
      const analytics = createValidAnalytics();
      analytics.sponsors = [
        { id: 'SPO_1', name: 'Sponsor 1', impressions: 500, clicks: 20, ctr: 4.0 }
      ];

      const result = validateSharedAnalytics(analytics);
      expect(result.valid).toBe(true);
    });

    it('should validate with optional events array', () => {
      const analytics = createValidAnalytics();
      analytics.events = [
        { id: 'EVT_1', name: 'Event 1', impressions: 500, clicks: 25, ctr: 5.0, signupsCount: 5 }
      ];

      const result = validateSharedAnalytics(analytics);
      expect(result.valid).toBe(true);
    });

    it('should fail if summary is missing', () => {
      const analytics = createValidAnalytics();
      delete analytics.summary;

      const result = validateSharedAnalytics(analytics);
      expect(result.valid).toBe(false);
    });

    it('should fail if surfaces is missing', () => {
      const analytics = createValidAnalytics();
      delete analytics.surfaces;

      const result = validateSharedAnalytics(analytics);
      expect(result.valid).toBe(false);
    });

    it('should fail if lastUpdatedISO is missing', () => {
      const analytics = createValidAnalytics();
      delete analytics.lastUpdatedISO;

      const result = validateSharedAnalytics(analytics);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Delete Response Schema Validation
  // ==========================================================================
  describe('Delete Response Schema', () => {
    it('should validate successful delete response', () => {
      const response = {
        ok: true,
        value: null
      };

      const result = validateAgainstSchema(response, 'delete-response');
      expect(result.valid).toBe(true);
    });

    it('should validate delete error response', () => {
      const response = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      };

      const result = validateAgainstSchema(response, 'delete-response');
      expect(result.valid).toBe(true);
    });

    it('should fail if value is not null on success', () => {
      const response = {
        ok: true,
        value: { deleted: true }  // Should be null
      };

      const result = validateAgainstSchema(response, 'delete-response');
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Endpoint-Specific Validation
  // ==========================================================================
  describe('Endpoint-Specific Validation', () => {
    it('should map all endpoints to schemas', () => {
      expect(Object.keys(ENDPOINT_SCHEMAS).length).toBeGreaterThan(10);
    });

    it('should validate response for list endpoint', () => {
      const response = {
        ok: true,
        value: {
          items: [],
          pagination: { total: 0, limit: 20, offset: 0, hasMore: false }
        }
      };

      const result = validateEndpointResponse(response, 'list');
      expect(result.valid).toBe(true);
    });

    it('should validate response for getPublicBundle endpoint', () => {
      const response = {
        ok: true,
        value: {
          event: { id: 'EVT_1', slug: 'test', name: 'Test' },
          config: { brandId: 'root', brandName: 'Test', appTitle: 'Events' }
        }
      };

      const result = validateEndpointResponse(response, 'getPublicBundle');
      expect(result.valid).toBe(true);
    });

    it('should return error for unknown endpoint', () => {
      const response = { ok: true, value: {} };

      const result = validateEndpointResponse(response, 'unknownEndpoint');
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Unknown endpoint');
    });
  });

  // ==========================================================================
  // Schema Mismatch Detection (Critical for CI)
  // ==========================================================================
  describe('Schema Mismatch Detection', () => {
    it('should detect missing required field', () => {
      const response = {
        ok: true
        // Missing value - required for success envelope
      };

      const result = validateAgainstSchema(response, 'api-envelope');
      expect(result.valid).toBe(false);
      expect(result.errors).not.toBeNull();
    });

    it('should detect wrong field type', () => {
      const response = {
        ok: 'true',  // Should be boolean, not string
        value: {}
      };

      const result = validateAgainstSchema(response, 'api-envelope');
      expect(result.valid).toBe(false);
    });

    it('should detect additional properties in strict schemas', () => {
      const event = {
        id: 'EVT_123',
        slug: 'test',
        name: 'Test',
        startDateISO: '2025-12-01',
        venue: 'Venue',
        links: { publicUrl: '', displayUrl: '', posterUrl: '', signupUrl: '' },
        qr: { public: '', signup: '' },
        ctas: { primary: { label: '', url: '' } },
        settings: { showSchedule: false, showStandings: false, showBracket: false },
        createdAtISO: '2025-12-01',
        updatedAtISO: '2025-12-01',
        extraField: 'not allowed'  // Additional property
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });

    it('should detect invalid enum value', () => {
      const response = {
        ok: false,
        code: 'INVALID_ERROR_CODE',  // Not in enum
        message: 'Error'
      };

      const result = validateAgainstSchema(response, 'api-envelope');
      expect(result.valid).toBe(false);
    });

    it('should detect pattern mismatch', () => {
      const event = {
        id: 'EVT_123',
        slug: 'INVALID_SLUG!',  // Should match ^[a-z0-9-]+$
        name: 'Test',
        startDateISO: '2025-12-01',
        venue: 'Venue',
        links: { publicUrl: '', displayUrl: '', posterUrl: '', signupUrl: '' },
        qr: { public: '', signup: '' },
        ctas: { primary: { label: '', url: '' } },
        settings: { showSchedule: false, showStandings: false, showBracket: false },
        createdAtISO: '2025-12-01',
        updatedAtISO: '2025-12-01'
      };

      const result = validateEvent(event);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // Jest Matcher Integration
  // ==========================================================================
  describe('Jest Matcher Integration', () => {
    it('should pass with valid schema match', () => {
      const response = {
        ok: true,
        value: { id: 'test' }
      };

      expect(response).toMatchSchema('api-envelope');
    });

    it('should fail with invalid schema match', () => {
      const response = {
        ok: true
        // Missing value
      };

      expect(() => expect(response).toMatchSchema('api-envelope')).toThrow();
    });
  });

  // ==========================================================================
  // validateResponse throws on failure
  // ==========================================================================
  describe('validateResponse Throws', () => {
    it('should not throw for valid response', () => {
      const response = { ok: true, value: {} };

      expect(() => validateResponse(response, 'api-envelope')).not.toThrow();
    });

    it('should throw for invalid response with detailed errors', () => {
      const response = { ok: true };  // Missing value

      expect(() => validateResponse(response, 'api-envelope')).toThrow(/Schema validation failed/);
    });
  });

  // ==========================================================================
  // Schema Version Control
  // ==========================================================================
  describe('Schema Version Control', () => {
    it('should have $schema field in all schemas', () => {
      const schemas = getAvailableSchemas();

      for (const schemaId of schemas) {
        const schema = loadSchema(schemaId);
        expect(schema.$schema).toBeDefined();
      }
    });

    it('should have $id field in entity schemas', () => {
      const entitySchemas = ['event', 'sponsor', 'shared-analytics'];

      for (const schemaId of entitySchemas) {
        const schema = loadSchema(schemaId);
        expect(schema.$id).toBeDefined();
        expect(schema.$id).toContain('zeventbook.com');
      }
    });

    it('should have title and description in all schemas', () => {
      const schemas = getAvailableSchemas();

      for (const schemaId of schemas) {
        const schema = loadSchema(schemaId);
        expect(schema.title).toBeDefined();
        expect(schema.description).toBeDefined();
      }
    });
  });
});
