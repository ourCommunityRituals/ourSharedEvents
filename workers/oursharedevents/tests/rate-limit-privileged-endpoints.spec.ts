/**
 * OSE-576 — rate limiting on privileged endpoints (admin / batch / mint).
 *
 * The public form limiter (OSE-552) is covered in rate-limit.spec.ts. This suite
 * covers the three privileged endpoints OSE-576 added, plus the OSE-592 fix
 * (keys must be stable per caller — the earlier CF-Ray key reset every request,
 * making the limit non-functional; keys now derive from clientIp()).
 *
 *   L2 functional — checkRateLimit enforces each per-endpoint max.
 *   Integration — mint + batch endpoints return 429 past their limit (the admin
 *                 pre-flight is production-gated, so it is covered structurally).
 *   L0 source gate — router wires each endpoint with the right max + stable key.
 */

import { SELF, env } from 'cloudflare:test';
import { describe, test, expect } from 'vitest';
import {
  checkRateLimit,
  RATE_LIMIT_ADMIN_MAX,
  RATE_LIMIT_BATCH_MAX,
  RATE_LIMIT_MINT_MAX,
  _deleteRateLimitKey,
} from '../src/lib/rate-limit';

interface TestEnv {
  RATE_LIMIT_KV: KVNamespace;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;

function routerSrc(): string {
  const files = JSON.parse(tenv().TEST_SOURCE_FILES_JSON) as Record<string, string>;
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith('src/router.ts'));
  if (!key) throw new Error('router.ts not found in TEST_SOURCE_FILES_JSON');
  return files[key];
}

// ── L1: per-endpoint constants ────────────────────────────────────────────────

describe('OSE-576 | per-endpoint limits', () => {
  test('admin=60, batch=30, mint=10', () => {
    expect(RATE_LIMIT_ADMIN_MAX).toBe(60);
    expect(RATE_LIMIT_BATCH_MAX).toBe(30);
    expect(RATE_LIMIT_MINT_MAX).toBe(10);
  });
});

// ── L2: checkRateLimit honors an arbitrary max ────────────────────────────────

describe('OSE-576 | checkRateLimit enforces each endpoint max', () => {
  test('mint key: allows 10, blocks the 11th', async () => {
    const key = 'mint:test-actor:evt_mint_unit';
    await _deleteRateLimitKey(tenv(), key);
    for (let i = 0; i < RATE_LIMIT_MINT_MAX; i++) {
      expect(await checkRateLimit(tenv(), key, RATE_LIMIT_MINT_MAX)).toBe(false);
    }
    expect(await checkRateLimit(tenv(), key, RATE_LIMIT_MINT_MAX)).toBe(true);
  });

  test('batch key: allows 30, blocks the 31st', async () => {
    const key = 'batch:test-token-unit';
    await _deleteRateLimitKey(tenv(), key);
    for (let i = 0; i < RATE_LIMIT_BATCH_MAX; i++) {
      expect(await checkRateLimit(tenv(), key, RATE_LIMIT_BATCH_MAX)).toBe(false);
    }
    expect(await checkRateLimit(tenv(), key, RATE_LIMIT_BATCH_MAX)).toBe(true);
  });

  test('admin key: allows 60, blocks the 61st', async () => {
    const key = 'admin:9.9.9.9';
    await _deleteRateLimitKey(tenv(), key);
    for (let i = 0; i < RATE_LIMIT_ADMIN_MAX; i++) {
      expect(await checkRateLimit(tenv(), key, RATE_LIMIT_ADMIN_MAX)).toBe(false);
    }
    expect(await checkRateLimit(tenv(), key, RATE_LIMIT_ADMIN_MAX)).toBe(true);
  });
});

// ── Integration: mint + batch return 429 past their limit ─────────────────────

describe('OSE-576 | privileged endpoints emit 429 past limit', () => {
  test('mint endpoint → 429 with Retry-After after 10 requests (rate check precedes auth)', async () => {
    const ip = '203.0.113.10'; // unique IP → isolated mint bucket
    const url = 'https://t.test/api/v2/admin/events/evt_mint_integ/shared-report/mint-link';
    const call = () => SELF.fetch(url, { method: 'POST', headers: { 'CF-Connecting-IP': ip } });

    // The rate check runs BEFORE requireAdmin, so unauthenticated calls still
    // consume the bucket. First 10 must NOT be 429 (they get an auth error instead).
    for (let i = 0; i < RATE_LIMIT_MINT_MAX; i++) {
      const res = await call();
      expect(res.status).not.toBe(429);
    }
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    const body = (await limited.json()) as Record<string, unknown>;
    expect(body.code).toBe('RATE_LIMITED');
  });

  test('batch endpoint → 429 after 30 requests for one service token', async () => {
    const token = 'Bearer svc-token-abcdef0123456789'; // last 16 chars key the bucket
    const url = 'https://t.test/api/v2/events/shared-reports/batch';
    const call = () =>
      SELF.fetch(url, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: '{}',
      });

    for (let i = 0; i < RATE_LIMIT_BATCH_MAX; i++) {
      const res = await call();
      expect(res.status).not.toBe(429);
    }
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  });
});

// ── L0: router wiring + OSE-592 stable-key guard ──────────────────────────────

describe('OSE-576 / OSE-592 | router wiring is stable-keyed', () => {
  test('admin pre-flight calls checkRateLimit with RATE_LIMIT_ADMIN_MAX', () => {
    const s = routerSrc();
    expect(s).toMatch(/checkRateLimit\([^)]*RATE_LIMIT_ADMIN_MAX/s);
  });

  test('mint is keyed by clientIp + eventId (not CF-Ray) with RATE_LIMIT_MINT_MAX', () => {
    const s = routerSrc();
    expect(s).toContain('`mint:${clientIp(request)}:');
    expect(s).toMatch(/checkRateLimit\([^)]*RATE_LIMIT_MINT_MAX/s);
  });

  test('batch is keyed by service token identity with RATE_LIMIT_BATCH_MAX', () => {
    const s = routerSrc();
    expect(s).toContain('`batch:${tokenId}`');
    expect(s).toMatch(/checkRateLimit\([^)]*RATE_LIMIT_BATCH_MAX/s);
  });

  test('OSE-592: privileged rate-limit keys do NOT use the per-request CF-Ray header', () => {
    const s = routerSrc();
    // Isolate the admin/mint/batch key derivations and assert none reads CF-Ray.
    for (const anchor of ['admin:${clientIp', 'mint:${clientIp', 'batch:${tokenId']) {
      const idx = s.indexOf(anchor);
      expect(idx, `${anchor} key must exist`).toBeGreaterThan(-1);
    }
    expect(s).not.toMatch(/(admin|mint|batch)[^`]*`[^`]*CF-Ray/i);
  });
});
