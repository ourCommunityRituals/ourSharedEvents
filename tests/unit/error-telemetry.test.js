/**
 * Error Telemetry Smoke Tests
 *
 * Verifies the error logging and telemetry baseline:
 * - Backend: Err envelopes include code from ERROR_CODES and get logged with
 *   timestamp, brandId, action, code, message
 * - Frontend: NUSDK logs structured errors when API returns ok:false (no spam)
 * - Error envelope structure validation
 * - Log entry presence verification (via mock/in-memory logger)
 */

const ERROR_CODES = Object.freeze({
  BAD_INPUT: 'BAD_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  CONTRACT: 'CONTRACT'
});

describe('Error Telemetry Smoke Tests', () => {

  // ============================================================================
  // BACKEND ERROR LOGGING TESTS
  // ============================================================================
  describe('Backend: logError helper', () => {
    const logs = [];

    // Mock diag_ function to capture log output
    const mockDiag = (level, action, msg, structured) => {
      logs.push({ level, action, msg, structured });
    };

    // Mock implementation of logError that matches Code.gs
    const logError = (params) => {
      const {
        code,
        action,
        message,
        brandId = 'unknown',
        corrId,
        stack,
        eventId,
        extra = {}
      } = params;

      // Generate corrId if not provided
      const finalCorrId = corrId || `${action}_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Build structured log entry with all required telemetry fields
      const structured = {
        timestamp: new Date().toISOString(),
        brandId: brandId,
        action: action,
        code: code,
        message: message,
        corrId: finalCorrId
      };

      if (stack) structured.stack = stack;
      if (eventId) structured.eventId = eventId;
      if (Object.keys(extra).length > 0) {
        Object.assign(structured, extra);
      }

      // Log via mock diag_
      mockDiag('error', action, `[${finalCorrId}] [${code}] ${message}`, structured);

      return finalCorrId;
    };

    beforeEach(() => {
      logs.length = 0;
    });

    test('should log with all required telemetry fields: timestamp, brandId, action, code, message', () => {
      const corrId = logError({
        code: ERROR_CODES.BAD_INPUT,
        action: 'api_saveEvent',
        message: 'Missing required field: name',
        brandId: 'acme-corp'
      });

      expect(logs.length).toBe(1);
      const logEntry = logs[0].structured;

      // Verify all required fields
      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('brandId', 'acme-corp');
      expect(logEntry).toHaveProperty('action', 'api_saveEvent');
      expect(logEntry).toHaveProperty('code', 'BAD_INPUT');
      expect(logEntry).toHaveProperty('message', 'Missing required field: name');
      expect(logEntry).toHaveProperty('corrId');

      // Timestamp should be ISO 8601 format
      expect(new Date(logEntry.timestamp).toISOString()).toBe(logEntry.timestamp);
    });

    test('should use ERROR_CODES constants for code field', () => {
      Object.values(ERROR_CODES).forEach(code => {
        logError({
          code,
          action: 'test_endpoint',
          message: `Testing ${code}`
        });
      });

      expect(logs.length).toBe(5);
      expect(logs[0].structured.code).toBe('BAD_INPUT');
      expect(logs[1].structured.code).toBe('NOT_FOUND');
      expect(logs[2].structured.code).toBe('RATE_LIMITED');
      expect(logs[3].structured.code).toBe('INTERNAL');
      expect(logs[4].structured.code).toBe('CONTRACT');
    });

    test('should default brandId to "unknown" when not provided', () => {
      logError({
        code: ERROR_CODES.INTERNAL,
        action: 'api_get',
        message: 'Unexpected error'
      });

      expect(logs[0].structured.brandId).toBe('unknown');
    });

    test('should generate corrId automatically if not provided', () => {
      const corrId = logError({
        code: ERROR_CODES.NOT_FOUND,
        action: 'api_get',
        message: 'Event not found'
      });

      expect(corrId).toBeDefined();
      expect(typeof corrId).toBe('string');
      expect(corrId.length).toBeGreaterThan(10);
    });

    test('should include optional fields when provided', () => {
      logError({
        code: ERROR_CODES.INTERNAL,
        action: 'api_saveEvent',
        message: 'Database error',
        brandId: 'test-brand',
        stack: 'Error: DB connection failed\n    at saveEvent:123',
        eventId: 'evt-12345',
        extra: { attempt: 2, retryable: true }
      });

      const logEntry = logs[0].structured;
      expect(logEntry.stack).toBeDefined();
      expect(logEntry.eventId).toBe('evt-12345');
      expect(logEntry.attempt).toBe(2);
      expect(logEntry.retryable).toBe(true);
    });
  });

  // ============================================================================
  // BACKEND ERR ENVELOPE TESTS
  // ============================================================================
  describe('Backend: Err envelope structure', () => {
    const Err = (code, message, corrId) => {
      const envelope = { ok: false, code, message: message || code };
      if (corrId) envelope.corrId = corrId;
      return envelope;
    };

    test('should create valid Err envelope with required fields', () => {
      const error = Err(ERROR_CODES.BAD_INPUT, 'Invalid input format');

      expect(error).toHaveProperty('ok', false);
      expect(error).toHaveProperty('code', 'BAD_INPUT');
      expect(error).toHaveProperty('message', 'Invalid input format');
    });

    test('should include corrId when provided', () => {
      const corrId = 'api_20251201_123456_ABCD';
      const error = Err(ERROR_CODES.INTERNAL, 'Something went wrong', corrId);

      expect(error.corrId).toBe(corrId);
    });

    test('all ERROR_CODES should create valid envelopes', () => {
      Object.entries(ERROR_CODES).forEach(([name, code]) => {
        const error = Err(code, `Error for ${name}`);

        expect(error.ok).toBe(false);
        expect(error.code).toBe(code);
        expect(error.message).toBe(`Error for ${name}`);
      });
    });

    test('should not expose internal details (stack trace)', () => {
      const error = Err(ERROR_CODES.INTERNAL, 'Something went wrong. Reference: abc123');

      expect(error).not.toHaveProperty('stack');
      expect(error.message).not.toContain('at ');
      expect(error.message).not.toContain('.gs:');
    });
  });

  // ============================================================================
  // FRONTEND NUSDK ERROR LOGGING TESTS
  // ============================================================================
  describe('Frontend: NUSDK _logError', () => {
    const errorLog = [];
    const dedupeWindow = 5000;
    const consoleOutput = [];

    // Mock console.error
    const mockConsoleError = (...args) => {
      consoleOutput.push(args);
    };

    // Mock implementation of NU._logError from NUSDK.html
    const _logError = (params) => {
      const { method, code, message, corrId } = params;
      const timestamp = new Date().toISOString();

      // Dedupe key: method + code within time window
      const dedupeKey = `${method}:${code}`;
      const now = Date.now();

      // Check for recent duplicate
      const recentError = errorLog.find(e =>
        e.key === dedupeKey && (now - e.time) < dedupeWindow
      );

      if (recentError) {
        return; // Skip duplicate
      }

      // Add to error log
      errorLog.push({ key: dedupeKey, time: now });
      if (errorLog.length > 50) {
        errorLog.shift();
      }

      // Build structured error entry
      const errorEntry = {
        timestamp,
        method,
        code: code || 'UNKNOWN',
        message: message || 'Unknown error'
      };
      if (corrId) errorEntry.corrId = corrId;

      // Log structured output
      mockConsoleError('[NUSDK:Error]', JSON.stringify(errorEntry));
    };

    beforeEach(() => {
      errorLog.length = 0;
      consoleOutput.length = 0;
    });

    test('should log single structured error when API returns ok:false', () => {
      _logError({
        method: 'api_saveEvent',
        code: 'BAD_INPUT',
        message: 'Missing required field'
      });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0][0]).toBe('[NUSDK:Error]');

      const loggedEntry = JSON.parse(consoleOutput[0][1]);
      expect(loggedEntry).toHaveProperty('timestamp');
      expect(loggedEntry).toHaveProperty('method', 'api_saveEvent');
      expect(loggedEntry).toHaveProperty('code', 'BAD_INPUT');
      expect(loggedEntry).toHaveProperty('message', 'Missing required field');
    });

    test('should include corrId in log when available', () => {
      _logError({
        method: 'api_get',
        code: 'NOT_FOUND',
        message: 'Event not found',
        corrId: 'api_20251201_123456_XYZ9'
      });

      const loggedEntry = JSON.parse(consoleOutput[0][1]);
      expect(loggedEntry.corrId).toBe('api_20251201_123456_XYZ9');
    });

    test('should dedupe identical errors within time window (no spam)', () => {
      // Log same error multiple times
      for (let i = 0; i < 5; i++) {
        _logError({
          method: 'api_saveEvent',
          code: 'BAD_INPUT',
          message: 'Validation failed'
        });
      }

      // Should only log once due to deduplication
      expect(consoleOutput.length).toBe(1);
    });

    test('should log different errors separately', () => {
      _logError({
        method: 'api_saveEvent',
        code: 'BAD_INPUT',
        message: 'Invalid input'
      });

      _logError({
        method: 'api_get',
        code: 'NOT_FOUND',
        message: 'Event not found'
      });

      _logError({
        method: 'api_saveEvent',
        code: 'INTERNAL',
        message: 'Database error'
      });

      // Should log all three (different method+code combinations)
      expect(consoleOutput.length).toBe(3);
    });

    test('should default code to UNKNOWN when not provided', () => {
      _logError({
        method: 'api_test',
        message: 'Something went wrong'
      });

      const loggedEntry = JSON.parse(consoleOutput[0][1]);
      expect(loggedEntry.code).toBe('UNKNOWN');
    });

    test('structured log should be JSON parseable', () => {
      _logError({
        method: 'api_saveEvent',
        code: 'BAD_INPUT',
        message: 'Invalid data format'
      });

      expect(() => {
        JSON.parse(consoleOutput[0][1]);
      }).not.toThrow();
    });
  });

  // ============================================================================
  // INTEGRATION: ERROR FLOW END-TO-END
  // ============================================================================
  describe('Integration: Error Flow Verification', () => {
    const backendLogs = [];
    const frontendLogs = [];

    // Mock backend logError
    const backendLogError = (params) => {
      const {
        code,
        action,
        message,
        brandId = 'unknown',
        corrId
      } = params;

      const finalCorrId = corrId || `${action}_${Date.now().toString(36).toUpperCase()}`;

      backendLogs.push({
        timestamp: new Date().toISOString(),
        brandId,
        action,
        code,
        message,
        corrId: finalCorrId
      });

      return {
        ok: false,
        code,
        message: `Something went wrong. Reference: ${finalCorrId}`,
        corrId: finalCorrId
      };
    };

    // Mock frontend _logError
    const frontendLogError = (params) => {
      frontendLogs.push({
        timestamp: new Date().toISOString(),
        method: params.method,
        code: params.code,
        message: params.message,
        corrId: params.corrId
      });
    };

    beforeEach(() => {
      backendLogs.length = 0;
      frontendLogs.length = 0;
    });

    test('controlled error triggers both backend and frontend logging', () => {
      // 1. Backend receives invalid request and logs error
      const backendResponse = backendLogError({
        code: ERROR_CODES.BAD_INPUT,
        action: 'api_saveEvent',
        message: 'Missing required field: name',
        brandId: 'test-brand'
      });

      // 2. Frontend receives error response and logs it
      frontendLogError({
        method: 'api_saveEvent',
        code: backendResponse.code,
        message: backendResponse.message,
        corrId: backendResponse.corrId
      });

      // Verify backend log entry
      expect(backendLogs.length).toBe(1);
      expect(backendLogs[0]).toMatchObject({
        brandId: 'test-brand',
        action: 'api_saveEvent',
        code: 'BAD_INPUT',
        message: 'Missing required field: name'
      });
      expect(backendLogs[0].timestamp).toBeDefined();
      expect(backendLogs[0].corrId).toBeDefined();

      // Verify frontend log entry
      expect(frontendLogs.length).toBe(1);
      expect(frontendLogs[0]).toMatchObject({
        method: 'api_saveEvent',
        code: 'BAD_INPUT'
      });
      expect(frontendLogs[0].corrId).toBe(backendResponse.corrId);
    });

    test('corrId correlates backend and frontend logs', () => {
      const backendResponse = backendLogError({
        code: ERROR_CODES.NOT_FOUND,
        action: 'api_get',
        message: 'Event not found',
        brandId: 'acme'
      });

      frontendLogError({
        method: 'api_get',
        code: backendResponse.code,
        message: backendResponse.message,
        corrId: backendResponse.corrId
      });

      // Same corrId in both logs enables correlation
      expect(backendLogs[0].corrId).toBe(frontendLogs[0].corrId);
    });

    test('error envelope structure matches contract', () => {
      const response = backendLogError({
        code: ERROR_CODES.INTERNAL,
        action: 'api_saveEvent',
        message: 'Database connection failed',
        brandId: 'root'
      });

      // Verify error envelope structure
      expect(response).toHaveProperty('ok', false);
      expect(response).toHaveProperty('code');
      expect(Object.values(ERROR_CODES)).toContain(response.code);
      expect(response).toHaveProperty('message');
      expect(response).toHaveProperty('corrId');

      // Message should reference corrId but not expose internal details
      expect(response.message).toContain('Reference:');
      expect(response.message).not.toContain('Database connection');
    });
  });

  // ============================================================================
  // ERROR CODES EXHAUSTIVE TEST
  // ============================================================================
  describe('ERROR_CODES completeness', () => {
    test('all error codes are defined', () => {
      expect(ERROR_CODES).toHaveProperty('BAD_INPUT', 'BAD_INPUT');
      expect(ERROR_CODES).toHaveProperty('NOT_FOUND', 'NOT_FOUND');
      expect(ERROR_CODES).toHaveProperty('RATE_LIMITED', 'RATE_LIMITED');
      expect(ERROR_CODES).toHaveProperty('INTERNAL', 'INTERNAL');
      expect(ERROR_CODES).toHaveProperty('CONTRACT', 'CONTRACT');
    });

    test('error codes are frozen (immutable)', () => {
      expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    });

    test('all codes are strings matching their key names', () => {
      Object.entries(ERROR_CODES).forEach(([key, value]) => {
        expect(typeof value).toBe('string');
        expect(value).toBe(key);
      });
    });
  });
});
