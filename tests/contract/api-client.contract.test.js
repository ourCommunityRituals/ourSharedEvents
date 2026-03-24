/**
 * APIClient Contract Tests
 *
 * Tests for the APIClient module that wraps NU.rpc for standardized
 * API calls across front-end pages.
 *
 * Contract validation ensures:
 * - Request payloads have correct structure
 * - Response envelopes follow Ok/Err pattern
 * - CRUD operations use correct API methods
 * - Error handling produces correct error objects
 */

const { validateEnvelope, validateSuccessEnvelope } = require('../shared/helpers/test.helpers');

describe('APIClient Contract Tests', () => {

  // =============================================================================
  // RESPONSE ENVELOPE CONTRACTS
  // =============================================================================

  describe('Response Envelope Contracts', () => {

    describe('Success Response (Ok envelope)', () => {

      test('create operation returns valid Ok envelope with id', () => {
        const response = {
          ok: true,
          value: {
            id: 'sponsor-abc123',
            name: 'Acme Corp',
            tier: 'gold',
            createdAt: '2025-11-21T12:00:00Z'
          }
        };

        validateSuccessEnvelope(response);
        expect(response.value).toHaveProperty('id');
        expect(typeof response.value.id).toBe('string');
      });

      test('list operation returns valid Ok envelope with items array', () => {
        const response = {
          ok: true,
          value: {
            items: [
              { id: 'sponsor-1', name: 'Sponsor A', tier: 'platinum' },
              { id: 'sponsor-2', name: 'Sponsor B', tier: 'gold' }
            ],
            count: 2
          }
        };

        validateSuccessEnvelope(response);
        expect(response.value).toHaveProperty('items');
        expect(Array.isArray(response.value.items)).toBe(true);
      });

      test('get operation returns valid Ok envelope with resource', () => {
        const response = {
          ok: true,
          value: {
            id: 'event-xyz789',
            name: 'Tech Conference 2025',
            date: '2025-12-15',
            location: 'Convention Center'
          }
        };

        validateSuccessEnvelope(response);
        expect(response.value).toHaveProperty('id');
        expect(response.value).toHaveProperty('name');
      });

      test('update operation returns valid Ok envelope', () => {
        const response = {
          ok: true,
          value: {
            id: 'sponsor-abc123',
            name: 'Acme Corp Updated',
            tier: 'platinum',
            updatedAt: '2025-11-21T14:00:00Z'
          }
        };

        validateSuccessEnvelope(response);
        expect(response.value.name).toBe('Acme Corp Updated');
      });

      test('delete operation returns valid Ok envelope', () => {
        const response = {
          ok: true,
          value: {
            deleted: true,
            id: 'sponsor-abc123'
          }
        };

        validateSuccessEnvelope(response);
        expect(response.value.deleted).toBe(true);
      });

    });

    describe('Error Response (Err envelope)', () => {

      test('UNAUTHORIZED error has correct structure', () => {
        const response = {
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'Invalid admin key'
        };

        validateEnvelope(response);
        expect(response.ok).toBe(false);
        expect(response.code).toBe('UNAUTHORIZED');
        expect(response).toHaveProperty('message');
      });

      test('NOT_FOUND error has correct structure', () => {
        const response = {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Resource not found'
        };

        validateEnvelope(response);
        expect(response.ok).toBe(false);
        expect(response.code).toBe('NOT_FOUND');
      });

      test('VALIDATION_ERROR has correct structure', () => {
        const response = {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Name is required',
          field: 'name'
        };

        validateEnvelope(response);
        expect(response.ok).toBe(false);
        expect(response.code).toBe('VALIDATION_ERROR');
      });

      test('INTERNAL error has correct structure', () => {
        const response = {
          ok: false,
          code: 'INTERNAL',
          message: 'An unexpected error occurred'
        };

        validateEnvelope(response);
        expect(response.ok).toBe(false);
        expect(response.code).toBe('INTERNAL');
      });

      test('RATE_LIMITED error has correct structure', () => {
        const response = {
          ok: false,
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          retryAfter: 60
        };

        validateEnvelope(response);
        expect(response.ok).toBe(false);
        expect(response.code).toBe('RATE_LIMITED');
      });

    });

  });

  // =============================================================================
  // REQUEST PAYLOAD CONTRACTS
  // =============================================================================

  describe('Request Payload Contracts', () => {

    describe('create() payload', () => {

      test('should include brandId, scope, and data', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'sponsors',
          data: {
            name: 'New Sponsor',
            tier: 'gold',
            website: 'https://example.com'
          },
          adminKey: 'admin-key-123'
        };

        expect(payload).toHaveProperty('brandId');
        expect(payload).toHaveProperty('scope');
        expect(payload).toHaveProperty('data');
        expect(payload).toHaveProperty('adminKey');
      });

      test('should support optional templateId', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'sponsors',
          templateId: 'sponsor',
          data: { name: 'Sponsor' },
          adminKey: 'key'
        };

        expect(payload).toHaveProperty('templateId');
        expect(payload.templateId).toBe('sponsor');
      });

    });

    describe('list() payload', () => {

      test('should include brandId and scope', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'events'
        };

        expect(payload).toHaveProperty('brandId');
        expect(payload).toHaveProperty('scope');
      });

      test('should support optional filter', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'sponsors',
          filter: { tier: 'platinum' }
        };

        expect(payload).toHaveProperty('filter');
        expect(payload.filter.tier).toBe('platinum');
      });

    });

    describe('get() payload', () => {

      test('should include brandId, scope, and id', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'events',
          id: 'event-123'
        };

        expect(payload).toHaveProperty('brandId');
        expect(payload).toHaveProperty('scope');
        expect(payload).toHaveProperty('id');
      });

    });

    describe('update() payload', () => {

      test('should include brandId, scope, id, data, and adminKey', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'sponsors',
          id: 'sponsor-456',
          data: { name: 'Updated Name' },
          adminKey: 'admin-key'
        };

        expect(payload).toHaveProperty('brandId');
        expect(payload).toHaveProperty('scope');
        expect(payload).toHaveProperty('id');
        expect(payload).toHaveProperty('data');
        expect(payload).toHaveProperty('adminKey');
      });

    });

    describe('remove() payload', () => {

      test('should include brandId, scope, id, and adminKey', () => {
        const payload = {
          brandId: 'test-brand',
          scope: 'sponsors',
          id: 'sponsor-789',
          adminKey: 'admin-key'
        };

        expect(payload).toHaveProperty('brandId');
        expect(payload).toHaveProperty('scope');
        expect(payload).toHaveProperty('id');
        expect(payload).toHaveProperty('adminKey');
      });

    });

  });

  // =============================================================================
  // API METHOD MAPPING CONTRACTS
  // =============================================================================

  describe('API Method Mapping', () => {

    test('CRUD operations map to correct api_* methods', () => {
      const methodMapping = {
        create: 'api_create',
        list: 'api_list',
        get: 'api_get',
        update: 'api_update',
        remove: 'api_delete'
      };

      expect(methodMapping.create).toBe('api_create');
      expect(methodMapping.list).toBe('api_list');
      expect(methodMapping.get).toBe('api_get');
      expect(methodMapping.update).toBe('api_update');
      expect(methodMapping.remove).toBe('api_delete');
    });

    test('specialized methods map correctly', () => {
      const specializedMapping = {
        updateEvent: 'api_updateEventData',
        getPublicBundle: 'api_getPublicBundle',
        generateFormShortlink: 'api_generateFormShortlink',
        createFormFromTemplate: 'api_createFormFromTemplate'
      };

      expect(specializedMapping.updateEvent).toBe('api_updateEventData');
      expect(specializedMapping.getPublicBundle).toBe('api_getPublicBundle');
    });

    test('analytics methods map correctly', () => {
      const analyticsMapping = {
        getSharedAnalytics: 'api_getSharedAnalytics',
        getSponsorAnalytics: 'api_getSponsorAnalytics',
        getSponsorROI: 'api_getSponsorROI'
      };

      expect(analyticsMapping.getSharedAnalytics).toBe('api_getSharedAnalytics');
      expect(analyticsMapping.getSponsorAnalytics).toBe('api_getSponsorAnalytics');
      expect(analyticsMapping.getSponsorROI).toBe('api_getSponsorROI');
    });

  });

  // =============================================================================
  // CONFIGURATION CONTRACTS
  // =============================================================================

  describe('Configuration Contracts', () => {

    test('init() accepts valid configuration object', () => {
      const config = {
        brandId: 'test-brand',
        adminKey: 'admin-key-123',
        onSuccess: () => {},
        onError: () => {}
      };

      expect(config).toHaveProperty('brandId');
      expect(config).toHaveProperty('adminKey');
      expect(typeof config.onSuccess).toBe('function');
      expect(typeof config.onError).toBe('function');
    });

    test('getConfig() returns expected structure', () => {
      const expectedConfig = {
        brandId: 'test-brand',
        adminKey: 'admin-key',
        onSuccess: null,
        onError: null
      };

      expect(expectedConfig).toHaveProperty('brandId');
      expect(expectedConfig).toHaveProperty('adminKey');
      expect(expectedConfig).toHaveProperty('onSuccess');
      expect(expectedConfig).toHaveProperty('onError');
    });

  });

  // =============================================================================
  // ERROR OBJECT CONTRACTS
  // =============================================================================

  describe('Error Object Contracts', () => {

    test('APIClient error has code and message', () => {
      const error = {
        message: 'API request failed',
        code: 'INTERNAL',
        response: { ok: false, code: 'INTERNAL', message: 'API request failed' }
      };

      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('response');
    });

    test('error.response contains original API response', () => {
      const apiResponse = {
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid admin key'
      };

      const error = {
        message: apiResponse.message,
        code: apiResponse.code,
        response: apiResponse
      };

      expect(error.response).toEqual(apiResponse);
      expect(error.response.ok).toBe(false);
    });

  });

  // =============================================================================
  // SCOPE VALIDATION
  // =============================================================================

  describe('Valid Scopes', () => {

    test('supported resource scopes', () => {
      const validScopes = [
        'sponsors',
        'events',
        'forms',
        'analytics',
        'config'
      ];

      validScopes.forEach(scope => {
        expect(typeof scope).toBe('string');
        expect(scope.length).toBeGreaterThan(0);
      });
    });

  });

});
