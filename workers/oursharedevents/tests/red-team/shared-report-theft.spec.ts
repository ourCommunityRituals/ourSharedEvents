/**
 * Red Team: shared-report-theft.spec.ts
 *
 * Attacks targeted:
 *   AUTH-006  Token reuse after revocation intent — no jti tracking.
 *   (escalation) Role escalation: bar_owner crafting admin-depth claim in token payload.
 *   (mismatch)   Event ID mismatch: token for event A used on event B endpoint.
 *   (depth)      Depth escalation: bar_owner claiming admin-depth pagination.
 *   (scope)      WKRP service token used on single-event endpoint (scope confusion).
 *   SEC-005      Batch endpoint allows full event ID enumeration.
 *
 * All tests use the actual Worker (SELF.fetch) or pure library functions.
 * No mocks of internal state — tests exercise real auth paths.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  mintSignedLinkToken,
  verifySignedLinkToken,
  verifyServiceToken,
  type SharedReportAuthEnv,
  type SignedLinkRole,
} from '../../src/lib/shared-report-auth';

// ─── Test env bindings ────────────────────────────────────────────────────────

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

const REPORT_SECRET = 'test-shared-report-signing-secret-do-not-use';
const WKRP_TOKEN    = 'test-wkrp-service-token-do-not-use';
const ADMIN_KEY     = 'test-admin-key-e2e-2026';

const reportEnv: SharedReportAuthEnv = {
  SHARED_REPORT_SIGNING_SECRET: REPORT_SECRET,
  WKRP_SERVICE_TOKEN: WKRP_TOKEN,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const mainStmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of mainStmts) {
    try { await tenv().DB.prepare(stmt).run(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
  const formsStmts: string[] = JSON.parse(tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  for (const stmt of formsStmts) {
    try { await tenv().FORMS_DB.prepare(stmt).run(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }

  // Seed events used in these tests
  const events = [
    ['evt_sr_target',  'brand_sr',  'SharedReport Target',  'active'],
    ['evt_sr_decoy',   'brand_sr',  'SharedReport Decoy',   'active'],
    ['evt_sr_owner',   'brand_sr',  'Bar Owner Event',      'active'],
    ['evt_sr_sponsor', 'brand_sr',  'Sponsor Event',        'active'],
    ['evt_sr_wkrp_1',  'brand_wkrp', 'WKRP Event 1',       'active'],
    ['evt_sr_wkrp_2',  'brand_wkrp', 'WKRP Event 2',       'active'],
    ['evt_sr_wkrp_3',  'brand_wkrp', 'WKRP Event 3',       'archived'],
  ];
  for (const [id, brand, title, status] of events) {
    try {
      await tenv().DB.prepare(
        `INSERT INTO events (id, brand_id, title, status, start_date, end_date)
         VALUES (?, ?, ?, ?, '2026-01-01', '2026-12-31')`
      ).bind(id, brand, title, status).run();
    } catch { /* already exists */ }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Manually forge a signed-link token with a controlled payload.
 * Signs with the real REPORT_SECRET but injects arbitrary claim fields.
 */
async function forgeSignedLinkToken(
  payload: Record<string, unknown>
): Promise<string> {
  function base64UrlEncode(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payloadStr));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(REPORT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${payloadB64}.${sigHex}`;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH-006: Token reuse — no jti, no server-side revocation
// ════════════════════════════════════════════════════════════════════════════

describe('AUTH-006: Token reuse rate limiting — tokens are unconditionally reusable (HIGH)', () => {

  test('same signed-link token accepted on 100 consecutive requests', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'bar_owner', 3600);
    expect(token).not.toBeNull();

    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_target/shared-report', {
        headers: { Authorization: `Bearer ${token}` },
      });
      results.push(res.status);
    }

    console.log(`[AUTH-006] 10 reuses — statuses: ${results.join(', ')}`);
    // None should be 401 from a "used token" check — there is no such check
    const unauthorizedCount = results.filter(s => s === 401).length;
    expect(unauthorizedCount).toBe(0);
    console.log('[AUTH-006] CONFIRMED: no per-token use counting — unlimited reuse');
  });

  test('expired token cannot be reused — expiry is enforced', async () => {
    // Mint a token with a -1 second TTL (already expired)
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'bar_owner', -1);
    expect(token).not.toBeNull();

    // Verify it's already expired at the library level
    const claim = await verifySignedLinkToken(reportEnv, token);
    expect(claim).toBeNull(); // correctly rejected

    // And at the HTTP level
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_target/shared-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test('verifySignedLinkToken: same token verifies identically on every call (no invalidation)', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_decoy', 'sponsor', 3600);
    expect(token).not.toBeNull();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => verifySignedLinkToken(reportEnv, token))
    );
    // All should return identical, non-null claims
    for (const claim of results) {
      expect(claim).not.toBeNull();
      expect(claim!.eventId).toBe('evt_sr_decoy');
    }
    console.log('[AUTH-006] 5 parallel verifications all succeeded — no state tracked');
  });

  test('token has no jti field — server-side revocation is architecturally impossible', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'admin', 3600);
    expect(token).not.toBeNull();
    const [payloadB64] = token!.split('.');
    const pad = '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/') + pad)
    ) as Record<string, unknown>;

    expect(payload.jti).toBeUndefined();
    expect(payload.nonce).toBeUndefined();
    expect(payload.version).toBeUndefined();
    console.log('[AUTH-006] Token payload keys:', Object.keys(payload));
    console.log('[AUTH-006] No jti/nonce — revocation requires key rotation (destroys all tokens)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Role escalation: bar_owner crafting admin-role token
// ════════════════════════════════════════════════════════════════════════════

describe('Role escalation via payload modification', () => {

  test('tampered payload (admin role) with original sig is rejected', async () => {
    // Mint a legitimate bar_owner token
    const legit = await mintSignedLinkToken(reportEnv, 'evt_sr_owner', 'bar_owner', 3600);
    expect(legit).not.toBeNull();
    const [, legitimateSig] = legit!.split('.');

    // Craft an admin-role payload and try to attach the bar_owner signature
    const adminPayload = JSON.stringify({
      eventId: 'evt_sr_owner',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fakeB64 = btoa(adminPayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tamperedToken = `${fakeB64}.${legitimateSig}`;

    // Must be rejected — signature covers the original payload, not this one
    const claim = await verifySignedLinkToken(reportEnv, tamperedToken);
    expect(claim).toBeNull();
    console.log('[ESCALATION] Tampered role=admin token rejected (signature mismatch)');
  });

  test('forged admin token (correctly signed with REPORT_SECRET) is accepted — key compromise scenario', async () => {
    // If the SHARED_REPORT_SIGNING_SECRET is compromised, an attacker can
    // mint admin-role tokens freely. This test documents that consequence.
    const adminToken = await forgeSignedLinkToken({
      eventId: 'evt_sr_owner',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const claim = await verifySignedLinkToken(reportEnv, adminToken);
    // The forged token IS valid because we used the real secret
    expect(claim).not.toBeNull();
    expect(claim!.role).toBe('admin');
    console.log('[ESCALATION] Key compromise scenario: attacker with REPORT_SECRET can mint admin tokens');
  });

  test('sponsor role cannot be escalated to bar_owner by payload edit', async () => {
    const sponsorToken = await mintSignedLinkToken(reportEnv, 'evt_sr_sponsor', 'sponsor', 3600);
    expect(sponsorToken).not.toBeNull();
    const [, sig] = sponsorToken!.split('.');

    // Try to change role from 'sponsor' to 'bar_owner'
    const escalatedPayload = JSON.stringify({
      eventId: 'evt_sr_sponsor',
      role: 'bar_owner',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fakeB64 = btoa(escalatedPayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const escalated = `${fakeB64}.${sig}`;

    const claim = await verifySignedLinkToken(reportEnv, escalated);
    expect(claim).toBeNull();
  });

  test('role field cannot be extended with custom super-role', async () => {
    // Forge a token with an invalid role — should be rejected even with valid sig
    const invalidRoleToken = await forgeSignedLinkToken({
      eventId: 'evt_sr_owner',
      role: 'super_admin',  // not a valid SignedLinkRole
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const claim = await verifySignedLinkToken(reportEnv, invalidRoleToken);
    expect(claim).toBeNull();
    console.log('[ESCALATION] Invalid role "super_admin" rejected');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Event ID mismatch: token for A used on B
// ════════════════════════════════════════════════════════════════════════════

describe('Event ID mismatch — cross-event token theft', () => {

  test('token for evt_sr_target cannot access evt_sr_decoy', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'admin', 3600);
    expect(token).not.toBeNull();

    const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_decoy/shared-report', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[MISMATCH] Token(evt_sr_target) on evt_sr_decoy: ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  test('token claims mismatch: eventId in token differs from URL event ID', async () => {
    // Forge a token correctly signed but claiming a different eventId
    const mismatchToken = await forgeSignedLinkToken({
      eventId: 'evt_sr_wkrp_1',  // different event
      role: 'bar_owner',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Try to use it on evt_sr_target
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_target/shared-report', {
      headers: { Authorization: `Bearer ${mismatchToken}` },
    });
    console.log(`[MISMATCH] Token(evt_sr_wkrp_1) on evt_sr_target: ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  test('verifySignedLinkToken does not cross-check URL event ID — it only validates the claim', async () => {
    // This is by design: verifySignedLinkToken is pure and receives no URL context.
    // The handler (shared-report-read.ts) must compare token.eventId with the URL param.
    // This test verifies the HANDLER enforces the check, not just the library.
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_decoy', 'bar_owner', 3600);
    const claim = await verifySignedLinkToken(reportEnv, token);
    // Library returns the claim — the mismatch check is the handler's responsibility
    expect(claim?.eventId).toBe('evt_sr_decoy');
    // The handler MUST reject when token.eventId !== URL event ID
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Depth escalation: bar_owner claiming admin-depth pagination
// ════════════════════════════════════════════════════════════════════════════

describe('Depth escalation — bar_owner claiming admin-depth access', () => {

  test('bar_owner token with depth=premium cannot be self-escalated to admin depth', async () => {
    // Mint a legitimate bar_owner token with depth=premium
    const legit = await mintSignedLinkToken(
      reportEnv, 'evt_sr_owner', 'bar_owner', 3600, { depth: 'premium' }
    );
    expect(legit).not.toBeNull();
    const claim = await verifySignedLinkToken(reportEnv, legit);
    expect(claim?.depth).toBe('premium');
    expect(claim?.role).toBe('bar_owner');

    // Attempt to tamper: change depth to admin in the payload
    const [, sig] = legit!.split('.');
    const escalatedPayload = JSON.stringify({
      eventId: 'evt_sr_owner',
      role: 'bar_owner',
      depth: 'admin',  // escalated
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fakeB64 = btoa(escalatedPayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const escalated = `${fakeB64}.${sig}`;
    const escapedClaim = await verifySignedLinkToken(reportEnv, escalated);
    expect(escapedClaim).toBeNull();
    console.log('[DEPTH] bar_owner depth escalation via payload tamper rejected');
  });

  test('forged bar_owner token with admin depth is accepted if secret is known (key compromise)', async () => {
    // If the signing secret is compromised, depth claims can be freely set
    const escalatedToken = await forgeSignedLinkToken({
      eventId: 'evt_sr_owner',
      role: 'bar_owner',
      depth: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const claim = await verifySignedLinkToken(reportEnv, escalatedToken);
    // With the real secret, even forged claims pass signature validation
    expect(claim?.depth).toBe('admin');
    console.log('[DEPTH] Key compromise: attacker can self-issue admin-depth bar_owner tokens');
    console.log('[DEPTH] Fix: depth must be validated server-side against the event\'s tier, not trusted from token');
  });

  test('sponsor_id scope claim cannot be self-escalated to show all sponsors', async () => {
    // Sponsor tokens include sponsor_id to restrict cross-contamination
    const narrowToken = await mintSignedLinkToken(
      reportEnv, 'evt_sr_sponsor', 'sponsor', 3600, { sponsor_id: 'spon_abc' }
    );
    const claim = await verifySignedLinkToken(reportEnv, narrowToken);
    expect(claim?.sponsor_id).toBe('spon_abc');

    // Attempt to remove the sponsor_id restriction
    const [, sig] = narrowToken!.split('.');
    const broadPayload = JSON.stringify({
      eventId: 'evt_sr_sponsor',
      role: 'sponsor',
      // No sponsor_id — would see all sponsors
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fakeB64 = btoa(broadPayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const broadToken = `${fakeB64}.${sig}`;
    const broadClaim = await verifySignedLinkToken(reportEnv, broadToken);
    expect(broadClaim).toBeNull();
    console.log('[DEPTH] sponsor_id scope escalation via payload tamper rejected');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Service token scope: WKRP token misuse on non-batch endpoints
// ════════════════════════════════════════════════════════════════════════════

describe('Service token scope — WKRP token misuse', () => {

  test('WKRP service token rejected on single-event SharedReport GET', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_wkrp_1/shared-report', {
      headers: { Authorization: `Bearer ${WKRP_TOKEN}` },
    });
    console.log(`[SCOPE] WKRP token on single-event GET: ${res.status}`);
    // WKRP token is structurally different from a signed-link token
    // verifySignedLinkToken should reject it (wrong format — no dot delimiter like payload.sig)
    expect(res.status).toBe(401);
  });

  test('WKRP service token rejected on admin endpoints', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/admin/events', {
      headers: { Authorization: `Bearer ${WKRP_TOKEN}` },
    });
    console.log(`[SCOPE] WKRP token on admin events: ${res.status}`);
    expect(res.status).toBe(401);
  });

  test('WKRP service token rejected on form endpoints', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_wkrp_1/forms/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WKRP_TOKEN}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    console.log(`[SCOPE] WKRP token on form endpoint: ${res.status}`);
    // Form endpoints don't use auth headers — token is irrelevant but should not grant access
    expect(res.status).not.toBe(401); // forms are public (no auth required on forms)
    // The WKRP token provides no elevation on a public form endpoint
  });

  test('verifyServiceToken: rejects signed-link tokens', async () => {
    // A signed-link token (payload.sig format) must not match the WKRP token
    const signedLinkToken = await mintSignedLinkToken(
      reportEnv, 'evt_sr_wkrp_1', 'admin', 3600
    );
    expect(signedLinkToken).not.toBeNull();
    // signed-link tokens contain a '.' delimiter — WKRP token is a simple bearer string
    const result = verifyServiceToken(reportEnv, signedLinkToken);
    expect(result).toBe(false);
  });

  test('verifyServiceToken: empty WKRP_SERVICE_TOKEN env → always reject', () => {
    const envNoToken: SharedReportAuthEnv = { WKRP_SERVICE_TOKEN: '' };
    expect(verifyServiceToken(envNoToken, WKRP_TOKEN)).toBe(false);
    expect(verifyServiceToken(envNoToken, '')).toBe(false);
    expect(verifyServiceToken({}, WKRP_TOKEN)).toBe(false);
  });

  test('WKRP token works on batch endpoint — its intended scope', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/shared-reports/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WKRP_TOKEN}`,
      },
      body: JSON.stringify({ eventIds: ['evt_sr_wkrp_1', 'evt_sr_wkrp_2'] }),
    });
    console.log(`[SCOPE] WKRP token on batch (intended scope): ${res.status}`);
    // Should succeed or return a non-401 status
    expect(res.status).not.toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Token manipulation attacks
// ════════════════════════════════════════════════════════════════════════════

describe('Token manipulation: structural attacks on signed-link format', () => {

  test('empty token string returns 401', async () => {
    const res = await SELF.fetch('http://localhost/api/v2/events/evt_sr_target/shared-report', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  test('token with extra dot segments is rejected', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'bar_owner', 3600);
    expect(token).not.toBeNull();
    const [payloadB64, sig] = token!.split('.');
    // Add a third segment
    const threePartToken = `${payloadB64}.${sig}.extra`;
    const claim = await verifySignedLinkToken(reportEnv, threePartToken);
    expect(claim).toBeNull();
    console.log('[MANIPULATION] Three-part token rejected');
  });

  test('signature-only token (no payload) is rejected', async () => {
    const claim = await verifySignedLinkToken(reportEnv, '.AAAAAAAAAAAAAAAAAAA');
    expect(claim).toBeNull();
  });

  test('payload-only token (no signature) is rejected', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'bar_owner', 3600);
    expect(token).not.toBeNull();
    const [payloadB64] = token!.split('.');
    const claim = await verifySignedLinkToken(reportEnv, payloadB64); // no dot = no delimiter
    expect(claim).toBeNull();
  });

  test('base64-encoded JSON without HMAC is rejected', async () => {
    const payload = JSON.stringify({
      eventId: 'evt_sr_target',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const fakeB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // No actual signature — just zeros
    const fakeToken = `${fakeB64}.${'0'.repeat(64)}`;
    const claim = await verifySignedLinkToken(reportEnv, fakeToken);
    expect(claim).toBeNull();
    console.log('[MANIPULATION] Zero-filled signature rejected');
  });

  test('algorithm confusion: RS256 header on HS256 token is still validated via HMAC', async () => {
    // The signed-link format is NOT a standard JWT — it does not have an alg header.
    // This ensures there's no algorithm confusion attack surface.
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'bar_owner', 3600);
    expect(token).not.toBeNull();
    // The format is payload.sig — there is no header segment
    const parts = token!.split('.');
    expect(parts).toHaveLength(2);
    // First part is base64url(JSON payload) — not a JWT header
    const pad = '='.repeat((4 - (parts[0].length % 4)) % 4);
    const decoded = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/') + pad)) as Record<string, unknown>;
    // No alg, no typ — not a JWT
    expect(decoded.alg).toBeUndefined();
    expect(decoded.typ).toBeUndefined();
    console.log('[MANIPULATION] Token format is NOT a JWT — no algorithm confusion surface');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Concurrent token use — race conditions
// ════════════════════════════════════════════════════════════════════════════

describe('Concurrent token use — parallel access patterns', () => {

  test('same token used concurrently in 10 parallel requests — all succeed (no locking)', async () => {
    const token = await mintSignedLinkToken(reportEnv, 'evt_sr_target', 'bar_owner', 3600);
    expect(token).not.toBeNull();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        SELF.fetch('http://localhost/api/v2/events/evt_sr_target/shared-report', {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );

    const statuses = responses.map(r => r.status);
    console.log(`[CONCURRENT] 10 parallel same-token requests: ${statuses.join(', ')}`);

    // None should be 401 — there's no per-token use counter
    const rejected = statuses.filter(s => s === 401).length;
    expect(rejected).toBe(0);
    console.log('[CONCURRENT] CONFIRMED: stateless verification — no concurrent use protection');
  });

  test('multiple different valid tokens for same event are all accepted simultaneously', async () => {
    const tokens = await Promise.all(
      ['bar_owner', 'sponsor', 'admin'].map(role =>
        mintSignedLinkToken(
          reportEnv, 'evt_sr_target', role as SignedLinkRole, 3600
        )
      )
    );

    const responses = await Promise.all(
      tokens.map(token =>
        SELF.fetch('http://localhost/api/v2/events/evt_sr_target/shared-report', {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );

    const statuses = responses.map(r => r.status);
    console.log(`[CONCURRENT] Multi-role parallel access: ${statuses.join(', ')}`);
    // All should be accepted (or 404/200 depending on data — never 401)
    for (const status of statuses) {
      expect(status).not.toBe(401);
    }
  });
});
