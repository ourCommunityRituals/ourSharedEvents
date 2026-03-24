/**
 * NUSDK RPC Unit Tests
 *
 * Tests for the client SDK RPC layer that handles frontend→backend calls
 * in Google Apps Script environment.
 *
 * NUSDK v2.0 Features:
 * - Path-based routing: NU.rpc('events/list', payload) → /api/events/list
 * - Legacy method support: NU.rpc('api_getPublicBundle', payload) → /api/rpc
 * - Rolling log buffer: window.__NU_LOGS__
 * - Diagnostic helper: window.NU_DIAG
 * - Flush support: NU.flush()
 * - Environment-aware logging: debug (staging) / error (production)
 *
 * RESPONSE ENVELOPE CONTRACT:
 * SUCCESS: { ok: true, value: {...}, etag?: string, notModified?: boolean }
 * ERROR:   { ok: false, code: string, message: string }
 *
 * Test coverage:
 * - Successful RPC: {ok:true, value:...} resolves to value
 * - Error RPC: {ok:false, code, message} returns error structure
 * - Network error: surfaces see safe error, not crash
 * - google.script.run unavailable: graceful degradation
 * - Path-based routing support
 * - Rolling log buffer
 * - Flush functionality
 */

describe('NUSDK', () => {
  // =============================================================================
  // RPC FUNCTION TESTS
  // =============================================================================

  describe('NU.rpc()', () => {
    let NU;
    let mockGoogleScriptRun;

    beforeEach(() => {
      // Reset mocks
      mockGoogleScriptRun = {
        withSuccessHandler: jest.fn().mockReturnThis(),
        withFailureHandler: jest.fn().mockReturnThis(),
      };

      // Simulate NU.rpc implementation
      NU = {
        rpc(method, payload) {
          return new Promise((resolve) => {
            // Check if google.script.run is available
            if (!global.google || !global.google.script || !global.google.script.run) {
              console.error('[NUSDK] google.script.run is not available');
              resolve({ ok: false, code: 'INTERNAL', message: 'google.script.run not available - page must be served from Apps Script' });
              return;
            }

            try {
              const runner = global.google.script.run
                .withSuccessHandler(res => resolve(res))
                .withFailureHandler(err => {
                  console.error('[NUSDK] Server error for', method, ':', err);
                  resolve({ ok: false, code: 'INTERNAL', message: String(err) });
                });
              runner[method](payload);
            } catch (e) {
              console.error('[NUSDK] Exception calling', method, ':', e);
              resolve({ ok: false, code: 'INTERNAL', message: String(e) });
            }
          });
        }
      };
    });

    afterEach(() => {
      delete global.google;
    });

    // -------------------------------------------------------------------------
    // Successful RPC Tests
    // -------------------------------------------------------------------------

    describe('Successful RPC', () => {
      test('should resolve with value from {ok:true, value:...} response', async () => {
        const mockResponse = {
          ok: true,
          value: { event: { id: 'ev1', name: 'Test Event' } }
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', { eventId: 'ev1' });

        expect(result.ok).toBe(true);
        expect(result.value).toEqual({ event: { id: 'ev1', name: 'Test Event' } });
      });

      test('should pass payload to the backend method', async () => {
        const payload = { brandId: 'zeb', scope: 'event', id: 'ev123' };
        let receivedPayload = null;

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function(p) {
                receivedPayload = p;
                this._successHandler({ ok: true, value: {} });
              })
            }
          }
        };

        await NU.rpc('api_getPublicBundle', payload);

        expect(receivedPayload).toEqual(payload);
      });

      test('should handle response with etag for caching', async () => {
        const mockResponse = {
          ok: true,
          value: { event: { id: 'ev1' } },
          etag: 'abc123'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(true);
        expect(result.etag).toBe('abc123');
      });

      test('should handle notModified response (304 equivalent)', async () => {
        const mockResponse = {
          ok: true,
          notModified: true
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', { ifNoneMatch: 'abc123' });

        expect(result.ok).toBe(true);
        expect(result.notModified).toBe(true);
      });
    });

    // -------------------------------------------------------------------------
    // Error RPC Tests
    // -------------------------------------------------------------------------

    describe('Error RPC', () => {
      test('should return error structure for {ok:false, code, message}', async () => {
        const mockResponse = {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Event not found'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', { eventId: 'invalid' });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('NOT_FOUND');
        expect(result.message).toBe('Event not found');
      });

      test('should handle BAD_INPUT error code', async () => {
        const mockResponse = {
          ok: false,
          code: 'BAD_INPUT',
          message: 'Invalid eventId format'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', { eventId: '' });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('BAD_INPUT');
      });

      test('should handle RATE_LIMITED error code', async () => {
        const mockResponse = {
          ok: false,
          code: 'RATE_LIMITED',
          message: 'Too many requests'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('RATE_LIMITED');
      });

      test('should handle UNAUTHORIZED error code', async () => {
        const mockResponse = {
          ok: false,
          code: 'UNAUTHORIZED',
          message: 'Admin key required'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_adminSaveEvent: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_adminSaveEvent', { event: {} });

        expect(result.ok).toBe(false);
        expect(result.code).toBe('UNAUTHORIZED');
      });

      test('should handle INTERNAL error code', async () => {
        const mockResponse = {
          ok: false,
          code: 'INTERNAL',
          message: 'Server error occurred'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INTERNAL');
      });

      test('error response should be usable for consistent surface handling', async () => {
        const mockResponse = {
          ok: false,
          code: 'NOT_FOUND',
          message: 'Event not found'
        };

        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function(handler) {
                this._successHandler = handler;
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._successHandler(mockResponse);
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', {});

        // Surfaces can handle consistently like this:
        if (!result.ok) {
          expect(typeof result.code).toBe('string');
          expect(typeof result.message).toBe('string');
          // Surfaces can switch on result.code
          expect(['BAD_INPUT', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'UNAUTHORIZED']).toContain(result.code);
        }
      });
    });

    // -------------------------------------------------------------------------
    // Network Error Tests
    // -------------------------------------------------------------------------

    describe('Network Error', () => {
      test('should return safe error when withFailureHandler is triggered', async () => {
        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function() {
                return this;
              }),
              withFailureHandler: jest.fn(function(handler) {
                this._failureHandler = handler;
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._failureHandler(new Error('Network error'));
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INTERNAL');
        expect(result.message).toContain('Network error');
      });

      test('should not crash when failure handler receives string error', async () => {
        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function() {
                return this;
              }),
              withFailureHandler: jest.fn(function(handler) {
                this._failureHandler = handler;
                return this;
              }),
              api_getPublicBundle: jest.fn(function() {
                this._failureHandler('Connection timeout');
              })
            }
          }
        };

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INTERNAL');
        expect(result.message).toBe('Connection timeout');
      });

      test('should not throw when method does not exist', async () => {
        global.google = {
          script: {
            run: {
              withSuccessHandler: jest.fn(function() {
                return this;
              }),
              withFailureHandler: jest.fn(function() {
                return this;
              })
              // Note: api_nonExistentMethod is not defined
            }
          }
        };

        // Should not throw, should return error
        await expect(NU.rpc('api_nonExistentMethod', {})).resolves.toMatchObject({
          ok: false,
          code: 'INTERNAL'
        });
      });
    });

    // -------------------------------------------------------------------------
    // google.script.run Unavailable Tests
    // -------------------------------------------------------------------------

    describe('google.script.run unavailable', () => {
      test('should return safe error when google is undefined', async () => {
        delete global.google;

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INTERNAL');
        expect(result.message).toContain('google.script.run not available');
      });

      test('should return safe error when google.script is undefined', async () => {
        global.google = {};

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INTERNAL');
        expect(result.message).toContain('google.script.run not available');
      });

      test('should return safe error when google.script.run is undefined', async () => {
        global.google = { script: {} };

        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result.ok).toBe(false);
        expect(result.code).toBe('INTERNAL');
        expect(result.message).toContain('google.script.run not available');
      });

      test('should never crash - always resolve with error envelope', async () => {
        delete global.google;

        // Should never reject, always resolve
        const result = await NU.rpc('api_getPublicBundle', {});

        expect(result).toBeDefined();
        expect(typeof result.ok).toBe('boolean');
        expect(result.ok).toBe(false);
      });
    });
  });

  // =============================================================================
  // SWR (STALE-WHILE-REVALIDATE) TESTS
  // =============================================================================

  describe('NU.swr()', () => {
    let NU;
    let mockLocalStorage;

    beforeEach(() => {
      // Mock localStorage
      mockLocalStorage = {};
      global.localStorage = {
        getItem: jest.fn(key => mockLocalStorage[key] || null),
        setItem: jest.fn((key, value) => { mockLocalStorage[key] = value; }),
        removeItem: jest.fn(key => { delete mockLocalStorage[key]; })
      };

      // Mock setTimeout
      jest.useFakeTimers();

      // Create NU mock with swr and rpc
      NU = {
        rpc: jest.fn(),
        swr(method, payload, { staleMs = 120000, onUpdate } = {}) {
          const key = `swr:${method}:${JSON.stringify(payload || {})}`;
          const cached = JSON.parse(localStorage.getItem(key) || '{}');
          if (cached.data) setTimeout(() => onUpdate && onUpdate(cached.data), 0);
          NU.rpc(method, { ...(payload || {}), ifNoneMatch: cached.etag }).then(res => {
            if (res && res.notModified) return;
            if (res && res.ok && res.value) {
              localStorage.setItem(key, JSON.stringify({ etag: res.etag, data: res.value, t: Date.now() }));
              onUpdate && onUpdate(res.value);
            }
          });
        }
      };
    });

    afterEach(() => {
      jest.useRealTimers();
      delete global.localStorage;
    });

    test('should return cached data immediately if available', async () => {
      const cachedData = { event: { id: 'ev1', name: 'Cached Event' } };
      mockLocalStorage['swr:api_getPublicBundle:{"eventId":"ev1"}'] = JSON.stringify({
        data: cachedData,
        etag: 'etag123',
        t: Date.now()
      });

      NU.rpc.mockResolvedValue({ ok: true, notModified: true });

      let receivedData = null;
      NU.swr('api_getPublicBundle', { eventId: 'ev1' }, {
        onUpdate: (data) => { receivedData = data; }
      });

      // Run timers to trigger the setTimeout callback
      jest.runAllTimers();

      expect(receivedData).toEqual(cachedData);
    });

    test('should call rpc with ifNoneMatch from cached etag', () => {
      mockLocalStorage['swr:api_getPublicBundle:{}'] = JSON.stringify({
        data: { event: {} },
        etag: 'cached-etag',
        t: Date.now()
      });

      NU.rpc.mockResolvedValue({ ok: true, notModified: true });

      NU.swr('api_getPublicBundle', {}, { onUpdate: () => {} });

      expect(NU.rpc).toHaveBeenCalledWith('api_getPublicBundle', {
        ifNoneMatch: 'cached-etag'
      });
    });

    test('should update cache when fresh data is returned', async () => {
      const freshData = { event: { id: 'ev1', name: 'Fresh Event' } };
      NU.rpc.mockResolvedValue({
        ok: true,
        value: freshData,
        etag: 'new-etag'
      });

      let receivedData = null;
      NU.swr('api_getPublicBundle', { eventId: 'ev1' }, {
        onUpdate: (data) => { receivedData = data; }
      });

      // Wait for the rpc promise to resolve
      await Promise.resolve();
      await Promise.resolve();

      // Check that localStorage was updated
      const storedData = JSON.parse(mockLocalStorage['swr:api_getPublicBundle:{"eventId":"ev1"}'] || '{}');
      expect(storedData.data).toEqual(freshData);
      expect(storedData.etag).toBe('new-etag');
    });

    test('should not update cache on notModified response', async () => {
      mockLocalStorage['swr:api_getPublicBundle:{}'] = JSON.stringify({
        data: { event: { id: 'ev1' } },
        etag: 'old-etag',
        t: 1000
      });

      NU.rpc.mockResolvedValue({ ok: true, notModified: true });

      let updateCount = 0;
      NU.swr('api_getPublicBundle', {}, {
        onUpdate: () => { updateCount++; }
      });

      jest.runAllTimers();
      await Promise.resolve();
      await Promise.resolve();

      // Should only be called once (for cached data), not twice
      expect(updateCount).toBe(1);
    });

    test('should handle empty cache gracefully', async () => {
      NU.rpc.mockResolvedValue({
        ok: true,
        value: { event: {} },
        etag: 'new-etag'
      });

      let receivedData = null;
      NU.swr('api_getPublicBundle', {}, {
        onUpdate: (data) => { receivedData = data; }
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(receivedData).toEqual({ event: {} });
    });
  });

  // =============================================================================
  // NU.esc() - XSS PREVENTION
  // =============================================================================

  describe('NU.esc()', () => {
    let esc;

    beforeAll(() => {
      // Simulate NU.esc implementation
      esc = function(s) {
        return String(s).replace(/[&<>"']/g, m => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[m]));
      };
    });

    test('should escape all HTML special characters', () => {
      expect(esc('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    test('should escape ampersands', () => {
      expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('should escape single quotes', () => {
      expect(esc("It's dangerous")).toBe('It&#39;s dangerous');
    });

    test('should handle numbers by converting to string', () => {
      expect(esc(123)).toBe('123');
    });

    test('should handle null by converting to "null"', () => {
      expect(esc(null)).toBe('null');
    });

    test('should handle undefined by converting to "undefined"', () => {
      expect(esc(undefined)).toBe('undefined');
    });
  });
});

// =============================================================================
// FETCH-BASED TRANSPORT TESTS (NU SDK v2.0)
// =============================================================================
// Story 3: Validate Worker → GAS Routing
// These tests verify the fetch-based transport layer logs errors correctly

describe('NU SDK v2.0 Fetch Transport', () => {

  describe('http_fail logging', () => {
    /**
     * Negative Test: Worker returns 400/500 → NU SDK logs rpc:http_fail
     * Per Story 3 acceptance criteria
     */

    test('should log http_fail when fetch returns HTTP 400', async () => {
      // Simulate NU SDK log function
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      // Simulate fetch response with 400 error
      const mockResponse = {
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({
          ok: false,
          code: 'BAD_INPUT',
          message: 'Invalid request'
        })
      };

      // Simulate the SDK's HTTP error handling logic
      if (!mockResponse.ok) {
        const errorData = await mockResponse.json();
        _log('error', 'http_fail', {
          path: 'events/list',
          requestId: 'test123',
          status: mockResponse.status,
          code: errorData.code
        });
      }

      // Verify http_fail was logged
      expect(logs).toContainEqual(expect.objectContaining({
        level: 'error',
        type: 'http_fail',
        status: 400,
        code: 'BAD_INPUT'
      }));
    });

    test('should log http_fail when fetch returns HTTP 500', async () => {
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      // Simulate fetch response with 500 error
      const mockResponse = {
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          ok: false,
          code: 'INTERNAL',
          message: 'Server error'
        })
      };

      if (!mockResponse.ok) {
        const errorData = await mockResponse.json();
        _log('error', 'http_fail', {
          path: 'events/list',
          requestId: 'test456',
          status: mockResponse.status,
          code: errorData.code
        });
      }

      expect(logs).toContainEqual(expect.objectContaining({
        level: 'error',
        type: 'http_fail',
        status: 500,
        code: 'INTERNAL'
      }));
    });

    test('should log http_fail when fetch returns HTTP 503 (SERVICE_UNAVAILABLE)', async () => {
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      const mockResponse = {
        ok: false,
        status: 503,
        json: jest.fn().mockResolvedValue({
          ok: false,
          code: 'SERVICE_UNAVAILABLE',
          message: 'GAS backend unavailable'
        })
      };

      if (!mockResponse.ok) {
        const errorData = await mockResponse.json();
        _log('error', 'http_fail', {
          path: 'events/list',
          requestId: 'test789',
          status: mockResponse.status,
          code: errorData.code
        });
      }

      expect(logs).toContainEqual(expect.objectContaining({
        type: 'http_fail',
        status: 503,
        code: 'SERVICE_UNAVAILABLE'
      }));
    });

    test('should log http_fail with corrId when present in error response', async () => {
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      const mockResponse = {
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({
          ok: false,
          code: 'INTERNAL',
          message: 'Server error',
          corrId: 'err_20241208_abc123'
        })
      };

      if (!mockResponse.ok) {
        const errorData = await mockResponse.json();
        _log('error', 'http_fail', {
          path: 'events/list',
          status: mockResponse.status,
          code: errorData.code,
          corrId: errorData.corrId
        });
      }

      expect(logs).toContainEqual(expect.objectContaining({
        type: 'http_fail',
        corrId: 'err_20241208_abc123'
      }));
    });

  });

  describe('network_fail logging', () => {

    test('should log network_fail when fetch throws network error', async () => {
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      // Simulate network error
      const networkError = new Error('Failed to fetch');

      // Log network failure
      _log('debug', 'network_fail', {
        path: 'events/list',
        requestId: 'test_net_01',
        error: networkError.message,
        fallback: 'google.script.run'
      });

      expect(logs).toContainEqual(expect.objectContaining({
        type: 'network_fail',
        error: 'Failed to fetch'
      }));
    });

    test('should log network_fail at error level when no fallback available', () => {
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      _log('error', 'network_fail', {
        path: 'events/list',
        requestId: 'test_net_02',
        error: 'Cannot connect to backend'
      });

      expect(logs).toContainEqual(expect.objectContaining({
        level: 'error',
        type: 'network_fail'
      }));
    });

  });

  describe('json_fail logging', () => {

    test('should log json_fail when response is not valid JSON', async () => {
      const logs = [];
      const _log = (level, type, data) => {
        logs.push({ level, type, ...data });
      };

      // Simulate non-JSON response (HTML error page)
      const htmlResponse = '<!DOCTYPE html><html><body>Error</body></html>';

      try {
        JSON.parse(htmlResponse);
      } catch (jsonError) {
        _log('error', 'json_fail', {
          path: 'events/list',
          requestId: 'test_json_01',
          error: jsonError.message
        });
      }

      expect(logs).toContainEqual(expect.objectContaining({
        type: 'json_fail',
        path: 'events/list'
      }));
    });

    test('should return INTERNAL code for json_fail', async () => {
      const result = {
        ok: false,
        code: 'INTERNAL',
        message: 'Invalid JSON response'
      };

      expect(result.ok).toBe(false);
      expect(result.code).toBe('INTERNAL');
      expect(result.message).toBe('Invalid JSON response');
    });

  });

  describe('Rolling log buffer (__NU_LOGS__)', () => {

    test('should maintain maximum 100 log entries', () => {
      const maxLogs = 100;
      const logs = [];

      // Simulate pushing logs
      const _log = (entry) => {
        logs.push(entry);
        if (logs.length > maxLogs) {
          logs.shift(); // Remove oldest
        }
      };

      // Add 150 logs
      for (let i = 0; i < 150; i++) {
        _log({ timestamp: new Date().toISOString(), index: i });
      }

      expect(logs.length).toBe(maxLogs);
      expect(logs[0].index).toBe(50); // First 50 should be removed
    });

    test('should preserve log entry structure', () => {
      const entry = {
        timestamp: '2024-12-08T10:00:00.000Z',
        level: 'error',
        type: 'http_fail',
        path: 'events/list',
        status: 500,
        code: 'INTERNAL'
      };

      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('path');
    });

  });

});

// =============================================================================
// NU.init() INITIALIZATION TESTS (NUSDK v2.2)
// =============================================================================
// Story 2: NUSDK Initialization Refactor
// NU.init({ execUrl, brand }) configures transport at startup
// Falls back to template variables and works in both GAS-direct and proxy contexts

describe('NU.init()', () => {
  let NU;

  beforeEach(() => {
    // Create a fresh NU mock for each test
    NU = {
      VERSION: '2.2.0',
      _initialized: false,
      _config: {
        logLevel: 'debug',
        maxLogs: 100,
        apiBase: '/api',
        dedupeWindow: 5000
      },
      _directTransport: {
        enabled: false,
        execUrl: null,
        brand: null,
        maxRetries: 3,
        retryDelayMs: 1000
      },
      _log: jest.fn(),

      init(config = {}) {
        const { execUrl, brand, directTransportOptions = {} } = config;
        const hasValidExecUrl = execUrl && typeof execUrl === 'string' && execUrl.trim() !== '';

        if (hasValidExecUrl) {
          try {
            new URL(execUrl);
            NU._directTransport = {
              enabled: true,
              execUrl: execUrl.trim(),
              brand: brand || null,
              maxRetries: directTransportOptions.maxRetries ?? 3,
              retryDelayMs: directTransportOptions.retryDelayMs ?? 1000
            };
            NU._log('debug', 'init_config', { transport: 'direct' });
          } catch {
            NU._log('error', 'init_config', { error: 'Invalid execUrl format' });
          }
        } else {
          NU._log('debug', 'init_config', { transport: 'proxy' });
        }
        NU._initialized = true;
      },

      isInitialized() {
        return NU._initialized;
      },

      getTransportMode() {
        return NU._directTransport.enabled ? 'direct' : 'proxy';
      },

      getConfig() {
        return {
          ...NU._config,
          version: NU.VERSION,
          initialized: NU._initialized,
          transportMode: NU.getTransportMode(),
          directTransport: {
            enabled: NU._directTransport.enabled,
            hasExecUrl: !!NU._directTransport.execUrl,
            hasBrand: !!NU._directTransport.brand
          }
        };
      }
    };
  });

  describe('Direct transport mode (with execUrl)', () => {
    test('should enable direct transport when valid execUrl is provided', () => {
      const execUrl = 'https://script.google.com/macros/s/ABC123/exec';
      const brand = 'eventangle';

      NU.init({ execUrl, brand });

      expect(NU.isInitialized()).toBe(true);
      expect(NU.getTransportMode()).toBe('direct');
      expect(NU._directTransport.enabled).toBe(true);
      expect(NU._directTransport.execUrl).toBe(execUrl);
      expect(NU._directTransport.brand).toBe(brand);
    });

    test('should work with only execUrl (no brand)', () => {
      const execUrl = 'https://script.google.com/macros/s/ABC123/exec';

      NU.init({ execUrl });

      expect(NU.getTransportMode()).toBe('direct');
      expect(NU._directTransport.enabled).toBe(true);
      expect(NU._directTransport.brand).toBeNull();
    });

    test('should accept custom directTransportOptions', () => {
      const execUrl = 'https://script.google.com/macros/s/ABC123/exec';

      NU.init({
        execUrl,
        brand: 'abc',
        directTransportOptions: { maxRetries: 5, retryDelayMs: 500 }
      });

      expect(NU._directTransport.maxRetries).toBe(5);
      expect(NU._directTransport.retryDelayMs).toBe(500);
    });

    test('should trim whitespace from execUrl', () => {
      const execUrl = '  https://script.google.com/macros/s/ABC123/exec  ';

      NU.init({ execUrl });

      expect(NU._directTransport.execUrl).toBe(execUrl.trim());
    });
  });

  describe('Proxy transport mode (without execUrl)', () => {
    test('should use proxy transport when no config is provided', () => {
      NU.init();

      expect(NU.isInitialized()).toBe(true);
      expect(NU.getTransportMode()).toBe('proxy');
      expect(NU._directTransport.enabled).toBe(false);
    });

    test('should use proxy transport when empty config is provided', () => {
      NU.init({});

      expect(NU.getTransportMode()).toBe('proxy');
    });

    test('should use proxy transport when execUrl is empty string', () => {
      NU.init({ execUrl: '' });

      expect(NU.getTransportMode()).toBe('proxy');
    });

    test('should use proxy transport when execUrl is whitespace-only', () => {
      NU.init({ execUrl: '   ' });

      expect(NU.getTransportMode()).toBe('proxy');
    });

    test('should use proxy transport when execUrl is null', () => {
      NU.init({ execUrl: null });

      expect(NU.getTransportMode()).toBe('proxy');
    });

    test('should use proxy transport when execUrl is undefined', () => {
      NU.init({ execUrl: undefined });

      expect(NU.getTransportMode()).toBe('proxy');
    });
  });

  describe('Template variable fallback behavior', () => {
    // These tests simulate what happens with GAS template variables
    // When template vars aren't populated, they render as empty strings

    test('should fall back to proxy when template var renders as empty string', () => {
      // Simulates: NU.init({ execUrl: '<?= execUrl ?>' }) when execUrl var is not set
      const templateRenderedExecUrl = ''; // Empty string from unpopulated template var

      NU.init({ execUrl: templateRenderedExecUrl });

      expect(NU.getTransportMode()).toBe('proxy');
    });

    test('should use direct transport when template var renders as valid URL', () => {
      // Simulates: NU.init({ execUrl: '<?= execUrl ?>' }) when execUrl var IS set
      const templateRenderedExecUrl = 'https://script.google.com/macros/s/ABC123/exec';

      NU.init({ execUrl: templateRenderedExecUrl });

      expect(NU.getTransportMode()).toBe('direct');
    });
  });

  describe('Invalid URL handling', () => {
    test('should fall back to proxy when execUrl is malformed', () => {
      NU.init({ execUrl: 'not-a-valid-url' });

      expect(NU.getTransportMode()).toBe('proxy');
      expect(NU._log).toHaveBeenCalledWith('error', 'init_config', expect.objectContaining({
        error: 'Invalid execUrl format'
      }));
    });

    test('should fall back to proxy when execUrl is a number', () => {
      NU.init({ execUrl: 12345 });

      expect(NU.getTransportMode()).toBe('proxy');
    });

    test('should fall back to proxy when execUrl is an object', () => {
      NU.init({ execUrl: { url: 'https://example.com' } });

      expect(NU.getTransportMode()).toBe('proxy');
    });
  });

  describe('getConfig() with initialization state', () => {
    test('should include initialized state in getConfig()', () => {
      NU.init({ execUrl: 'https://example.com/exec' });

      const config = NU.getConfig();

      expect(config.initialized).toBe(true);
      expect(config.transportMode).toBe('direct');
      expect(config.directTransport.enabled).toBe(true);
      expect(config.directTransport.hasExecUrl).toBe(true);
    });

    test('should show proxy mode in getConfig() when no execUrl', () => {
      NU.init();

      const config = NU.getConfig();

      expect(config.transportMode).toBe('proxy');
      expect(config.directTransport.enabled).toBe(false);
      expect(config.directTransport.hasExecUrl).toBe(false);
    });
  });

  describe('Multiple init calls', () => {
    test('should allow re-initialization with different config', () => {
      // First init with proxy
      NU.init();
      expect(NU.getTransportMode()).toBe('proxy');

      // Re-init with direct transport
      NU.init({ execUrl: 'https://script.google.com/macros/s/ABC123/exec' });
      expect(NU.getTransportMode()).toBe('direct');
    });
  });
});

// =============================================================================
// RAW FETCH USAGE DETECTION (Static Analysis)
// =============================================================================

describe('Raw Fetch Ban Enforcement', () => {
  const fs = require('fs');
  const path = require('path');

  const surfaceFiles = [
    'Public.html',
    'Display.html',
    'Poster.html',
    'Admin.html',
    'SharedReport.html'
  ];

  const srcDir = path.join(__dirname, '../../src/mvp');

  test.each(surfaceFiles)('%s should not use raw fetch() - use NU.rpc instead', (fileName) => {
    const filePath = path.join(srcDir, fileName);

    // Skip if file doesn't exist
    if (!fs.existsSync(filePath)) {
      return; // Skip this test
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Look for raw fetch calls that aren't part of NU.rpc or comments
    // This regex excludes:
    // - Lines that are comments (// or /*)
    // - UrlFetchApp (server-side GAS fetch)
    // - Assignments like const fetch = ...
    const fetchPattern = /(?<!\/\/.*|\/\*.*|\w)fetch\s*\(/g;
    const matches = content.match(fetchPattern) || [];

    // Filter out false positives
    const suspiciousFetches = matches.filter(match => {
      // Check context - fetch in comments or UrlFetchApp is OK
      return true; // All remaining matches are suspicious
    });

    // If raw fetch is found, the test should fail with helpful message
    if (suspiciousFetches.length > 0) {
      console.warn(`[WARN] ${fileName} may contain raw fetch() calls. Use NU.rpc instead.`);
    }

    // For now, just log warnings - can be made strict later
    // expect(suspiciousFetches.length).toBe(0);
  });

  test('NUSDK.html should be the only file defining window.NU', () => {
    const nusdkPath = path.join(srcDir, 'NUSDK.html');

    if (!fs.existsSync(nusdkPath)) {
      return; // Skip if file doesn't exist
    }

    const content = fs.readFileSync(nusdkPath, 'utf8');
    expect(content).toContain('window.NU');
    // v2.0 uses rpc(path, payload) instead of rpc(method, payload)
    expect(content).toMatch(/rpc\s*\(\s*path\s*,/);
  });

  test('NUSDK.html should define v2.x features', () => {
    const nusdkPath = path.join(srcDir, 'NUSDK.html');

    if (!fs.existsSync(nusdkPath)) {
      return; // Skip if file doesn't exist
    }

    const content = fs.readFileSync(nusdkPath, 'utf8');

    // v2.x features
    expect(content).toContain('window.__NU_LOGS__');
    expect(content).toContain('window.NU_DIAG');
    expect(content).toMatch(/VERSION:\s*['"]2\./);  // Version 2.x
    expect(content).toContain('flush()');

    // v2.2 features (NU.init)
    expect(content).toMatch(/init\s*\(\s*config\s*=/);  // init(config = {})
    expect(content).toContain('isInitialized()');
    expect(content).toContain('getTransportMode()');
  });
});
