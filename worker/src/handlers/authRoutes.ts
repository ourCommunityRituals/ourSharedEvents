/**
 * OAuth Authentication Route Handlers
 *
 * Implements admin authentication endpoints using Google OAuth with PKCE.
 *
 * Routes:
 * - GET /auth/login    - Initiate OAuth flow
 * - GET /auth/callback - Handle OAuth callback
 * - POST /auth/logout  - Clear session
 *
 * @module handlers/authRoutes
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 */

import {
  GoogleOAuthEnv,
  buildAuthorizationUrl,
  completeOAuthFlow,
  validateOAuthEnv,
  createOAuthNotConfiguredResponse,
} from '../auth/googleOAuth';
import {
  OAuthSessionEnv,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  createSessionCookie,
  createPKCECookie,
  getPKCEFromRequest,
  buildSessionCookieHeader,
  buildPKCECookieHeader,
  buildClearSessionCookieHeader,
  buildClearPKCECookieHeader,
} from '../auth/oauthSession';
import {
  AdminAllowlistEnv,
  checkAllowlist,
  isAllowlistConfigured,
} from '../auth/adminAllowlist';

// =============================================================================
// Types
// =============================================================================

/**
 * Combined environment for auth routes
 */
export interface AuthRoutesEnv extends GoogleOAuthEnv, OAuthSessionEnv, AdminAllowlistEnv {}

// =============================================================================
// GET /auth/login
// =============================================================================

/**
 * Handle login initiation
 *
 * Generates PKCE parameters, stores in cookie, redirects to Google.
 */
export async function handleAuthLogin(
  request: Request,
  env: Partial<AuthRoutesEnv>,
  requestId: string
): Promise<Response> {
  // Validate OAuth configuration
  const validation = validateOAuthEnv(env);
  if (!validation.valid) {
    return createOAuthNotConfiguredResponse(validation.missing, requestId);
  }

  // Check allowlist configuration
  if (!isAllowlistConfigured(env)) {
    return new Response(
      JSON.stringify({
        ok: false,
        status: 503,
        code: 'ALLOWLIST_NOT_CONFIGURED',
        message: 'Admin allowlist not configured',
        requestId,
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      }
    );
  }

  try {
    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Build authorization URL
    const authUrl = buildAuthorizationUrl(env as GoogleOAuthEnv, codeChallenge, state);

    // Create PKCE state cookie
    const pkceCookie = await createPKCECookie(codeVerifier, state, env.SESSION_SECRET!);

    // Determine if we should use secure cookies
    const url = new URL(request.url);
    const isSecure = url.protocol === 'https:';

    // Redirect to Google OAuth
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl,
        'Set-Cookie': buildPKCECookieHeader(pkceCookie, { secure: isSecure }),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    console.error('[AuthLogin] Error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        status: 500,
        code: 'LOGIN_ERROR',
        message: 'Failed to initiate login',
        requestId,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
      }
    );
  }
}

// =============================================================================
// GET /auth/callback
// =============================================================================

/**
 * Handle OAuth callback from Google
 *
 * Validates state, exchanges code for token, verifies allowlist, creates session.
 */
export async function handleAuthCallback(
  request: Request,
  env: Partial<AuthRoutesEnv>,
  requestId: string
): Promise<Response> {
  // Validate OAuth configuration
  const validation = validateOAuthEnv(env);
  if (!validation.valid) {
    return createOAuthNotConfiguredResponse(validation.missing, requestId);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Determine if we should use secure cookies
  const isSecure = url.protocol === 'https:';

  // Handle OAuth error from Google
  if (error) {
    console.error(`[AuthCallback] OAuth error: ${error} - ${errorDescription}`);
    return createCallbackErrorResponse(
      'OAuth Error',
      errorDescription || error,
      requestId,
      isSecure
    );
  }

  // Validate required parameters
  if (!code || !state) {
    return createCallbackErrorResponse(
      'Invalid Callback',
      'Missing code or state parameter',
      requestId,
      isSecure
    );
  }

  try {
    // Retrieve and validate PKCE state
    const pkceResult = await getPKCEFromRequest(request, env.SESSION_SECRET!);
    if (!pkceResult.valid || !pkceResult.pkce) {
      return createCallbackErrorResponse(
        'Invalid State',
        pkceResult.error || 'PKCE validation failed',
        requestId,
        isSecure
      );
    }

    // Verify state matches (CSRF protection)
    if (pkceResult.pkce.state !== state) {
      console.warn('[AuthCallback] State mismatch - possible CSRF');
      return createCallbackErrorResponse(
        'Invalid State',
        'State parameter mismatch',
        requestId,
        isSecure
      );
    }

    // Complete OAuth flow
    const oauthResult = await completeOAuthFlow(
      env as GoogleOAuthEnv,
      code,
      pkceResult.pkce.codeVerifier
    );

    if (!oauthResult.success) {
      return createCallbackErrorResponse(
        'Authentication Failed',
        oauthResult.error,
        requestId,
        isSecure
      );
    }

    // Check allowlist
    const allowlistResult = checkAllowlist(oauthResult.user.email, env);
    if (!allowlistResult.allowed) {
      console.warn(`[AuthCallback] User ${oauthResult.user.email} not in allowlist`);
      return createForbiddenHtmlResponse(oauthResult.user.email, requestId, isSecure);
    }

    console.log(
      `[AuthCallback] User ${oauthResult.user.email} authorized via ${allowlistResult.reason}`
    );

    // Create session cookie
    const sessionCookie = await createSessionCookie(
      oauthResult.user.email,
      env.SESSION_SECRET!
    );

    // Clear PKCE cookie and set session cookie
    const headers = new Headers();
    headers.append('Set-Cookie', buildSessionCookieHeader(sessionCookie, { secure: isSecure }));
    headers.append('Set-Cookie', buildClearPKCECookieHeader({ secure: isSecure }));
    headers.set('Location', '/admin');
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('X-Request-Id', requestId);

    // Redirect to admin page
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    console.error('[AuthCallback] Error:', error);
    return createCallbackErrorResponse(
      'Authentication Error',
      'An unexpected error occurred',
      requestId,
      isSecure
    );
  }
}

// =============================================================================
// POST /auth/logout
// =============================================================================

/**
 * Handle logout
 *
 * Clears session cookie and redirects to home.
 */
export async function handleAuthLogout(
  request: Request,
  _env: Partial<AuthRoutesEnv>,
  requestId: string
): Promise<Response> {
  const url = new URL(request.url);
  const isSecure = url.protocol === 'https:';

  const headers = new Headers();
  headers.set('Set-Cookie', buildClearSessionCookieHeader({ secure: isSecure }));
  headers.set('Location', '/');
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('X-Request-Id', requestId);

  return new Response(null, {
    status: 302,
    headers,
  });
}

// =============================================================================
// Error Responses
// =============================================================================

/**
 * Create HTML error response for callback failures
 */
function createCallbackErrorResponse(
  title: string,
  message: string,
  requestId: string,
  isSecure: boolean
): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - EventAngle</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 480px;
      margin: 80px auto;
      padding: 24px;
      text-align: center;
      background: #f9fafb;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 {
      color: #dc2626;
      font-size: 24px;
      margin: 0 0 16px;
    }
    p {
      color: #6b7280;
      margin: 0 0 24px;
    }
    a {
      display: inline-block;
      background: #3b82f6;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      background: #2563eb;
    }
    .request-id {
      margin-top: 24px;
      font-size: 12px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/auth/login">Try Again</a>
    <div class="request-id">Request ID: ${escapeHtml(requestId)}</div>
  </div>
</body>
</html>`;

  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('X-Request-Id', requestId);
  headers.append('Set-Cookie', buildClearPKCECookieHeader({ secure: isSecure }));

  return new Response(html, {
    status: 400,
    headers,
  });
}

/**
 * Create HTML 403 response for non-allowlisted users
 */
function createForbiddenHtmlResponse(
  email: string,
  requestId: string,
  isSecure: boolean
): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Denied - EventAngle</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 480px;
      margin: 80px auto;
      padding: 24px;
      text-align: center;
      background: #f9fafb;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 {
      color: #dc2626;
      font-size: 24px;
      margin: 0 0 16px;
    }
    p {
      color: #6b7280;
      margin: 0 0 8px;
    }
    .email {
      font-family: monospace;
      background: #f3f4f6;
      padding: 4px 8px;
      border-radius: 4px;
    }
    a {
      display: inline-block;
      margin-top: 24px;
      background: #6b7280;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      background: #4b5563;
    }
    .request-id {
      margin-top: 24px;
      font-size: 12px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access Denied</h1>
    <p>The account <span class="email">${escapeHtml(email)}</span> is not authorized for admin access.</p>
    <p>Contact your administrator if you believe this is an error.</p>
    <a href="/">Return Home</a>
    <div class="request-id">Request ID: ${escapeHtml(requestId)}</div>
  </div>
</body>
</html>`;

  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('X-Request-Id', requestId);
  headers.append('Set-Cookie', buildClearPKCECookieHeader({ secure: isSecure }));

  return new Response(html, {
    status: 403,
    headers,
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
