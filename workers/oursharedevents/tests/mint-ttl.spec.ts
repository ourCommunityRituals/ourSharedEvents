/**
 * OSE-1390 — resolveMintTtlSeconds: the mint-link TTL resolution.
 *
 * Pure logic (no cloudflare:test / DOM) → runs in the fast node project
 * (listed in vitest.node-specs.mjs). Proves the sub-day TTL contract and that
 * the legacy ttl_days path is untouched.
 */
import { describe, test, expect } from 'vitest';
import {
  resolveMintTtlSeconds,
  MINT_TTL_DAYS_DEFAULT,
  MINT_TTL_MINUTES_MIN,
  MINT_TTL_MINUTES_MAX,
} from '../src/lib/mint-ttl';

const DAY = 24 * 60 * 60;

describe('resolveMintTtlSeconds — sub-day TTL (OSE-1390)', () => {
  test('ttl_minutes:30 → 1800s (run-scoped)', () => {
    expect(resolveMintTtlSeconds({ ttl_minutes: 30 })).toEqual({ ttlSeconds: 1800 });
  });

  test(`floor: ttl_minutes:${MINT_TTL_MINUTES_MIN} → ${MINT_TTL_MINUTES_MIN * 60}s`, () => {
    expect(resolveMintTtlSeconds({ ttl_minutes: MINT_TTL_MINUTES_MIN })).toEqual({
      ttlSeconds: MINT_TTL_MINUTES_MIN * 60,
    });
  });

  test(`ceiling: ttl_minutes:${MINT_TTL_MINUTES_MAX} → 1 day`, () => {
    expect(resolveMintTtlSeconds({ ttl_minutes: MINT_TTL_MINUTES_MAX })).toEqual({
      ttlSeconds: DAY,
    });
  });

  test('below floor → error', () => {
    expect('error' in resolveMintTtlSeconds({ ttl_minutes: MINT_TTL_MINUTES_MIN - 1 })).toBe(true);
  });

  test('above ceiling → error', () => {
    expect('error' in resolveMintTtlSeconds({ ttl_minutes: MINT_TTL_MINUTES_MAX + 1 })).toBe(true);
  });

  test('non-integer ttl_minutes → error', () => {
    expect('error' in resolveMintTtlSeconds({ ttl_minutes: 5.5 })).toBe(true);
  });

  test('non-number ttl_minutes → error (no coercion)', () => {
    expect('error' in resolveMintTtlSeconds({ ttl_minutes: '30' })).toBe(true);
  });

  test('both ttl_minutes and ttl_days → 400 (ambiguous)', () => {
    expect('error' in resolveMintTtlSeconds({ ttl_minutes: 30, ttl_days: 1 })).toBe(true);
  });

  test('default (empty body) → 7 days, backward-compatible', () => {
    expect(resolveMintTtlSeconds({})).toEqual({ ttlSeconds: MINT_TTL_DAYS_DEFAULT * DAY });
  });

  test('ttl_days:1 → 1 day (legacy path unchanged)', () => {
    expect(resolveMintTtlSeconds({ ttl_days: 1 })).toEqual({ ttlSeconds: DAY });
  });

  test('ttl_days:366 → error (legacy ceiling unchanged)', () => {
    expect('error' in resolveMintTtlSeconds({ ttl_days: 366 })).toBe(true);
  });
});
