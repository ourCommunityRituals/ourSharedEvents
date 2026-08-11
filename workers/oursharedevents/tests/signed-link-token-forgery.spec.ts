/**
 * TL-008 — Signed-link token forgery guard
 *
 * Threat: "Signed-link token forgery: attacker crafts a token with a
 * valid-looking HMAC for a different event_id or elevated role"
 *
 * Tests:
 *   1. Valid token verifies (baseline)
 *   2. Tampered event_id (payload swap, original sig) → rejected
 *   3. Role escalation: sponsor → admin (payload swap, original sig) → rejected
 *   4. Role escalation: bar_owner → admin (payload swap, original sig) → rejected
 *   5. Signature bit-flip → rejected
 *   6. Wrong signing secret → rejected
 *   7. No signing secret → always null (fail-safe)
 *   8. Expired token → rejected
 *   9. Missing event_id claim → rejected
 *  10. Missing role claim → rejected
 *  11. Depth escalation: sponsor forges depth=premium (payload swap) → rejected
 *  12. Malformed token (no delimiter) → rejected
 *  13. Token with extra parts → rejected
 *  14. Empty token → rejected
 *  15. sponsor_id swap (attacker replaces their own sponsor_id) → rejected
 */

import { describe, test, expect } from 'vitest';
import { mintSignedLinkToken, verifySignedLinkToken } from '../src/lib/shared-report-auth';

// ─── Env fixtures ──────────────────────────────────────────────────────────────

const ENV_A = { SHARED_REPORT_SIGNING_SECRET: 'test-secret-alpha-32chars-min!!!' };
const ENV_B = { SHARED_REPORT_SIGNING_SECRET: 'different-secret-beta-32chars!!!' };
const ENV_NONE = {};

// ─── Tamper helpers ───────────────────────────────────────────────────────────
//
// Mirrors the base64UrlEncode used inside shared-report-auth.ts so tamper
// tests can synthesize a payload with original-sig without touching source.

function b64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Replace a token's payload portion with `newClaim` while keeping the original signature. */
function swapPayload(token: string, newClaim: Record<string, unknown>): string {
  const sig = token.slice(token.lastIndexOf('.') + 1);
  const fakePart = b64UrlEncode(JSON.stringify(newClaim));
  return `${fakePart}.${sig}`;
}

/** Flip the last character of the signature. */
function flipSig(token: string): string {
  const dotIdx = token.lastIndexOf('.');
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  // Flip the last hex character
  const last = sig[sig.length - 1];
  const flipped = last === 'f' ? '0' : 'f';
  return `${payload}.${sig.slice(0, -1)}${flipped}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// @born-red TL-008 | method: design-time-negative-assertion | date: 2026-08-06
describe('TL-008 | Signed-link token forgery guard', () => {
  test('valid token verifies successfully (baseline)', async () => {
    const token = await mintSignedLinkToken(ENV_A, 'evt_abc', 'bar_owner');
    expect(token).not.toBeNull();
    const claim = await verifySignedLinkToken(ENV_A, token);
    expect(claim).not.toBeNull();
    expect(claim!.eventId).toBe('evt_abc');
    expect(claim!.role).toBe('bar_owner');
  });

  test('event_id swap (attacker reuses sig for a different event) → rejected', async () => {
    const realToken = await mintSignedLinkToken(ENV_A, 'evt_real', 'bar_owner');
    expect(realToken).not.toBeNull();
    // Attacker decodes payload, changes event_id, keeps original sig
    const forged = swapPayload(realToken!, { eventId: 'evt_attacker', role: 'bar_owner', exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await verifySignedLinkToken(ENV_A, forged);
    expect(result).toBeNull();
  });

  test('role escalation: sponsor → admin (payload swap) → rejected', async () => {
    const sponsorToken = await mintSignedLinkToken(ENV_A, 'evt_abc', 'sponsor');
    expect(sponsorToken).not.toBeNull();
    const forged = swapPayload(sponsorToken!, { eventId: 'evt_abc', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await verifySignedLinkToken(ENV_A, forged);
    expect(result).toBeNull();
  });

  test('role escalation: bar_owner → admin (payload swap) → rejected', async () => {
    const token = await mintSignedLinkToken(ENV_A, 'evt_abc', 'bar_owner');
    expect(token).not.toBeNull();
    const forged = swapPayload(token!, { eventId: 'evt_abc', role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 });
    const result = await verifySignedLinkToken(ENV_A, forged);
    expect(result).toBeNull();
  });

  test('signature bit-flip → rejected', async () => {
    const token = await mintSignedLinkToken(ENV_A, 'evt_abc', 'bar_owner');
    expect(token).not.toBeNull();
    const flipped = flipSig(token!);
    const result = await verifySignedLinkToken(ENV_A, flipped);
    expect(result).toBeNull();
  });

  test('wrong signing secret → rejected', async () => {
    const token = await mintSignedLinkToken(ENV_A, 'evt_abc', 'bar_owner');
    expect(token).not.toBeNull();
    const result = await verifySignedLinkToken(ENV_B, token);
    expect(result).toBeNull();
  });

  test('no signing secret → always null (fail-safe)', async () => {
    // mint returns null when secret absent
    const token = await mintSignedLinkToken(ENV_NONE, 'evt_abc', 'bar_owner');
    expect(token).toBeNull();
    // verify returns null when secret absent
    const tokenFromA = await mintSignedLinkToken(ENV_A, 'evt_abc', 'bar_owner');
    const result = await verifySignedLinkToken(ENV_NONE, tokenFromA);
    expect(result).toBeNull();
  });

  test('expired token → rejected', async () => {
    // Mint with 1-second TTL, then check expiry enforcement
    // We manually craft an already-expired claim to avoid sleep
    const expiredClaim = { eventId: 'evt_abc', role: 'bar_owner', exp: Math.floor(Date.now() / 1000) - 1 };
    // Build a properly-signed token with an expired claim
    const payloadB64 = b64UrlEncode(JSON.stringify(expiredClaim));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(ENV_A.SHARED_REPORT_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiredToken = `${payloadB64}.${sigHex}`;
    const result = await verifySignedLinkToken(ENV_A, expiredToken);
    expect(result).toBeNull();
  });

  test('missing eventId claim → rejected', async () => {
    const claim = { role: 'bar_owner', exp: Math.floor(Date.now() / 1000) + 3600 };
    const payloadB64 = b64UrlEncode(JSON.stringify(claim));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(ENV_A.SHARED_REPORT_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const result = await verifySignedLinkToken(ENV_A, `${payloadB64}.${sigHex}`);
    expect(result).toBeNull();
  });

  test('missing role claim → rejected', async () => {
    const claim = { eventId: 'evt_abc', exp: Math.floor(Date.now() / 1000) + 3600 };
    const payloadB64 = b64UrlEncode(JSON.stringify(claim));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(ENV_A.SHARED_REPORT_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const result = await verifySignedLinkToken(ENV_A, `${payloadB64}.${sigHex}`);
    expect(result).toBeNull();
  });

  test('depth escalation: sponsor forges depth=premium (payload swap) → rejected', async () => {
    // Attacker has a sponsor token with depth=local, tries to upgrade to premium
    const sponsorToken = await mintSignedLinkToken(ENV_A, 'evt_abc', 'sponsor', 3600, { depth: 'local', sponsor_id: 'sp_attacker' });
    expect(sponsorToken).not.toBeNull();
    const forged = swapPayload(sponsorToken!, {
      eventId: 'evt_abc',
      role: 'sponsor',
      exp: Math.floor(Date.now() / 1000) + 3600,
      depth: 'premium',         // escalated from local
      sponsor_id: 'sp_attacker',
    });
    const result = await verifySignedLinkToken(ENV_A, forged);
    expect(result).toBeNull();
  });

  test('malformed token (no dot delimiter) → rejected', async () => {
    const result = await verifySignedLinkToken(ENV_A, 'notavalidtokenatall');
    expect(result).toBeNull();
  });

  test('token with extra parts (three segments) → rejected', async () => {
    const token = await mintSignedLinkToken(ENV_A, 'evt_abc', 'bar_owner');
    expect(token).not.toBeNull();
    const result = await verifySignedLinkToken(ENV_A, `${token}.extrapart`);
    expect(result).toBeNull();
  });

  test('empty / null / undefined token → rejected', async () => {
    expect(await verifySignedLinkToken(ENV_A, null)).toBeNull();
    expect(await verifySignedLinkToken(ENV_A, undefined)).toBeNull();
    expect(await verifySignedLinkToken(ENV_A, '')).toBeNull();
  });

  test('sponsor_id swap (attacker replaces sponsor_id claim) → rejected', async () => {
    // Sponsor sp_legit gets a token; tries to forge one with sp_competitor's id
    const legitToken = await mintSignedLinkToken(ENV_A, 'evt_abc', 'sponsor', 3600, { depth: 'local', sponsor_id: 'sp_legit' });
    expect(legitToken).not.toBeNull();
    const forged = swapPayload(legitToken!, {
      eventId: 'evt_abc',
      role: 'sponsor',
      exp: Math.floor(Date.now() / 1000) + 3600,
      depth: 'local',
      sponsor_id: 'sp_competitor',  // swapped to a different sponsor
    });
    const result = await verifySignedLinkToken(ENV_A, forged);
    expect(result).toBeNull();
  });
});
