/**
 * OSE-1509 — edge rate limiting (Cloudflare Workers Rate Limiting binding).
 *
 * The PO bar (2026-10-03): a flood from one caller is refused within 3 seconds,
 * tops, and one person working at ~5 requests a second never is. These tests
 * pin both halves against the real binding (miniflare simulates `ratelimits`
 * from wrangler.toml), plus the fail-open rule and the toml ↔ code agreement.
 */

import { SELF, env } from 'cloudflare:test';
import { describe, test, expect, vi } from 'vitest';
import {
  EDGE_WINDOW_SECONDS,
  FORM_EDGE_MAX,
  PUBLIC_READ_EDGE_MAX,
  isEdgeLimited,
  type EdgeRateLimitEnv,
} from '../src/lib/edge-rate-limit';
import { publicReadLimited, PUBLIC_READ_MAX } from '../src/lib/public-read-limit';

const testEnv = env as unknown as EdgeRateLimitEnv & { TEST_WRANGLER_TOML: string };

const ok = async () => new Response('ok');
const req = (ip: string | null) =>
  new Request('http://localhost/api/v2/events', {
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  });

/** The PO's "5 requests a second", over one whole edge window. */
const NORMAL_RUN_PER_WINDOW = 5 * EDGE_WINDOW_SECONDS;
/** The flood rate the bar is stated against. */
const FLOOD_PER_SECOND = 100;

describe('the PO bar holds for public reads', () => {
  test('a flood is refused within 3 seconds', async () => {
    const wrapped = publicReadLimited('edge-flood', ok);
    let firstRefused = -1;
    for (let i = 1; i <= 3 * FLOOD_PER_SECOND; i++) {
      const res = await wrapped(req('203.0.113.50'), testEnv);
      if (res.status === 429) {
        firstRefused = i;
        break;
      }
    }
    expect(firstRefused, 'no request refused in 3 s of a 100/s flood').toBeGreaterThan(0);
    // At 100/s, request n arrives (n - 1) / 100 s in.
    expect((firstRefused - 1) / FLOOD_PER_SECOND).toBeLessThanOrEqual(3);
    // Never before the limit. The binding counts in fixed 10 s windows, so a
    // burst straddling a window edge is counted afresh once: refused by 2x.
    expect(firstRefused).toBeGreaterThan(PUBLIC_READ_EDGE_MAX);
    expect(firstRefused).toBeLessThanOrEqual(2 * PUBLIC_READ_EDGE_MAX + 1);
  });

  test('a normal run of 5 a second is never refused', async () => {
    const wrapped = publicReadLimited('edge-normal', ok);
    for (let i = 0; i < NORMAL_RUN_PER_WINDOW; i++) {
      expect((await wrapped(req('203.0.113.51'), testEnv)).status).toBe(200);
    }
  });

  test('the sustained (KV) limit is at least 5 a second too', () => {
    expect(PUBLIC_READ_MAX / 60).toBeGreaterThanOrEqual(5);
  });

  test('a route that raised its limit above the default skips the edge layer', async () => {
    const wrapped = publicReadLimited('edge-raised', ok, PUBLIC_READ_MAX + 1);
    for (let i = 0; i <= PUBLIC_READ_EDGE_MAX + 5; i++) {
      expect((await wrapped(req('203.0.113.52'), testEnv)).status).toBe(200);
    }
  });

  test('no Cloudflare address (local dev, direct calls) means no edge limit', async () => {
    const wrapped = publicReadLimited('edge-noip', ok);
    for (let i = 0; i <= PUBLIC_READ_EDGE_MAX + 5; i++) {
      expect((await wrapped(req(null), testEnv)).status).toBe(200);
    }
  });
});

describe('the PO bar holds for forms (router.ts formRouteLimit)', () => {
  const post = (eventId: string, ip: string) =>
    SELF.fetch(`http://localhost/api/v2/events/${eventId}/forms/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
        Origin: 'http://localhost',
      },
      body: JSON.stringify({}),
    });

  test('a flood on one event is refused within 3 seconds', async () => {
    let firstRefused = -1;
    for (let i = 1; i <= 3 * FLOOD_PER_SECOND; i++) {
      const res = await post('evt_edge_flood', '203.0.113.60');
      await res.body?.cancel();
      if (res.status === 429) {
        firstRefused = i;
        break;
      }
    }
    expect(firstRefused, 'no form POST refused in 3 s of a 100/s flood').toBeGreaterThan(0);
    expect((firstRefused - 1) / FLOOD_PER_SECOND).toBeLessThanOrEqual(3);
  });

  test('a normal run of 5 a second is never refused', async () => {
    for (let i = 0; i < NORMAL_RUN_PER_WINDOW; i++) {
      const res = await post('evt_edge_normal', '203.0.113.61');
      expect(res.status).not.toBe(429);
      await res.body?.cancel();
    }
  });

  test('form limit stays at or above 5 a second', () => {
    expect(FORM_EDGE_MAX / EDGE_WINDOW_SECONDS).toBeGreaterThanOrEqual(5);
  });
});

describe('fails open — a speed bump never becomes an outage', () => {
  test('unbound', async () => {
    expect(await isEdgeLimited(undefined, 'k')).toBe(false);
  });

  test('throwing', async () => {
    const broken = {
      limit: async () => {
        throw new Error('binding unavailable');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await isEdgeLimited(broken, '203.0.113.9:evt')).toBe(false);
      // Logged, and the log never carries the key (it holds an IP).
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('EDGE_RATE_LIMIT_FAIL_OPEN');
      expect(line).not.toContain('203.0.113.9');
    } finally {
      warn.mockRestore();
    }
  });

  test('refused when the binding says so', async () => {
    expect(await isEdgeLimited({ limit: async () => ({ success: false }) }, 'k')).toBe(true);
  });
});

describe('wrangler.toml agrees with the code in every environment', () => {
  const toml = testEnv.TEST_WRANGLER_TOML;

  const PREFIXES = ['', 'env.staging.', 'env.staging-full.', 'env.production.'];

  for (const prefix of PREFIXES) {
    for (const [name, limit] of [
      ['PUBLIC_READ_EDGE_LIMITER', PUBLIC_READ_EDGE_MAX],
      ['FORM_EDGE_LIMITER', FORM_EDGE_MAX],
    ] as const) {
      test(`[[${prefix}ratelimits]] ${name} = ${limit} per ${EDGE_WINDOW_SECONDS} s`, () => {
        // Plain string checks on the one block that names this binding in this env.
        const block = toml
          .split('[[')
          .find((b) => b.startsWith(`${prefix}ratelimits]]`) && b.includes(`name = "${name}"`));
        expect(block, `no [[${prefix}ratelimits]] block for ${name}`).toBeDefined();
        expect(block).toContain(`simple = { limit = ${limit}, period = ${EDGE_WINDOW_SECONDS} }`);
      });
    }
  }

  test('every namespace_id is unique, so environments never share counts', () => {
    const ids = [...toml.matchAll(/^namespace_id = "(\d+)"/gm)].map((m) => m[1]);
    // two limiters per environment: derived from the sections, not a literal
    const blocks = PREFIXES.reduce((n, p) => n + toml.split(`[[${p}ratelimits]]`).length - 1, 0);
    expect(blocks).toBe(PREFIXES.length * 2);
    expect(ids.length).toBe(blocks);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
