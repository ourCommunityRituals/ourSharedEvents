/**
 * OSE-1509 — the form route's per-IP KV count fails open.
 *
 * T5 on staging (run 37098251345, #764's code): a 180-request email-signup
 * burst drew 22 × 500. KV allows about one write a second per key, and every
 * request in the burst writes the same caller's bucket, so `kv.put` throws
 * under a burst. The public-read limiter already turns that into "not
 * limited"; the form route did not, so the throw escaped as a 500.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import { route, type RouterEnv } from '../src/router';

const throwingKv = {
  get: async () => {
    throw new Error('KV PUT failed: 429 Too Many Requests');
  },
  put: async () => {
    throw new Error('KV PUT failed: 429 Too Many Requests');
  },
} as unknown as KVNamespace;

async function post(path: string, method = 'POST') {
  const ctx = createExecutionContext();
  const res = await route(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.77',
        Origin: 'http://localhost',
      },
      body: JSON.stringify({}),
    }),
    // No DB: the route's event-lifecycle guard is skipped, so this exercises
    // the limiter path only.
    {
      ...(env as unknown as RouterEnv),
      RATE_LIMIT_KV: throwingKv,
      DB: undefined,
    } as unknown as RouterEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('a throwing KV never turns a form request into a 500', () => {
  for (const form of ['checkin', 'survey', 'email-signup', 'register'] as const) {
    test(`POST /forms/${form}`, async () => {
      const res = await post(`/api/v2/events/evt_kv_throw/forms/${form}`);
      await res.body?.cancel();
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(429);
    });
  }

  test('DELETE /forms/register (self-delete)', async () => {
    const res = await post('/api/v2/events/evt_kv_throw/forms/register', 'DELETE');
    await res.body?.cancel();
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(429);
  });
});
