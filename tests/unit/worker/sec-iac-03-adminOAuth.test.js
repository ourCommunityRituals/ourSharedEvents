/**
 * SEC-IAC-03: Admin OAuth & Allowlist Tests
 *
 * Tests for Google OAuth authentication with allowlist enforcement.
 * Validates the implementation matches acceptance criteria.
 *
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Test Setup - Read Source Files
// =============================================================================

const oauthSessionPath = path.join(__dirname, '../../../worker/src/auth/oauthSession.ts');
const googleOAuthPath = path.join(__dirname, '../../../worker/src/auth/googleOAuth.ts');
const adminAllowlistPath = path.join(__dirname, '../../../worker/src/auth/adminAllowlist.ts');
const adminOAuthGuardPath = path.join(__dirname, '../../../worker/src/auth/adminOAuthGuard.ts');
const authRoutesPath = path.join(__dirname, '../../../worker/src/handlers/authRoutes.ts');
const routerPath = path.join(__dirname, '../../../worker/src/router.ts');
const authIndexPath = path.join(__dirname, '../../../worker/src/auth/index.ts');

let oauthSessionSource = '';
let googleOAuthSource = '';
let adminAllowlistSource = '';
let adminOAuthGuardSource = '';
let authRoutesSource = '';
let routerSource = '';
let authIndexSource = '';

beforeAll(() => {
  try {
    oauthSessionSource = fs.readFileSync(oauthSessionPath, 'utf8');
    googleOAuthSource = fs.readFileSync(googleOAuthPath, 'utf8');
    adminAllowlistSource = fs.readFileSync(adminAllowlistPath, 'utf8');
    adminOAuthGuardSource = fs.readFileSync(adminOAuthGuardPath, 'utf8');
    authRoutesSource = fs.readFileSync(authRoutesPath, 'utf8');
    routerSource = fs.readFileSync(routerPath, 'utf8');
    authIndexSource = fs.readFileSync(authIndexPath, 'utf8');
  } catch (error) {
    console.error('Failed to read source files:', error.message);
  }
});

// =============================================================================
// OAuth Session Module Tests
// =============================================================================

describe('SEC-IAC-03: OAuth Session Module', () => {
  describe('Module Structure', () => {
    it('exists at worker/src/auth/oauthSession.ts', () => {
      expect(oauthSessionSource.length).toBeGreaterThan(0);
    });

    it('exports OAuthSessionEnv interface', () => {
      expect(oauthSessionSource).toContain('export interface OAuthSessionEnv');
    });

    it('exports SESSION_SECRET requirement', () => {
      expect(oauthSessionSource).toContain('SESSION_SECRET: string');
    });

    it('exports SessionData interface with required fields', () => {
      expect(oauthSessionSource).toContain('export interface SessionData');
      expect(oauthSessionSource).toContain('email: string');
      expect(oauthSessionSource).toContain('exp: number');
      expect(oauthSessionSource).toContain('iat: number');
    });
  });

  describe('Session TTL', () => {
    it('sets SESSION_TTL_SECONDS to 15 minutes (900 seconds)', () => {
      expect(oauthSessionSource).toContain('SESSION_TTL_SECONDS = 15 * 60');
    });

    it('exports the TTL constant', () => {
      expect(oauthSessionSource).toContain('export const SESSION_TTL_SECONDS');
    });
  });

  describe('Cookie Configuration', () => {
    it('uses HttpOnly cookies', () => {
      expect(oauthSessionSource).toContain("'HttpOnly'");
    });

    it('uses Secure cookies', () => {
      expect(oauthSessionSource).toContain("'Secure'");
    });

    it('uses SameSite=Lax', () => {
      expect(oauthSessionSource).toContain("'SameSite=Lax'");
    });

    it('defines session cookie name', () => {
      expect(oauthSessionSource).toContain("SESSION_COOKIE_NAME = '__ea_admin_session'");
    });
  });

  describe('PKCE Support', () => {
    it('exports generateCodeVerifier function', () => {
      expect(oauthSessionSource).toContain('export function generateCodeVerifier');
    });

    it('exports generateCodeChallenge function', () => {
      expect(oauthSessionSource).toContain('export async function generateCodeChallenge');
    });

    it('uses SHA-256 for code challenge', () => {
      expect(oauthSessionSource).toContain("'SHA-256'");
    });
  });

  describe('HMAC Signing', () => {
    it('creates HMAC-SHA256 signatures', () => {
      expect(oauthSessionSource).toContain("'HMAC'");
      expect(oauthSessionSource).toContain("'SHA-256'");
    });

    it('uses constant-time comparison', () => {
      // The implementation uses let result = 0 and result |= for constant-time comparison
      expect(oauthSessionSource).toMatch(/let result = 0/);
      expect(oauthSessionSource).toMatch(/result \|=/);
    });
  });
});

// =============================================================================
// Google OAuth Module Tests
// =============================================================================

describe('SEC-IAC-03: Google OAuth Module', () => {
  describe('Module Structure', () => {
    it('exists at worker/src/auth/googleOAuth.ts', () => {
      expect(googleOAuthSource.length).toBeGreaterThan(0);
    });

    it('exports GoogleOAuthEnv interface', () => {
      expect(googleOAuthSource).toContain('export interface GoogleOAuthEnv');
    });

    it('requires GOOGLE_CLIENT_ID', () => {
      expect(googleOAuthSource).toContain('GOOGLE_CLIENT_ID: string');
    });

    it('requires GOOGLE_CLIENT_SECRET', () => {
      expect(googleOAuthSource).toContain('GOOGLE_CLIENT_SECRET: string');
    });

    it('requires OAUTH_REDIRECT_URI', () => {
      expect(googleOAuthSource).toContain('OAUTH_REDIRECT_URI: string');
    });
  });

  describe('OAuth Endpoints', () => {
    it('uses correct Google authorization URL', () => {
      expect(googleOAuthSource).toContain(
        "GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'"
      );
    });

    it('uses correct Google token URL', () => {
      expect(googleOAuthSource).toContain(
        "GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'"
      );
    });

    it('uses correct Google userinfo URL', () => {
      expect(googleOAuthSource).toContain(
        "GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'"
      );
    });
  });

  describe('PKCE Implementation', () => {
    it('uses S256 code challenge method', () => {
      expect(googleOAuthSource).toContain("code_challenge_method: 'S256'");
    });

    it('sends code_verifier in token exchange', () => {
      expect(googleOAuthSource).toContain('code_verifier: codeVerifier');
    });
  });

  describe('OAuth Scopes', () => {
    it('requests openid scope', () => {
      expect(googleOAuthSource).toContain("'openid'");
    });

    it('requests email scope', () => {
      expect(googleOAuthSource).toContain("'email'");
    });

    it('requests profile scope', () => {
      expect(googleOAuthSource).toContain("'profile'");
    });
  });

  describe('Email Verification', () => {
    it('checks verified_email from Google response', () => {
      expect(googleOAuthSource).toContain('verified_email');
      expect(googleOAuthSource).toContain('Email not verified');
    });
  });
});

// =============================================================================
// Admin Allowlist Module Tests
// =============================================================================

describe('SEC-IAC-03: Admin Allowlist Module', () => {
  describe('Module Structure', () => {
    it('exists at worker/src/auth/adminAllowlist.ts', () => {
      expect(adminAllowlistSource.length).toBeGreaterThan(0);
    });

    it('exports AdminAllowlistEnv interface', () => {
      expect(adminAllowlistSource).toContain('export interface AdminAllowlistEnv');
    });

    it('supports ALLOWED_ADMIN_EMAILS', () => {
      expect(adminAllowlistSource).toContain('ALLOWED_ADMIN_EMAILS');
    });

    it('supports ALLOWED_ADMIN_DOMAINS (optional)', () => {
      expect(adminAllowlistSource).toContain('ALLOWED_ADMIN_DOMAINS');
    });
  });

  describe('Allowlist Parsing', () => {
    it('exports parseAllowlist function', () => {
      expect(adminAllowlistSource).toContain('export function parseAllowlist');
    });

    it('normalizes to lowercase', () => {
      expect(adminAllowlistSource).toContain('.toLowerCase()');
    });

    it('trims whitespace', () => {
      expect(adminAllowlistSource).toContain('.trim()');
    });
  });

  describe('Email Matching', () => {
    it('exports isEmailAllowed function', () => {
      expect(adminAllowlistSource).toContain('export function isEmailAllowed');
    });

    it('checks email against allowlist', () => {
      expect(adminAllowlistSource).toContain('allowedEmails.includes');
    });
  });

  describe('Domain Matching', () => {
    it('exports isDomainAllowed function', () => {
      expect(adminAllowlistSource).toContain('export function isDomainAllowed');
    });

    it('exports extractDomain function', () => {
      expect(adminAllowlistSource).toContain('export function extractDomain');
    });
  });

  describe('403 Forbidden Response', () => {
    it('exports createForbiddenResponse function', () => {
      expect(adminAllowlistSource).toContain('export function createForbiddenResponse');
    });

    it('returns 403 status', () => {
      expect(adminAllowlistSource).toContain('status: 403');
    });

    it('returns FORBIDDEN code', () => {
      expect(adminAllowlistSource).toContain("code: 'FORBIDDEN'");
    });
  });
});

// =============================================================================
// Admin OAuth Guard Module Tests
// =============================================================================

describe('SEC-IAC-03: Admin OAuth Guard Module', () => {
  describe('Module Structure', () => {
    it('exists at worker/src/auth/adminOAuthGuard.ts', () => {
      expect(adminOAuthGuardSource.length).toBeGreaterThan(0);
    });

    it('exports guardAdminOAuth function', () => {
      expect(adminOAuthGuardSource).toContain('export async function guardAdminOAuth');
    });

    it('exports isOAuthAdminEnabled function', () => {
      expect(adminOAuthGuardSource).toContain('export function isOAuthAdminEnabled');
    });
  });

  describe('Session Validation', () => {
    it('calls getSessionFromRequest', () => {
      expect(adminOAuthGuardSource).toContain('getSessionFromRequest');
    });

    it('handles expired sessions', () => {
      expect(adminOAuthGuardSource).toContain('expired_session');
    });

    it('handles missing sessions', () => {
      expect(adminOAuthGuardSource).toContain('no_session');
    });
  });

  describe('Allowlist Integration', () => {
    it('calls checkAllowlist', () => {
      expect(adminOAuthGuardSource).toContain('checkAllowlist');
    });

    it('checks if allowlist is configured', () => {
      expect(adminOAuthGuardSource).toContain('isAllowlistConfigured');
    });

    it('handles not_allowlisted case', () => {
      expect(adminOAuthGuardSource).toContain('not_allowlisted');
    });
  });

  describe('Response Handling', () => {
    it('redirects to login for unauthenticated page requests', () => {
      expect(adminOAuthGuardSource).toContain("Location: '/auth/login'");
    });

    it('returns 401 for unauthenticated API requests', () => {
      expect(adminOAuthGuardSource).toContain('status: 401');
    });

    it('returns 403 for unauthorized requests', () => {
      expect(adminOAuthGuardSource).toContain('status: 403');
    });
  });
});

// =============================================================================
// Auth Routes Handler Tests
// =============================================================================

describe('SEC-IAC-03: Auth Routes Handler', () => {
  describe('Module Structure', () => {
    it('exists at worker/src/handlers/authRoutes.ts', () => {
      expect(authRoutesSource.length).toBeGreaterThan(0);
    });

    it('exports handleAuthLogin function', () => {
      expect(authRoutesSource).toContain('export async function handleAuthLogin');
    });

    it('exports handleAuthCallback function', () => {
      expect(authRoutesSource).toContain('export async function handleAuthCallback');
    });

    it('exports handleAuthLogout function', () => {
      expect(authRoutesSource).toContain('export async function handleAuthLogout');
    });
  });

  describe('Login Handler', () => {
    it('validates OAuth configuration', () => {
      expect(authRoutesSource).toContain('validateOAuthEnv');
    });

    it('checks allowlist configuration', () => {
      expect(authRoutesSource).toContain('isAllowlistConfigured');
    });

    it('generates PKCE parameters', () => {
      expect(authRoutesSource).toContain('generateCodeVerifier');
      expect(authRoutesSource).toContain('generateCodeChallenge');
    });

    it('redirects to Google OAuth (302)', () => {
      expect(authRoutesSource).toContain('status: 302');
    });
  });

  describe('Callback Handler', () => {
    it('validates PKCE state', () => {
      expect(authRoutesSource).toContain('getPKCEFromRequest');
    });

    it('verifies state parameter (CSRF protection)', () => {
      expect(authRoutesSource).toContain('.state !== state');
      expect(authRoutesSource).toContain('State mismatch');
    });

    it('exchanges code for token', () => {
      expect(authRoutesSource).toContain('completeOAuthFlow');
    });

    it('checks allowlist before creating session', () => {
      expect(authRoutesSource).toContain('checkAllowlist');
    });

    it('creates session cookie on success', () => {
      expect(authRoutesSource).toContain('createSessionCookie');
    });

    it('redirects to admin on success', () => {
      expect(authRoutesSource).toContain("Location', '/admin'");
    });
  });

  describe('Logout Handler', () => {
    it('clears session cookie', () => {
      expect(authRoutesSource).toContain('buildClearSessionCookieHeader');
    });

    it('redirects to home', () => {
      expect(authRoutesSource).toContain("Location', '/'");
    });
  });
});

// =============================================================================
// Router Integration Tests
// =============================================================================

describe('SEC-IAC-03: Router Integration', () => {
  describe('Auth Route Registration', () => {
    it('imports auth route handlers', () => {
      expect(routerSource).toContain("import {");
      expect(routerSource).toContain('handleAuthLogin');
      expect(routerSource).toContain('handleAuthCallback');
      expect(routerSource).toContain('handleAuthLogout');
    });

    it('imports guardAdminOAuth', () => {
      expect(routerSource).toContain('guardAdminOAuth');
    });

    it('imports isOAuthAdminEnabled', () => {
      expect(routerSource).toContain('isOAuthAdminEnabled');
    });
  });

  describe('Route Matching', () => {
    it('matches /auth/login', () => {
      expect(routerSource).toContain("'/auth/login'");
    });

    it('matches /auth/callback', () => {
      expect(routerSource).toContain("'/auth/callback'");
    });

    it('matches /auth/logout', () => {
      expect(routerSource).toContain("'/auth/logout'");
    });

    it('adds auth route type', () => {
      expect(routerSource).toContain("type: 'auth'");
    });
  });

  describe('Environment Configuration', () => {
    it('adds GOOGLE_CLIENT_ID to RouterEnv', () => {
      expect(routerSource).toContain('GOOGLE_CLIENT_ID');
    });

    it('adds GOOGLE_CLIENT_SECRET to RouterEnv', () => {
      expect(routerSource).toContain('GOOGLE_CLIENT_SECRET');
    });

    it('adds OAUTH_REDIRECT_URI to RouterEnv', () => {
      expect(routerSource).toContain('OAUTH_REDIRECT_URI');
    });

    it('adds SESSION_SECRET to RouterEnv', () => {
      expect(routerSource).toContain('SESSION_SECRET');
    });

    it('adds ALLOWED_ADMIN_EMAILS to RouterEnv', () => {
      expect(routerSource).toContain('ALLOWED_ADMIN_EMAILS');
    });

    it('adds ALLOWED_ADMIN_DOMAINS to RouterEnv', () => {
      expect(routerSource).toContain('ALLOWED_ADMIN_DOMAINS');
    });
  });

  describe('Admin Page Protection', () => {
    it('checks isOAuthAdminEnabled for admin pages', () => {
      expect(routerSource).toContain("match.pageType === 'admin' && isOAuthAdminEnabled");
    });

    it('calls guardAdminOAuth for protected admin pages', () => {
      expect(routerSource).toContain('guardAdminOAuth(');
    });

    it('returns error response when guard fails', () => {
      expect(routerSource).toContain('oauthResult.errorResponse');
    });
  });

  describe('Router Version', () => {
    it('updates router version for SEC-IAC-03', () => {
      // SEC-IAC-03 was added in 1.21.0, current version may be higher
      expect(routerSource).toContain('1.21.0 - Admin OAuth with Google + Allowlist (SEC-IAC-03)');
    });

    it('documents SEC-IAC-03 in version history', () => {
      expect(routerSource).toContain('SEC-IAC-03');
    });
  });
});

// =============================================================================
// Auth Module Exports Tests
// =============================================================================

describe('SEC-IAC-03: Auth Module Exports', () => {
  describe('Module Barrel', () => {
    it('exports from oauthSession', () => {
      expect(authIndexSource).toContain("from './oauthSession'");
    });

    it('exports from googleOAuth', () => {
      expect(authIndexSource).toContain("from './googleOAuth'");
    });

    it('exports from adminAllowlist', () => {
      expect(authIndexSource).toContain("from './adminAllowlist'");
    });

    it('exports from adminOAuthGuard', () => {
      expect(authIndexSource).toContain("from './adminOAuthGuard'");
    });
  });

  describe('Session Exports', () => {
    it('exports createSessionCookie', () => {
      expect(authIndexSource).toContain('createSessionCookie');
    });

    it('exports parseSessionCookie', () => {
      expect(authIndexSource).toContain('parseSessionCookie');
    });

    it('exports SESSION_TTL_SECONDS', () => {
      expect(authIndexSource).toContain('SESSION_TTL_SECONDS');
    });
  });

  describe('OAuth Exports', () => {
    it('exports buildAuthorizationUrl', () => {
      expect(authIndexSource).toContain('buildAuthorizationUrl');
    });

    it('exports completeOAuthFlow', () => {
      expect(authIndexSource).toContain('completeOAuthFlow');
    });

    it('exports validateOAuthEnv', () => {
      expect(authIndexSource).toContain('validateOAuthEnv');
    });
  });

  describe('Allowlist Exports', () => {
    it('exports checkAllowlist', () => {
      expect(authIndexSource).toContain('checkAllowlist');
    });

    it('exports isAllowlistConfigured', () => {
      expect(authIndexSource).toContain('isAllowlistConfigured');
    });

    it('exports guardAdminAllowlist', () => {
      expect(authIndexSource).toContain('guardAdminAllowlist');
    });
  });

  describe('Guard Exports', () => {
    it('exports guardAdminOAuth', () => {
      expect(authIndexSource).toContain('guardAdminOAuth');
    });

    it('exports isOAuthAdminEnabled', () => {
      expect(authIndexSource).toContain('isOAuthAdminEnabled');
    });
  });
});

// =============================================================================
// Acceptance Criteria Tests
// =============================================================================

describe('SEC-IAC-03: Acceptance Criteria', () => {
  describe('AC: OAuth required for /admin', () => {
    it('guards admin page type with OAuth when enabled', () => {
      expect(routerSource).toContain("match.pageType === 'admin'");
      expect(routerSource).toContain('isOAuthAdminEnabled');
    });
  });

  describe('AC: Allowlist enforced server-side', () => {
    it('checks allowlist in callback handler', () => {
      expect(authRoutesSource).toContain('checkAllowlist');
      expect(authRoutesSource).toContain('allowlistResult.allowed');
    });

    it('checks allowlist in guard', () => {
      expect(adminOAuthGuardSource).toContain('checkAllowlist');
    });
  });

  describe('AC: No OAuth = 401', () => {
    it('creates 401 response for missing auth', () => {
      expect(adminOAuthGuardSource).toContain('status: 401');
    });

    it('redirects to login for page requests', () => {
      expect(adminOAuthGuardSource).toContain("'/auth/login'");
    });
  });

  describe('AC: OAuth but not allowlisted = 403', () => {
    it('creates 403 response for unauthorized', () => {
      expect(adminAllowlistSource).toContain('status: 403');
      expect(adminOAuthGuardSource).toContain('status: 403');
    });

    it('uses FORBIDDEN code', () => {
      expect(adminAllowlistSource).toContain("code: 'FORBIDDEN'");
    });
  });

  describe('AC: Session TTL = 15 minutes', () => {
    it('sets TTL to 900 seconds (15 * 60)', () => {
      expect(oauthSessionSource).toContain('SESSION_TTL_SECONDS = 15 * 60');
    });
  });

  describe('AC: HttpOnly session cookie', () => {
    it('sets HttpOnly flag', () => {
      expect(oauthSessionSource).toContain("'HttpOnly'");
    });
  });

  describe('AC: Signed, tamper-proof cookie', () => {
    it('uses HMAC-SHA256 for signing', () => {
      expect(oauthSessionSource).toContain('HMAC');
      expect(oauthSessionSource).toContain('SHA-256');
    });
  });

  describe('AC: Google OAuth with PKCE', () => {
    it('implements Auth Code flow', () => {
      expect(googleOAuthSource).toContain("response_type: 'code'");
    });

    it('implements PKCE with S256', () => {
      expect(googleOAuthSource).toContain("code_challenge_method: 'S256'");
    });

    it('sends code_verifier in token exchange', () => {
      expect(googleOAuthSource).toContain('code_verifier');
    });
  });

  describe('AC: Required Routes', () => {
    it('implements GET /auth/login', () => {
      expect(routerSource).toContain("'/auth/login'");
      expect(authRoutesSource).toContain('handleAuthLogin');
    });

    it('implements GET /auth/callback', () => {
      expect(routerSource).toContain("'/auth/callback'");
      expect(authRoutesSource).toContain('handleAuthCallback');
    });

    it('implements POST /auth/logout', () => {
      expect(routerSource).toContain("'/auth/logout'");
      expect(authRoutesSource).toContain('handleAuthLogout');
    });
  });

  describe('AC: Required Environment Variables', () => {
    it('documents GOOGLE_CLIENT_ID', () => {
      expect(routerSource).toContain('GOOGLE_CLIENT_ID');
    });

    it('documents GOOGLE_CLIENT_SECRET', () => {
      expect(routerSource).toContain('GOOGLE_CLIENT_SECRET');
    });

    it('documents OAUTH_REDIRECT_URI', () => {
      expect(routerSource).toContain('OAUTH_REDIRECT_URI');
    });

    it('documents SESSION_SECRET', () => {
      expect(routerSource).toContain('SESSION_SECRET');
    });

    it('documents ALLOWED_ADMIN_EMAILS', () => {
      expect(routerSource).toContain('ALLOWED_ADMIN_EMAILS');
    });

    it('documents ALLOWED_ADMIN_DOMAINS (optional)', () => {
      expect(routerSource).toContain('ALLOWED_ADMIN_DOMAINS');
    });
  });
});
