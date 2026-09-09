/**
 * OSE-1186 G4 — adversarial negative-auth: env-gated fallbacks + fail-closed JWT.
 *
 * Two gaps the existing auth suite did not cover:
 *
 *  1. FAIL-CLOSED JWT (new guard, src/auth/admin.ts): a deployed env
 *     (WORKER_ENV=staging|production) with NO CF_ACCESS_TEAM_DOMAIN cannot
 *     verify the CF Access JWT signature. Before the guard it silently trusted
 *     the unverified payload — a forged JWT bearing any allowlisted email would
 *     authenticate (fail-OPEN on misconfiguration). The guard makes that path
 *     reject. Local dev (no WORKER_ENV) keeps the unverified-extract convenience.
 *
 *  2. ENV-GATED FALLBACKS REJECTED WHEN OFF: Method 2 (X-OCR-Internal) and
 *     Method 3 (Bearer ADMIN_KEY) must present the correct secret AND have their
 *     flag set to exactly "true". The suite tested "flag on + wrong secret → 401"
 *     but never "flag off + correct secret → 401" — asserted here.
 *
 * L1 unit tests against requireAdmin() directly. A forged JWT is used
 * deliberately: the point is that an UNVERIFIED token must never authenticate in
 * a deployed env, regardless of its (attacker-chosen) claims.
 */

import { describe, test, expect } from 'vitest';
import { requireAdmin, type AdminEnv } from '../../src/auth/admin';

function seg(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A forged CF Access "human" JWT: valid-looking iat/exp, chosen email, junk sig. */
function forgedHumanJwt(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${seg({ alg: 'none', typ: 'JWT' })}.${seg({ iat: now - 10, exp: now + 3600, email })}.forged-signature`;
}

function adminReq(headers: Record<string, string>): Request {
  return new Request('https://x/api/v2/admin/sponsors', { headers });
}

function envOf(extra: Record<string, string>): AdminEnv {
  return extra as unknown as AdminEnv;
}

const ALLOWLISTED = 'admin@oursharedevents.com';

describe('OSE-1186 G4 — fail-closed CF Access JWT in a deployed env without a team domain', () => {
  for (const workerEnv of ['staging', 'production']) {
    test(`BORN-RED: ${workerEnv} + forged allowlisted JWT + no CF_ACCESS_TEAM_DOMAIN → rejected (not trusted)`, async () => {
      const req = adminReq({ 'Cf-Access-Jwt-Assertion': forgedHumanJwt(ALLOWLISTED) });
      const env = envOf({ WORKER_ENV: workerEnv, ALLOWED_ADMIN_EMAILS: ALLOWLISTED });
      const res = await requireAdmin(req, env, `fc-${workerEnv}`);
      // Revert the fail-closed guard and this returns null (the fail-open hole).
      expect(res, `${workerEnv} must not trust an unverifiable JWT`).not.toBeNull();
      expect(res!.status).toBe(401);
    });
  }

  test('local dev (no WORKER_ENV, no team domain) still trusts the unverified JWT (by design)', async () => {
    const req = adminReq({ 'Cf-Access-Jwt-Assertion': forgedHumanJwt(ALLOWLISTED) });
    const env = envOf({ ALLOWED_ADMIN_EMAILS: ALLOWLISTED });
    const res = await requireAdmin(req, env, 'local-1');
    expect(res, 'local dev keeps the unverified-extract convenience').toBeNull();
  });

  test('fail-closed does NOT strand CI: a service token + valid ADMIN_KEY still authenticates', async () => {
    // The JWT path is skipped (untrusted), but Method 3 authenticates on its secret.
    const now = Math.floor(Date.now() / 1000);
    const serviceJwt = `${seg({ alg: 'none' })}.${seg({ iat: now - 10, exp: now + 3600, common_name: 'ci' })}.sig`;
    const req = adminReq({ 'Cf-Access-Jwt-Assertion': serviceJwt, Authorization: 'Bearer k' });
    const env = envOf({
      WORKER_ENV: 'production',
      ALLOW_ADMIN_KEY_FALLBACK: 'true',
      ADMIN_KEY: 'k',
    });
    const res = await requireAdmin(req, env, 'ci-1');
    expect(res).toBeNull();
  });
});

describe('OSE-1186 G4 — env-gated fallbacks are rejected when their flag is not "true"', () => {
  test('Bearer ADMIN_KEY with the CORRECT key but ALLOW_ADMIN_KEY_FALLBACK absent → 401', async () => {
    const req = adminReq({ Authorization: 'Bearer secret-key' });
    const env = envOf({ WORKER_ENV: 'production', ADMIN_KEY: 'secret-key' }); // flag absent
    const res = await requireAdmin(req, env, 'gate-1');
    expect(res, 'fallback disabled → correct key must not authenticate').not.toBeNull();
    expect(res!.status).toBe(401);
  });

  test('X-OCR-Internal with the CORRECT secret but ALLOW_OCR_INTERNAL absent → 401', async () => {
    const req = adminReq({ 'X-OCR-Internal': 'internal-secret' });
    const env = envOf({ WORKER_ENV: 'production', X_OCR_INTERNAL: 'internal-secret' }); // flag absent
    const res = await requireAdmin(req, env, 'gate-2');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  for (const truthy of ['True', 'TRUE', '1', 'yes', 'on']) {
    test(`ALLOW_ADMIN_KEY_FALLBACK="${truthy}" (not exactly "true") does NOT enable the fallback → 401`, async () => {
      const req = adminReq({ Authorization: 'Bearer secret-key' });
      const env = envOf({
        WORKER_ENV: 'production',
        ALLOW_ADMIN_KEY_FALLBACK: truthy,
        ADMIN_KEY: 'secret-key',
      });
      const res = await requireAdmin(req, env, `truthy-${truthy}`);
      expect(res, `"${truthy}" must not be treated as enabled`).not.toBeNull();
      expect(res!.status).toBe(401);
    });
  }
});
