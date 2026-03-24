/**
 * Google OAuth2 Authentication for Cloudflare Workers
 *
 * Implements service account JWT authentication for Google Sheets API.
 * Uses Web Crypto API (available in Cloudflare Workers) for JWT signing.
 *
 * @module googleAuth
 * @see Story 1.2 - Implement sheetsClient.ts for Workers
 */

// =============================================================================
// Constants
// =============================================================================

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Token cache TTL buffer (5 minutes before actual expiry)
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// =============================================================================
// Types
// =============================================================================

/**
 * Worker environment bindings for Google API access.
 *
 * Note: Properties are optional to match the reality that environment
 * variables may not be set. Use hasCredentials() to check at runtime
 * before making API calls.
 */
export interface GoogleAuthEnv {
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  SHEETS_SPREADSHEET_ID?: string;
}

/**
 * Token response from Google OAuth2
 */
interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Error codes for authentication failures
 */
export const AUTH_ERROR_CODES = {
  MISSING_CLIENT_EMAIL: 'AUTH_MISSING_CLIENT_EMAIL',
  MISSING_PRIVATE_KEY: 'AUTH_MISSING_PRIVATE_KEY',
  INVALID_PRIVATE_KEY: 'AUTH_INVALID_PRIVATE_KEY',
  TOKEN_EXCHANGE_FAILED: 'AUTH_TOKEN_EXCHANGE_FAILED',
  JWT_SIGNING_FAILED: 'AUTH_JWT_SIGNING_FAILED',
} as const;

export type AuthErrorCode = typeof AUTH_ERROR_CODES[keyof typeof AUTH_ERROR_CODES];

/**
 * Custom error class for authentication failures
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly details?: unknown;

  constructor(code: AuthErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.details = details;
  }
}

// =============================================================================
// Token Cache
// =============================================================================

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

/**
 * Clear the token cache (useful for testing or credential rotation)
 */
export function clearTokenCache(): void {
  tokenCache = null;
}

/**
 * Check if a valid token exists in cache
 */
function getCachedToken(): string | null {
  if (!tokenCache) return null;

  const now = Date.now();
  if (tokenCache.expiresAt > now + TOKEN_EXPIRY_BUFFER_MS) {
    return tokenCache.accessToken;
  }

  return null;
}

/**
 * Store token in cache
 */
function setCachedToken(accessToken: string, expiresIn: number): void {
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

// =============================================================================
// JWT Utilities
// =============================================================================

/**
 * Base64URL encode a buffer (RFC 4648)
 */
function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Import PEM private key as CryptoKey for signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers/footers and whitespace
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  // Decode base64 to binary
  let binaryString: string;
  try {
    binaryString = atob(pemContents);
  } catch {
    throw new AuthError(
      AUTH_ERROR_CODES.INVALID_PRIVATE_KEY,
      'Failed to decode private key: invalid base64 encoding'
    );
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Import as RSA private key for RS256 signing
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      bytes.buffer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['sign']
    );
  } catch (error) {
    throw new AuthError(
      AUTH_ERROR_CODES.INVALID_PRIVATE_KEY,
      'Failed to import private key: invalid PKCS8 format',
      error
    );
  }
}

/**
 * Create a signed JWT for Google API authentication
 */
async function createSignedJwt(
  clientEmail: string,
  privateKey: string,
  scope: string = GOOGLE_SHEETS_SCOPE
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour expiry

  // JWT Header
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  // JWT Claims
  const claims = {
    iss: clientEmail,
    scope: scope,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: exp,
  };

  // Encode header and claims
  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const claimsB64 = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const unsignedToken = `${headerB64}.${claimsB64}`;

  // Sign the token
  let signature: ArrayBuffer;
  try {
    const cryptoKey = await importPrivateKey(privateKey);
    signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedToken)
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      AUTH_ERROR_CODES.JWT_SIGNING_FAILED,
      'Failed to sign JWT',
      error
    );
  }

  const signatureB64 = base64UrlEncode(signature);
  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Exchange signed JWT for access token
 */
async function exchangeJwtForToken(jwt: string): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    let errorDetails: unknown;
    try {
      errorDetails = await response.json();
    } catch {
      errorDetails = await response.text();
    }
    throw new AuthError(
      AUTH_ERROR_CODES.TOKEN_EXCHANGE_FAILED,
      `Token exchange failed: ${response.status} ${response.statusText}`,
      errorDetails
    );
  }

  return response.json() as Promise<TokenResponse>;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Google API credentials are configured
 */
export function hasCredentials(env: Partial<GoogleAuthEnv>): boolean {
  return !!(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}

/**
 * Validated credentials with required properties guaranteed to be strings
 */
interface ValidatedGoogleAuthEnv extends GoogleAuthEnv {
  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
}

/**
 * Validate credentials format.
 *
 * This is a TypeScript assertion function that narrows the type of env
 * to guarantee GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY are strings
 * if the function returns without throwing.
 */
export function validateCredentials(
  env: Partial<GoogleAuthEnv>
): asserts env is ValidatedGoogleAuthEnv {
  if (!env.GOOGLE_CLIENT_EMAIL) {
    throw new AuthError(
      AUTH_ERROR_CODES.MISSING_CLIENT_EMAIL,
      'Missing GOOGLE_CLIENT_EMAIL environment variable'
    );
  }

  if (!env.GOOGLE_PRIVATE_KEY) {
    throw new AuthError(
      AUTH_ERROR_CODES.MISSING_PRIVATE_KEY,
      'Missing GOOGLE_PRIVATE_KEY environment variable'
    );
  }

  // Validate service account email format
  if (!env.GOOGLE_CLIENT_EMAIL.endsWith('.iam.gserviceaccount.com')) {
    console.warn(
      'GOOGLE_CLIENT_EMAIL does not appear to be a service account email'
    );
  }

  // Validate private key has PEM headers
  if (
    !env.GOOGLE_PRIVATE_KEY.includes('-----BEGIN') ||
    !env.GOOGLE_PRIVATE_KEY.includes('-----END')
  ) {
    throw new AuthError(
      AUTH_ERROR_CODES.INVALID_PRIVATE_KEY,
      'GOOGLE_PRIVATE_KEY must be in PEM format with BEGIN/END markers'
    );
  }
}

/**
 * Get a valid access token for Google APIs
 *
 * Uses caching to minimize token refresh calls.
 * Tokens are cached with a 5-minute buffer before expiry.
 *
 * @param env - Worker environment with Google credentials
 * @returns Access token string
 * @throws {AuthError} If credentials are missing or token generation fails
 */
export async function getAccessToken(env: GoogleAuthEnv): Promise<string> {
  // Check cache first
  const cached = getCachedToken();
  if (cached) {
    return cached;
  }

  // Validate credentials
  validateCredentials(env);

  // Generate new token
  const jwt = await createSignedJwt(
    env.GOOGLE_CLIENT_EMAIL,
    env.GOOGLE_PRIVATE_KEY
  );

  const tokenResponse = await exchangeJwtForToken(jwt);

  // Cache the token
  setCachedToken(tokenResponse.access_token, tokenResponse.expires_in);

  return tokenResponse.access_token;
}

/**
 * Log authentication error with structured format
 */
export function logAuthError(error: AuthError, context?: Record<string, unknown>): void {
  console.error(JSON.stringify({
    type: 'AUTH_ERROR',
    code: error.code,
    message: error.message,
    timestamp: new Date().toISOString(),
    ...context,
  }));
}
