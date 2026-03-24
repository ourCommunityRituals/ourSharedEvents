/**
 * Signed Public Mutations Guard
 *
 * SEC-IAC-05: Require HMAC-signed tokens for all public mutations.
 *
 * Security Posture:
 * - All public mutations require a valid signed token
 * - Token includes action, brandId, eventId, payloadHash, exp, nonce
 * - HMAC-SHA256 signature verification
 * - Nonce replay prevention via KV storage
 * - Automatic nonce expiration via KV TTL
 *
 * Token Model:
 * - action: The mutation action/endpoint being performed
 * - brandId: Brand identifier for the request
 * - eventId: Event identifier for the request
 * - payloadHash: SHA-256 hash of the request body (hex encoded)
 * - exp: Expiration timestamp (Unix seconds)
 * - nonce: Unique value to prevent replay attacks
 *
 * Token Format:
 * - Base64URL(JSON(payload)).Base64URL(HMAC-SHA256(payload))
 * - Passed in X-Mutation-Token header
 *
 * @module auth/signedMutations
 * @see SEC-IAC-05 - Signed Public Mutations
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Signed mutation token payload
 */
export interface MutationTokenPayload {
  /** The mutation action/endpoint (e.g., "createEvent", "updateEvent") */
  action: string;
  /** Brand identifier */
  brandId: string;
  /** Event identifier */
  eventId: string;
  /** SHA-256 hash of request body (hex encoded) */
  payloadHash: string;
  /** Token expiration timestamp (Unix seconds) */
  exp: number;
  /** Unique nonce to prevent replay attacks */
  nonce: string;
}

/**
 * Environment bindings for signed mutations guard
 */
export interface SignedMutationsEnv {
  /**
   * HMAC secret key for signing/verifying tokens.
   * Must be a cryptographically secure random string (minimum 32 bytes recommended).
   */
  HMAC_SECRET?: string;

  /**
   * KV namespace for storing used nonces to prevent replay attacks.
   * Nonces are stored with TTL matching token expiration.
   */
  HMAC_NONCE_KV?: KVNamespace;
}

/**
 * Result of signed mutation verification
 */
export interface SignedMutationResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Error response if not allowed */
  errorResponse?: Response;
  /** Reason for decision */
  reason: string;
  /** Decoded token payload if valid */
  payload?: MutationTokenPayload;
}

/**
 * Signed mutation error codes
 */
export type SignedMutationErrorCode =
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN_FORMAT'
  | 'INVALID_SIGNATURE'
  | 'TOKEN_EXPIRED'
  | 'NONCE_REPLAYED'
  | 'HMAC_NOT_CONFIGURED';

/**
 * Signed mutation error response (403)
 */
export interface SignedMutationError {
  ok: false;
  status: 403;
  code: SignedMutationErrorCode;
  message: string;
  requestId: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Header name for the signed mutation token
 */
export const MUTATION_TOKEN_HEADER = 'X-Mutation-Token';

/**
 * Maximum clock skew allowed (5 minutes in seconds)
 */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Minimum HMAC secret length (32 bytes = 256 bits)
 */
export const MIN_HMAC_SECRET_LENGTH = 32;

/**
 * Nonce prefix for KV storage
 */
const NONCE_KV_PREFIX = 'nonce:';

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Base64URL encode a string (RFC 4648)
 */
function base64UrlEncode(data: string): string {
  const base64 = btoa(data);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL decode a string (RFC 4648)
 */
function base64UrlDecode(data: string): string {
  // Add padding if needed
  let padded = data.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  padded += '='.repeat(padLength);
  return atob(padded);
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute HMAC-SHA256 signature
 *
 * @param data - Data to sign
 * @param secret - HMAC secret key
 * @returns Base64URL encoded signature
 */
async function computeHmacSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataBytes = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, dataBytes);
  const signatureBytes = new Uint8Array(signature);
  const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));
  return signatureBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verify HMAC-SHA256 signature using constant-time comparison
 *
 * @param data - Original data
 * @param signature - Base64URL encoded signature to verify
 * @param secret - HMAC secret key
 * @returns True if signature is valid
 */
async function verifyHmacSignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await computeHmacSignature(data, secret);

  // Constant-time comparison to prevent timing attacks
  if (expectedSignature.length !== signature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    result |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Compute SHA-256 hash of request body
 *
 * @param body - Request body string
 * @returns Hex-encoded SHA-256 hash
 */
export async function computePayloadHash(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

/**
 * Parse a signed mutation token
 *
 * @param token - The token string (payload.signature format)
 * @returns Parsed payload and signature, or null if invalid format
 */
function parseToken(token: string): { payload: string; signature: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return null;
  }

  try {
    // Verify payload can be decoded
    base64UrlDecode(encodedPayload);
    return { payload: encodedPayload, signature };
  } catch {
    return null;
  }
}

/**
 * Decode and validate token payload structure
 *
 * @param encodedPayload - Base64URL encoded JSON payload
 * @returns Decoded payload or null if invalid
 */
function decodePayload(encodedPayload: string): MutationTokenPayload | null {
  try {
    const jsonString = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(jsonString);

    // Validate required fields
    if (
      typeof payload.action !== 'string' ||
      typeof payload.brandId !== 'string' ||
      typeof payload.eventId !== 'string' ||
      typeof payload.payloadHash !== 'string' ||
      typeof payload.exp !== 'number' ||
      typeof payload.nonce !== 'string'
    ) {
      return null;
    }

    // Validate non-empty required fields
    if (!payload.action || !payload.nonce) {
      return null;
    }

    return payload as MutationTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired
 *
 * @param exp - Token expiration timestamp (Unix seconds)
 * @returns True if token is expired
 */
function isTokenExpired(exp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  // Allow some clock skew
  return exp < now - MAX_CLOCK_SKEW_SECONDS;
}

/**
 * Check if nonce has been used (replay attack detection)
 *
 * @param nonce - The nonce to check
 * @param kv - KV namespace for nonce storage
 * @returns True if nonce has been used before
 */
async function isNonceReplayed(nonce: string, kv: KVNamespace): Promise<boolean> {
  const key = NONCE_KV_PREFIX + nonce;
  const value = await kv.get(key);
  return value !== null;
}

/**
 * Store nonce in KV to prevent replay attacks
 *
 * @param nonce - The nonce to store
 * @param exp - Token expiration timestamp (for TTL)
 * @param kv - KV namespace for nonce storage
 */
async function storeNonce(nonce: string, exp: number, kv: KVNamespace): Promise<void> {
  const key = NONCE_KV_PREFIX + nonce;
  const now = Math.floor(Date.now() / 1000);

  // Calculate TTL: expire nonce at token expiration + buffer for clock skew
  // Minimum 60 seconds TTL
  const ttl = Math.max(exp - now + MAX_CLOCK_SKEW_SECONDS, 60);

  await kv.put(key, '1', { expirationTtl: ttl });
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Create a 403 Forbidden response for signed mutation errors
 *
 * @param code - Error code
 * @param message - Error message
 * @param requestId - Request ID for correlation
 * @returns HTTP Response with 403 status
 */
export function createSignedMutationErrorResponse(
  code: SignedMutationErrorCode,
  message: string,
  requestId: string
): Response {
  const body: SignedMutationError = {
    ok: false,
    status: 403,
    code,
    message,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

// =============================================================================
// Main Guard Function
// =============================================================================

/**
 * Verify a signed mutation token
 *
 * SEC-IAC-05: Verify HMAC-signed tokens for public mutations.
 *
 * Verification Steps:
 * 1. Check HMAC_SECRET is configured
 * 2. Extract token from X-Mutation-Token header
 * 3. Parse token format (payload.signature)
 * 4. Verify HMAC-SHA256 signature
 * 5. Decode and validate payload structure
 * 6. Check token expiration
 * 7. Check nonce for replay attack
 * 8. Store nonce to prevent future replay
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for error response
 * @returns Verification result with allowed status and optional error response
 */
export async function verifySignedMutation(
  request: Request,
  env: SignedMutationsEnv,
  requestId: string
): Promise<SignedMutationResult> {
  // Check HMAC secret is configured
  if (!env.HMAC_SECRET || env.HMAC_SECRET.length < MIN_HMAC_SECRET_LENGTH) {
    console.error('[SignedMutations] HMAC_SECRET not configured or too short');
    return {
      allowed: false,
      errorResponse: createSignedMutationErrorResponse(
        'HMAC_NOT_CONFIGURED',
        'Server configuration error',
        requestId
      ),
      reason: 'HMAC_SECRET not configured',
    };
  }

  // Extract token from header
  const token = request.headers.get(MUTATION_TOKEN_HEADER);
  if (!token) {
    console.warn(`[SignedMutations] Missing token header: ${MUTATION_TOKEN_HEADER}`);
    return {
      allowed: false,
      errorResponse: createSignedMutationErrorResponse(
        'MISSING_TOKEN',
        `Missing required header: ${MUTATION_TOKEN_HEADER}`,
        requestId
      ),
      reason: 'Missing mutation token header',
    };
  }

  // Parse token format
  const parsed = parseToken(token);
  if (!parsed) {
    console.warn('[SignedMutations] Invalid token format');
    return {
      allowed: false,
      errorResponse: createSignedMutationErrorResponse(
        'INVALID_TOKEN_FORMAT',
        'Invalid token format - expected: payload.signature',
        requestId
      ),
      reason: 'Invalid token format',
    };
  }

  // Decode payload to get the JSON string for signature verification
  const payloadJson = base64UrlDecode(parsed.payload);

  // Verify HMAC signature
  const isValid = await verifyHmacSignature(payloadJson, parsed.signature, env.HMAC_SECRET);
  if (!isValid) {
    console.warn('[SignedMutations] Invalid signature');
    return {
      allowed: false,
      errorResponse: createSignedMutationErrorResponse(
        'INVALID_SIGNATURE',
        'Invalid token signature',
        requestId
      ),
      reason: 'Invalid HMAC signature',
    };
  }

  // Decode and validate payload structure
  const payload = decodePayload(parsed.payload);
  if (!payload) {
    console.warn('[SignedMutations] Invalid payload structure');
    return {
      allowed: false,
      errorResponse: createSignedMutationErrorResponse(
        'INVALID_TOKEN_FORMAT',
        'Invalid token payload structure',
        requestId
      ),
      reason: 'Invalid payload structure',
    };
  }

  // Check expiration
  if (isTokenExpired(payload.exp)) {
    console.warn(`[SignedMutations] Token expired: exp=${payload.exp}`);
    return {
      allowed: false,
      errorResponse: createSignedMutationErrorResponse(
        'TOKEN_EXPIRED',
        'Token has expired',
        requestId
      ),
      reason: 'Token expired',
    };
  }

  // Check for replay attack (requires KV)
  if (env.HMAC_NONCE_KV) {
    const replayed = await isNonceReplayed(payload.nonce, env.HMAC_NONCE_KV);
    if (replayed) {
      console.warn(`[SignedMutations] Nonce replayed: ${payload.nonce}`);
      return {
        allowed: false,
        errorResponse: createSignedMutationErrorResponse(
          'NONCE_REPLAYED',
          'Token has already been used',
          requestId
        ),
        reason: 'Nonce replayed',
      };
    }

    // Store nonce to prevent future replay
    await storeNonce(payload.nonce, payload.exp, env.HMAC_NONCE_KV);
  } else {
    console.warn('[SignedMutations] HMAC_NONCE_KV not configured - replay protection disabled');
  }

  return {
    allowed: true,
    reason: 'Valid signed mutation token',
    payload,
  };
}

/**
 * Guard public mutations with signed token verification
 *
 * SEC-IAC-05: Enforce signed tokens for all public mutations.
 *
 * This guard should be applied after the public read-only guard (SEC-IAC-04)
 * for routes that allow public mutations with signed tokens.
 *
 * @param request - Incoming request
 * @param env - Environment bindings
 * @param requestId - Request ID for error response
 * @returns Guard result with allowed status and optional error response
 */
export async function guardSignedMutation(
  request: Request,
  env: SignedMutationsEnv,
  requestId: string
): Promise<SignedMutationResult> {
  return verifySignedMutation(request, env, requestId);
}

/**
 * Create a signed mutation token (utility for testing/client generation)
 *
 * @param payload - Token payload
 * @param secret - HMAC secret key
 * @returns Signed token string
 */
export async function createSignedMutationToken(
  payload: MutationTokenPayload,
  secret: string
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadJson);
  const signature = await computeHmacSignature(payloadJson, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Check if signed mutations guard is configured
 *
 * @param env - Environment bindings
 * @returns True if HMAC_SECRET is configured
 */
export function isSignedMutationsConfigured(env: SignedMutationsEnv): boolean {
  return !!env.HMAC_SECRET && env.HMAC_SECRET.length >= MIN_HMAC_SECRET_LENGTH;
}

/**
 * Check if nonce storage is configured
 *
 * @param env - Environment bindings
 * @returns True if HMAC_NONCE_KV is available
 */
export function isNonceStorageConfigured(env: SignedMutationsEnv): boolean {
  return !!env.HMAC_NONCE_KV;
}
