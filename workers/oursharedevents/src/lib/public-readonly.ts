/**
 * Public read-only guard (OSE-214 / SEC-7)
 *
 * Blanket guard that returns 405 Method Not Allowed when a mutating method
 * (POST, PUT, DELETE, PATCH) targets a public read-only API path.
 *
 * Call guardPublicReadOnly(method, pathname) at the top of route(), immediately
 * after the CORS preflight block, before any route matching. Return its result
 * directly if non-null.
 *
 * Exempted from this guard (intentional public mutations):
 *   - /api/v2/events/:id/forms/*          — form submissions (POST-only public)
 *   - /api/v2/events/:id/sponsors/:id/impression  — impression tracking
 *   - /api/v2/events/:id/sponsors/:id/click       — click tracking
 *   - /subscribe, /signup, /newsletter            — email capture
 *   - /api/v2/admin/*                             — admin routes (guarded by requireAdmin)
 *   - /auth/*                                     — auth routes
 *   - OPTIONS                                     — CORS preflight (handled upstream)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** HTTP methods that can mutate state — the guard fires only on these. */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Paths that are POST-only public endpoints, intentionally exempt from the
 * read-only guard. Checked before the read-only prefix list.
 */
const POST_ONLY_EXEMPTIONS: readonly RegExp[] = [
  // Public form submissions
  /^\/api\/v2\/events\/[^/]+\/forms\/(register|checkin|survey|email-signup)$/,
  // Sponsor interaction tracking
  /^\/api\/v2\/events\/[^/]+\/sponsors\/[^/]+\/(impression|click)$/,
  // Email / newsletter capture
  /^\/subscribe$/,
  /^\/signup$/,
  /^\/newsletter$/,
];

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the pathname is a public read-only API path.
 * Admin routes, auth routes, and page routes are excluded.
 */
function isPublicReadOnlyPath(pathname: string): boolean {
  // Public event API — GET only
  if (pathname === '/api/v2/events') return true;
  if (pathname.startsWith('/api/v2/events/')) return true;
  // R2 upload serving — GET only
  if (pathname.startsWith('/api/v2/uploads/')) return true;
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Guard public read-only paths against mutating HTTP methods.
 *
 * Returns a 405 Response if the request should be blocked, null to pass through.
 */
export function guardPublicReadOnly(method: string, pathname: string): Response | null {
  // Only inspect mutation methods
  if (!MUTATION_METHODS.has(method)) return null;

  // Skip admin and auth routes — handled by requireAdmin
  if (pathname.startsWith('/api/v2/admin/') || pathname.startsWith('/auth/')) return null;

  // Allow POST-only public exemptions through first
  for (const pattern of POST_ONLY_EXEMPTIONS) {
    if (pattern.test(pathname)) return null;
  }

  // Block mutations on public read-only paths
  if (!isPublicReadOnlyPath(pathname)) return null;

  return new Response(
    JSON.stringify({
      ok: false,
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      error: `${method} is not allowed on this endpoint.`,
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        Allow: 'GET, HEAD',
      },
    }
  );
}
