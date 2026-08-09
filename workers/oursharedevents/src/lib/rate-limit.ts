/**
 * KV-backed sliding-window rate limiter (OSE-552 / BE-11)
 *
 * Per-IP state stored in CF KV with TTL — persists across cold starts and
 * isolates. Key: `ratelimit:{ip}`, value: JSON { count, resetAt }.
 *
 * Ref: https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys
 */

/** Requests allowed per window per IP (public form endpoints) */
export const RATE_LIMIT_MAX = 60;

/** Window duration in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Per-endpoint limits (OSE-576) */
export const RATE_LIMIT_ADMIN_MAX = 60;  // admin mutations: 60 req/min by CF-Ray-ID
export const RATE_LIMIT_BATCH_MAX = 30;  // SharedReport batch: 30 req/min by service token
export const RATE_LIMIT_MINT_MAX = 10;   // mint endpoint: 10 req/min by actor+eventId

export interface RateLimitEnv {
  RATE_LIMIT_KV: KVNamespace;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

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
 * Core sliding-window rate limit check against an arbitrary KV key.
 * Returns true if the caller has exceeded `max` requests in `windowMs`.
 */
export async function checkRateLimit(
  key: string,
  kv: KVNamespace,
  max: number = RATE_LIMIT_MAX,
  windowMs: number = RATE_LIMIT_WINDOW_MS
): Promise<boolean> {
  const now = Date.now();
  const kvKey = `ratelimit:${key}`;
  const raw = await kv.get(kvKey);
  const entry = raw ? (JSON.parse(raw) as RateLimitEntry) : null;

  if (!entry || now >= entry.resetAt) {
    await kv.put(kvKey, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });
    return false;
  }

  const newCount = entry.count + 1;
  await kv.put(kvKey, JSON.stringify({ count: newCount, resetAt: entry.resetAt }), {
    expirationTtl: Math.max(60, Math.ceil((entry.resetAt - now) / 1000)),
  });
  return newCount > max;
}

/**
 * Check whether the given IP has exceeded the rate limit.
 * Records the request; returns true if the limit is breached.
 *
 * @param ip  - Client IP address (use clientIp() helper)
 * @param kv  - RATE_LIMIT_KV namespace from env
 */
export async function isRateLimited(ip: string, kv: KVNamespace): Promise<boolean> {
  return checkRateLimit(ip, kv, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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

/** Delete the KV entry for a given key (test helper — never call from production paths). */
export async function _deleteRateLimitKey(key: string, kv: KVNamespace): Promise<void> {
  await kv.delete(`ratelimit:${key}`);
}
