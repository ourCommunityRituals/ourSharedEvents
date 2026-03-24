/**
 * Google Service Account Authentication for Cloudflare Workers
 *
 * Implements JWT-based service account authentication for Google APIs.
 * Uses Web Crypto API (available in Cloudflare Workers) for JWT signing.
 *
 * Identity Model (Story B1):
 * - Staging uses a dedicated service account
 * - No end-user Google auth
 * - Worker has a single explicit backend identity
 *
 * @module google/auth
 * @see Story B1 - Worker Service Account Auth (JWT -> OAuth Token) + Token Cache
 */

import { importPrivateKeyFromPem } from './pem';

// =============================================================================
// Constants
// =============================================================================

/** Google OAuth2 token endpoint */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Google Sheets API scope */
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/**
 * Token cache TTL buffer (60 seconds before actual expiry)
 * Per Story B1: "Token cached in memory until expires_in - 60s"
 */
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

// =============================================================================
// Error Codes (Story B1)
// =============================================================================

/**
 * Google Auth error codes per Story B1 acceptance criteria
 */
export const GOOGLE_AUTH_ERROR_CODES = {
  /** Missing required secret (GOOGLE_SA_CLIENT_EMAIL or GOOGLE_SA_PRIVATE_KEY_PEM) */
  MISSING_SECRET: 'GOOGLE_AUTH_MISSING_SECRET',
  /** Private key import failed (invalid PEM format or unsupported algorithm) */
  KEY_IMPORT_FAILED: 'GOOGLE_AUTH_KEY_IMPORT_FAILED',
  /** Token exchange with Google OAuth failed */
  TOKEN_EXCHANGE_FAILED: 'GOOGLE_AUTH_TOKEN_EXCHANGE_FAILED',
} as const;

export type GoogleAuthErrorCode = typeof GOOGLE_AUTH_ERROR_CODES[keyof typeof GOOGLE_AUTH_ERROR_CODES];

// =============================================================================
// Types
// =============================================================================

/**
 * Worker environment bindings for Google API access
 *
 * Uses Story B1 naming convention:
 * - GOOGLE_SA_CLIENT_EMAIL (not GOOGLE_CLIENT_EMAIL)
 * - GOOGLE_SA_PRIVATE_KEY_PEM (not GOOGLE_PRIVATE_KEY)
 */
export interface GoogleServiceAccountEnv {
  /** Google service account email (e.g., sa@project.iam.gserviceaccount.com) */
  GOOGLE_SA_CLIENT_EMAIL?: string;
  /** Google service account private key in PEM format */
  GOOGLE_SA_PRIVATE_KEY_PEM?: string;
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
 * Cached token structure
 */
interface CachedToken {
  accessToken: string;
  expiresAt: number;
  mintedAt: number;
}

/**
 * Token mint result with cache status
 */
export interface TokenMintResult {
  /** Access token */
  accessToken: string;
  /** Whether token was served from cache */
  fromCache: boolean;
  /** When token expires (Unix timestamp ms) */
  expiresAt: number;
  /** When token was minted (Unix timestamp ms) */
  mintedAt: number;
}

/**
 * Google auth health check result
 */
export interface GoogleAuthHealthResult {
  /** Whether auth is healthy */
  healthy: boolean;
  /** Whether secrets are configured */
  secretsConfigured: boolean;
  /** Token cache status */
  tokenCached: boolean;
  /** When cached token expires (if cached) */
  tokenExpiresAt?: number;
  /** Error code if unhealthy */
  errorCode?: GoogleAuthErrorCode;
  /** Error message if unhealthy */
  errorMessage?: string;
  /** Google OAuth status (if token exchange was attempted) */
  googleStatus?: number;
}

// =============================================================================
// Error Class (Story B1)
// =============================================================================

/**
 * Custom error class for Google authentication failures
 *
 * Per Story B1: Structured error codes for observability
 */
export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;
  readonly details?: Record<string, unknown>;
  readonly googleStatus?: number;

  constructor(
    code: GoogleAuthErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.details = details;
    this.googleStatus = details?.googleStatus as number | undefined;
  }
}

// =============================================================================
// Token Cache (Story B1)
// =============================================================================

/**
 * In-memory token cache
 * Per Story B1: "Token is cached; repeated requests do not mint each time"
 */
let tokenCache: CachedToken | null = null;

/**
 * Clear the token cache
 * Useful for testing or credential rotation
 */
export function clearTokenCache(): void {
  tokenCache = null;
}

/**
 * Get token cache status for health checks
 */
export function getTokenCacheStatus(): { cached: boolean; expiresAt?: number } {
  if (!tokenCache) {
    return { cached: false };
  }

  const now = Date.now();
  const isValid = tokenCache.expiresAt > now + TOKEN_EXPIRY_BUFFER_MS;

  return {
    cached: isValid,
    expiresAt: isValid ? tokenCache.expiresAt : undefined,
  };
}

/**
 * Check if a valid token exists in cache
 */
function getCachedToken(): CachedToken | null {
  if (!tokenCache) return null;

  const now = Date.now();
  // Per Story B1: Token cached until expires_in - 60s
  if (tokenCache.expiresAt > now + TOKEN_EXPIRY_BUFFER_MS) {
    return tokenCache;
  }

  // Token expired or about to expire
  tokenCache = null;
  return null;
}

/**
 * Store token in cache
 */
function setCachedToken(accessToken: string, expiresIn: number): CachedToken {
  const now = Date.now();
  tokenCache = {
    accessToken,
    expiresAt: now + expiresIn * 1000,
    mintedAt: now,
  };
  return tokenCache;
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
 * Create a signed JWT for Google API authentication
 *
 * @param clientEmail - Service account email
 * @param privateKeyPem - PEM-encoded private key
 * @param scope - OAuth scope (defaults to Sheets API)
 * @returns Signed JWT string
 * @throws {GoogleAuthError} If signing fails
 */
async function createSignedJwt(
  clientEmail: string,
  privateKeyPem: string,
  scope: string = GOOGLE_SHEETS_SCOPE
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour expiry

  // JWT Header
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  // JWT Claims (per Google service account spec)
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
    const cryptoKey = await importPrivateKeyFromPem(privateKeyPem);
    signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedToken)
    );
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error;
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.KEY_IMPORT_FAILED,
      'Failed to sign JWT: key import or signing failed',
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }

  const signatureB64 = base64UrlEncode(signature);
  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Exchange signed JWT for access token
 *
 * @param jwt - Signed JWT string
 * @returns Token response from Google
 * @throws {GoogleAuthError} If exchange fails
 */
async function exchangeJwtForToken(jwt: string): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
  } catch (error) {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.TOKEN_EXCHANGE_FAILED,
      'Network error during token exchange',
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }

  if (!response.ok) {
    // Per Story B1: Include Google status (not body dump) for security
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.TOKEN_EXCHANGE_FAILED,
      `Token exchange failed: HTTP ${response.status}`,
      { googleStatus: response.status }
    );
  }

  return response.json() as Promise<TokenResponse>;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Google service account credentials are configured
 *
 * @param env - Worker environment
 * @returns True if both GOOGLE_SA_CLIENT_EMAIL and GOOGLE_SA_PRIVATE_KEY_PEM are set
 */
export function hasGoogleCredentials(env: GoogleServiceAccountEnv): boolean {
  return !!(env.GOOGLE_SA_CLIENT_EMAIL && env.GOOGLE_SA_PRIVATE_KEY_PEM);
}

/**
 * Validate Google service account credentials
 *
 * @param env - Worker environment
 * @throws {GoogleAuthError} If credentials are missing or invalid
 */
export function validateGoogleCredentials(env: GoogleServiceAccountEnv): void {
  if (!env.GOOGLE_SA_CLIENT_EMAIL) {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.MISSING_SECRET,
      'Missing GOOGLE_SA_CLIENT_EMAIL environment variable'
    );
  }

  if (!env.GOOGLE_SA_PRIVATE_KEY_PEM) {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.MISSING_SECRET,
      'Missing GOOGLE_SA_PRIVATE_KEY_PEM environment variable'
    );
  }

  // Validate service account email format
  if (!env.GOOGLE_SA_CLIENT_EMAIL.endsWith('.iam.gserviceaccount.com')) {
    // Log warning but don't throw - allow non-standard formats for testing
    console.warn(
      'GOOGLE_SA_CLIENT_EMAIL does not appear to be a service account email'
    );
  }

  // Validate private key has PEM headers
  if (
    !env.GOOGLE_SA_PRIVATE_KEY_PEM.includes('-----BEGIN') ||
    !env.GOOGLE_SA_PRIVATE_KEY_PEM.includes('-----END')
  ) {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.MISSING_SECRET,
      'GOOGLE_SA_PRIVATE_KEY_PEM must be in PEM format with BEGIN/END markers'
    );
  }
}

/**
 * Get a valid OAuth access token for Google APIs
 *
 * Uses caching to minimize token refresh calls.
 * Per Story B1: "Token is cached; repeated requests do not mint each time"
 *
 * @param env - Worker environment with Google credentials
 * @returns Token mint result with cache status
 * @throws {GoogleAuthError} If credentials are missing or token generation fails
 */
export async function getGoogleAccessToken(
  env: GoogleServiceAccountEnv
): Promise<TokenMintResult> {
  // Check cache first
  const cached = getCachedToken();
  if (cached) {
    return {
      accessToken: cached.accessToken,
      fromCache: true,
      expiresAt: cached.expiresAt,
      mintedAt: cached.mintedAt,
    };
  }

  // Validate credentials (throws if missing)
  validateGoogleCredentials(env);

  // Generate new token
  const jwt = await createSignedJwt(
    env.GOOGLE_SA_CLIENT_EMAIL!,
    env.GOOGLE_SA_PRIVATE_KEY_PEM!
  );

  const tokenResponse = await exchangeJwtForToken(jwt);

  // Cache the token
  const cachedToken = setCachedToken(
    tokenResponse.access_token,
    tokenResponse.expires_in
  );

  return {
    accessToken: cachedToken.accessToken,
    fromCache: false,
    expiresAt: cachedToken.expiresAt,
    mintedAt: cachedToken.mintedAt,
  };
}

/**
 * Perform a health check on Google authentication
 *
 * Per Story B1: Health endpoint must tell us exactly why auth fails
 *
 * @param env - Worker environment
 * @param attemptTokenMint - Whether to attempt minting a token (default: true)
 * @returns Health check result with detailed status
 */
export async function checkGoogleAuthHealth(
  env: GoogleServiceAccountEnv,
  attemptTokenMint: boolean = true
): Promise<GoogleAuthHealthResult> {
  // Check if secrets are configured
  const secretsConfigured = hasGoogleCredentials(env);

  if (!secretsConfigured) {
    return {
      healthy: false,
      secretsConfigured: false,
      tokenCached: false,
      errorCode: GOOGLE_AUTH_ERROR_CODES.MISSING_SECRET,
      errorMessage: !env.GOOGLE_SA_CLIENT_EMAIL
        ? 'Missing GOOGLE_SA_CLIENT_EMAIL'
        : 'Missing GOOGLE_SA_PRIVATE_KEY_PEM',
    };
  }

  // Check cache status
  const cacheStatus = getTokenCacheStatus();

  // If we have a cached token and don't need to mint, return healthy
  if (cacheStatus.cached && !attemptTokenMint) {
    return {
      healthy: true,
      secretsConfigured: true,
      tokenCached: true,
      tokenExpiresAt: cacheStatus.expiresAt,
    };
  }

  // Attempt token mint
  if (attemptTokenMint) {
    try {
      const result = await getGoogleAccessToken(env);
      return {
        healthy: true,
        secretsConfigured: true,
        tokenCached: result.fromCache,
        tokenExpiresAt: result.expiresAt,
      };
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        return {
          healthy: false,
          secretsConfigured: true,
          tokenCached: false,
          errorCode: error.code,
          errorMessage: error.message,
          googleStatus: error.googleStatus,
        };
      }

      return {
        healthy: false,
        secretsConfigured: true,
        tokenCached: false,
        errorCode: GOOGLE_AUTH_ERROR_CODES.TOKEN_EXCHANGE_FAILED,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // If secrets are configured but we didn't attempt mint, report as healthy
  return {
    healthy: true,
    secretsConfigured: true,
    tokenCached: cacheStatus.cached,
    tokenExpiresAt: cacheStatus.expiresAt,
  };
}

/**
 * Create an error response for Google auth failures
 *
 * Per Story B1: Structured JSON error responses with requestId
 *
 * @param error - GoogleAuthError or generic error
 * @param requestId - Request ID for tracing
 * @returns Response with structured error body
 */
export function createGoogleAuthErrorResponse(
  error: GoogleAuthError | Error,
  requestId: string
): Response {
  const isAuthError = error instanceof GoogleAuthError;

  const body = {
    ok: false,
    status: 503,
    code: isAuthError ? error.code : GOOGLE_AUTH_ERROR_CODES.TOKEN_EXCHANGE_FAILED,
    error: error.message,
    requestId,
    timestamp: new Date().toISOString(),
    ...(isAuthError && error.googleStatus ? { googleStatus: error.googleStatus } : {}),
  };

  // SECURITY: Never log secrets - only log error code and requestId
  console.error(JSON.stringify({
    type: 'GOOGLE_AUTH_ERROR',
    code: body.code,
    requestId,
    timestamp: body.timestamp,
    ...(isAuthError && error.googleStatus ? { googleStatus: error.googleStatus } : {}),
  }));

  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Request-Id': requestId,
    },
  });
}
