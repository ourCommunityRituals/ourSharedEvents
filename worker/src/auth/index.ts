/**
 * Authentication Module Exports
 *
 * Barrel file for exporting all authentication modules.
 *
 * @module auth
 * @see Story 3.1 - Define Admin Auth Model for Worker API
 * @see Story C1 - Admin Auth Gate (Admin Key)
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 */

// Admin Authentication (Story 3.1)
export {
  // Functions
  checkAdminAuth,
  requireAdminAuth,
  createAuthErrorResponse,
  isAuthConfigured,
  isAdminRoute,
  guardAdminRoute,
  logAuthAttempt,

  // Types
  type AdminAuthEnv,
  type AuthResult,
  type AuthContext,
  type AuthErrorCode,
  type AdminAuthErrorResponse,

  // Constants
  AUTH_ERROR_MESSAGES,
  AUTH_STATUS_CODES,
} from './adminAuth';

// Admin Key Authentication (Story C1) + Cloudflare Access (Story D4)
export {
  // Functions
  requireAdmin,
  isAdminKeyConfigured,
  createUnauthorizedResponse,
  createAdminKeyMissingResponse,
  isV2AdminRoute,
  guardV2AdminRoute,
  decodeCloudflareAccessJwt,

  // Types
  type AdminKeyEnv,
  type AdminAuthError,
  type AdminKeyMissingError,
  type CloudflareAccessJwtPayload,
  type JwtDecodeResult,
} from './admin';

// OAuth Session Management (SEC-IAC-03)
export {
  // Functions
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  createSessionCookie,
  parseSessionCookie,
  createPKCECookie,
  parsePKCECookie,
  buildSessionCookieHeader,
  buildPKCECookieHeader,
  buildClearSessionCookieHeader,
  buildClearPKCECookieHeader,
  getCookieValue,
  getSessionFromRequest,
  getPKCEFromRequest,

  // Types
  type OAuthSessionEnv,
  type SessionData,
  type PKCEState,
  type SessionValidationResult,

  // Constants
  SESSION_COOKIE_NAME,
  PKCE_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  PKCE_TTL_SECONDS,
} from './oauthSession';

// Google OAuth (SEC-IAC-03)
export {
  // Functions
  buildAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  completeOAuthFlow,
  validateOAuthEnv,
  createOAuthNotConfiguredResponse,

  // Types
  type GoogleOAuthEnv,
  type GoogleTokenResponse,
  type GoogleUserInfo,
  type GoogleOAuthError,

  // Constants
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  OAUTH_SCOPES,
} from './googleOAuth';

// Admin Allowlist (SEC-IAC-03)
export {
  // Functions
  parseAllowlist,
  extractDomain,
  isEmailAllowed,
  isDomainAllowed,
  checkAllowlist,
  isAllowlistConfigured,
  createForbiddenResponse,
  createAllowlistNotConfiguredResponse,
  guardAdminAllowlist,

  // Types
  type AdminAllowlistEnv,
  type AllowlistCheckResult,
  type AdminAccessError,
} from './adminAllowlist';

// Admin OAuth Guard (SEC-IAC-03)
export {
  // Functions
  guardAdminOAuth,
  isOAuthAdminEnabled,

  // Types
  type AdminOAuthEnv,
  type OAuthGuardResult,
} from './adminOAuthGuard';

// Public Read-Only Enforcement (SEC-IAC-04)
export {
  // Functions
  guardPublicReadOnly,
  shouldApplyPublicReadOnlyGuard,
  classifyRoute,
  isMutationMethod,
  isReadMethod,
  createWriteDeniedResponse,

  // Types
  type PublicReadOnlyEnv,
  type PublicReadOnlyResult,
  type PublicReadOnlyError,
  type RouteAccessLevel,

  // Constants
  MUTATION_METHODS,
  READ_METHODS,
} from './publicReadOnly';

// Signed Public Mutations (SEC-IAC-05)
export {
  // Functions
  guardSignedMutation,
  verifySignedMutation,
  createSignedMutationToken,
  createSignedMutationErrorResponse,
  computePayloadHash,
  isSignedMutationsConfigured,
  isNonceStorageConfigured,

  // Types
  type SignedMutationsEnv,
  type SignedMutationResult,
  type SignedMutationError,
  type SignedMutationErrorCode,
  type MutationTokenPayload,

  // Constants
  MUTATION_TOKEN_HEADER,
  MAX_CLOCK_SKEW_SECONDS,
  MIN_HMAC_SECRET_LENGTH,
} from './signedMutations';
