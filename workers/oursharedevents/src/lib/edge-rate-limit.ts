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
// receives the request. Its shortest window is 10 s. The product bar (PO,
// 2026-10-03): a flood is blocked within 3 seconds, tops, and one person
// working at ~5 requests a second never is. So both limits are 60 per 10 s.
//
// MEASURED, NOT ASSUMED: locally (miniflare) the 61st request of a burst is
// refused. On staging (T5 run 37098251345, 2026-10-03) the binding let about
// 500 public reads through over ~20 s before its first 429, and never refused
// a 180-request form burst. Its counts are synchronised in the background, so
// it does not meet the 3-second bar on its own. The bar needs a layer that
// counts in the request path at the edge: a Cloudflare WAF rate-limiting rule
// (OSE-1509). This layer stays as the in-Worker defence behind it.
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
  } catch (err) {
    // OSE-1509 DoD: fail open, but say so. No key in the log: it holds an IP.
    console.warn(
      JSON.stringify({
        type: 'EDGE_RATE_LIMIT_FAIL_OPEN',
        error: err instanceof Error ? err.message : String(err),
      })
    );
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
