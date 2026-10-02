/**
 * OSE-552 / BE-11 — KV-backed rate limiter tests
 *
 * L1: static shape checks (exports, constants)
 * L2: direct function tests for isRateLimited, clientIp, rateLimitResponse
 *
 * Each test uses a unique client IP so KV state does not bleed between cases.
 * No beforeEach flush needed — isolation via unique keys per test.
 */

import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  isRateLimited,
  clientIp,
  rateLimitResponse,
  _deleteRateLimitKey,
} from '../src/lib/rate-limit';

// ── L1: Static shape ──────────────────────────────────────────────────────────

describe('rate-limit — L1 static', () => {
  it('exports RATE_LIMIT_MAX = 60', () => {
    expect(RATE_LIMIT_MAX).toBe(60);
  });

  it('exports RATE_LIMIT_WINDOW_MS = 60000', () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('exports isRateLimited as a function', () => {
    expect(typeof isRateLimited).toBe('function');
  });

  it('exports clientIp as a function', () => {
    expect(typeof clientIp).toBe('function');
  });

  it('exports rateLimitResponse as a function', () => {
    expect(typeof rateLimitResponse).toBe('function');
  });
});

// ── L2: isRateLimited ────────────────────────────────────────────────────────

describe('isRateLimited', () => {
  // @born-red TL-053 | method: deliberate-fixture-break | date: 2026-08-03
  it('allows the first request for a new IP', async () => {
    expect(await isRateLimited(env, '1.2.3.4')).toBe(false);
  });

  it('allows up to RATE_LIMIT_MAX requests', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(await isRateLimited(env, ip)).toBe(false);
    }
  });

  it('blocks the request after exceeding RATE_LIMIT_MAX', async () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await isRateLimited(env, ip);
    }
    expect(await isRateLimited(env, ip)).toBe(true);
  });

  it('tracks different IPs independently', async () => {
    const ip1 = '192.168.1.1';
    const ip2 = '192.168.1.2';
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await isRateLimited(env, ip1);
    }
    expect(await isRateLimited(env, ip1)).toBe(true);
    expect(await isRateLimited(env, ip2)).toBe(false);
  });

  it('resets after key deletion (simulates window expiry)', async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      await isRateLimited(env, ip);
    }
    expect(await isRateLimited(env, ip)).toBe(true);
    await _deleteRateLimitKey(env, ip);
    expect(await isRateLimited(env, ip)).toBe(false);
  });
});

// ── L2: clientIp ─────────────────────────────────────────────────────────────

describe('clientIp', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://example.com/', { headers });
  }

  it('prefers CF-Connecting-IP', () => {
    const r = req({ 'CF-Connecting-IP': '1.1.1.1', 'X-Forwarded-For': '2.2.2.2' });
    expect(clientIp(r)).toBe('1.1.1.1');
  });

  it('falls back to first X-Forwarded-For segment', () => {
    const r = req({ 'X-Forwarded-For': '3.3.3.3, 4.4.4.4' });
    expect(clientIp(r)).toBe('3.3.3.3');
  });

  it('returns "unknown" when no IP header present', () => {
    const r = req({});
    expect(clientIp(r)).toBe('unknown');
  });

  it('trims whitespace from X-Forwarded-For', () => {
    const r = req({ 'X-Forwarded-For': '  5.5.5.5  , 6.6.6.6' });
    expect(clientIp(r)).toBe('5.5.5.5');
  });
});

// ── L2: rateLimitResponse ────────────────────────────────────────────────────

describe('rateLimitResponse', () => {
  it('returns HTTP 429', () => {
    expect(rateLimitResponse().status).toBe(429);
  });

  it('includes Retry-After header', () => {
    expect(rateLimitResponse().headers.get('Retry-After')).toBe('60');
  });

  it('includes X-RateLimit-Limit header', () => {
    expect(rateLimitResponse().headers.get('X-RateLimit-Limit')).toBe('60');
  });

  it('includes X-RateLimit-Remaining header', () => {
    expect(rateLimitResponse().headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('body has ok=false and RATE_LIMITED code', async () => {
    const body = (await rateLimitResponse().json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.status).toBe(429);
  });
});
