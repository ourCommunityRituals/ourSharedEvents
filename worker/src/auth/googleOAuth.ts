/**
 * Google OAuth 2.0 Authentication with PKCE
 *
 * Implements Authorization Code flow with PKCE for admin authentication.
 * Uses Google's OAuth 2.0 endpoints for user identity verification.
 *
 * @module auth/googleOAuth
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 * @see RFC 7636 - PKCE
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Environment variables for Google OAuth
 */
export interface GoogleOAuthEnv {
  /** Google OAuth 2.0 Client ID */
  GOOGLE_CLIENT_ID: string;
  /** Google OAuth 2.0 Client Secret */
  GOOGLE_CLIENT_SECRET: string;
  /** OAuth redirect URI (must match Google Cloud Console config) */
  OAUTH_REDIRECT_URI: string;
  /** Session signing secret */
  SESSION_SECRET: string;
}

/**
 * Google OAuth token response
 */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
  refresh_token?: string;
}

/**
 * Google userinfo response
 */
export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  hd?: string; // Hosted domain (for Google Workspace)
}

/**
 * OAuth error response from Google
 */
export interface GoogleOAuthError {
  error: string;
  error_description?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Google OAuth 2.0 authorization endpoint */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Google OAuth 2.0 token endpoint */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Google userinfo endpoint */
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** Required OAuth scopes for admin authentication */
export const OAUTH_SCOPES = ['openid', 'email', 'profile'];

// =============================================================================
// Authorization URL
// =============================================================================

/**
 * Build Google OAuth authorization URL with PKCE
 *
 * @param env - OAuth environment configuration
 * @param codeChallenge - PKCE code challenge (S256)
 * @param state - CSRF protection state
 * @returns Full authorization URL
 */
export function buildAuthorizationUrl(
  env: GoogleOAuthEnv,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online', // No refresh token needed for short sessions
    prompt: 'select_account', // Always show account picker
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// =============================================================================
// Token Exchange
// =============================================================================

/**
 * Exchange authorization code for access token
 *
 * @param env - OAuth environment configuration
 * @param code - Authorization code from callback
 * @param codeVerifier - PKCE code verifier
 * @returns Token response or error
 */
export async function exchangeCodeForToken(
  env: GoogleOAuthEnv,
  code: string,
  codeVerifier: string
): Promise<{ success: true; tokens: GoogleTokenResponse } | { success: false; error: string }> {
  try {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code: code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: env.OAUTH_REDIRECT_URI,
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as GoogleOAuthError;
      console.error('[GoogleOAuth] Token exchange failed:', errorData);
      return {
        success: false,
        error: errorData.error_description || errorData.error || 'Token exchange failed',
      };
    }

    const tokens = (await response.json()) as GoogleTokenResponse;
    return { success: true, tokens };
  } catch (error) {
    console.error('[GoogleOAuth] Token exchange error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token exchange failed',
    };
  }
}

// =============================================================================
// User Info
// =============================================================================

/**
 * Fetch user info from Google using access token
 *
 * @param accessToken - OAuth access token
 * @returns User info or error
 */
export async function fetchUserInfo(
  accessToken: string
): Promise<{ success: true; user: GoogleUserInfo } | { success: false; error: string }> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json()) as GoogleOAuthError;
      console.error('[GoogleOAuth] Userinfo fetch failed:', errorData);
      return {
        success: false,
        error: errorData.error_description || errorData.error || 'Failed to fetch user info',
      };
    }

    const user = (await response.json()) as GoogleUserInfo;

    // Verify email is verified
    if (!user.verified_email) {
      return {
        success: false,
        error: 'Email not verified with Google',
      };
    }

    return { success: true, user };
  } catch (error) {
    console.error('[GoogleOAuth] Userinfo error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch user info',
    };
  }
}

// =============================================================================
// Complete OAuth Flow
// =============================================================================

/**
 * Complete OAuth callback flow: exchange code and get user info
 *
 * @param env - OAuth environment configuration
 * @param code - Authorization code from callback
 * @param codeVerifier - PKCE code verifier
 * @returns User info or error
 */
export async function completeOAuthFlow(
  env: GoogleOAuthEnv,
  code: string,
  codeVerifier: string
): Promise<
  | { success: true; user: GoogleUserInfo; tokens: GoogleTokenResponse }
  | { success: false; error: string }
> {
  // Exchange code for token
  const tokenResult = await exchangeCodeForToken(env, code, codeVerifier);
  if (!tokenResult.success) {
    return tokenResult;
  }

  // Fetch user info
  const userResult = await fetchUserInfo(tokenResult.tokens.access_token);
  if (!userResult.success) {
    return userResult;
  }

  return {
    success: true,
    user: userResult.user,
    tokens: tokenResult.tokens,
  };
}

// =============================================================================
// Environment Validation
// =============================================================================

/**
 * Validate OAuth environment configuration
 *
 * @param env - Environment to validate
 * @returns Validation result with missing variables
 */
export function validateOAuthEnv(
  env: Partial<GoogleOAuthEnv>
): { valid: boolean; missing: string[] } {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_URI', 'SESSION_SECRET'];
  const missing: string[] = [];

  for (const key of required) {
    if (!env[key as keyof GoogleOAuthEnv]) {
      missing.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Create error response for missing OAuth configuration
 */
export function createOAuthNotConfiguredResponse(
  missing: string[],
  requestId: string
): Response {
  const body = {
    ok: false,
    status: 503,
    code: 'OAUTH_NOT_CONFIGURED',
    message: `OAuth not configured. Missing: ${missing.join(', ')}`,
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
