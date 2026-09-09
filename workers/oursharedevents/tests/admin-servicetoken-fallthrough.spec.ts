/**
 * OSE-889 root cause — admin auth Method 1 must not short-circuit a service token.
 *
 * When Cloudflare Access is enforced on `/api/v2/admin/*`, a valid **service
 * token** authenticates at the edge and CF Access injects a `Cf-Access-Jwt-
 * Assertion` whose JWT carries **no `email` claim** (service tokens are non-human).
 * The admin guard's Method 1 (CF Access JWT) hit `if (!email) → 403` and RETURNED,
 * short-circuiting before Method 2 (`X-OCR-Internal`) and Method 3 (`ADMIN_KEY`) —
 * the methods the CI actually authenticates with. Net effect: the CI could never
 * pass admin auth once CF Access was on the path (the recurring OSE-349/OSE-889
 * failure), because reaching the worker *requires* the service token, and that
 * token's JWT then vetoes the request.
 *
 * Fix: a valid CF Access JWT with **no email** (a service token) must FALL THROUGH
 * to Methods 2/3 instead of 403-ing. This does not weaken auth — each fallthrough
 * method still requires its own secret; and a JWT that carries an email that is
 * simply not allowlisted (a real human) is still rejected.
 *
 * These are L1 unit tests against requireAdmin() directly (no JWKS/team-domain, so
 * the signature step is skipped — the `!email` branch is identical whether the
 * signature was verified or not).
 */

import { describe, test, expect } from 'vitest';
import { requireAdmin, type AdminEnv } from '../src/auth/admin';

/** Encode a base64url JWT segment. */
function seg(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A CF Access **service token** JWT: valid iat/exp, NO email claim. */
function serviceTokenJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${seg({ alg: 'none', typ: 'JWT' })}.${seg({ iat: now - 10, exp: now + 3600, sub: '', common_name: 'ci-service-token' })}.sig`;
}

/** A CF Access **human** JWT carrying an email claim. */
function humanJwt(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${seg({ alg: 'none', typ: 'JWT' })}.${seg({ iat: now - 10, exp: now + 3600, email })}.sig`;
}

function adminReq(headers: Record<string, string>): Request {
  return new Request('https://x/api/v2/admin/sponsors', { headers });
}

/** Base env: deployed (staging) so the local-dev bypass can never fire; no
 * team domain so JWKS signature verification is skipped for the unit test. */
const baseEnv = { WORKER_ENV: 'staging' } as unknown as AdminEnv;
function withEnv(extra: Record<string, string>): AdminEnv {
  return { ...(baseEnv as object), ...extra } as unknown as AdminEnv;
}

describe('OSE-889 — service-token JWT (no email) falls through to ADMIN_KEY / X-OCR-Internal', () => {
  test('BORN-RED: service-token JWT + valid ADMIN_KEY authenticates (must NOT 403 on the no-email short-circuit)', async () => {
    const req = adminReq({
      'Cf-Access-Jwt-Assertion': serviceTokenJwt(),
      Authorization: 'Bearer test-admin-key',
    });
    const env = withEnv({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'test-admin-key' });
    const res = await requireAdmin(req, env, 'req-1');
    expect(
      res,
      'service token + valid ADMIN_KEY should pass (null), not be 403d by Method 1'
    ).toBeNull();
  });

  test('service-token JWT + valid X-OCR-Internal authenticates (Method 2 fallthrough)', async () => {
    const req = adminReq({
      'Cf-Access-Jwt-Assertion': serviceTokenJwt(),
      'X-OCR-Internal': 'internal-secret',
    });
    const env = withEnv({ ALLOW_OCR_INTERNAL: 'true', X_OCR_INTERNAL: 'internal-secret' });
    const res = await requireAdmin(req, env, 'req-2');
    expect(res).toBeNull();
  });

  // ── Security preserved: fallthrough must NOT grant access on the JWT alone ──
  test('SECURITY: service-token JWT with NO fallback secret is still rejected', async () => {
    const req = adminReq({ 'Cf-Access-Jwt-Assertion': serviceTokenJwt() });
    // Fallback methods disabled / no matching secret.
    const env = withEnv({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'the-real-key' });
    const res = await requireAdmin(req, env, 'req-3');
    expect(res, 'no ADMIN_KEY presented → must not authenticate').not.toBeNull();
    expect(res!.status).toBeGreaterThanOrEqual(401);
  });

  test('SECURITY: service-token JWT + WRONG ADMIN_KEY is still rejected', async () => {
    const req = adminReq({
      'Cf-Access-Jwt-Assertion': serviceTokenJwt(),
      Authorization: 'Bearer wrong-key',
    });
    const env = withEnv({ ALLOW_ADMIN_KEY_FALLBACK: 'true', ADMIN_KEY: 'the-real-key' });
    const res = await requireAdmin(req, env, 'req-4');
    expect(res).not.toBeNull();
    expect(res!.status).toBeGreaterThanOrEqual(401);
  });

  // ── Allowlist behaviour on a TRUSTED JWT ──
  // These two assert the email-allowlist logic against a JWT whose payload is
  // trusted WITHOUT a JWKS signature check. After the OSE-1186 G4 fail-closed
  // guard, a deployed env (staging/production) with no CF_ACCESS_TEAM_DOMAIN no
  // longer trusts an unverified JWT — so the legitimate place to exercise
  // "trusted-JWT → allowlist" without mocking JWKS is a LOCAL env (WORKER_ENV
  // undefined), where the unverified-extract path is by-design. The deployed
  // fail-closed behaviour itself is asserted in red-team/auth-env-gating.spec.ts.
  const localEnv = {} as unknown as AdminEnv; // no WORKER_ENV, no team domain
  function withLocalEnv(extra: Record<string, string>): AdminEnv {
    return { ...(localEnv as object), ...extra } as unknown as AdminEnv;
  }

  test('SECURITY: a human JWT with a NON-allowlisted email is still 403 (allowlist unaffected)', async () => {
    const req = adminReq({ 'Cf-Access-Jwt-Assertion': humanJwt('stranger@nowhere.test') });
    const env = withLocalEnv({ ALLOWED_ADMIN_EMAILS: 'admin@oursharedevents.com' });
    const res = await requireAdmin(req, env, 'req-5');
    expect(res, 'non-allowlisted human must stay rejected').not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('a human JWT with an ALLOWLISTED email still passes (unchanged)', async () => {
    const req = adminReq({ 'Cf-Access-Jwt-Assertion': humanJwt('admin@oursharedevents.com') });
    const env = withLocalEnv({ ALLOWED_ADMIN_EMAILS: 'admin@oursharedevents.com' });
    const res = await requireAdmin(req, env, 'req-6');
    expect(res).toBeNull();
  });
});
