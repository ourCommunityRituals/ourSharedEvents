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

import {
  checkRateLimit,
  isBucketTripped,
  parseRateLimitEntry,
  rateLimitKvKey,
  type RateLimitEnv,
} from './rate-limit';
import {
  EDGE_WINDOW_SECONDS,
  PUBLIC_READ_EDGE_MAX,
  edgeCallerIp,
  isEdgeLimited,
  type EdgeRateLimitEnv,
} from './edge-rate-limit';

/**
 * Requests per minute per caller for a public read (the KV layer).
 *
 * 360/min is six per second sustained. The PO bar (2026-10-03, OSE-1509) is
 * that one person working fast — about 5 requests a second — is never
 * refused, while a flood is refused within 3 seconds. The flood half is the
 * edge layer's job (`PUBLIC_READ_EDGE_MAX` per 10 s); this per-minute count is
 * the backstop for a caller that stays under the edge limit. It was 120/min,
 * which refused a 5-per-second user after ~24 s. Enumerating a metro's ~2,800
 * corridor cells still takes about eight minutes.
 */
export const PUBLIC_READ_MAX = 360;

export type PublicReadLimitEnv = Partial<RateLimitEnv> & EdgeRateLimitEnv;

/**
 * Names the caller's bucket when it is something other than the address (a
 * bearer token). Return null to fall back to the address. The edge layer keeps
 * keying on the address either way: it is the flood layer, not the polling one.
 */
export type BucketKey = (request: Request) => string | null;

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
function callerKey(request: Request, scope: string, bucketKey?: BucketKey): string {
  // A route that authenticates with a bearer credential can bucket on THAT
  // instead of the address (OSE-1421: a signed-link holder polling a report is
  // one caller wherever they connect from). It is hashed with the rest of the
  // key before it touches KV (rate-limit.ts), so the credential is never stored.
  // No credential -> the address, as before.
  const own = bucketKey?.(request);
  if (own) return `publicread:${scope}:${own}`;
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown';
  return `publicread:${scope}:${ip}`;
}

/**
 * 429 with a Retry-After, so a well-behaved client can back off correctly.
 *
 * The headers describe the edge layer (OSE-1509), which is the one a burst
 * meets first: 60 per 10 s. The KV layer behind it (360 per minute) only
 * catches a caller that stays under the edge limit for a whole minute; such a
 * caller retrying after 10 s is simply refused again.
 */
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
        'Retry-After': String(EDGE_WINDOW_SECONDS),
        'X-RateLimit-Limit': String(PUBLIC_READ_EDGE_MAX),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Window': `${EDGE_WINDOW_SECONDS}s`,
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
  max: number = PUBLIC_READ_MAX,
  bucketKey?: BucketKey
): Promise<boolean> {
  // Edge layer first (OSE-1509): blocks a burst within its first fraction of a
  // second. Routes that raise the limit above the default (the sponsor logo
  // proxy, 300/min) skip it, so this layer never tightens a deliberate raise.
  const ip = edgeCallerIp(request);
  if (
    ip &&
    max <= PUBLIC_READ_MAX &&
    (await isEdgeLimited(env.PUBLIC_READ_EDGE_LIMITER, `${scope}:${ip}`))
  ) {
    return true;
  }
  try {
    // checkRateLimit fails open with no KV bound — see the header.
    return await checkRateLimit(env, callerKey(request, scope, bucketKey), max);
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
  max: number = PUBLIC_READ_MAX,
  bucketKey?: BucketKey
): (request: Request, env: E & PublicReadLimitEnv) => Promise<Response> {
  // The wrapper ADDS the KV requirement to whatever env the handler already
  // needs, rather than constraining the handler to know about rate limiting.
  // A handler should not have to declare a binding it never touches.
  return async (request: Request, env: E & PublicReadLimitEnv) => {
    if (await isPublicReadLimited(request, env, scope, max, bucketKey)) {
      return publicReadLimitResponse();
    }
    return handler(request, env);
  };
}

/**
 * Wrap a public route that COUNTS something on every request: a poster scan
 * (`/q/`) or a short-link click (`/s/`). OSE-1496.
 *
 * It never refuses. These are the links people scan off a poster, and a crowd
 * at a door shares one address, so a 429 would turn real people away. Instead
 * the handler is told whether this request may be counted. Past the limit the
 * visitor is still sent on and nothing is written, so one client cannot add
 * scans or clicks without end: not to inflate a count, and not to push a
 * node's count across the floor to learn whether one real person scanned.
 *
 * Same limit and same fail-open rule as `publicReadLimited`: with the limiter's
 * storage down, everything is counted.
 *
 * ONE DIFFERENCE, and it matters. A limit that stops counting can be turned
 * around: drain someone else's allowance and their real scans stop being
 * counted. So the bucket here is only ever the address Cloudflare reports
 * (`CF-Connecting-IP`). `publicReadLimited` falls back to `X-Forwarded-For`,
 * then to one shared bucket, which is the cautious direction for a read and the
 * wrong one for a count: a client could name the address to drain. With no
 * Cloudflare address the request is counted and not limited.
 *
 * What remains by design: callers who really do share an address (one venue's
 * Wi-Fi) share an allowance, so one of them flooding can stop the others being
 * counted for that minute. Any per-address limit has this property.
 */
export function publicCountLimited<E>(
  scope: string,
  handler: (request: Request, env: E, countable: boolean) => Promise<Response>,
  max: number = PUBLIC_READ_MAX
): (request: Request, env: E & PublicReadLimitEnv) => Promise<Response> {
  return async (request: Request, env: E & PublicReadLimitEnv) => {
    if (!edgeCallerIp(request)) return handler(request, env, true);
    return handler(request, env, !(await isPublicReadLimited(request, env, scope, max)));
  };
}

/**
 * Limit WRONG GUESSES at a short code, not visits. OSE-1684.
 *
 * An event code is six characters from 31, so about 887 million codes, and
 * every event gets one. The links it serves (/e/ /p/ /r/ /c/) sit behind
 * `publicCountLimited`, which never refuses, so without this a caller could try
 * codes without end and find events that are off the map, which before needed
 * the event's full id.
 *
 * Two calls, one bucket per caller and scope:
 * - `countGuess` records one wrong guess; true once the caller is past `max`.
 * - `isGuessLimited` only reads the bucket. A route checks it BEFORE looking a
 *   code up and refuses every code while it is true, right ones too: refusing
 *   only the misses would still tell a caller which codes are real.
 *
 * A right code never adds to the count, so a crowd sharing one address and one
 * link is never refused. KV only (no edge layer), so the two calls read and
 * write the same count. Same key and fail-open rule as `isPublicReadLimited`:
 * with KV down, nothing is refused.
 */
export async function countGuess(
  request: Request,
  env: PublicReadLimitEnv,
  scope: string,
  max: number
): Promise<boolean> {
  try {
    return await checkRateLimit(env, callerKey(request, scope), max);
  } catch {
    return false;
  }
}

export async function isGuessLimited(
  request: Request,
  env: PublicReadLimitEnv,
  scope: string
): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return false;
  try {
    const kvKey = await rateLimitKvKey(callerKey(request, scope), env.RATE_LIMIT_KEY_PEPPER);
    const entry = parseRateLimitEntry(await kv.get(kvKey));
    return entry !== null && Date.now() < entry.resetAt && isBucketTripped(entry);
  } catch {
    return false;
  }
}
