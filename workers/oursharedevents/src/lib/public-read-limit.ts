// ─── Rate limiting for public read endpoints ───────────────────────────────────
//
// OSE-1247. `lib/rate-limit.ts` has worked for a long time and is applied to
// admin mutations and SharedReport minting — by hand, per route. That shape
// means the SAFE path requires someone to remember, and every new public route
// starts unlimited. `GET /api/v2/events/map` is what made it concrete: its
// `cell` parameter is an index over geography, a metro is roughly 2,800 res-7
// cells, and with no limit the endpoint is a bulk export of every event with
// coordinates at whatever rate a caller likes.
//
// This module inverts the default for READS. `publicReadLimited()` wraps a
// handler; the unlimited path becomes the one that has to be written out and
// justified, rather than the one you get by forgetting.
//
// WHY READS ARE THEIR OWN THING. A write limit protects data. A read limit
// protects the SUBJECTS of the data — the people whose gatherings are listed —
// and it is sized differently: generous enough that a real reader refreshing a
// map is never touched, tight enough that enumerating a region is slow enough
// to notice.
//
// FAILS OPEN, DELIBERATELY. If KV is unbound or throws, the request is served.
// A rate limiter that takes the public surface down when its own storage has a
// bad minute has done more damage than the abuse it exists to slow. The limiter
// is a speed bump on a scraper, not an authentication boundary, and it should
// never be load-bearing enough to be worth an outage.

import { checkRateLimit, type RateLimitEnv } from './rate-limit';

/**
 * Requests per minute per caller for a public read.
 *
 * 120/min is two per second sustained. A reader panning a map, a page
 * refreshing its list, a poster QR being scanned by a queue of people at a door
 * — none of these come close. Enumerating a metro's ~2,800 corridor cells does.
 */
export const PUBLIC_READ_MAX = 120;

export type PublicReadLimitEnv = Partial<RateLimitEnv>;

/**
 * Identify the caller.
 *
 * `CF-Connecting-IP` is Cloudflare's client address. It is used as a RATE
 * BUCKET KEY only — never stored, never logged, never joined to anything. This
 * module must not become a place where an address is retained; that is what
 * Invariant #1 is about, and a rate limiter is exactly the kind of well-meant
 * infrastructure that quietly starts keeping one.
 *
 * When there is no address (direct invocation, some test contexts), callers
 * share one bucket. That is the conservative direction: a shared bucket
 * throttles more, never less.
 */
function callerKey(request: Request, scope: string): string {
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown';
  return `publicread:${scope}:${ip}`;
}

/** 429 with a Retry-After, so a well-behaved client can back off correctly. */
export function publicReadLimitResponse(): Response {
  return Response.json(
    {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      error: 'Too many requests. Please slow down and try again shortly.',
    },
    {
      status: 429,
      headers: {
        'Retry-After': '60',
        'X-RateLimit-Limit': String(PUBLIC_READ_MAX),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Window': '60s',
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * Has this caller exceeded the public read limit for `scope`?
 *
 * `scope` separates buckets per endpoint, so hammering the map does not
 * throttle someone reading the list.
 */
export async function isPublicReadLimited(
  request: Request,
  env: PublicReadLimitEnv,
  scope: string,
  max: number = PUBLIC_READ_MAX
): Promise<boolean> {
  try {
    // checkRateLimit fails open with no KV bound — see the header.
    return await checkRateLimit(env, callerKey(request, scope), max);
  } catch {
    return false;
  }
}

/**
 * Wrap a public read handler so the limit is applied by default.
 *
 * Written as a wrapper rather than a router-level middleware on purpose: it
 * shows up at the call site, so a route that is NOT limited is visibly not
 * limited when you read the router, instead of being absent from a list
 * somewhere else.
 */
export function publicReadLimited<E>(
  scope: string,
  handler: (request: Request, env: E) => Promise<Response>,
  max: number = PUBLIC_READ_MAX
): (request: Request, env: E & PublicReadLimitEnv) => Promise<Response> {
  // The wrapper ADDS the KV requirement to whatever env the handler already
  // needs, rather than constraining the handler to know about rate limiting.
  // A handler should not have to declare a binding it never touches.
  return async (request: Request, env: E & PublicReadLimitEnv) => {
    if (await isPublicReadLimited(request, env, scope, max)) {
      return publicReadLimitResponse();
    }
    return handler(request, env);
  };
}
