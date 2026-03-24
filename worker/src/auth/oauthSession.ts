/**
 * OAuth Session Management
 *
 * HttpOnly cookie-based sessions with HMAC signing for tamper-proofing.
 * Sessions are stateless - all data encoded in signed cookie.
 *
 * @module auth/oauthSession
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Environment variables for OAuth session management
 */
export interface OAuthSessionEnv {
  /** Secret key for HMAC signing (min 32 chars recommended) */
  SESSION_SECRET: string;
}

/**
 * Session data stored in signed cookie
 */
export interface SessionData {
  /** Authenticated user email */
  email: string;
  /** Session expiration timestamp (Unix seconds) */
  exp: number;
  /** Session issued at timestamp (Unix seconds) */
  iat: number;
}

/**
 * PKCE state stored temporarily during OAuth flow
 */
export interface PKCEState {
  /** Code verifier for PKCE */
  codeVerifier: string;
  /** CSRF protection state */
  state: string;
  /** Expiration timestamp (Unix seconds) */
  exp: number;
}

/**
 * Result of session validation
 */
export interface SessionValidationResult {
  valid: boolean;
  session?: SessionData;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Session cookie name */
export const SESSION_COOKIE_NAME = '__ea_admin_session';

/** PKCE state cookie name */
export const PKCE_COOKIE_NAME = '__ea_oauth_pkce';

/** Session TTL in seconds (15 minutes) */
export const SESSION_TTL_SECONDS = 15 * 60;

/** PKCE state TTL in seconds (10 minutes - covers OAuth flow) */
export const PKCE_TTL_SECONDS = 10 * 60;

// =============================================================================
// Crypto Utilities
// =============================================================================

/**
 * Generate cryptographically secure random bytes as hex string
 */
export function generateRandomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate PKCE code verifier (43-128 chars, URL-safe)
 * @see RFC 7636
 */
export function generateCodeVerifier(): string {
  // Generate 32 bytes = 64 hex chars (within 43-128 range)
  return generateRandomHex(32);
}

/**
 * Generate PKCE code challenge from verifier using S256 method
 * @see RFC 7636
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);

  // Base64URL encode
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate CSRF state token
 */
export function generateState(): string {
  return generateRandomHex(16);
}

/**
 * Create HMAC-SHA256 signature for data
 */
async function createHmacSignature(data: string, secret: string): Promise<string> {
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
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify HMAC-SHA256 signature (constant-time comparison)
 */
async function verifyHmacSignature(data: string, signature: string, secret: string): Promise<boolean> {
  const expectedSig = await createHmacSignature(data, secret);

  if (signature.length !== expectedSig.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }

  return result === 0;
}

// =============================================================================
// Session Cookie Functions
// =============================================================================

/**
 * Create signed session cookie value
 *
 * Format: base64(json).signature
 */
export async function createSessionCookie(
  email: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const session: SessionData = {
    email,
    exp: now + SESSION_TTL_SECONDS,
    iat: now,
  };

  const payload = btoa(JSON.stringify(session));
  const signature = await createHmacSignature(payload, secret);

  return `${payload}.${signature}`;
}

/**
 * Parse and verify session cookie
 */
export async function parseSessionCookie(
  cookieValue: string,
  secret: string
): Promise<SessionValidationResult> {
  try {
    const parts = cookieValue.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid session format' };
    }

    const [payload, signature] = parts;

    // Verify signature
    const isValid = await verifyHmacSignature(payload, signature, secret);
    if (!isValid) {
      return { valid: false, error: 'Invalid session signature' };
    }

    // Decode payload
    const session: SessionData = JSON.parse(atob(payload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (session.exp < now) {
      return { valid: false, error: 'Session expired' };
    }

    return { valid: true, session };
  } catch (e) {
    return { valid: false, error: 'Failed to parse session' };
  }
}

/**
 * Create PKCE state cookie value
 */
export async function createPKCECookie(
  codeVerifier: string,
  state: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const pkceState: PKCEState = {
    codeVerifier,
    state,
    exp: now + PKCE_TTL_SECONDS,
  };

  const payload = btoa(JSON.stringify(pkceState));
  const signature = await createHmacSignature(payload, secret);

  return `${payload}.${signature}`;
}

/**
 * Parse and verify PKCE state cookie
 */
export async function parsePKCECookie(
  cookieValue: string,
  secret: string
): Promise<{ valid: boolean; pkce?: PKCEState; error?: string }> {
  try {
    const parts = cookieValue.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid PKCE format' };
    }

    const [payload, signature] = parts;

    // Verify signature
    const isValid = await verifyHmacSignature(payload, signature, secret);
    if (!isValid) {
      return { valid: false, error: 'Invalid PKCE signature' };
    }

    // Decode payload
    const pkce: PKCEState = JSON.parse(atob(payload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (pkce.exp < now) {
      return { valid: false, error: 'PKCE state expired' };
    }

    return { valid: true, pkce };
  } catch (e) {
    return { valid: false, error: 'Failed to parse PKCE state' };
  }
}

// =============================================================================
// Cookie Header Helpers
// =============================================================================

/**
 * Build Set-Cookie header for session
 */
export function buildSessionCookieHeader(
  value: string,
  options: { secure?: boolean; domain?: string } = {}
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'Path=/',
  ];

  if (options.secure !== false) {
    parts.push('Secure');
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join('; ');
}

/**
 * Build Set-Cookie header for PKCE state
 */
export function buildPKCECookieHeader(
  value: string,
  options: { secure?: boolean; domain?: string } = {}
): string {
  const parts = [
    `${PKCE_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${PKCE_TTL_SECONDS}`,
    'Path=/',
  ];

  if (options.secure !== false) {
    parts.push('Secure');
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join('; ');
}

/**
 * Build Set-Cookie header to clear session
 */
export function buildClearSessionCookieHeader(
  options: { secure?: boolean; domain?: string } = {}
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (options.secure !== false) {
    parts.push('Secure');
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join('; ');
}

/**
 * Build Set-Cookie header to clear PKCE state
 */
export function buildClearPKCECookieHeader(
  options: { secure?: boolean; domain?: string } = {}
): string {
  const parts = [
    `${PKCE_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];

  if (options.secure !== false) {
    parts.push('Secure');
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  return parts.join('; ');
}

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Extract cookie value from Cookie header
 */
export function getCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=');
    if (name === cookieName) {
      return valueParts.join('=');
    }
  }

  return null;
}

/**
 * Get session from request
 */
export async function getSessionFromRequest(
  request: Request,
  secret: string
): Promise<SessionValidationResult> {
  const cookieValue = getCookieValue(request, SESSION_COOKIE_NAME);
  if (!cookieValue) {
    return { valid: false, error: 'No session cookie' };
  }

  return parseSessionCookie(cookieValue, secret);
}

/**
 * Get PKCE state from request
 */
export async function getPKCEFromRequest(
  request: Request,
  secret: string
): Promise<{ valid: boolean; pkce?: PKCEState; error?: string }> {
  const cookieValue = getCookieValue(request, PKCE_COOKIE_NAME);
  if (!cookieValue) {
    return { valid: false, error: 'No PKCE cookie' };
  }

  return parsePKCECookie(cookieValue, secret);
}
