/**
 * SecurityMiddleware Unit Tests
 *
 * Integration-style tests for CSRF token flow:
 * - Token creation
 * - Token consumption on sensitive write requests
 * - Invalid token rejection with safe error envelope
 * - Reused token rejection
 * - LockService usage around token generation (no deadlock)
 *
 * @module tests/unit/security-middleware.test.js
 */

const {
  validateEnvelope,
  validateSuccessEnvelope,
  validateErrorEnvelope,
  ERROR_CODES
} = require('../shared/helpers/test.helpers');

describe('SecurityMiddleware', () => {
  // Constants matching SecurityMiddleware.gs
  const SECURITY_CONFIG = Object.freeze({
    CSRF_EXPIRY_SECONDS: 3600,        // 1 hour
    JWT_DEFAULT_EXPIRY: 3600,          // 1 hour
    RATE_MAX_PER_MIN: 10,              // Max requests per minute
    RATE_LOCKOUT_MINS: 15,             // Lockout duration
    MAX_FAILED_AUTH: 5,                // Max failed auth attempts
    LOCK_TIMEOUT_MS: 5000              // Lock acquisition timeout
  });

  const ERR = {
    BAD_INPUT: 'BAD_INPUT',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL: 'INTERNAL',
    RATE_LIMITED: 'RATE_LIMITED'
  };

  const Ok = (value) => ({ ok: true, value });
  const Err = (code, message) => ({ ok: false, code, message });

  // Mock objects
  let mockCache;
  let mockLock;
  let lockAcquired;
  let lockReleased;
  let lockAcquisitionDelay;

  // Implementation functions
  let SecurityMiddleware_generateCSRFToken;
  let SecurityMiddleware_validateCSRFToken;
  let SecurityMiddleware_sanitizeInput;
  let SecurityMiddleware_sanitizeId;
  let SecurityMiddleware_timingSafeCompare;
  let SecurityMiddleware_gate;
  let api_sensitiveWrite;

  beforeEach(() => {
    // Reset lock state
    lockAcquired = true;
    lockReleased = false;
    lockAcquisitionDelay = 0;

    // Mock cache
    mockCache = {
      data: {},
      put: jest.fn((key, value, ttl) => {
        mockCache.data[key] = { value, ttl };
      }),
      get: jest.fn((key) => mockCache.data[key]?.value || null),
      remove: jest.fn((key) => {
        delete mockCache.data[key];
      })
    };

    // Mock lock with realistic behavior
    mockLock = {
      tryLock: jest.fn((timeout) => {
        if (lockAcquisitionDelay > 0) {
          // Simulate delay (in real tests, this would be async)
        }
        return lockAcquired;
      }),
      releaseLock: jest.fn(() => {
        lockReleased = true;
      })
    };

    // Global mocks
    global.CacheService = {
      getUserCache: jest.fn(() => mockCache),
      getScriptCache: jest.fn(() => mockCache)
    };

    global.LockService = {
      getUserLock: jest.fn(() => mockLock)
    };

    global.Utilities = {
      getUuid: jest.fn(() => `csrf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
      computeHmacSha256Signature: jest.fn((data, secret) => {
        // Mock signature
        return [0x01, 0x02, 0x03, 0x04];
      }),
      base64EncodeWebSafe: jest.fn((data) => {
        if (typeof data === 'string') return Buffer.from(data).toString('base64');
        return 'mock-signature';
      }),
      base64Decode: jest.fn((data) => {
        return Buffer.from(data, 'base64');
      }),
      newBlob: jest.fn((data) => ({
        getDataAsString: () => data.toString()
      }))
    };

    global.diag_ = jest.fn();

    // Implementation: Generate CSRF Token
    SecurityMiddleware_generateCSRFToken = () => {
      const token = Utilities.getUuid();
      const cache = CacheService.getUserCache();
      cache.put('csrf_' + token, '1', SECURITY_CONFIG.CSRF_EXPIRY_SECONDS);
      return token;
    };

    // Implementation: Validate CSRF Token with LockService
    SecurityMiddleware_validateCSRFToken = (token) => {
      if (!token || typeof token !== 'string') return false;

      const lock = LockService.getUserLock();
      try {
        // Acquire lock with timeout
        if (!lock.tryLock(SECURITY_CONFIG.LOCK_TIMEOUT_MS)) {
          diag_('warn', 'SecurityMiddleware_validateCSRFToken', 'Failed to acquire lock',
            { token: token.substring(0, 8) + '...' });
          return false;
        }

        const cache = CacheService.getUserCache();
        const valid = cache.get('csrf_' + token);

        if (valid) {
          cache.remove('csrf_' + token); // One-time use (atomic)
          return true;
        }
        return false;
      } finally {
        try {
          lock.releaseLock();
        } catch (e) {
          // Lock might have expired, ignore
        }
      }
    };

    // Implementation: Timing-safe string comparison
    SecurityMiddleware_timingSafeCompare = (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
      }

      const aLen = a.length;
      const bLen = b.length;
      let result = aLen === bLen ? 0 : 1;

      const maxLen = Math.max(aLen, bLen);
      for (let i = 0; i < maxLen; i++) {
        const aChar = i < aLen ? a.charCodeAt(i) : 0;
        const bChar = i < bLen ? b.charCodeAt(i) : 0;
        result |= aChar ^ bChar;
      }

      return result === 0;
    };

    // Implementation: Input sanitization
    SecurityMiddleware_sanitizeInput = (input, maxLength = 1000) => {
      if (!input || typeof input !== 'string') return '';

      let sanitized = String(input)
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();

      sanitized = sanitized
        .replace(/[<>"'`&]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/data:/gi, '')
        .replace(/vbscript:/gi, '');

      let previousLength;
      do {
        previousLength = sanitized.length;
        sanitized = sanitized.replace(/on\w+=/gi, '');
      } while (sanitized.length !== previousLength);

      sanitized = sanitized
        .replace(/&#/g, '')
        .replace(/\\x/g, '')
        .replace(/\\u/g, '');

      return sanitized.slice(0, maxLength);
    };

    // Implementation: ID sanitization
    SecurityMiddleware_sanitizeId = (id) => {
      if (!id || typeof id !== 'string') return null;
      if (!/^[a-zA-Z0-9-_]{1,100}$/.test(id)) return null;
      return id;
    };

    // Implementation: Rate limiting and auth gate
    SecurityMiddleware_gate = (brandId, adminKey, ipAddress = null) => {
      const cache = CacheService.getScriptCache();

      // Check for lockout
      if (ipAddress) {
        const failKey = `auth_fail:${brandId}:${ipAddress}`;
        const fails = Number(cache.get(failKey) || '0');

        if (fails >= SECURITY_CONFIG.MAX_FAILED_AUTH) {
          return Err(ERR.RATE_LIMITED,
            `Too many failed authentication attempts. Try again in ${SECURITY_CONFIG.RATE_LOCKOUT_MINS} minutes.`);
        }
      }

      // Mock brand lookup
      const brand = brandId === 'valid-brand' ? { id: brandId, secret: 'correct-secret' } : null;
      if (!brand) return Err(ERR.NOT_FOUND, 'Unknown brand');

      const brandSecret = brand.secret;

      // Validate admin key
      if (brandSecret && adminKey !== brandSecret) {
        if (ipAddress) {
          const failKey = `auth_fail:${brandId}:${ipAddress}`;
          const fails = Number(cache.get(failKey) || '0');
          cache.put(failKey, String(fails + 1), SECURITY_CONFIG.RATE_LOCKOUT_MINS * 60);
        }
        return Err(ERR.BAD_INPUT, 'Invalid admin key');
      }

      // Check rate limit
      const rateLimitKey = `rate:${brandId}`;
      const count = Number(cache.get(rateLimitKey) || '0');

      if (count >= SECURITY_CONFIG.RATE_MAX_PER_MIN) {
        return Err(ERR.RATE_LIMITED, `Too many requests. Maximum ${SECURITY_CONFIG.RATE_MAX_PER_MIN} per minute.`);
      }

      cache.put(rateLimitKey, String(count + 1), 60);

      return Ok({ brand });
    };

    // Implementation: Sensitive write API (requires CSRF token)
    api_sensitiveWrite = (params) => {
      const { csrfToken, data, brandId, adminKey } = params || {};

      // Validate CSRF token first
      if (!csrfToken) {
        return Err(ERR.BAD_INPUT, 'Missing CSRF token');
      }

      if (!SecurityMiddleware_validateCSRFToken(csrfToken)) {
        return Err(ERR.BAD_INPUT, 'Invalid or expired CSRF token');
      }

      // Validate authentication
      const gateResult = SecurityMiddleware_gate(brandId, adminKey);
      if (!gateResult.ok) return gateResult;

      // Sanitize input data
      const sanitizedData = SecurityMiddleware_sanitizeInput(data, 5000);

      // Perform the write operation
      return Ok({
        success: true,
        message: 'Write operation completed',
        data: sanitizedData
      });
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // C. SecurityMiddleware Tests - CSRF Token Creation
  // =========================================================================

  describe('CSRF Token Creation', () => {

    test('should generate unique CSRF token', () => {
      const token1 = SecurityMiddleware_generateCSRFToken();
      const token2 = SecurityMiddleware_generateCSRFToken();

      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(typeof token1).toBe('string');
      expect(token1).not.toBe(token2);
    });

    test('should store token in cache with correct TTL', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      expect(mockCache.put).toHaveBeenCalledWith(
        `csrf_${token}`,
        '1',
        SECURITY_CONFIG.CSRF_EXPIRY_SECONDS
      );
    });

    test('should generate token using Utilities.getUuid', () => {
      SecurityMiddleware_generateCSRFToken();

      expect(Utilities.getUuid).toHaveBeenCalled();
    });

    test('should store token with 1-hour expiry (3600 seconds)', () => {
      SecurityMiddleware_generateCSRFToken();

      expect(mockCache.put).toHaveBeenCalledWith(
        expect.stringContaining('csrf_'),
        '1',
        3600
      );
    });

    test('should generate token with sufficient entropy', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      // UUID format has sufficient entropy
      expect(token.length).toBeGreaterThan(20);
    });
  });

  // =========================================================================
  // C. SecurityMiddleware Tests - Token Consumption on Sensitive Write
  // =========================================================================

  describe('Token Consumption on Sensitive Write Request', () => {

    test('should accept valid CSRF token on write request', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      const result = api_sensitiveWrite({
        csrfToken: token,
        data: 'Test data',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(true);
      expect(result.value.success).toBe(true);
    });

    test('should consume token after successful validation', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      // First use should succeed
      const result1 = api_sensitiveWrite({
        csrfToken: token,
        data: 'First write',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result1.ok).toBe(true);
      expect(mockCache.remove).toHaveBeenCalledWith(`csrf_${token}`);
    });

    test('should acquire lock before validating token', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      api_sensitiveWrite({
        csrfToken: token,
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(LockService.getUserLock).toHaveBeenCalled();
      expect(mockLock.tryLock).toHaveBeenCalledWith(SECURITY_CONFIG.LOCK_TIMEOUT_MS);
    });

    test('should release lock after validation', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      api_sensitiveWrite({
        csrfToken: token,
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(mockLock.releaseLock).toHaveBeenCalled();
    });

    test('should sanitize data before writing', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      const result = api_sensitiveWrite({
        csrfToken: token,
        data: '<script>alert("xss")</script>',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(true);
      expect(result.value.data).not.toContain('<script>');
    });
  });

  // =========================================================================
  // C. SecurityMiddleware Tests - Invalid Token Rejection
  // =========================================================================

  describe('Invalid Token Rejection with Safe Error Envelope', () => {

    test('should reject request with invalid CSRF token', () => {
      const result = api_sensitiveWrite({
        csrfToken: 'invalid-token',
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('CSRF token');
    });

    test('should reject request with missing CSRF token', () => {
      const result = api_sensitiveWrite({
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('Missing CSRF token');
    });

    test('should return safe error envelope (no internal details)', () => {
      const result = api_sensitiveWrite({
        csrfToken: 'malicious-attempt',
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBeDefined();
      expect(result.message).toBeDefined();
      // Should not contain internal implementation details
      expect(result.message).not.toContain('cache');
      expect(result.message).not.toContain('lock');
      expect(result.message).not.toContain('internal');
    });

    test('should reject null CSRF token', () => {
      const result = api_sensitiveWrite({
        csrfToken: null,
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(false);
    });

    test('should reject empty string CSRF token', () => {
      const result = api_sensitiveWrite({
        csrfToken: '',
        data: 'Test',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(false);
    });

    test('should reject non-string CSRF token', () => {
      const result = SecurityMiddleware_validateCSRFToken(12345);
      expect(result).toBe(false);
    });

    test('should reject object as CSRF token', () => {
      const result = SecurityMiddleware_validateCSRFToken({ token: 'value' });
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // C. SecurityMiddleware Tests - Reused Token Rejection
  // =========================================================================

  describe('Reused Token Rejection', () => {

    test('should reject reused CSRF token (one-time use)', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      // First use
      const result1 = api_sensitiveWrite({
        csrfToken: token,
        data: 'First write',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      // Second use (should fail)
      const result2 = api_sensitiveWrite({
        csrfToken: token,
        data: 'Second write',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(false);
      validateErrorEnvelope(result2, ERR.BAD_INPUT);
    });

    test('should remove token from cache after first use', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      SecurityMiddleware_validateCSRFToken(token);

      // Verify token was removed
      expect(mockCache.remove).toHaveBeenCalledWith(`csrf_${token}`);
    });

    test('should not allow third use of token', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      // Use token three times
      const result1 = SecurityMiddleware_validateCSRFToken(token);
      const result2 = SecurityMiddleware_validateCSRFToken(token);
      const result3 = SecurityMiddleware_validateCSRFToken(token);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    test('should atomically remove token to prevent race conditions', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      // Simulate concurrent validation
      const validations = [];
      for (let i = 0; i < 5; i++) {
        validations.push(SecurityMiddleware_validateCSRFToken(token));
      }

      // Only the first should succeed
      const successCount = validations.filter(v => v === true).length;
      expect(successCount).toBe(1);
    });
  });

  // =========================================================================
  // C. SecurityMiddleware Tests - LockService Usage (No Deadlock)
  // =========================================================================

  describe('LockService Usage - No Deadlock or Throw', () => {

    test('should use LockService.getUserLock for CSRF validation', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      SecurityMiddleware_validateCSRFToken(token);

      expect(LockService.getUserLock).toHaveBeenCalled();
    });

    test('should call tryLock with correct timeout', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      SecurityMiddleware_validateCSRFToken(token);

      expect(mockLock.tryLock).toHaveBeenCalledWith(5000); // LOCK_TIMEOUT_MS
    });

    test('should release lock in finally block (no deadlock)', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      SecurityMiddleware_validateCSRFToken(token);

      expect(mockLock.releaseLock).toHaveBeenCalled();
    });

    test('should release lock even if cache.get throws', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      // Make cache.get throw
      mockCache.get.mockImplementation(() => {
        throw new Error('Cache error');
      });

      try {
        SecurityMiddleware_validateCSRFToken(token);
      } catch (e) {
        // Expected
      }

      // Lock should still be released
      expect(mockLock.releaseLock).toHaveBeenCalled();
    });

    test('should return false if lock cannot be acquired', () => {
      lockAcquired = false;

      const token = SecurityMiddleware_generateCSRFToken();
      const result = SecurityMiddleware_validateCSRFToken(token);

      expect(result).toBe(false);
    });

    test('should log warning if lock acquisition fails', () => {
      lockAcquired = false;

      const token = SecurityMiddleware_generateCSRFToken();
      SecurityMiddleware_validateCSRFToken(token);

      expect(global.diag_).toHaveBeenCalledWith(
        'warn',
        'SecurityMiddleware_validateCSRFToken',
        'Failed to acquire lock',
        expect.any(Object)
      );
    });

    test('should handle lock.releaseLock throwing without crashing', () => {
      const token = SecurityMiddleware_generateCSRFToken();

      mockLock.releaseLock.mockImplementation(() => {
        throw new Error('Lock expired');
      });

      // Should not throw
      expect(() => {
        SecurityMiddleware_validateCSRFToken(token);
      }).not.toThrow();
    });

    test('should not deadlock with multiple sequential validations', () => {
      const tokens = [];
      for (let i = 0; i < 10; i++) {
        tokens.push(SecurityMiddleware_generateCSRFToken());
      }

      // Validate all tokens sequentially
      const results = tokens.map(t => SecurityMiddleware_validateCSRFToken(t));

      // All should succeed (each token used once)
      expect(results.every(r => r === true)).toBe(true);

      // Lock should have been acquired and released 10 times
      expect(mockLock.tryLock).toHaveBeenCalledTimes(10);
      expect(mockLock.releaseLock).toHaveBeenCalledTimes(10);
    });

    test('should not hold lock if validation fails early', () => {
      // Token not in cache
      const result = SecurityMiddleware_validateCSRFToken('non-existent-token');

      expect(result).toBe(false);
      expect(mockLock.releaseLock).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Additional SecurityMiddleware Tests
  // =========================================================================

  describe('SecurityMiddleware_sanitizeInput', () => {

    test('should remove HTML tags', () => {
      const result = SecurityMiddleware_sanitizeInput('<script>alert(1)</script>');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    test('should remove javascript: protocol', () => {
      const result = SecurityMiddleware_sanitizeInput('javascript:alert(1)');
      expect(result).not.toContain('javascript:');
    });

    test('should remove event handlers', () => {
      const result = SecurityMiddleware_sanitizeInput('onclick=alert(1)');
      expect(result).not.toContain('onclick=');
    });

    test('should handle nested event handlers', () => {
      const result = SecurityMiddleware_sanitizeInput('ononclick==alert(1)');
      expect(result).not.toContain('onclick=');
    });

    test('should respect max length', () => {
      const longString = 'a'.repeat(2000);
      const result = SecurityMiddleware_sanitizeInput(longString, 100);
      expect(result.length).toBe(100);
    });

    test('should return empty string for null input', () => {
      const result = SecurityMiddleware_sanitizeInput(null);
      expect(result).toBe('');
    });

    test('should trim whitespace', () => {
      const result = SecurityMiddleware_sanitizeInput('  test  ');
      expect(result).toBe('test');
    });
  });

  describe('SecurityMiddleware_sanitizeId', () => {

    test('should accept valid alphanumeric ID', () => {
      const result = SecurityMiddleware_sanitizeId('abc123');
      expect(result).toBe('abc123');
    });

    test('should accept UUID format', () => {
      const result = SecurityMiddleware_sanitizeId('550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    test('should accept underscore in ID', () => {
      const result = SecurityMiddleware_sanitizeId('test_id_123');
      expect(result).toBe('test_id_123');
    });

    test('should reject special characters', () => {
      expect(SecurityMiddleware_sanitizeId('test@id')).toBeNull();
      expect(SecurityMiddleware_sanitizeId('test.id')).toBeNull();
      expect(SecurityMiddleware_sanitizeId('test/id')).toBeNull();
    });

    test('should reject SQL injection attempts', () => {
      expect(SecurityMiddleware_sanitizeId("1' OR '1'='1")).toBeNull();
      expect(SecurityMiddleware_sanitizeId("1; DROP TABLE")).toBeNull();
    });

    test('should reject IDs over 100 characters', () => {
      const longId = 'a'.repeat(101);
      expect(SecurityMiddleware_sanitizeId(longId)).toBeNull();
    });

    test('should reject null and undefined', () => {
      expect(SecurityMiddleware_sanitizeId(null)).toBeNull();
      expect(SecurityMiddleware_sanitizeId(undefined)).toBeNull();
    });
  });

  describe('SecurityMiddleware_timingSafeCompare', () => {

    test('should return true for identical strings', () => {
      expect(SecurityMiddleware_timingSafeCompare('abc', 'abc')).toBe(true);
    });

    test('should return false for different strings', () => {
      expect(SecurityMiddleware_timingSafeCompare('abc', 'def')).toBe(false);
    });

    test('should return false for different lengths', () => {
      expect(SecurityMiddleware_timingSafeCompare('abc', 'abcd')).toBe(false);
    });

    test('should return false for non-string inputs', () => {
      expect(SecurityMiddleware_timingSafeCompare(null, 'abc')).toBe(false);
      expect(SecurityMiddleware_timingSafeCompare('abc', 123)).toBe(false);
    });

    test('should handle empty strings', () => {
      expect(SecurityMiddleware_timingSafeCompare('', '')).toBe(true);
      expect(SecurityMiddleware_timingSafeCompare('', 'a')).toBe(false);
    });
  });

  describe('SecurityMiddleware_gate (Rate Limiting)', () => {

    test('should allow valid authentication', () => {
      const result = SecurityMiddleware_gate('valid-brand', 'correct-secret');

      expect(result.ok).toBe(true);
      expect(result.value.brand).toBeDefined();
    });

    test('should reject invalid admin key', () => {
      const result = SecurityMiddleware_gate('valid-brand', 'wrong-secret');

      validateErrorEnvelope(result, ERR.BAD_INPUT);
      expect(result.message).toContain('Invalid admin key');
    });

    test('should reject unknown brand', () => {
      const result = SecurityMiddleware_gate('unknown-brand', 'any-key');

      validateErrorEnvelope(result, ERR.NOT_FOUND);
      expect(result.message).toContain('Unknown brand');
    });

    test('should track failed authentication attempts', () => {
      const ip = '192.168.1.1';

      // Fail 5 times
      for (let i = 0; i < 5; i++) {
        SecurityMiddleware_gate('valid-brand', 'wrong-secret', ip);
      }

      // 6th attempt should be rate limited
      const result = SecurityMiddleware_gate('valid-brand', 'correct-secret', ip);

      validateErrorEnvelope(result, ERR.RATE_LIMITED);
      expect(result.message).toContain('Too many failed authentication attempts');
    });

    test('should enforce rate limit per brand', () => {
      // Make 10 requests
      for (let i = 0; i < 10; i++) {
        SecurityMiddleware_gate('valid-brand', 'correct-secret');
      }

      // 11th request should be rate limited
      const result = SecurityMiddleware_gate('valid-brand', 'correct-secret');

      validateErrorEnvelope(result, ERR.RATE_LIMITED);
      expect(result.message).toContain('Too many requests');
    });

    test('should increment request count in cache', () => {
      SecurityMiddleware_gate('valid-brand', 'correct-secret');

      expect(mockCache.put).toHaveBeenCalledWith(
        'rate:valid-brand',
        expect.any(String),
        60
      );
    });
  });

  describe('Integration: Full CSRF Flow', () => {

    test('should complete full CSRF-protected write flow', () => {
      // Step 1: Generate token
      const token = SecurityMiddleware_generateCSRFToken();
      expect(token).toBeDefined();

      // Step 2: Perform write with token
      const result = api_sensitiveWrite({
        csrfToken: token,
        data: 'Protected data',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(true);
      expect(result.value.success).toBe(true);

      // Step 3: Verify token is consumed
      const reuse = api_sensitiveWrite({
        csrfToken: token,
        data: 'Attempted reuse',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(reuse.ok).toBe(false);
    });

    test('should reject write without prior token generation', () => {
      const result = api_sensitiveWrite({
        csrfToken: 'made-up-token',
        data: 'Suspicious data',
        brandId: 'valid-brand',
        adminKey: 'correct-secret'
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(ERR.BAD_INPUT);
    });

    test('should maintain security with multiple concurrent tokens', () => {
      // Generate multiple tokens
      const tokens = [
        SecurityMiddleware_generateCSRFToken(),
        SecurityMiddleware_generateCSRFToken(),
        SecurityMiddleware_generateCSRFToken()
      ];

      // Use each token once
      const results = tokens.map(token =>
        api_sensitiveWrite({
          csrfToken: token,
          data: `Data for ${token}`,
          brandId: 'valid-brand',
          adminKey: 'correct-secret'
        })
      );

      // All should succeed
      expect(results.every(r => r.ok === true)).toBe(true);

      // None should work a second time
      const retries = tokens.map(token =>
        api_sensitiveWrite({
          csrfToken: token,
          data: 'Retry',
          brandId: 'valid-brand',
          adminKey: 'correct-secret'
        })
      );

      expect(retries.every(r => r.ok === false)).toBe(true);
    });
  });
});
