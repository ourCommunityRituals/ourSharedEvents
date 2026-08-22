/**
 * OSE-272 Session 5 — SharedReport auth lib tests
 *
 * Pure-function tests; no D1, no fetch. Exercises the signed-link mint
 * + verify cycle and the service-token verifier.
 */

import { describe, test, expect } from 'vitest';
import {
  extractBearerToken,
  mintSignedLinkToken,
  verifyServiceToken,
  classifyServiceToken,
  verifySignedLinkToken,
  type SharedReportAuthEnv,
} from '../src/lib/shared-report-auth';

const SECRET = 'test-shared-report-signing-secret-do-not-use-in-prod';

function envWithSecret(): SharedReportAuthEnv {
  return { SHARED_REPORT_SIGNING_SECRET: SECRET };
}

describe('OSE-272 Session 5 — extractBearerToken', () => {
  test('returns null for null/undefined/empty', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
  });

  test('extracts a Bearer token', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  test('case-insensitive on the Bearer prefix', () => {
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('BEARER abc')).toBe('abc');
  });

  test('returns null for non-Bearer schemes', () => {
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('abc')).toBeNull();
  });

  test('trims whitespace', () => {
    expect(extractBearerToken('Bearer   abc   ')).toBe('abc');
  });
});

describe('OSE-272 Session 5 — signed-link token mint + verify', () => {
  test('mint returns null when signing secret is unset', async () => {
    const t = await mintSignedLinkToken({}, 'evt_abc', 'bar_owner');
    expect(t).toBeNull();
  });

  test('mint returns a dotted token when secret is set', async () => {
    const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', 'bar_owner');
    expect(t).not.toBeNull();
    expect(t!.split('.').length).toBe(2);
  });

  test('verify accepts a fresh mint with correct claim', async () => {
    const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', 'bar_owner');
    const claim = await verifySignedLinkToken(envWithSecret(), t);
    expect(claim).not.toBeNull();
    expect(claim!.eventId).toBe('evt_abc');
    expect(claim!.role).toBe('bar_owner');
    expect(claim!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('verify rejects a token with wrong secret (signature mismatch)', async () => {
    const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', 'bar_owner');
    const claim = await verifySignedLinkToken(
      { SHARED_REPORT_SIGNING_SECRET: 'different-secret' },
      t
    );
    expect(claim).toBeNull();
  });

  test('verify rejects an expired token', async () => {
    const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', 'bar_owner', -1);
    const claim = await verifySignedLinkToken(envWithSecret(), t);
    expect(claim).toBeNull();
  });

  test('verify rejects a token with a tampered payload', async () => {
    const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', 'bar_owner');
    const [, sig] = t!.split('.');
    // Encode a payload with different eventId but try to reuse the original sig
    const tampered = btoa(JSON.stringify({ eventId: 'evt_xyz', role: 'admin', exp: 9999999999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fakeToken = `${tampered}.${sig}`;
    const claim = await verifySignedLinkToken(envWithSecret(), fakeToken);
    expect(claim).toBeNull();
  });

  test('verify rejects a malformed token (no delimiter)', async () => {
    const claim = await verifySignedLinkToken(envWithSecret(), 'no-delimiter-here');
    expect(claim).toBeNull();
  });

  test('verify rejects a token with an invalid role claim', async () => {
    // Manually mint a token with an invalid role using the SAME secret.
    const payload = JSON.stringify({
      eventId: 'evt_abc',
      role: 'super_user', // invalid
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sig = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const fakeToken = `${payloadB64}.${sig}`;
    const claim = await verifySignedLinkToken(envWithSecret(), fakeToken);
    expect(claim).toBeNull(); // invalid role rejected even with valid sig
  });

  test('verify returns null when secret is unset', async () => {
    const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', 'bar_owner');
    expect(await verifySignedLinkToken({}, t)).toBeNull();
  });

  test('all three valid roles round-trip', async () => {
    for (const role of ['bar_owner', 'sponsor', 'admin'] as const) {
      const t = await mintSignedLinkToken(envWithSecret(), 'evt_abc', role);
      const claim = await verifySignedLinkToken(envWithSecret(), t);
      expect(claim!.role).toBe(role);
    }
  });
});

describe('OSE-272 Session 5 — service-token verifier', () => {
  test('returns false when env token is unset', () => {
    expect(verifyServiceToken({}, 'anything')).toBe(false);
  });

  test('returns false when supplied token is null/empty', () => {
    const env = { WKRP_SERVICE_TOKEN: 'real-token' };
    expect(verifyServiceToken(env, null)).toBe(false);
    expect(verifyServiceToken(env, '')).toBe(false);
  });

  test('returns false on mismatch', () => {
    const env = { WKRP_SERVICE_TOKEN: 'real-token' };
    expect(verifyServiceToken(env, 'wrong-token')).toBe(false);
  });

  test('returns true on exact match', () => {
    const env = { WKRP_SERVICE_TOKEN: 'real-token' };
    expect(verifyServiceToken(env, 'real-token')).toBe(true);
  });

  test('constant-time semantics: different-length tokens are rejected', () => {
    const env = { WKRP_SERVICE_TOKEN: 'real-token' };
    expect(verifyServiceToken(env, 'real-toke')).toBe(false);
    expect(verifyServiceToken(env, 'real-tokenX')).toBe(false);
  });
});

describe('OSE-577 — classifyServiceToken (token class split)', () => {
  const bothEnv: SharedReportAuthEnv = {
    OSE_INTERNAL_BATCH_TOKEN: 'internal-token',
    WKRP_SERVICE_TOKEN: 'wkrp-token',
  };

  test('internal token → "internal"', () => {
    expect(classifyServiceToken(bothEnv, 'internal-token')).toBe('internal');
  });

  test('WKRP token → "cross_product" (recognized but will fail closed at handler)', () => {
    expect(classifyServiceToken(bothEnv, 'wkrp-token')).toBe('cross_product');
  });

  test('unknown / empty / null token → null', () => {
    expect(classifyServiceToken(bothEnv, 'some-other-token')).toBeNull();
    expect(classifyServiceToken(bothEnv, '')).toBeNull();
    expect(classifyServiceToken(bothEnv, null)).toBeNull();
    expect(classifyServiceToken(bothEnv, undefined)).toBeNull();
  });

  test('WKRP recognized as cross_product even when internal token is unset', () => {
    expect(classifyServiceToken({ WKRP_SERVICE_TOKEN: 'wkrp-token' }, 'wkrp-token')).toBe(
      'cross_product'
    );
  });

  test('internal token unrecognized when its env var is unset (fail closed to null)', () => {
    expect(classifyServiceToken({ WKRP_SERVICE_TOKEN: 'wkrp-token' }, 'internal-token')).toBeNull();
  });

  test('empty env → null (no class granted)', () => {
    expect(classifyServiceToken({}, 'internal-token')).toBeNull();
    expect(classifyServiceToken({}, 'wkrp-token')).toBeNull();
  });

  test('constant-time semantics: near-miss tokens do not classify', () => {
    expect(classifyServiceToken(bothEnv, 'internal-toke')).toBeNull();
    expect(classifyServiceToken(bothEnv, 'wkrp-tokenX')).toBeNull();
  });

  test('internal is checked first: a shared value classifies as internal (safer branch)', () => {
    // Defence-in-depth: the two secrets must never share a value in practice,
    // but if mis-set identically the classification must not hand the
    // cross-product branch full access. Internal-first means the safe class wins.
    const shared: SharedReportAuthEnv = {
      OSE_INTERNAL_BATCH_TOKEN: 'same',
      WKRP_SERVICE_TOKEN: 'same',
    };
    expect(classifyServiceToken(shared, 'same')).toBe('internal');
  });
});
