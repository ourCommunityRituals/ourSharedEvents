/**
 * resolution-cache.ts — KV read-through cache for the tracking-hot-path
 * resolvers. Engine-hardening #2 (OSE-963 / OSE-1090 KV row).
 *
 * WHY: `/q/` (qr_token → deployment) and `/s/` (code → destination) each do a
 * D1 read on every hit. During an evening scan peak that is one D1 read per
 * scan. This lib fronts those reads with Cloudflare KV so the peak is absorbed
 * at the edge cache instead of D1 — the "cache" half of "cache then observe".
 *
 * DOCTRINE (pinned by resolution-cache.spec.ts):
 *   - FAIL-OPEN. KV unbound or throwing → fall straight through to the source
 *     loader. A cache fault must never strand an attendee; the resolver behaves
 *     exactly as it does today when there is no KV. This is why the binding is
 *     optional and dark-launched.
 *   - BOUNDED TTL. Every write carries an expirationTtl, so a stale entry
 *     self-evicts even with no explicit purge (the read-your-writes floor).
 *   - NEGATIVE CACHE (short TTL). An unknown/inactive key is remembered briefly
 *     so a flood of bad tokens does not become a flood of D1 reads.
 *   - SELECTIVE PURGE. `purgeResolution` deletes ONE key — never a blanket bust
 *     (OSE-962 spine: selective invalidation, server-authoritative).
 *
 * NEVER-WHO: the cached payload is the caller's contract and MUST be
 * non-identifying resolution data only (deployment_id / event_id / target_url).
 * This lib is payload-agnostic and stores whatever it is given — do not pass a
 * value derived from anon_id, IP, cookie, or any WHO signal.
 *
 * VERSIONED KEYS: keys carry a `v1` segment so a future coordinated
 * invalidation is a version bump (chosen over a Durable Object coordinator —
 * DOs are reserved for the live display, OSE-1339).
 */

/** KV binding for the resolution cache. Optional → dark-launched, fail-open. */
export interface ResolutionCacheEnv {
  RESOLVE_CACHE_KV?: KVNamespace;
}

/** Positive-hit TTL (seconds). Bounded so an admin change self-heals even if a
 * purge is missed; short enough that resolution data stays fresh. */
export const RESOLUTION_CACHE_TTL_SECONDS = 60;

/** Negative-hit TTL (seconds). Deliberately shorter than the positive TTL: an
 * unknown token is often a newly-minted one about to become valid, so we do not
 * want to deny it for long. */
export const RESOLUTION_NEGATIVE_TTL_SECONDS = 15;

const KEY_VERSION = 'v1';

/** Cache key for a `/q/` poster-deployment resolution. */
export function deploymentCacheKey(qrToken: string): string {
  return `rc:${KEY_VERSION}:qr:${qrToken}`;
}

/** Cache key for a `/s/` shortlink resolution. Namespaced apart from `qr:` so a
 * token that happens to equal a code can never collide. */
export function shortlinkCacheKey(code: string): string {
  return `rc:${KEY_VERSION}:sl:${code}`;
}

/**
 * Outcome of a read-through, surfaced so the caller can emit a bounded
 * never-who CACHE_EVENT (the "observe" seed) without this lib taking a
 * dependency on a logger.
 *   hit          — served a positive entry from cache; source not called
 *   negative_hit — served a remembered miss from cache; source not called
 *   miss         — cache empty; source called and the result written back
 *   bypass       — no KV bound; source called (today's behaviour)
 *   error        — KV.get threw; source called (fail-open)
 */
export type CacheOutcome = 'hit' | 'negative_hit' | 'miss' | 'bypass' | 'error';

export interface CacheResult<T> {
  value: T | null;
  outcome: CacheOutcome;
}

interface ReadThroughOptions {
  ttlSeconds?: number;
  negativeTtlSeconds?: number;
}

type StoredEntry<T> = { hit: T } | { miss: true };

/**
 * Read `key` from KV; on a miss run `loader` (the D1 read) and write the result
 * back. Fail-open on every KV fault. `loader` returning null is a real "not
 * found" and is negatively cached; a `loader` that throws (a source fault, not
 * a cache fault) propagates unchanged — the resolver keeps today's error
 * handling.
 */
export async function readThroughResolution<T>(
  kv: KVNamespace | undefined,
  key: string,
  loader: () => Promise<T | null>,
  opts: ReadThroughOptions = {}
): Promise<CacheResult<T>> {
  const ttl = opts.ttlSeconds ?? RESOLUTION_CACHE_TTL_SECONDS;
  const negativeTtl = opts.negativeTtlSeconds ?? RESOLUTION_NEGATIVE_TTL_SECONDS;

  if (!kv) {
    return { value: await loader(), outcome: 'bypass' };
  }

  let cached: string | null;
  try {
    cached = await kv.get(key);
  } catch {
    // Cache read fault — fall open to the source rather than strand the caller.
    return { value: await loader(), outcome: 'error' };
  }

  if (cached !== null) {
    const parsed = safeParse<StoredEntry<T>>(cached);
    if (parsed) {
      if ('miss' in parsed && parsed.miss === true) {
        return { value: null, outcome: 'negative_hit' };
      }
      if ('hit' in parsed) {
        return { value: parsed.hit, outcome: 'hit' };
      }
    }
    // Corrupt/unknown-shape entry — ignore it and reload.
  }

  const value = await loader();
  const entry: StoredEntry<T> = value === null ? { miss: true } : { hit: value };
  const writeTtl = value === null ? negativeTtl : ttl;
  try {
    await kv.put(key, JSON.stringify(entry), { expirationTtl: writeTtl });
  } catch {
    // Write fault is non-fatal — the value is already resolved; just skip caching.
  }
  return { value, outcome: 'miss' };
}

/**
 * Selectively evict ONE key (the entity an admin just changed — e.g. a
 * deployment deactivated or a shortlink retargeted). Never a blanket bust.
 * No-op and never throws when KV is unbound.
 */
export async function purgeResolution(
  kv: KVNamespace | undefined,
  key: string
): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch {
    // A failed purge only means the stale entry lives out its bounded TTL.
  }
}

/**
 * Emit the bounded, never-who cache-hit-rate signal (the "observe" seed of
 * engine-hardening #3). Never-who BY CONSTRUCTION: the signature accepts only a
 * surface and an outcome — there is no parameter through which a qr_token,
 * shortlink code, anon_id, or event_id could be logged. Aggregating CACHE_EVENT
 * by {surface, outcome} yields the hit-rate; no identity is ever emitted.
 */
export function logCacheEvent(surface: 'qr' | 'shortlink', outcome: CacheOutcome): void {
  console.log(JSON.stringify({ type: 'CACHE_EVENT', surface, outcome }));
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
