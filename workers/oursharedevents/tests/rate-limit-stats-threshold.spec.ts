/**
 * GET /api/v2/admin/security/rate-limit-stats compares each bucket with its own
 * limit (PR #744 review). Buckets enforce different limits (mint 10, batch 30,
 * default 60, public reads 120); the handler used a flat `count > 60`, so it
 * missed blocked mint/batch callers and listed public readers that were not
 * blocked. checkRateLimit now stores `max` on the entry, and the handler reads it.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { route, type RouterEnv } from '../src/router';
import { checkRateLimit, rateLimitKvKey, RATE_LIMIT_WINDOW_MS } from '../src/lib/rate-limit';

interface TestEnv {
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
}

const testEnv = env as unknown as TestEnv;
const routerEnv = env as unknown as RouterEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(testEnv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await testEnv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

/** Seed one bucket directly: `count` hits against a bucket whose limit is `max`. */
async function seed(key: string, count: number, max?: number): Promise<string> {
  const kvKey = await rateLimitKvKey(key);
  const entry = { count, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS, ...(max ? { max } : {}) };
  await testEnv.RATE_LIMIT_KV.put(kvKey, JSON.stringify(entry), { expirationTtl: 60 });
  return kvKey.slice('ratelimit:'.length);
}

async function stats(): Promise<{
  top_ips: Array<{ ip: string; count: number; limit: number }>;
}> {
  const ctx = createExecutionContext();
  const res = await route(
    new Request('https://ose.test/api/v2/admin/security/rate-limit-stats', {
      // key:admin + ADMIN_SCOPE_ALL (vitest.workers.config.mts) → platform scope.
      headers: { Authorization: 'Bearer test-admin-key-e2e-2026' },
    }),
    routerEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return res.json();
}

describe('rate-limit-stats uses each bucket’s own limit', () => {
  beforeAll(applyMigrations);

  test('checkRateLimit stores the limit it enforces', async () => {
    await checkRateLimit('mint:stored-max', testEnv.RATE_LIMIT_KV, 10);
    const raw = await testEnv.RATE_LIMIT_KV.get(await rateLimitKvKey('mint:stored-max'));
    expect(JSON.parse(raw!).max).toBe(10);
  });

  test('blocked low-limit buckets are listed; unblocked high-limit ones are not', async () => {
    const mintBlocked = await seed('mint:t1', 11, 10); // over 10 → blocked
    const batchBlocked = await seed('batch-sr:t1', 31, 30); // over 30 → blocked
    const publicOk = await seed('publicread:t1', 100, 120); // under 120 → not blocked
    const legacy = await seed('legacy:t1', 61); // no max → default 60 → blocked
    const underDefault = await seed('admin:t1', 50, 60); // under 60 → not blocked

    const ids = new Map((await stats()).top_ips.map((e) => [e.ip, e]));
    expect(ids.get(mintBlocked)?.limit).toBe(10);
    expect(ids.get(batchBlocked)?.limit).toBe(30);
    expect(ids.get(legacy)?.limit).toBe(60);
    expect(ids.has(publicOk)).toBe(false);
    expect(ids.has(underDefault)).toBe(false);
  });
});
