/**
 * KV-backed sliding-window rate limiter (OSE-552 / BE-11)
 *
 * Per-IP state stored in CF KV with TTL — persists across cold starts and
 * isolates. Key: `ratelimit:{hmac of the key}`, value: JSON { count, resetAt, max }.
 *
 * Ref: https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys
 */

/** Requests allowed per window per IP (public form endpoints) */
export const RATE_LIMIT_MAX = 60;

/** Window duration in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Per-endpoint limits (OSE-576) */
export const RATE_LIMIT_ADMIN_MAX = 60; // admin mutations: 60 req/min by CF-Ray-ID
export const RATE_LIMIT_BATCH_MAX = 30; // SharedReport batch: 30 req/min by service token
export const RATE_LIMIT_MINT_MAX = 10; // mint endpoint: 10 req/min by actor+eventId

/**
 * What the limiter needs from the Worker env. Callers pass `env` itself, so the
 * pepper travels with the KV binding and cannot be left out.
 */
export interface RateLimitEnv {
  RATE_LIMIT_KV: KVNamespace;
  /**
   * HMAC key for rate-limit bucket names (OSE-1447 follow-up). Its own secret,
   * not IP_HASH_PEPPER: separate peppers, separate rotation (OSE-272 Q1).
   * Rotating it is free: rate-limit buckets live one window (60 s) and beacon
   * dedup keys IMPRESSION_DEDUP_TTL_SECONDS (300 s), so old keys age out within
   * five minutes and a rotation only resets counts.
   */
  RATE_LIMIT_KEY_PEPPER?: string;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
  /**
   * The limit this bucket enforces (10 mint, 30 batch, 60 default, 120 public
   * reads). Stored so scans can tell which buckets are actually blocked; absent
   * on entries written before this field existed (≤ 60 s old).
   */
  max?: number;
}

/** The limit a stored bucket enforces; entries from before `max` existed use the default. */
/** A stored bucket value, or null when it is missing or not a bucket. */
export function parseRateLimitEntry(raw: string | null): RateLimitEntry | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as RateLimitEntry | null;
    return typeof v?.count === 'number' && typeof v.resetAt === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function bucketLimit(entry: RateLimitEntry): number {
  return entry.max ?? RATE_LIMIT_MAX;
}

/** Has this stored bucket tripped its own limit? The one rule for every KV scan. */
export function isBucketTripped(entry: RateLimitEntry): boolean {
  return entry.count > bucketLimit(entry);
}

/** Shorter peppers are ignored, matching the other hash peppers (min 32 chars). */
export const RATE_LIMIT_PEPPER_MIN_LENGTH = 32;

/**
 * Data-at-rest doctrine (A-5): the rate-limit KV key must NOT contain the raw
 * client IP. The caller-supplied key (which may embed an IP, plus a route/scope
 * prefix such as `admin:` or `mint:`) is hashed before it becomes the KV key;
 * the hash is deterministic, so rate-limit semantics are unchanged.
 *
 * OSE-1447: a bare SHA-256 of an IPv4-bearing key reverses offline (2^32
 * guesses), and `GET /security/rate-limit-stats` lists these keys. With
 * `RATE_LIMIT_KEY_PEPPER` set the key is HMAC-SHA256 under that secret. Unset
 * (or too short) keeps the old SHA-256, so a missing secret degrades privacy to
 * the previous state instead of breaking rate limiting; it is logged once per
 * isolate as RATE_LIMIT_PEPPER_MISSING. The deploy gates require the secret.
 */
let cachedKey: { pepper: string; key: Promise<CryptoKey> } | undefined;
let warnedMissingPepper = false;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hmacKey(pepper: string): Promise<CryptoKey> {
  if (cachedKey?.pepper !== pepper) {
    const key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pepper),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    // Never keep a failed import: the next call retries (same rule as lib/pii.ts).
    key.catch(() => {
      if (cachedKey?.key === key) cachedKey = undefined;
    });
    cachedKey = { pepper, key };
  }
  return cachedKey.key;
}

/** Peppered hash for any IP-bearing KV key (rate-limit buckets, beacon dedup). */
export async function pepperedKeyHash(input: string, pepper?: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  if (!pepper || pepper.length < RATE_LIMIT_PEPPER_MIN_LENGTH) {
    if (!warnedMissingPepper) {
      warnedMissingPepper = true;
      console.log(
        JSON.stringify({
          type: 'RATE_LIMIT_PEPPER_MISSING',
          note: 'Rate-limit KV keys use unpeppered SHA-256. Set wrangler secret RATE_LIMIT_KEY_PEPPER.',
        })
      );
    }
    return toHex(await crypto.subtle.digest('SHA-256', data));
  }
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(pepper), data));
}

const KEY_PREFIX = 'ratelimit:';

/** The KV key a rate-limit `key` is stored under. */
export async function rateLimitKvKey(key: string, pepper?: string): Promise<string> {
  return `${KEY_PREFIX}${await pepperedKeyHash(key, pepper)}`;
}

/**
 * Every stored bucket as `{ id, entry }` (`id` is the keyed hash after the
 * prefix). Shared by rate-limit-stats and the security-metrics cron. KV list is
 * eventually consistent, so results are best-effort. Malformed values are skipped.
 */
export async function* scanRateLimitBuckets(
  kv: KVNamespace
): AsyncGenerator<{ id: string; entry: RateLimitEntry }> {
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: KEY_PREFIX, limit: 1000, cursor });
    // Values in parallel batches of 50 to avoid fan-out explosion.
    for (let i = 0; i < page.keys.length; i += 50) {
      const batch = page.keys.slice(i, i + 50);
      const values = await Promise.all(batch.map((k) => kv.get(k.name)));
      for (let j = 0; j < batch.length; j++) {
        const entry = parseRateLimitEntry(values[j]);
        if (entry) yield { id: batch[j].name.slice(KEY_PREFIX.length), entry };
      }
    }
    cursor = page.list_complete ? undefined : (page as { cursor?: string }).cursor;
  } while (cursor);
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
 * Core sliding-window rate limit check against an arbitrary key. Pass `env`.
 * Returns true if the caller has exceeded `max` requests in `windowMs`. With no
 * RATE_LIMIT_KV bound it returns false: the limiter fails open, as every caller
 * already did.
 */
export async function checkRateLimit(
  env: Partial<RateLimitEnv>,
  key: string,
  max: number = RATE_LIMIT_MAX,
  windowMs: number = RATE_LIMIT_WINDOW_MS
): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return false;
  const now = Date.now();
  const kvKey = await rateLimitKvKey(key, env.RATE_LIMIT_KEY_PEPPER);
  const entry = parseRateLimitEntry(await kv.get(kvKey));

  if (!entry || now >= entry.resetAt) {
    await kv.put(kvKey, JSON.stringify({ count: 1, resetAt: now + windowMs, max }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });
    return false;
  }

  const newCount = entry.count + 1;
  await kv.put(kvKey, JSON.stringify({ count: newCount, resetAt: entry.resetAt, max }), {
    expirationTtl: Math.max(60, Math.ceil((entry.resetAt - now) / 1000)),
  });
  return newCount > max;
}

/** Per-IP check at the default limit. Records the request; true if breached. */
export async function isRateLimited(env: Partial<RateLimitEnv>, ip: string): Promise<boolean> {
  return checkRateLimit(env, ip);
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
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Window': '60s',
        'Content-Type': 'application/json',
      },
    }
  );
}

/** Delete the KV entry for a given key (test helper — never call from production paths). */
export async function _deleteRateLimitKey(env: RateLimitEnv, key: string): Promise<void> {
  // Must hash identically to checkRateLimit so the delete targets the real key.
  await env.RATE_LIMIT_KV.delete(await rateLimitKvKey(key, env.RATE_LIMIT_KEY_PEPPER));
}
