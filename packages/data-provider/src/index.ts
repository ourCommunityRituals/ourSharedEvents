/**
 * @ocr/data-provider — Shared DataProvider foundation for OCR Workers.
 *
 * Exports:
 *   - Core types:  DataSource, DataResult<T>, DataProviderError, DataProviderCtx
 *   - CF Cache API helpers: makeCacheKey, readCfCache, writeCfCache, CacheTtlConfig
 *
 * Each app (OSE, OSM, OW) has its own concrete DataProvider class that uses
 * these shared primitives.  Domain methods, env shapes, and mock fixtures are
 * app-specific and live in each app's own `src/lib/data-provider.ts`.
 *
 * CF Cache API compatibility
 * ──────────────────────────
 * `caches.default` is a CF Workers global.  The helpers here call it inside
 * try/catch so they degrade gracefully in Node.js unit-test environments
 * (where `caches` is not defined) — returning null and skipping cache I/O.
 */

// ── Core types ─────────────────────────────────────────────────────────────────

export type DataSource = 'live' | 'cache' | 'mock';

export interface DataResult<T> {
  data: T;
  source: DataSource;
  /**
   * Milliseconds since the entry was written to the CF cache.
   * null for 'live' responses (freshly fetched) and 'mock' responses.
   */
  cacheAge: number | null;
}

export class DataProviderError extends Error {
  constructor(
    message: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'DataProviderError';
  }
}

/**
 * Minimal execution context interface — structurally compatible with
 * Cloudflare's `ExecutionContext` so callers can pass it without importing
 * `@cloudflare/workers-types`.
 */
export interface DataProviderCtx {
  waitUntil(promise: Promise<unknown>): void;
}

// ── CF Cache API helpers ────────────────────────────────────────────────────────

export interface CacheTtlConfig {
  /** Seconds a cached entry is considered fresh (served immediately). */
  ttlSeconds: number;
  /**
   * Seconds beyond ttl during which a stale entry is served while a
   * background revalidation runs (stale-while-revalidate).  Default 300.
   */
  swrSeconds?: number;
}

export const DEFAULT_TTL: CacheTtlConfig = {
  ttlSeconds: 60,
  swrSeconds: 300,
};

const CACHE_BASE_URL = 'https://dp-cache.internal/v1';

/** Construct a synthetic HTTPS cache key from a resource path. */
export function makeCacheKey(path: string): Request {
  return new Request(`${CACHE_BASE_URL}/${path}`);
}

/** Returns `caches.default` or null when unavailable (Node.js / tests). */
export async function getCfCache(): Promise<Cache | null> {
  try {
    // `caches` is a CF Workers global — may be undefined in Node environments.
    return (globalThis as unknown as { caches: { default: Cache } }).caches.default ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a typed value from the CF Cache.
 * Returns `{ data, age }` where `age` is milliseconds since the entry was
 * written.  Returns null on cache miss, parse error, or unavailable cache.
 */
export async function readCfCache<T>(key: Request): Promise<{ data: T; age: number } | null> {
  const cache = await getCfCache();
  if (!cache) return null;
  try {
    const resp = await cache.match(key);
    if (!resp) return null;
    const cachedAt = Number(resp.headers.get('X-Cached-At') ?? '0');
    if (!cachedAt) return null;
    const age = Date.now() - cachedAt;
    const data = (await resp.json()) as T;
    return { data, age };
  } catch {
    return null;
  }
}

/**
 * Write a typed value to the CF Cache.
 * The response is stored with a `Cache-Control: max-age` of `ttl + swr`
 * so CF keeps the entry alive through the stale-while-revalidate window.
 * Freshness within that window is tracked by the `X-Cached-At` header.
 */
export async function writeCfCache<T>(key: Request, data: T, ttl: CacheTtlConfig): Promise<void> {
  const cache = await getCfCache();
  if (!cache) return;
  try {
    const maxAge = ttl.ttlSeconds + (ttl.swrSeconds ?? 300);
    const resp = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${maxAge}`,
        'X-Cached-At': String(Date.now()),
      },
    });
    await cache.put(key, resp);
  } catch {
    // Silently ignore — cache write failures are non-fatal.
  }
}
