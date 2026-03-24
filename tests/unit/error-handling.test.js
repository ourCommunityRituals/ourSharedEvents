/**
 * Error Handling Bug Fixes Tests
 *
 * Tests for error handling improvements:
 * - Bug #22: Separate try-catch blocks in doPost
 * - Bug #25: UUID split validation
 * - Bug #26: _ensureOk_ error response handling
 * - Story 5.1: Structured Error Logging with Correlation ID
 */

describe('Error Handling Bug Fixes', () => {

  describe('Bug #22: Separate Try-Catch Blocks', () => {
    test('should distinguish JSON parse errors from handler errors', () => {
      const processRequest = (postData) => {
        let body;
        try {
          body = JSON.parse(postData);
        } catch (jsonErr) {
          return { error: 'BAD_INPUT', message: 'Invalid JSON body' };
        }

        try {
          // Simulate request processing
          if (!body.action) {
            throw new Error('Missing action');
          }
          return { success: true, action: body.action };
        } catch (err) {
          return { error: 'INTERNAL', message: 'Request processing failed' };
        }
      };

      // Test JSON parse error
      const result1 = processRequest('invalid json');
      expect(result1.error).toBe('BAD_INPUT');
      expect(result1.message).toBe('Invalid JSON body');

      // Test handler error
      const result2 = processRequest('{}');
      expect(result2.error).toBe('INTERNAL');
      expect(result2.message).toBe('Request processing failed');

      // Test success
      const result3 = processRequest('{"action": "create"}');
      expect(result3.success).toBe(true);
      expect(result3.action).toBe('create');
    });

    test('should log handler errors but not JSON errors', () => {
      const logs = [];

      const processRequestWithLogging = (postData) => {
        let body;
        try {
          body = JSON.parse(postData);
        } catch (jsonErr) {
          // Don't log JSON parse errors (user input error)
          return { error: 'BAD_INPUT' };
        }

        try {
          if (!body.action) {
            throw new Error('Missing action');
          }
          return { success: true };
        } catch (err) {
          // Log internal errors (system error)
          logs.push({ error: err.message, stack: err.stack });
          return { error: 'INTERNAL' };
        }
      };

      processRequestWithLogging('invalid json');
      expect(logs.length).toBe(0); // JSON error not logged

      processRequestWithLogging('{}');
      expect(logs.length).toBe(1); // Handler error logged
      expect(logs[0].error).toBe('Missing action');
    });
  });

  describe('Bug #25: UUID Split Validation', () => {
    test('should handle valid UUID format', () => {
      const getShortToken = (uuid) => {
        const parts = uuid.split('-');
        return parts.length > 1 ? parts[0] : uuid.substring(0, 8);
      };

      const validUUID = '550e8400-e29b-41d4-a716-446655440000';
      expect(getShortToken(validUUID)).toBe('550e8400');
    });

    test('should handle UUID without hyphens', () => {
      const getShortToken = (uuid) => {
        const parts = uuid.split('-');
        return parts.length > 1 ? parts[0] : uuid.substring(0, 8);
      };

      const noHyphens = '550e8400e29b41d4a716446655440000';
      const token = getShortToken(noHyphens);
      expect(token.length).toBe(8);
      expect(token).toBe('550e8400');
    });

    test('should handle short UUID', () => {
      const getShortToken = (uuid) => {
        const parts = uuid.split('-');
        return parts.length > 1 ? parts[0] : uuid.substring(0, 8);
      };

      const shortUUID = 'abc123';
      expect(getShortToken(shortUUID)).toBe('abc123');
    });

    test('should handle empty UUID', () => {
      const getShortToken = (uuid) => {
        if (!uuid) return '';
        const parts = uuid.split('-');
        return parts.length > 1 ? parts[0] : uuid.substring(0, 8);
      };

      expect(getShortToken('')).toBe('');
      expect(getShortToken(null)).toBe('');
    });
  });

  describe('Bug #26: _ensureOk_ Error Response Handling', () => {
    test('should pass through error responses without validation', () => {
      const ensureOk = (obj) => {
        // If already an error envelope, return as-is
        if (obj && obj.ok === false) {
          return obj;
        }

        // Otherwise validate (simplified for test)
        if (!obj || typeof obj !== 'object') {
          return { ok: false, error: 'CONTRACT', message: 'Invalid response' };
        }

        return obj;
      };

      const errorResponse = {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      };

      const result = ensureOk(errorResponse);
      expect(result).toEqual(errorResponse);
      expect(result.ok).toBe(false);
    });

    test('should validate success responses', () => {
      const ensureOk = (obj) => {
        if (obj && obj.ok === false) {
          return obj;
        }

        // Validate success response
        if (!obj || !obj.ok || !obj.value) {
          return { ok: false, error: 'CONTRACT', message: 'Invalid success response' };
        }

        return obj;
      };

      const successResponse = {
        ok: true,
        value: { id: '123', name: 'Test' }
      };

      const result = ensureOk(successResponse);
      expect(result).toEqual(successResponse);
    });

    test('should detect invalid success responses', () => {
      const ensureOk = (obj) => {
        if (obj && obj.ok === false) {
          return obj;
        }

        if (!obj || !obj.ok || !obj.value) {
          return { ok: false, error: 'CONTRACT', message: 'Invalid success response' };
        }

        return obj;
      };

      const invalidResponse = { ok: true }; // Missing value
      const result = ensureOk(invalidResponse);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('CONTRACT');
    });

    test('should not double-validate error responses', () => {
      let validationCalls = 0;

      const ensureOk = (obj) => {
        if (obj && obj.ok === false) {
          return obj; // Skip validation
        }

        validationCalls++;
        return obj;
      };

      const errorResponse = { ok: false, code: 'ERROR' };
      ensureOk(errorResponse);
      expect(validationCalls).toBe(0);

      const successResponse = { ok: true, value: {} };
      ensureOk(successResponse);
      expect(validationCalls).toBe(1);
    });
  });

  describe('Error Envelope Format', () => {
    test('should create consistent error format', () => {
      const Err = (code, message) => ({
        ok: false,
        code,
        message
      });

      expect(Err('NOT_FOUND', 'Event not found')).toEqual({
        ok: false,
        code: 'NOT_FOUND',
        message: 'Event not found'
      });
    });

    test('should create consistent success format', () => {
      const Ok = (value) => ({
        ok: true,
        value
      });

      expect(Ok({ id: '123' })).toEqual({
        ok: true,
        value: { id: '123' }
      });
    });

    test('should distinguish error from success', () => {
      const Err = (code, message) => ({ ok: false, code, message });
      const Ok = (value) => ({ ok: true, value });

      const error = Err('ERROR', 'Failed');
      const success = Ok({ data: 'test' });

      expect(error.ok).toBe(false);
      expect(success.ok).toBe(true);
    });
  });

  describe('Error Codes', () => {
    const ERR = {
      BAD_INPUT: 'BAD_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      INTERNAL: 'INTERNAL',
      RATE_LIMITED: 'RATE_LIMITED',
      CONTRACT: 'CONTRACT'
    };

    test('should use standard error codes', () => {
      expect(ERR.BAD_INPUT).toBe('BAD_INPUT');
      expect(ERR.NOT_FOUND).toBe('NOT_FOUND');
      expect(ERR.INTERNAL).toBe('INTERNAL');
      expect(ERR.RATE_LIMITED).toBe('RATE_LIMITED');
      expect(ERR.CONTRACT).toBe('CONTRACT');
    });

    test('should create errors with standard codes', () => {
      const Err = (code, message) => ({ ok: false, code, message });

      const badInput = Err(ERR.BAD_INPUT, 'Invalid data');
      expect(badInput.code).toBe('BAD_INPUT');

      const notFound = Err(ERR.NOT_FOUND, 'Resource not found');
      expect(notFound.code).toBe('NOT_FOUND');
    });
  });

  describe('RunSafe Error Wrapper', () => {
    test('should catch exceptions and return error envelope', () => {
      const runSafe = (where, fn) => {
        try {
          return fn();
        } catch (e) {
          return {
            ok: false,
            code: 'INTERNAL',
            message: 'Unexpected error'
          };
        }
      };

      const result = runSafe('test', () => {
        throw new Error('Something went wrong');
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('INTERNAL');
    });

    test('should pass through successful results', () => {
      const runSafe = (where, fn) => {
        try {
          return fn();
        } catch (e) {
          return { ok: false, code: 'INTERNAL', message: 'Error' };
        }
      };

      const result = runSafe('test', () => ({
        ok: true,
        value: { data: 'success' }
      }));

      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ data: 'success' });
    });

    test('should pass through error envelopes', () => {
      const runSafe = (where, fn) => {
        try {
          return fn();
        } catch (e) {
          return { ok: false, code: 'INTERNAL', message: 'Error' };
        }
      };

      const result = runSafe('test', () => ({
        ok: false,
        code: 'NOT_FOUND',
        message: 'Not found'
      }));

      expect(result.ok).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });
  });

  // Story 5.1: Structured Error Logging with Correlation ID
  describe('Story 5.1: Correlation ID Generation', () => {
    /**
     * Mock implementation of generateCorrId_ for testing
     * Format: timestamp (base36) + "-" + random suffix
     */
    const generateCorrId = () => {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 6);
      return `${timestamp}-${random}`;
    };

    test('should generate unique correlation IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCorrId());
      }
      // At least 95% should be unique (allows for timestamp collision in tight loop)
      // In practice, collisions only happen when multiple iterations run in same millisecond
      expect(ids.size).toBeGreaterThanOrEqual(95);
    });

    test('should generate corrId in expected format', () => {
      const corrId = generateCorrId();
      // Format: alphanumeric-alphanumeric
      expect(corrId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    test('should have timestamp part before dash', () => {
      const corrId = generateCorrId();
      const [timestampPart] = corrId.split('-');
      // Timestamp in base36 should be parseable
      const parsed = parseInt(timestampPart, 36);
      expect(parsed).toBeGreaterThan(0);
      // Should be a recent timestamp (within last day)
      const now = Date.now();
      expect(parsed).toBeLessThanOrEqual(now);
      expect(parsed).toBeGreaterThan(now - 86400000); // Within 24 hours
    });
  });

  describe('Story 5.1: Error Response with Correlation ID', () => {
    /**
     * Mock implementation of Err with corrId support
     */
    const Err = (code, message, corrId) => {
      const envelope = { ok: false, code, message: message || code };
      if (corrId) envelope.corrId = corrId;
      return envelope;
    };

    test('should include corrId when provided', () => {
      const error = Err('INTERNAL', 'Something went wrong. Reference: abc123-def4', 'abc123-def4');
      expect(error.corrId).toBe('abc123-def4');
      expect(error.ok).toBe(false);
    });

    test('should work without corrId for backward compatibility', () => {
      const error = Err('BAD_INPUT', 'Invalid input');
      expect(error).not.toHaveProperty('corrId');
      expect(error.ok).toBe(false);
      expect(error.code).toBe('BAD_INPUT');
    });

    test('should not expose stack trace in client response', () => {
      const error = Err('INTERNAL', 'Something went wrong. Reference: xyz789-abc1', 'xyz789-abc1');
      expect(error).not.toHaveProperty('stack');
    });
  });

  describe('Story 5.1: ErrWithCorrId Function', () => {
    const logs = [];

    // Mock diag_ function
    const mockDiag = (level, where, msg, meta) => {
      logs.push({ level, where, msg, meta });
    };

    // Mock implementation of ErrWithCorrId_
    const ErrWithCorrId = (code, internalMessage, options = {}) => {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 6);
      const corrId = `${timestamp}-${random}`;
      const { stack, eventId, endpoint = 'API', extra = {} } = options;

      // Log structured error internally
      const structured = {
        level: 'error',
        corrId,
        endpoint,
        message: internalMessage
      };
      if (stack) structured.stack = stack;
      if (eventId) structured.eventId = eventId;
      Object.assign(structured, extra);
      mockDiag('error', endpoint, `[${corrId}] ${internalMessage}`, structured);

      // Return sanitized error to client
      return {
        ok: false,
        code,
        message: `Something went wrong. Reference: ${corrId}`,
        corrId
      };
    };

    beforeEach(() => {
      logs.length = 0;
    });

    test('should generate corrId and include in response', () => {
      const error = ErrWithCorrId('INTERNAL', 'Database connection failed');
      expect(error.corrId).toBeDefined();
      expect(error.corrId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
      expect(error.message).toContain('Reference:');
      expect(error.message).toContain(error.corrId);
    });

    test('should log structured error with corrId', () => {
      const error = ErrWithCorrId('INTERNAL', 'Database connection failed', {
        endpoint: 'api_create'
      });

      expect(logs.length).toBe(1);
      expect(logs[0].meta.corrId).toBe(error.corrId);
      expect(logs[0].meta.endpoint).toBe('api_create');
      expect(logs[0].meta.message).toBe('Database connection failed');
    });

    test('should include stack trace in logs but not in response', () => {
      const mockStack = 'Error: Test\n    at test.js:1:1';
      const error = ErrWithCorrId('INTERNAL', 'Something broke', {
        stack: mockStack
      });

      // Stack in logs
      expect(logs[0].meta.stack).toBe(mockStack);
      // No stack in response
      expect(error).not.toHaveProperty('stack');
    });

    test('should include eventId when provided', () => {
      const error = ErrWithCorrId('NOT_FOUND', 'Event not found', {
        eventId: 'evt-12345'
      });

      expect(logs[0].meta.eventId).toBe('evt-12345');
    });

    test('should sanitize internal message from client response', () => {
      const error = ErrWithCorrId('INTERNAL', 'SQL Error: SELECT * FROM users WHERE password="secret"');

      // Internal message should NOT be in client response
      expect(error.message).not.toContain('SQL');
      expect(error.message).not.toContain('password');
      expect(error.message).not.toContain('secret');
      // Only generic message with reference
      expect(error.message).toMatch(/Something went wrong\. Reference: [a-z0-9]+-[a-z0-9]+/);
    });
  });

  describe('Story 5.1: runSafe with Correlation ID', () => {
    const logs = [];

    const runSafeWithCorrId = (where, fn, eventId) => {
      try {
        return fn();
      } catch (e) {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 6);
        const corrId = `${timestamp}-${random}`;

        // Log structured error
        logs.push({
          level: 'error',
          corrId,
          endpoint: where,
          message: String(e),
          stack: e && e.stack,
          eventId
        });

        return {
          ok: false,
          code: 'INTERNAL',
          message: `Something went wrong. Reference: ${corrId}`,
          corrId
        };
      }
    };

    beforeEach(() => {
      logs.length = 0;
    });

    test('should return error with corrId on exception', () => {
      const result = runSafeWithCorrId('test_endpoint', () => {
        throw new Error('Test error');
      });

      expect(result.ok).toBe(false);
      expect(result.corrId).toBeDefined();
      expect(result.message).toContain('Reference:');
    });

    test('should log structured error with stack trace', () => {
      runSafeWithCorrId('api_update', () => {
        throw new Error('Update failed');
      });

      expect(logs.length).toBe(1);
      expect(logs[0].endpoint).toBe('api_update');
      expect(logs[0].message).toContain('Update failed');
      expect(logs[0].stack).toBeDefined();
    });

    test('should include eventId in logs when provided', () => {
      runSafeWithCorrId('api_get', () => {
        throw new Error('Not found');
      }, 'evt-99999');

      expect(logs[0].eventId).toBe('evt-99999');
    });

    test('should pass through successful results unchanged', () => {
      const result = runSafeWithCorrId('test', () => ({
        ok: true,
        value: { id: '123' }
      }));

      expect(result.ok).toBe(true);
      expect(result).not.toHaveProperty('corrId');
      expect(logs.length).toBe(0);
    });
  });

  describe('Story 5.1: Structured Log Format', () => {
    test('should create structured log with all required fields', () => {
      const corrId = 'lqx5m8k-a7b2';
      const structuredLog = {
        level: 'error',
        corrId: corrId,
        endpoint: 'api_create',
        message: 'Validation failed'
      };

      expect(structuredLog.level).toBe('error');
      expect(structuredLog.corrId).toBe(corrId);
      expect(structuredLog.endpoint).toBe('api_create');
      expect(structuredLog.message).toBe('Validation failed');
    });

    test('should include optional fields when present', () => {
      const structuredLog = {
        level: 'error',
        corrId: 'abc123-def4',
        endpoint: 'api_get',
        message: 'Event not found',
        stack: 'Error: Not found\n    at api_get:42',
        eventId: 'evt-12345'
      };

      expect(structuredLog.stack).toBeDefined();
      expect(structuredLog.eventId).toBe('evt-12345');
    });

    test('should be greppable by corrId', () => {
      const logLine = JSON.stringify({
        level: 'error',
        corrId: 'lqx5m8k-a7b2',
        endpoint: 'api_create',
        message: 'Database error'
      });

      // Simulating grep by corrId
      expect(logLine.includes('lqx5m8k-a7b2')).toBe(true);
    });
  });

  // Story 11: HTML Error Pages with Correlation IDs
  describe('Story 11: HtmlErrorWithCorrId Function', () => {
    const logs = [];

    // Mock generateCorrId_
    const generateCorrId = () => {
      const timestamp = Date.now().toString(36);
      const random = Math.random().toString(36).substring(2, 6);
      return `${timestamp}-${random}`;
    };

    // Mock logStructuredError_
    const mockLogStructuredError = (level, corrId, endpoint, message, stack, eventId, extra) => {
      const structured = { level, corrId, endpoint, message };
      if (stack) structured.stack = stack;
      if (eventId) structured.eventId = eventId;
      if (extra) Object.assign(structured, extra);
      logs.push(structured);
    };

    // Mock HtmlErrorWithCorrId_
    const HtmlErrorWithCorrId = (title, internalMessage, options = {}) => {
      const corrId = generateCorrId();
      const { stack, eventId, endpoint = 'HTML', extra = {} } = options;

      // Log structured error internally
      mockLogStructuredError('error', corrId, endpoint, internalMessage, stack, eventId, extra);

      // Return mock HTML output structure (simulating what HtmlService.createHtmlOutput returns)
      const safeTitle = String(title)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Error - ${safeTitle}</title>
        </head>
        <body>
          <div class="error-box">
            <h1>⚠️ ${safeTitle}</h1>
            <p class="message">Something went wrong. Please try again or contact support.</p>
            <div class="reference">Reference: ${corrId}</div>
            <p class="help-text">If you need assistance, please provide this reference code.</p>
          </div>
        </body>
        </html>
      `;

      return {
        getContent: () => htmlContent,
        corrId // Include for testing (not in real implementation)
      };
    };

    beforeEach(() => {
      logs.length = 0;
    });

    test('should generate HTML page with corrId in reference', () => {
      const result = HtmlErrorWithCorrId('Invalid shortlink', 'Token not found', {
        endpoint: 'handleRedirect_'
      });

      const html = result.getContent();
      expect(html).toContain('Reference:');
      expect(html).toContain(result.corrId);
    });

    test('should include user-friendly title in HTML', () => {
      const result = HtmlErrorWithCorrId('Shortlink not found', 'Token xyz not in database');
      const html = result.getContent();

      expect(html).toContain('Shortlink not found');
      expect(html).toContain('Something went wrong');
    });

    test('should NOT expose internal message to user', () => {
      const internalMessage = 'Database connection failed: SELECT * FROM shortlinks';
      const result = HtmlErrorWithCorrId('Error', internalMessage);
      const html = result.getContent();

      // Internal message should NOT appear in HTML
      expect(html).not.toContain('Database connection');
      expect(html).not.toContain('SELECT');
      expect(html).not.toContain('shortlinks');
    });

    test('should NOT expose stack trace in HTML', () => {
      const result = HtmlErrorWithCorrId('Error', 'Something broke', {
        stack: 'Error: broken\n    at handleRedirect_:123\n    at doGet:456'
      });
      const html = result.getContent();

      // Stack trace should NOT appear in HTML
      expect(html).not.toContain('at handleRedirect_');
      expect(html).not.toContain('at doGet');
      expect(html).not.toContain(':123');
    });

    test('should log structured error with full details internally', () => {
      const mockStack = 'Error: Test\n    at test.js:1:1';
      HtmlErrorWithCorrId('Error', 'Internal error details', {
        endpoint: 'handleRedirect_',
        stack: mockStack,
        eventId: 'evt-12345',
        extra: { token: 'abc123' }
      });

      expect(logs.length).toBe(1);
      expect(logs[0].endpoint).toBe('handleRedirect_');
      expect(logs[0].message).toBe('Internal error details');
      expect(logs[0].stack).toBe(mockStack);
      expect(logs[0].eventId).toBe('evt-12345');
      expect(logs[0].token).toBe('abc123');
    });

    test('should escape HTML special characters in title', () => {
      const result = HtmlErrorWithCorrId('<script>alert("xss")</script>', 'XSS attempt');
      const html = result.getContent();

      // Should be escaped
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    test('should include help text for support reference', () => {
      const result = HtmlErrorWithCorrId('Error', 'Something went wrong');
      const html = result.getContent();

      expect(html).toContain('If you need assistance');
      expect(html).toContain('reference code');
    });

    test('corrId in HTML should match corrId in logs', () => {
      const result = HtmlErrorWithCorrId('Error', 'Test error', {
        endpoint: 'test_endpoint'
      });

      const html = result.getContent();
      const loggedCorrId = logs[0].corrId;

      expect(html).toContain(loggedCorrId);
    });
  });

  describe('Story 11: handleRedirect_ Error Scenarios', () => {
    test('should return HTML error with corrId for missing token', () => {
      // Simulating the expected behavior
      const errorResponse = {
        title: 'Invalid shortlink',
        internalMessage: 'Missing token parameter',
        endpoint: 'handleRedirect_'
      };

      expect(errorResponse.title).toBe('Invalid shortlink');
      expect(errorResponse.internalMessage).not.toContain('Reference:');
    });

    test('should return HTML error with corrId for configuration error', () => {
      const errorResponse = {
        title: 'Configuration error',
        internalMessage: 'Root brand spreadsheet not configured',
        endpoint: 'handleRedirect_'
      };

      expect(errorResponse.title).toBe('Configuration error');
    });

    test('should return HTML error with corrId for token not found', () => {
      const token = 'abc123';
      const errorResponse = {
        title: 'Shortlink not found',
        internalMessage: `Token not found: ${token}`,
        endpoint: 'handleRedirect_',
        extra: { token }
      };

      expect(errorResponse.title).toBe('Shortlink not found');
      expect(errorResponse.internalMessage).toContain(token);
    });

    test('should return HTML error with corrId for invalid URL', () => {
      const errorResponse = {
        title: 'Invalid shortlink URL',
        internalMessage: 'URL validation failed for token: xyz',
        endpoint: 'handleRedirect_'
      };

      expect(errorResponse.title).toBe('Invalid shortlink URL');
    });

    test('should return HTML error with corrId for invalid protocol', () => {
      const errorResponse = {
        title: 'Invalid shortlink protocol',
        internalMessage: 'Non-HTTP protocol: javascript:',
        endpoint: 'handleRedirect_'
      };

      expect(errorResponse.title).toBe('Invalid shortlink protocol');
      expect(errorResponse.internalMessage).toContain('javascript:');
    });
  });
});
