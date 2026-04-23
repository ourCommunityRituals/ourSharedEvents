/**
 * Admin email allowlist (OSE-211 / SEC-5)
 *
 * Validates the `email` claim from a Cloudflare Access JWT against an
 * operator-configured allowlist. Applied after CF Access JWT signature
 * validation passes (Method 1 in requireAdmin).
 *
 * Fail-safe: empty env vars → deny all. Never silently passes through on
 * misconfiguration. Methods 2 and 3 (X-OCR-Internal, ADMIN_KEY) bypass
 * this check — they carry no email identity and are used only for
 * CI/CD automation and staging fallback.
 *
 * Env vars:
 *   ALLOWED_ADMIN_EMAILS  — CSV of exact-match email addresses
 *   ALLOWED_ADMIN_DOMAINS — CSV of allowed domain suffixes
 *
 * Example:
 *   ALLOWED_ADMIN_EMAILS=mzdano@gmail.com,ops@oursharedevents.com
 *   ALLOWED_ADMIN_DOMAINS=oursharedevents.com
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdminAllowlistEnv {
  /** CSV of exact-match admin email addresses */
  ALLOWED_ADMIN_EMAILS?: string;
  /** CSV of allowed domain suffixes (e.g. "oursharedevents.com") */
  ALLOWED_ADMIN_DOMAINS?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseList(csv: string | undefined): string[] {
  if (!csv?.trim()) return [];
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function extractDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether an email is permitted by the allowlist.
 *
 * Returns false if both lists are empty — this is the fail-safe default.
 * An unconfigured allowlist means all CF Access JWT identities are denied.
 */
export function isAdminEmailAllowed(email: string, env: AdminAllowlistEnv): boolean {
  const emailLower = email.toLowerCase();
  const emails = parseList(env.ALLOWED_ADMIN_EMAILS);
  const domains = parseList(env.ALLOWED_ADMIN_DOMAINS);

  // Fail-safe: empty allowlist → deny all
  if (emails.length === 0 && domains.length === 0) return false;

  if (emails.includes(emailLower)) return true;

  const domain = extractDomain(emailLower);
  if (domain && domains.includes(domain)) return true;

  return false;
}

/**
 * Assert that an email is on the allowlist.
 *
 * Returns a 403 Response if the email is not allowed, null if it passes.
 * Use inline in requireAdmin — return the Response immediately if non-null.
 */
export function assertAdminEmailAllowed(
  email: string,
  env: AdminAllowlistEnv,
  requestId: string
): Response | null {
  if (isAdminEmailAllowed(email, env)) return null;
  return new Response(
    JSON.stringify({
      ok: false,
      status: 403,
      code: 'ADMIN_NOT_ALLOWED',
      error: 'This email address is not authorised for admin access.',
      requestId,
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    }
  );
}
