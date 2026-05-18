/**
 * In-isolate sliding-window rate limiter (OSE-201 / BE-11)
 *
 * Module-level Map keyed by client IP. Best-effort — resets on cold start.
 * First line of defence against form-submission spam. For hard enforcement,
 * configure Cloudflare Rate Limiting Rules at the edge.
 *
 * Ported from prior worker implementation.
 * Ref: https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
 */

/** Requests allowed per window per IP */
export const RATE_LIMIT_MAX = 60;

/** Window duration in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Module-level state — persists across requests within a single isolate lifetime.
// Intentionally not exported; all access is through the functions below.
const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Extract the best-available client IP from the request headers.
 * Prefers CF-Connecting-IP (set by Cloudflare for every inbound request),
 * falls back to X-Forwarded-For first segment, then 'unknown'.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') ?? '').split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Check whether the given IP has exceeded the rate limit.
 * Records the request; returns true if the limit is breached.
 *
 * @param ip - Client IP address (use clientIp() helper)
 */
export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    // New window
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

/**
 * Build a 429 Too Many Requests response with standard rate-limit headers.
 */
export function rateLimitResponse(): Response {
  return Response.json(
    {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many requests. Please wait a moment before trying again.',
      retryAfter: 60,
    },
    {
      status: 429,
      headers: {
        'Retry-After': '60',
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Window': '60s',
        'Content-Type': 'application/json',
      },
    }
  );
}

/** Flush the rate-limit map (test helper only — not exported to production code paths). */
export function _flushRateLimitMap(): void {
  rateLimitMap.clear();
}
