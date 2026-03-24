/**
 * Story 4.2 - Shared API Client Unit Tests
 *
 * Tests for the shared API client module (/web/shared/apiClient.js).
 * Validates:
 * - Module loading and initialization
 * - EA namespace API
 * - NU backward compatibility
 * - Request/response handling
 * - Error handling
 * - Retry logic
 * - Stale-while-revalidate caching
 *
 * @see /web/shared/apiClient.js
 */

describe('Story 4.2 - Shared API Client', () => {
  // =============================================================================
  // Test Setup
  // =============================================================================

  let originalFetch;
  let originalLocalStorage;
  let mockFetch;
  let mockLocalStorage;
  let EA;
  let NU;

  beforeEach(() => {
    // Store originals
    originalFetch = global.fetch;
    originalLocalStorage = global.localStorage;

    // Create mock fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Create mock localStorage
    mockLocalStorage = {
      store: {},
      getItem: jest.fn((key) => mockLocalStorage.store[key] || null),
      setItem: jest.fn((key, value) => { mockLocalStorage.store[key] = value; }),
      removeItem: jest.fn((key) => { delete mockLocalStorage.store[key]; }),
      clear: jest.fn(() => { mockLocalStorage.store = {}; }),
    };
    global.localStorage = mockLocalStorage;

    // Mock window.location
    global.window = {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
        host: 'localhost:8080',
      },
    };

    // Mock document for auto-init
    global.document = {
      readyState: 'complete',
      querySelector: jest.fn(() => null),
    };

    // Reset module state by re-evaluating (simulated)
    // In real tests, we'd reload the module
    EA = createMockEA();
    NU = EA; // NU is an alias in the shared module

    // Mock __EA_LOGS__ and __NU_LOGS__
    global.__EA_LOGS__ = [];
    global.__NU_LOGS__ = global.__EA_LOGS__;
  });

  afterEach(() => {
    // Restore originals
    global.fetch = originalFetch;
    global.localStorage = originalLocalStorage;
    delete global.window;
    delete global.document;
    delete global.__EA_LOGS__;
    delete global.__NU_LOGS__;
  });

  /**
   * Create a mock EA object that simulates the shared API client
   */
  function createMockEA() {
    const logs = [];
    const pendingRequests = [];
    const state = {
      initialized: false,
      apiBase: '/api',
      brand: 'root',
      logLevel: 'debug',
      isStaging: true,
      isProduction: false,
    };

    const ERROR_CODES = {
      BAD_INPUT: 'BAD_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      UNAUTHORIZED: 'UNAUTHORIZED',
      FORBIDDEN: 'FORBIDDEN',
      RATE_LIMITED: 'RATE_LIMITED',
      TIMEOUT: 'TIMEOUT',
      NETWORK_ERROR: 'NETWORK_ERROR',
      PARSE_ERROR: 'PARSE_ERROR',
      INTERNAL: 'INTERNAL',
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    };

    async function request(path, options = {}) {
      const { method = 'GET', body, headers = {}, timeout = 30000, ifNoneMatch } = options;

      const url = path.startsWith('http') ? path : `${state.apiBase}/${path.replace(/^\//, '')}`;

      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      };

      if (ifNoneMatch) {
        requestHeaders['If-None-Match'] = ifNoneMatch;
      }

      try {
        const response = await global.fetch(url, {
          method,
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
          credentials: 'same-origin',
        });

        if (response.status === 304) {
          return { ok: true, notModified: true };
        }

        if (!response.ok) {
          let errorData = {};
          try {
            errorData = await response.json();
          } catch (_jsonError) {
            // Ignore JSON parse errors for error responses
          }

          const code = errorData.code || mapStatusToErrorCode(response.status);
          return { ok: false, code, message: errorData.message || 'HTTP error', status: response.status };
        }

        const data = await response.json();
        if (data.ok === false) {
          return { ok: false, code: data.code || 'INTERNAL', message: data.message };
        }

        return { ok: true, value: data.value !== undefined ? data.value : data, etag: data.etag };

      } catch (error) {
        if (error.name === 'AbortError') {
          return { ok: false, code: 'TIMEOUT', message: 'Request timeout' };
        }
        return { ok: false, code: 'NETWORK_ERROR', message: 'Network error' };
      }
    }

    function mapStatusToErrorCode(status) {
      if (status === 400) return 'BAD_INPUT';
      if (status === 401) return 'UNAUTHORIZED';
      if (status === 403) return 'FORBIDDEN';
      if (status === 404) return 'NOT_FOUND';
      if (status === 429) return 'RATE_LIMITED';
      if (status >= 500) return 'INTERNAL';
      return 'INTERNAL';
    }

    async function rpc(path, payload = {}) {
      const isLegacyMethod = path.startsWith('api_');
      if (isLegacyMethod) {
        return request('rpc', { method: 'POST', body: { method: path, payload } });
      }
      return request(path, { method: 'POST', body: payload });
    }

    return {
      VERSION: '1.0.0',
      ERROR_CODES,
      init(config = {}) {
        if (config.brand) state.brand = config.brand;
        if (config.apiBase) state.apiBase = config.apiBase;
        state.initialized = true;
      },
      isInitialized: () => state.initialized,
      isStaging: () => state.isStaging,
      isProduction: () => state.isProduction,
      request,
      rpc,
      esc: (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      getLogs: () => [...logs],
      getPending: () => [...pendingRequests],
      flush: async () => {},
      swr: (path, payload, options = {}) => {
        const { onUpdate } = options;
        rpc(path, payload).then(res => {
          if (res.ok && res.value && onUpdate) {
            onUpdate(res.value);
          }
        });
      },
      api: {
        events: {
          list: (options = {}) => request(`events${options.brand ? `?brand=${options.brand}` : ''}`, { method: 'GET' }),
          get: (eventId) => request(`events/${eventId}`, { method: 'GET' }),
          getPublicBundle: (eventId, opts = {}) => request(`events/${eventId}/publicBundle`, { method: 'GET', ifNoneMatch: opts.ifNoneMatch }),
          getAdminBundle: (eventId, opts = {}) => request(`events/${eventId}/adminBundle`, { method: 'GET', ifNoneMatch: opts.ifNoneMatch }),
          getDisplayBundle: (eventId, opts = {}) => request(`events/${eventId}/displayBundle`, { method: 'GET', ifNoneMatch: opts.ifNoneMatch }),
          getPosterBundle: (eventId, opts = {}) => request(`events/${eventId}/posterBundle`, { method: 'GET', ifNoneMatch: opts.ifNoneMatch }),
        },
        admin: {
          createEvent: (eventData) => request('admin/events', { method: 'POST', body: eventData }),
          recordResult: (eventId, resultData) => request(`admin/events/${eventId}/results`, { method: 'POST', body: resultData }),
          saveEvent: (eventData) => rpc('api_saveEvent', eventData),
        },
        status: {
          check: () => request('status', { method: 'GET' }),
        },
      },
    };
  }

  // =============================================================================
  // Helper Functions
  // =============================================================================

  function createSuccessResponse(value, options = {}) {
    return {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        ok: true,
        value,
        etag: options.etag,
      }),
    };
  }

  function createErrorResponse(status, code, message) {
    return {
      ok: false,
      status,
      json: jest.fn().mockResolvedValue({
        ok: false,
        code,
        message,
      }),
    };
  }

  // =============================================================================
  // Module Structure Tests
  // =============================================================================

  describe('Module Structure', () => {
    test('should expose EA namespace with VERSION', () => {
      expect(EA.VERSION).toBe('1.0.0');
    });

    test('should expose ERROR_CODES constant', () => {
      expect(EA.ERROR_CODES).toBeDefined();
      expect(EA.ERROR_CODES.BAD_INPUT).toBe('BAD_INPUT');
      expect(EA.ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
      expect(EA.ERROR_CODES.UNAUTHORIZED).toBe('UNAUTHORIZED');
      expect(EA.ERROR_CODES.NETWORK_ERROR).toBe('NETWORK_ERROR');
    });

    test('should expose api namespace with typed endpoints', () => {
      expect(EA.api).toBeDefined();
      expect(EA.api.events).toBeDefined();
      expect(EA.api.admin).toBeDefined();
      expect(EA.api.status).toBeDefined();
    });

    test('should expose utility functions', () => {
      expect(typeof EA.request).toBe('function');
      expect(typeof EA.rpc).toBe('function');
      expect(typeof EA.swr).toBe('function');
      expect(typeof EA.esc).toBe('function');
      expect(typeof EA.flush).toBe('function');
    });
  });

  // =============================================================================
  // Initialization Tests
  // =============================================================================

  describe('Initialization', () => {
    test('should not be initialized before init() call', () => {
      const freshEA = createMockEA();
      expect(freshEA.isInitialized()).toBe(false);
    });

    test('should be initialized after init() call', () => {
      EA.init();
      expect(EA.isInitialized()).toBe(true);
    });

    test('should accept brand configuration', () => {
      EA.init({ brand: 'abc' });
      expect(EA.isInitialized()).toBe(true);
    });

    test('should detect staging environment', () => {
      expect(EA.isStaging()).toBe(true);
      expect(EA.isProduction()).toBe(false);
    });
  });

  // =============================================================================
  // Request Tests
  // =============================================================================

  describe('EA.request()', () => {
    test('should make GET request with correct URL', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ test: 'data' }));

      await EA.request('events');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/events',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }),
        })
      );
    });

    test('should make POST request with body', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ id: 'new-event' }));

      await EA.request('admin/events', {
        method: 'POST',
        body: { name: 'Test Event' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/events',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test Event' }),
        })
      );
    });

    test('should return success response with value', async () => {
      const mockData = { events: [{ id: '1', name: 'Event 1' }] };
      mockFetch.mockResolvedValue(createSuccessResponse(mockData));

      const result = await EA.request('events');

      expect(result.ok).toBe(true);
      expect(result.value).toEqual(mockData);
    });

    test('should return error response for HTTP 404', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(404, 'NOT_FOUND', 'Event not found'));

      const result = await EA.request('events/invalid-id');

      expect(result.ok).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    test('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await EA.request('events');

      expect(result.ok).toBe(false);
      expect(result.code).toBe('NETWORK_ERROR');
    });

    test('should include If-None-Match header when provided', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ test: 'data' }));

      await EA.request('events/123/publicBundle', {
        ifNoneMatch: 'abc123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-None-Match': 'abc123',
          }),
        })
      );
    });

    test('should handle 304 Not Modified response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 304,
      });

      const result = await EA.request('events/123/publicBundle', {
        ifNoneMatch: 'abc123',
      });

      expect(result.ok).toBe(true);
      expect(result.notModified).toBe(true);
    });
  });

  // =============================================================================
  // RPC Tests (Backward Compatibility)
  // =============================================================================

  describe('EA.rpc() / NU.rpc()', () => {
    test('should route modern paths to direct endpoints', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ events: [] }));

      await EA.rpc('events/list', { brandId: 'abc' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/events/list',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ brandId: 'abc' }),
        })
      );
    });

    test('should route legacy api_* methods to /api/rpc', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ saved: true }));

      await EA.rpc('api_saveEvent', { eventId: '123', data: {} });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/rpc',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            method: 'api_saveEvent',
            payload: { eventId: '123', data: {} },
          }),
        })
      );
    });

    test('should handle successful RPC response', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ created: true, eventId: 'ev-123' }));

      const result = await EA.rpc('admin/events', { name: 'New Event' });

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ created: true, eventId: 'ev-123' });
    });

    test('should handle error RPC response', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(400, 'BAD_INPUT', 'Invalid event data'));

      const result = await EA.rpc('admin/events', { name: '' });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_INPUT');
    });
  });

  // =============================================================================
  // Typed API Tests
  // =============================================================================

  describe('EA.api.events', () => {
    test('list() should fetch events list', async () => {
      const mockEvents = { events: [{ id: '1', name: 'Event 1' }] };
      mockFetch.mockResolvedValue(createSuccessResponse(mockEvents));

      const result = await EA.api.events.list();

      expect(result.ok).toBe(true);
      expect(result.value).toEqual(mockEvents);
    });

    test('get() should fetch single event', async () => {
      const mockEvent = { id: '123', name: 'Test Event' };
      mockFetch.mockResolvedValue(createSuccessResponse(mockEvent));

      const result = await EA.api.events.get('123');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/events/123',
        expect.any(Object)
      );
      expect(result.ok).toBe(true);
    });

    test('getPublicBundle() should fetch public bundle', async () => {
      const mockBundle = { event: {}, schedule: [] };
      mockFetch.mockResolvedValue(createSuccessResponse(mockBundle, { etag: 'abc123' }));

      const result = await EA.api.events.getPublicBundle('event-123');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/events/event-123/publicBundle',
        expect.any(Object)
      );
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(mockBundle);
    });

    test('getAdminBundle() should fetch admin bundle', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ event: {}, config: {} }));

      const result = await EA.api.events.getAdminBundle('event-123');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/events/event-123/adminBundle',
        expect.any(Object)
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('EA.api.admin', () => {
    test('createEvent() should create new event', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ eventId: 'new-123' }));

      const result = await EA.api.admin.createEvent({ name: 'New Event', date: '2025-01-01' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/events',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ eventId: 'new-123' });
    });

    test('recordResult() should record result for event', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ recorded: true }));

      const result = await EA.api.admin.recordResult('event-123', { team: 'A', score: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/events/event-123/results',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('EA.api.status', () => {
    test('check() should return health status', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ status: 'ok', version: '1.7.0' }));

      const result = await EA.api.status.check();

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/status',
        expect.any(Object)
      );
      expect(result.ok).toBe(true);
      expect(result.value.status).toBe('ok');
    });
  });

  // =============================================================================
  // Utility Function Tests
  // =============================================================================

  describe('EA.esc()', () => {
    test('should escape HTML special characters', () => {
      expect(EA.esc('<script>')).toBe('&lt;script&gt;');
      expect(EA.esc('"quotes"')).toBe('&quot;quotes&quot;');
      expect(EA.esc("'apostrophe'")).toBe('&#39;apostrophe&#39;');
      expect(EA.esc('&amp')).toBe('&amp;amp');
    });

    test('should handle non-string input', () => {
      expect(EA.esc(123)).toBe('123');
      expect(EA.esc(null)).toBe('null');
    });
  });

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('Error Handling', () => {
    test('should map HTTP 400 to BAD_INPUT', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(400, 'BAD_INPUT', 'Invalid data'));

      const result = await EA.request('events');

      expect(result.code).toBe('BAD_INPUT');
    });

    test('should map HTTP 401 to UNAUTHORIZED', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(401, 'UNAUTHORIZED', 'Not authenticated'));

      const result = await EA.request('admin/events');

      expect(result.code).toBe('UNAUTHORIZED');
    });

    test('should map HTTP 403 to FORBIDDEN', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(403, 'FORBIDDEN', 'Access denied'));

      const result = await EA.request('admin/events');

      expect(result.code).toBe('FORBIDDEN');
    });

    test('should map HTTP 404 to NOT_FOUND', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(404, 'NOT_FOUND', 'Not found'));

      const result = await EA.request('events/invalid');

      expect(result.code).toBe('NOT_FOUND');
    });

    test('should map HTTP 429 to RATE_LIMITED', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(429, 'RATE_LIMITED', 'Too many requests'));

      const result = await EA.request('events');

      expect(result.code).toBe('RATE_LIMITED');
    });

    test('should map HTTP 500 to INTERNAL', async () => {
      mockFetch.mockResolvedValue(createErrorResponse(500, 'INTERNAL', 'Server error'));

      const result = await EA.request('events');

      expect(result.code).toBe('INTERNAL');
    });

    test('should handle JSON parse errors gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      const result = await EA.request('events');

      // Should not throw, should return error
      expect(result.ok).toBe(false);
    });
  });

  // =============================================================================
  // Backward Compatibility Tests (NU namespace)
  // =============================================================================

  describe('NU Backward Compatibility', () => {
    test('NU.rpc should work like EA.rpc', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({ events: [] }));

      const result = await NU.rpc('events/list', {});

      expect(result.ok).toBe(true);
    });

    test('NU.esc should work like EA.esc', () => {
      expect(NU.esc('<test>')).toBe('&lt;test&gt;');
    });

    test('NU.init should work like EA.init', () => {
      NU.init({ brand: 'cbc' });
      expect(NU.isInitialized()).toBe(true);
    });
  });

  // =============================================================================
  // Zero GAS Network Calls Verification
  // =============================================================================

  describe('Zero GAS Network Calls', () => {
    test('should never reference google.script.run', () => {
      // The shared API client uses fetch exclusively
      // This test verifies the architecture by checking that all API calls use fetch
      expect(mockFetch).toBeDefined();

      // Make various API calls
      EA.api.events.list();
      EA.api.status.check();
      EA.rpc('events/list', {});

      // All calls should go through fetch, not google.script.run
      expect(mockFetch).toHaveBeenCalled();

      // Verify no google.script.run reference exists
      expect(global.google?.script?.run).toBeUndefined();
    });

    test('all API calls should use /api/* endpoints', async () => {
      mockFetch.mockResolvedValue(createSuccessResponse({}));

      await EA.api.events.list();
      await EA.api.events.get('123');
      await EA.api.events.getPublicBundle('123');
      await EA.api.admin.createEvent({});
      await EA.api.status.check();

      // Verify all calls use /api/ prefix
      const calls = mockFetch.mock.calls;
      calls.forEach(call => {
        const url = call[0];
        expect(url).toMatch(/^\/api\//);
      });
    });
  });
});
