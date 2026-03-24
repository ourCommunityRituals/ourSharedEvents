/**
 * Security Middleware Service
 *
 * Centralizes all security-related operations:
 * - JWT token generation and verification
 * - CSRF protection
 * - Multi-method authentication (adminKey, JWT, API Key)
 * - Rate limiting
 * - Input sanitization
 * - Brand isolation
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * [MVP] SECURITY ASSUMPTIONS - EXPLICIT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * MVP runs as ANYONE_ANONYMOUS (Google Apps Script web app setting).
 * Security is environment + secret link, NOT identity-based:
 *
 *   1. Admin access:  brandId + adminKey (shared secret in URL)
 *   2. Public access: No auth required (read-only views)
 *   3. Report access: Secret link with brandId (obscured, not authenticated)
 *
 * This file validates adminKey for mutating operations but does NOT:
 *   - Verify user identity
 *   - Check OAuth tokens
 *   - Enforce per-user permissions
 *
 * V2+ will add proper identity (Google Sign-In, JWT refresh tokens).
 *
 * EVERY MUTATING API must call SecurityMiddleware functions:
 *   - api_create       → SecurityMiddleware_validateAuth
 *   - api_update*      → SecurityMiddleware_validateAuth
 *   - api_delete       → SecurityMiddleware_validateAuth
 *   - api_createForm*  → SecurityMiddleware_validateAuth
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Design principles:
 * - Single responsibility for security concerns
 * - Fail-secure by default
 * - Constant-time operations for sensitive comparisons
 * - Comprehensive logging for security events
 *
 * @module SecurityMiddleware
 */

// === Constants ============================================================
const SECURITY_CONFIG = Object.freeze({
  CSRF_EXPIRY_SECONDS: 3600,        // 1 hour
  JWT_DEFAULT_EXPIRY: 3600,          // 1 hour
  RATE_MAX_PER_MIN: 10,              // Max requests per minute
  RATE_LOCKOUT_MINS: 15,             // Lockout duration
  MAX_FAILED_AUTH: 5,                // Max failed auth attempts
  LOCK_TIMEOUT_MS: 5000              // Lock acquisition timeout
});

// === CSRF Protection ======================================================

/**
 * Generate a CSRF token and store it in user cache
 * @returns {string} UUID-based CSRF token
 */
function SecurityMiddleware_generateCSRFToken() {
  const token = Utilities.getUuid();
  const cache = CacheService.getUserCache();
  cache.put('csrf_' + token, '1', SECURITY_CONFIG.CSRF_EXPIRY_SECONDS);
  return token;
}

/**
 * Validate and consume a CSRF token (one-time use)
 * Uses LockService for atomic check-and-remove to prevent race conditions
 *
 * @param {string} token - CSRF token to validate
 * @returns {boolean} True if token is valid and unused
 */
function SecurityMiddleware_validateCSRFToken(token) {
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
}

// === JWT Operations =======================================================

/**
 * Timing-safe string comparison to prevent timing attacks
 * Always takes constant time regardless of where strings differ
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function SecurityMiddleware_timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const aLen = a.length;
  const bLen = b.length;
  let result = aLen === bLen ? 0 : 1;

  // Compare all bytes, using modulo to handle different lengths
  const maxLen = Math.max(aLen, bLen);
  for (let i = 0; i < maxLen; i++) {
    const aChar = i < aLen ? a.charCodeAt(i) : 0;
    const bChar = i < bLen ? b.charCodeAt(i) : 0;
    result |= aChar ^ bChar;
  }

  return result === 0;
}

/**
 * Generate JWT signature using HMAC-SHA256
 *
 * @param {string} data - Data to sign (header.payload)
 * @param {string} secret - Secret key
 * @returns {string} Base64-encoded signature
 */
function SecurityMiddleware_generateJWTSignature(data, secret) {
  const signature = Utilities.computeHmacSha256Signature(data, secret);
  return Utilities.base64EncodeWebSafe(signature);
}

/**
 * Verify JWT token
 * Validates: format, algorithm, brand, expiration, signature, not-before
 *
 * @param {string} token - JWT token
 * @param {object} brand - Brand configuration
 * @returns {object} Result envelope with claims or error
 */
function SecurityMiddleware_verifyJWT(token, brand) {
  try {
    // Validate format
    const parts = token.split('.');
    if (parts.length !== 3) {
      return Err(ERR.BAD_INPUT, 'Invalid JWT format');
    }

    // Verify algorithm in header (prevent "none" algorithm attack)
    let header;
    try {
      header = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString());
    } catch (e) {
      return Err(ERR.BAD_INPUT, 'Invalid JWT header');
    }

    // Only allow HS256 algorithm
    if (!header.alg || header.alg !== 'HS256') {
      diag_('error', 'SecurityMiddleware_verifyJWT', 'Invalid algorithm', {alg: header.alg});
      return Err(ERR.BAD_INPUT, 'Invalid JWT algorithm');
    }

    // Parse payload
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(parts[1])).getDataAsString());

    // Verify brand
    if (payload.brand !== brand.id) {
      return Err(ERR.BAD_INPUT, 'Token brand mismatch');
    }

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return Err(ERR.BAD_INPUT, 'Token expired');
    }

    // Verify signature
    const brandSecret = getAdminSecret_(brand.id);
    if (!brandSecret) {
      return UserFriendlyErr_(ERR.INTERNAL, 'Brand secret not configured',
        { brandId: brand.id }, 'SecurityMiddleware_verifyJWT');
    }
    const expectedSignature = SecurityMiddleware_generateJWTSignature(
      parts[0] + '.' + parts[1], brandSecret
    );

    // Timing-safe comparison to prevent timing attacks
    if (!SecurityMiddleware_timingSafeCompare(parts[2], expectedSignature)) {
      return Err(ERR.BAD_INPUT, 'Invalid token signature');
    }

    // Verify not-before if present
    if (payload.nbf && payload.nbf > now) {
      return Err(ERR.BAD_INPUT, 'Token not yet valid');
    }

    return Ok(payload);
  } catch (e) {
    return UserFriendlyErr_(ERR.BAD_INPUT, 'Invalid JWT verification',
      { error: e.message }, 'SecurityMiddleware_verifyJWT');
  }
}

/**
 * Generate JWT token for a brand
 *
 * @param {object} params - Token parameters
 * @param {object} params.brand - Brand configuration
 * @param {number} [params.expiresIn=3600] - Expiry time in seconds
 * @param {string} [params.scope='events'] - Token scope
 * @param {object} [params.customClaims={}] - Additional claims
 * @returns {object} Result envelope with token or error
 */
function SecurityMiddleware_generateJWT(params) {
  const { brand, expiresIn = SECURITY_CONFIG.JWT_DEFAULT_EXPIRY, scope = 'events', customClaims = {} } = params;

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const payload = {
    brand: brand.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn,
    scope: scope,
    ...customClaims
  };

  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const brandSecret = getAdminSecret_(brand.id);

  if (!brandSecret) {
    return UserFriendlyErr_(ERR.INTERNAL, 'Brand secret not configured',
      { brandId: brand.id }, 'SecurityMiddleware_generateJWT');
  }

  const signature = SecurityMiddleware_generateJWTSignature(headerB64 + '.' + payloadB64, brandSecret);
  const token = headerB64 + '.' + payloadB64 + '.' + signature;

  return Ok({
    token,
    expiresIn,
    expiresAt: new Date((payload.exp * 1000)).toISOString(),
    usage: `Authorization: Bearer ${token}`
  });
}

// === Authentication =======================================================

/**
 * Authenticate request using multiple methods
 * Supports: adminKey (legacy), JWT Bearer token, API Key header
 *
 * @param {object} e - Request event object
 * @param {object} body - Request body
 * @param {string} brandId - Brand ID
 * @returns {object} Result envelope with authentication details or error
 */
function SecurityMiddleware_authenticateRequest(e, body, brandId) {
  const brand = findBrand_(brandId);
  if (!brand) {
    return Err(ERR.NOT_FOUND, 'Unknown brand');
  }

  // Method 1: adminKey in body (legacy, backward compatible)
  const adminKey = body?.adminKey || e?.parameter?.adminKey || '';
  const brandSecret = getAdminSecret_(brand.id);
  if (adminKey && brandSecret && adminKey === brandSecret) {
    return Ok({ brand, method: 'adminKey' });
  }

  // Method 2: Bearer token (JWT)
  const authHeader = e?.headers?.Authorization || e?.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const jwtResult = SecurityMiddleware_verifyJWT(token, brand);
    if (jwtResult.ok) {
      return Ok({ brand, method: 'jwt', claims: jwtResult.value });
    }
  }

  // Method 3: API Key in header
  const apiKey = e?.headers?.['X-API-Key'] || e?.headers?.['x-api-key'] || '';
  const brandApiSecret = getAdminSecret_(brand.id);
  if (apiKey && brandApiSecret && apiKey === brandApiSecret) {
    return Ok({ brand, method: 'apiKey' });
  }

  // No valid authentication found
  return Err(ERR.BAD_INPUT, 'Invalid authentication credentials');
}

// === Rate Limiting ========================================================

/**
 * Check rate limits and authenticate brand
 * Includes IP-based failed authentication tracking
 *
 * @param {string} brandId - Brand ID
 * @param {string} adminKey - Admin secret key
 * @param {string} [ipAddress] - Client IP address
 * @returns {object} Result envelope with brand or error
 */
function SecurityMiddleware_gate(brandId, adminKey, ipAddress = null) {
  const brand = findBrand_(brandId);
  if (!brand) return Err(ERR.NOT_FOUND, 'Unknown brand');

  const brandSecret = getAdminSecret_(brand.id);
  const cache = CacheService.getScriptCache();

  // Track failed authentication attempts per IP
  if (brandSecret && adminKey !== brandSecret) {
    if (ipAddress) {
      const failKey = `auth_fail:${brandId}:${ipAddress}`;
      const fails = Number(cache.get(failKey) || '0');

      if (fails >= SECURITY_CONFIG.MAX_FAILED_AUTH) {
        return Err(ERR.RATE_LIMITED,
          `Too many failed authentication attempts. Try again in ${SECURITY_CONFIG.RATE_LOCKOUT_MINS} minutes.`);
      }

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

  cache.put(rateLimitKey, String(count + 1), 60); // 1 minute window

  return Ok({ brand });
}

// === Input Sanitization ===================================================

/**
 * Sanitize input to prevent injection attacks
 * Enhanced: Comprehensive XSS prevention with context-aware escaping
 *
 * @param {string} input - Input string
 * @param {number} [maxLength=1000] - Maximum allowed length
 * @returns {string} Sanitized input
 */
function SecurityMiddleware_sanitizeInput(input, maxLength = 1000) {
  if (!input || typeof input !== 'string') return '';

  let sanitized = String(input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .trim();

  // Remove dangerous characters and patterns
  sanitized = sanitized
    .replace(/[<>"'`&]/g, '') // Remove HTML special chars and backticks
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/data:/gi, '') // Remove data: protocol
    .replace(/vbscript:/gi, ''); // Remove vbscript: protocol

  // Remove event handlers - use loop to prevent bypass via nesting (e.g., ononclick==)
  // This addresses CodeQL warning: Incomplete multi-character sanitization
  let previousLength;
  do {
    previousLength = sanitized.length;
    sanitized = sanitized.replace(/on\w+=/gi, '');
  } while (sanitized.length !== previousLength);

  // Remove encoding attempts
  sanitized = sanitized
    .replace(/&#/g, '') // Remove HTML entity encoding
    .replace(/\\x/g, '') // Remove hex encoding
    .replace(/\\u/g, ''); // Remove unicode encoding

  return sanitized.slice(0, maxLength);
}

/**
 * Sanitize ID to ensure it contains only safe characters
 * Enhanced: Returns null for invalid IDs with strict validation
 *
 * @param {string} id - ID string
 * @returns {string|null} Sanitized ID or null if invalid
 */
function SecurityMiddleware_sanitizeId(id) {
  if (!id || typeof id !== 'string') return null;
  // Ensure ID is valid UUID format or safe alphanumeric string (max 100 chars)
  if (!/^[a-zA-Z0-9-_]{1,100}$/.test(id)) return null;
  return id;
}

/**
 * Sanitize value for spreadsheet storage
 * Prevents formula injection with comprehensive protection
 *
 * @param {*} value - Value to sanitize
 * @returns {string} Sanitized value safe for spreadsheet storage
 */
function SecurityMiddleware_sanitizeSpreadsheetValue(value) {
  if (!value) return '';

  const str = String(value);

  // Prevent formula injection: strip leading special chars
  const dangerous = ['=', '+', '-', '@', '\t', '\r', '\n'];
  let sanitized = str;

  // If starts with dangerous char, prefix with single quote to treat as text
  while (dangerous.some(char => sanitized.startsWith(char))) {
    sanitized = "'" + sanitized;
  }

  return sanitized;
}

/**
 * Sanitize sensitive data from metadata before logging
 * Removes: passwords, keys, tokens, secrets, API keys, CSRF tokens, bearer tokens
 * Enhanced: Recursively sanitizes nested objects
 *
 * @param {object} meta - Metadata object
 * @returns {object} Sanitized metadata
 */
function SecurityMiddleware_sanitizeMetaForLogging(meta) {
  if (!meta || typeof meta !== 'object') return meta;

  const sanitized = {};
  const sensitiveKeys = [
    'password', 'secret', 'key', 'token', 'adminkey', 'apikey',
    'authorization', 'bearer', 'csrf', 'csrftoken'
  ];

  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      sanitized[key] = SecurityMiddleware_sanitizeMetaForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// === Brand Isolation =====================================================

/**
 * Validate that brand has access to requested scope
 *
 * @param {object} brand - Brand configuration
 * @param {string} scope - Requested scope
 * @returns {object} Result envelope (Ok/Err)
 */
function SecurityMiddleware_assertScopeAllowed(brand, scope) {
  const allowed = brand.scopesAllowed?.length ? brand.scopesAllowed : ['events', 'leagues', 'tournaments'];
  if (!allowed.includes(scope)) {
    return Err(ERR.BAD_INPUT, `Scope '${scope}' not allowed for brand ${brand.id}`);
  }
  return Ok();
}

/**
 * Extract and validate origin header
 * Returns sanitized origin or null if invalid
 *
 * @param {object} e - Request event object
 * @param {Array<string>} allowedOrigins - List of allowed origins
 * @returns {string|null} Validated origin or null
 */
function SecurityMiddleware_validateOrigin(e, allowedOrigins = []) {
  const origin = e?.headers?.Origin || e?.headers?.origin || '';

  if (!origin) return null;

  // If no allowed origins specified, accept any (for backward compatibility)
  if (allowedOrigins.length === 0) return origin;

  // Check if origin is in allowed list
  if (allowedOrigins.includes(origin)) return origin;

  // Check if origin matches wildcard patterns
  for (const allowed of allowedOrigins) {
    if (allowed.includes('*')) {
      const regex = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
      if (regex.test(origin)) return origin;
    }
  }

  return null;
}
