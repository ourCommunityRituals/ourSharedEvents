/**
 * Admin Allowlist Validation
 *
 * Server-side enforcement of admin access via email and domain allowlists.
 * Returns 403 Forbidden for authenticated users not on allowlist.
 *
 * @module auth/adminAllowlist
 * @see SEC-IAC-03 - Admin OAuth & Allowlist
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Environment variables for admin allowlist
 */
export interface AdminAllowlistEnv {
  /**
   * Comma-separated list of allowed admin emails
   * Example: "admin@company.com,user@company.com"
   */
  ALLOWED_ADMIN_EMAILS?: string;

  /**
   * Comma-separated list of allowed admin domains (optional)
   * Example: "company.com,partner.org"
   * If set, any email from these domains is allowed
   */
  ALLOWED_ADMIN_DOMAINS?: string;
}

/**
 * Result of allowlist check
 */
export interface AllowlistCheckResult {
  allowed: boolean;
  reason?: 'email_match' | 'domain_match';
  matchedValue?: string;
}

/**
 * Admin access error response
 */
export interface AdminAccessError {
  ok: false;
  status: 403;
  code: 'FORBIDDEN';
  message: string;
  requestId: string;
}

// =============================================================================
// Allowlist Parsing
// =============================================================================

/**
 * Parse comma-separated allowlist into normalized array
 *
 * @param allowlist - Comma-separated list string
 * @returns Array of lowercase, trimmed values (empty entries removed)
 */
export function parseAllowlist(allowlist: string | undefined): string[] {
  if (!allowlist || allowlist.trim() === '') {
    return [];
  }

  return allowlist
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Extract domain from email address
 *
 * @param email - Email address
 * @returns Domain portion (lowercase) or null if invalid
 */
export function extractDomain(email: string): string | null {
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[1]) {
    return null;
  }
  return parts[1].toLowerCase();
}

// =============================================================================
// Allowlist Checking
// =============================================================================

/**
 * Check if email is in allowed emails list
 */
export function isEmailAllowed(email: string, allowedEmails: string[]): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  return allowedEmails.includes(normalizedEmail);
}

/**
 * Check if email domain is in allowed domains list
 */
export function isDomainAllowed(email: string, allowedDomains: string[]): boolean {
  const domain = extractDomain(email);
  if (!domain) {
    return false;
  }
  return allowedDomains.includes(domain);
}

/**
 * Check if email is allowed by either email or domain allowlist
 *
 * @param email - User's email address
 * @param env - Environment with allowlist configuration
 * @returns AllowlistCheckResult with allowed status and match reason
 */
export function checkAllowlist(
  email: string,
  env: AdminAllowlistEnv
): AllowlistCheckResult {
  const allowedEmails = parseAllowlist(env.ALLOWED_ADMIN_EMAILS);
  const allowedDomains = parseAllowlist(env.ALLOWED_ADMIN_DOMAINS);

  const normalizedEmail = email.toLowerCase().trim();

  // Check email allowlist first (more specific)
  if (isEmailAllowed(normalizedEmail, allowedEmails)) {
    return {
      allowed: true,
      reason: 'email_match',
      matchedValue: normalizedEmail,
    };
  }

  // Check domain allowlist
  const domain = extractDomain(normalizedEmail);
  if (domain && isDomainAllowed(normalizedEmail, allowedDomains)) {
    return {
      allowed: true,
      reason: 'domain_match',
      matchedValue: domain,
    };
  }

  // Not allowed
  return { allowed: false };
}

/**
 * Check if allowlist is configured
 *
 * @param env - Environment with allowlist configuration
 * @returns True if at least one allowlist has entries
 */
export function isAllowlistConfigured(env: AdminAllowlistEnv): boolean {
  const allowedEmails = parseAllowlist(env.ALLOWED_ADMIN_EMAILS);
  const allowedDomains = parseAllowlist(env.ALLOWED_ADMIN_DOMAINS);
  return allowedEmails.length > 0 || allowedDomains.length > 0;
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Create 403 Forbidden response for non-allowlisted users
 */
export function createForbiddenResponse(
  email: string,
  requestId: string
): Response {
  const body: AdminAccessError = {
    ok: false,
    status: 403,
    code: 'FORBIDDEN',
    message: `User ${email} is not authorized for admin access`,
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

/**
 * Create 401 Unauthorized response for missing authentication
 */
export function createUnauthorizedResponse(requestId: string): Response {
  const body = {
    ok: false,
    status: 401,
    code: 'UNAUTH',
    message: 'Authentication required',
    requestId,
  };

  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="EventAngle Admin"',
      'X-Request-Id': requestId,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

/**
 * Create 503 response when allowlist is not configured
 */
export function createAllowlistNotConfiguredResponse(requestId: string): Response {
  const body = {
    ok: false,
    status: 503,
    code: 'ALLOWLIST_NOT_CONFIGURED',
    message: 'Admin allowlist not configured. Set ALLOWED_ADMIN_EMAILS or ALLOWED_ADMIN_DOMAINS.',
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

// =============================================================================
// Guard Functions
// =============================================================================

/**
 * Guard function to verify admin session and allowlist
 *
 * Usage:
 *   const error = await guardAdminOAuth(request, env, requestId);
 *   if (error) return error;
 *   // ... handle authenticated + authorized request
 *
 * @param session - Validated session data (or null if no session)
 * @param env - Environment with allowlist configuration
 * @param requestId - Request ID for error responses
 * @returns Error Response if not authorized, null if authorized
 */
export function guardAdminAllowlist(
  email: string | null,
  env: AdminAllowlistEnv,
  requestId: string
): Response | null {
  // No session = 401 Unauthorized
  if (!email) {
    return createUnauthorizedResponse(requestId);
  }

  // Check if allowlist is configured
  if (!isAllowlistConfigured(env)) {
    console.warn('[AdminAllowlist] No allowlist configured');
    return createAllowlistNotConfiguredResponse(requestId);
  }

  // Check allowlist
  const result = checkAllowlist(email, env);

  if (!result.allowed) {
    console.warn(`[AdminAllowlist] User ${email} not in allowlist`);
    return createForbiddenResponse(email, requestId);
  }

  console.log(`[AdminAllowlist] User ${email} authorized via ${result.reason}: ${result.matchedValue}`);
  return null;
}
