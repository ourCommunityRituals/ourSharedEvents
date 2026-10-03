// ─── Edge rate limiting (Cloudflare Workers Rate Limiting binding) ─────────────
//
// OSE-1509. The two limiters that existed before this could not stop a burst
// quickly:
//
//   - `lib/rate-limit.ts` counts in KV. KV is eventually consistent (up to ~60 s
//     between locations), so at 100+ requests a second a caller can get far past
//     the limit before the count catches up.
//   - `handlers/forms.ts` counts in one isolate's memory. Cloudflare spreads a
//     burst across isolates, so its 10/min per event barely slowed a burst; on
//     staging the form burst was stopped at #60 by the route's KV count
//     (60/min per IP), which is itself only eventually consistent.
//
// The `ratelimits` binding counts in memory at the Cloudflare location that
// receives the request and answers in well under a millisecond. Its shortest
// window is 10 s, but the block is applied the moment the count is crossed:
// at 100 requests a second a caller is cut off within the first fraction of a
// second. The product bar (PO, 2026-10-03): a flood is blocked within 3
// seconds, tops, and one person working at ~5 requests a second never is. So
// both limits are 60 per 10 s (6 a second): at 100 a second, the 61st request,
// about 0.6 s in, is the first one refused.
//
// The older limiters stay behind this one as backstops; this layer only adds.
//
// FAILS OPEN, like `public-read-limit.ts`: unbound (local dev, tests that do not
// bind it) or throwing → not limited. A speed bump must never become an outage.

/** The binding's runtime shape (`env.X.limit({ key })`). */
export interface EdgeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface EdgeRateLimitEnv {
  /** Public reads: 60 per 10 s per caller per scope (wrangler.toml `[[ratelimits]]`). */
  PUBLIC_READ_EDGE_LIMITER?: EdgeRateLimiter;
  /** Public form POSTs + self-delete: 60 per 10 s per caller per event (router.ts). */
  FORM_EDGE_LIMITER?: EdgeRateLimiter;
}

/** The window both bindings use, in seconds. The binding allows only 10 or 60. */
export const EDGE_WINDOW_SECONDS = 10;
/** Must match `PUBLIC_READ_EDGE_LIMITER`'s `simple.limit` in wrangler.toml. */
export const PUBLIC_READ_EDGE_MAX = 60;
/** Must match `FORM_EDGE_LIMITER`'s `simple.limit` in wrangler.toml. */
export const FORM_EDGE_MAX = 60;

/**
 * The caller's address, from Cloudflare only. `X-Forwarded-For` is client-
 * controlled, so it is no key for a limiter a caller is trying to escape. No
 * address (local dev, direct handler calls in tests) → no edge limit, as the
 * form handlers already treat a missing address. The address is a bucket key only: the
 * binding keeps it in memory for one window; it is never stored or logged here.
 */
export function edgeCallerIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP');
}

/** Has `key` gone past `limiter`'s limit? Fails open. */
export async function isEdgeLimited(
  limiter: EdgeRateLimiter | undefined,
  key: string
): Promise<boolean> {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

/** 429 for a request the edge layer refused: retry after one window. */
export function edgeLimitResponse(limit: number): Response {
  return Response.json(
    {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many requests. Please wait a moment before trying again.',
      retryAfter: EDGE_WINDOW_SECONDS,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(EDGE_WINDOW_SECONDS),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Window': `${EDGE_WINDOW_SECONDS}s`,
        'Cache-Control': 'no-store',
      },
    }
  );
}
