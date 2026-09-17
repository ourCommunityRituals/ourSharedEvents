/**
 * resolution-cache-wiring.spec.ts — proves the two resolvers are actually
 * fronted by the KV read-through (OSE-963). The cache logic itself is covered
 * by resolution-cache.spec.ts; this pins the WIRING: the right key, the right
 * D1 loader, and that a second hit skips D1.
 *
 * Fake D1 (records prepare/bind/first calls) + Map-backed KV stub → node pool.
 */
import { describe, it, expect } from 'vitest';
import { resolveDeploymentCached } from '../src/handlers/qr-scan';
import { resolveShortlinkCached } from '../src/handlers/shortlink-resolve';

function makeFakeDb(row: unknown) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              calls.push({ sql, args });
              return row;
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, calls };
}

function makeKvStub() {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
  return kv as unknown as KVNamespace;
}

describe('resolveDeploymentCached (/q/)', () => {
  it('reads D1 once on a miss, then serves the second call from KV', async () => {
    const { db, calls } = makeFakeDb({ id: 'pd_1', event_id: 'evt_1' });
    const env = { DB: db, RESOLVE_CACHE_KV: makeKvStub() };

    const first = await resolveDeploymentCached(env, 'qrt_abc');
    expect(first.value).toEqual({ id: 'pd_1', event_id: 'evt_1' });
    expect(first.outcome).toBe('miss');
    expect(calls).toHaveLength(1);
    // the loader queries poster_deployments by the token, active-only
    expect(calls[0].sql).toContain('poster_deployments');
    expect(calls[0].args).toEqual(['qrt_abc']);

    const second = await resolveDeploymentCached(env, 'qrt_abc');
    expect(second.value).toEqual({ id: 'pd_1', event_id: 'evt_1' });
    expect(second.outcome).toBe('hit');
    expect(calls).toHaveLength(1); // D1 not touched again
  });

  it('bypasses to D1 every call when no cache is bound (fail-open)', async () => {
    const { db, calls } = makeFakeDb({ id: 'pd_1', event_id: 'evt_1' });
    const env = { DB: db }; // no RESOLVE_CACHE_KV

    const a = await resolveDeploymentCached(env, 'qrt_abc');
    const b = await resolveDeploymentCached(env, 'qrt_abc');
    expect(a.outcome).toBe('bypass');
    expect(b.outcome).toBe('bypass');
    expect(calls).toHaveLength(2);
  });
});

describe('resolveShortlinkCached (/s/)', () => {
  it('reads D1 once on a miss, then serves the second call from KV', async () => {
    const { db, calls } = makeFakeDb({ code: 'abc123', event_id: 'evt_2', target_url: null });
    const env = { DB: db, RESOLVE_CACHE_KV: makeKvStub() };

    const first = await resolveShortlinkCached(env, 'abc123');
    expect(first.value).toEqual({ code: 'abc123', event_id: 'evt_2', target_url: null });
    expect(first.outcome).toBe('miss');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('shortlinks');

    const second = await resolveShortlinkCached(env, 'abc123');
    expect(second.value).toEqual({ code: 'abc123', event_id: 'evt_2', target_url: null });
    expect(second.outcome).toBe('hit');
    expect(calls).toHaveLength(1);
  });
});
