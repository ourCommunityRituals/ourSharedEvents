/**
 * resolution-cache.spec.ts — KV read-through cache for the scan/shortlink
 * resolvers (engine-hardening #2, OSE-963 / OSE-1090 KV row).
 *
 * The cache fronts the D1 resolution reads on the two tracking hot paths
 * (`/q/` qr_token→deployment, `/s/` code→destination) so an evening scan
 * peak is absorbed at KV instead of hammering D1. Doctrine constraints that
 * these tests pin:
 *   - FAIL-OPEN: KV unbound or throwing must fall straight through to the
 *     source loader — a cache fault can never strand an attendee.
 *   - BOUNDED TTL: every write carries an expirationTtl, so even with no
 *     explicit purge a stale entry self-evicts.
 *   - NEGATIVE CACHE: an unknown/inactive key is remembered briefly so a
 *     flood of bad tokens doesn't become a flood of D1 reads.
 *   - SELECTIVE PURGE: purge deletes ONE key, never a blanket bust.
 * Non-identifying payloads only (deployment/event/target ids) — never WHO —
 * are the caller's contract; this lib is payload-agnostic.
 *
 * Pure-logic (Map-backed KV stub, no cloudflare:test) → node pool.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  readThroughResolution,
  purgeResolution,
  logCacheEvent,
  deploymentCacheKey,
  shortlinkCacheKey,
  RESOLUTION_CACHE_TTL_SECONDS,
  RESOLUTION_NEGATIVE_TTL_SECONDS,
} from '../src/lib/resolution-cache';

/**
 * Faithful in-memory stand-in for the subset of KVNamespace we use
 * (get/put/delete). It genuinely stores and returns values and records the
 * TTL passed to put — so assertions are on real cache behaviour, not on a
 * mock's call log.
 */
function makeKvStub() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; ttl?: number }> = [];
  const kv = {
    store,
    puts,
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
      store.set(key, value);
      puts.push({ key, value, ttl: opts?.expirationTtl });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
  return kv as typeof kv & KVNamespace;
}

describe('readThroughResolution', () => {
  it('falls open to the source loader when KV is unbound', async () => {
    const loader = vi.fn(async () => ({ event_id: 'e1' }));
    const result = await readThroughResolution(undefined, 'rc:v1:sl:abc123', loader);
    expect(result.value).toEqual({ event_id: 'e1' });
    expect(result.outcome).toBe('bypass');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('populates the cache on a miss with a bounded positive TTL', async () => {
    const kv = makeKvStub();
    const loader = vi.fn(async () => ({ deployment_id: 'd1', event_id: 'e1' }));
    const result = await readThroughResolution(kv, 'rc:v1:qr:qrt_x', loader);
    expect(result.value).toEqual({ deployment_id: 'd1', event_id: 'e1' });
    expect(result.outcome).toBe('miss');
    expect(kv.puts).toHaveLength(1);
    expect(kv.puts[0].ttl).toBe(RESOLUTION_CACHE_TTL_SECONDS);
  });

  it('serves a hit from cache and does NOT call the source loader', async () => {
    const kv = makeKvStub();
    const key = 'rc:v1:qr:qrt_hit';
    await readThroughResolution(kv, key, async () => ({ deployment_id: 'd1', event_id: 'e1' }));

    const loader = vi.fn(async () => {
      throw new Error('source must not be called on a cache hit');
    });
    const result = await readThroughResolution(kv, key, loader);
    expect(result.value).toEqual({ deployment_id: 'd1', event_id: 'e1' });
    expect(result.outcome).toBe('hit');
    expect(loader).not.toHaveBeenCalled();
  });

  it('negative-caches an unknown key so the repeat miss skips the source', async () => {
    const kv = makeKvStub();
    const key = 'rc:v1:sl:missing';
    const loader = vi.fn(async () => null);

    const first = await readThroughResolution(kv, key, loader);
    expect(first.value).toBeNull();
    expect(first.outcome).toBe('miss');

    const second = await readThroughResolution(kv, key, loader);
    expect(second.value).toBeNull();
    expect(second.outcome).toBe('negative_hit');
    expect(loader).toHaveBeenCalledTimes(1); // second served from the negative entry

    const negativePut = kv.puts.find((p) => p.key === key);
    expect(negativePut?.ttl).toBe(RESOLUTION_NEGATIVE_TTL_SECONDS);
  });

  it('fails open to the source when KV.get throws', async () => {
    const kv = makeKvStub();
    kv.get = async () => {
      throw new Error('KV unavailable');
    };
    const loader = vi.fn(async () => ({ event_id: 'e9' }));
    const result = await readThroughResolution(kv, 'rc:v1:sl:boom', loader);
    expect(result.value).toEqual({ event_id: 'e9' });
    expect(result.outcome).toBe('error');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('still returns the loaded value when KV.put throws (write-fault is non-fatal)', async () => {
    const kv = makeKvStub();
    kv.put = async () => {
      throw new Error('KV write failed');
    };
    const loader = vi.fn(async () => ({ event_id: 'e2' }));
    const result = await readThroughResolution(kv, 'rc:v1:sl:wfail', loader);
    expect(result.value).toEqual({ event_id: 'e2' });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('purgeResolution (selective, never blanket)', () => {
  it('deletes exactly the one key so the next read is a fresh miss', async () => {
    const kv = makeKvStub();
    const key = 'rc:v1:qr:qrt_purge';
    const other = 'rc:v1:qr:qrt_keep';
    await readThroughResolution(kv, key, async () => ({ deployment_id: 'd1', event_id: 'e1' }));
    await readThroughResolution(kv, other, async () => ({ deployment_id: 'd2', event_id: 'e2' }));

    await purgeResolution(kv, key);
    expect(kv.store.has(key)).toBe(false);
    expect(kv.store.has(other)).toBe(true); // never a blanket bust

    const loader = vi.fn(async () => ({ deployment_id: 'd1b', event_id: 'e1' }));
    const after = await readThroughResolution(kv, key, loader);
    expect(after.outcome).toBe('miss');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('is a no-op (no throw) when KV is unbound', async () => {
    await expect(purgeResolution(undefined, 'rc:v1:qr:qrt_x')).resolves.toBeUndefined();
  });
});

describe('logCacheEvent (never-who by construction)', () => {
  it('emits only type/surface/outcome — no token, code, or id can be passed', () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logged.push(line);
    });
    try {
      logCacheEvent('qr', 'hit');
    } finally {
      spy.mockRestore();
    }
    expect(logged).toHaveLength(1);
    const parsed = JSON.parse(logged[0]);
    expect(parsed).toEqual({ type: 'CACHE_EVENT', surface: 'qr', outcome: 'hit' });
    // the whole never-who guarantee: exactly these three keys, nothing else
    expect(Object.keys(parsed).sort()).toEqual(['outcome', 'surface', 'type']);
  });
});

describe('cache keys', () => {
  it('are versioned and namespaced distinctly per resolver so a version bump invalidates', () => {
    expect(deploymentCacheKey('qrt_abc')).toBe('rc:v1:qr:qrt_abc');
    expect(shortlinkCacheKey('abc123')).toBe('rc:v1:sl:abc123');
    // the two resolvers never collide even if a token equals a code
    expect(deploymentCacheKey('x')).not.toBe(shortlinkCacheKey('x'));
  });
});
