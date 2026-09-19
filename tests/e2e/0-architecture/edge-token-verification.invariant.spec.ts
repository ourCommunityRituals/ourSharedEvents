/**
 * INVARIANT: Edge identity tokens are cryptographically verified (OSE-573).
 *
 * The Worker fronts its admin surface with Cloudflare Access. A CF Access JWT
 * (`Cf-Access-Jwt-Assertion`) must have its RS256 signature verified against the
 * team's published JWKS BEFORE any claim (email/allowlist) is trusted. Before
 * OSE-590/OSE-211 the Worker decoded the token but never verified the signature,
 * so a forged JWT with a matching email passed unconditionally.
 *
 * This is load-bearing for the platform's "choice play": the whole model — anonymous
 * OSE + named spokes, governed by the authorization token — is only honest if the
 * token cannot be forged. A choice enforced by a forgeable token is no choice. So
 * this L0 static gate locks the verification mechanism into the code shape, in the
 * T0 `invariants` shard, so it can never silently regress to decode-only:
 *
 *   1. verifyCfAccessJWT() performs a REAL RSA signature check
 *      (crypto.subtle.verify, RSASSA-PKCS1-v1_5) — not just a base64 decode.
 *   2. It rejects (valid:false) on expiry BEFORE trusting the token, and rejects
 *      on any failure (fail-closed).
 *   3. The JWKS is cached with a TTL (no per-request fetch, no unbounded staleness).
 *   4. requireAdmin() actually CALLS verifyCfAccessJWT(cfJwt, env.CF_ACCESS_TEAM_DOMAIN)
 *      and gates on the result — the check is wired into the auth path, not dormant.
 *   5. The CF Access team domain is env-driven (CF_ACCESS_TEAM_DOMAIN), never a
 *      hardcoded team domain in the verification path.
 *
 * What it catches: a refactor that drops the crypto.subtle.verify call, stops
 * calling verifyCfAccessJWT from requireAdmin, removes the expiry/fail-closed
 * guard, or hardcodes the team domain → CI fails in the T0 gate before merge.
 *
 * Pattern reference: sponsor-identity-split.invariant.spec.ts (readFileSync L0
 * structural approach). Runtime counterpart: admin-allowlist.spec.ts (OSE-590)
 * exercises the wiring against the worker; verifyCfAccessJWT unit tests there
 * cover the expired/malformed → valid:false behaviour.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const ADMIN_TS = join(REPO_ROOT, 'workers', 'oursharedevents', 'src', 'auth', 'admin.ts');

function adminSrc(): string {
  return readFileSync(ADMIN_TS, 'utf8');
}

/** The body of the verifyCfAccessJWT function (best-effort brace-free slice). */
function verifyFnBody(src: string): string {
  const start = src.indexOf('export async function verifyCfAccessJWT');
  expect(start, 'verifyCfAccessJWT must be exported from auth/admin.ts (OSE-573)').toBeGreaterThan(
    -1
  );
  // Slice to the next top-level `export ` / `function ` after the declaration, or 3k chars.
  const rest = src.slice(start + 1);
  const nextExport = rest.indexOf('\nexport ');
  return rest.slice(0, nextExport === -1 ? 3000 : nextExport);
}

test.describe('Invariant: edge identity token cryptographic verification (OSE-573)', () => {
  test('verifyCfAccessJWT performs a real RSA signature check, not decode-only', () => {
    const body = verifyFnBody(adminSrc());
    expect(
      /crypto\.subtle\.verify\s*\(\s*['"`]RSASSA-PKCS1-v1_5['"`]/.test(body),
      'verifyCfAccessJWT must call crypto.subtle.verify("RSASSA-PKCS1-v1_5", ...) — a base64 decode is not verification'
    ).toBe(true);
  });

  test('verification is fail-closed: rejects on expiry and returns valid:false on failure', () => {
    const body = verifyFnBody(adminSrc());
    // Expiry is checked (exp claim) before the token is trusted.
    expect(
      /\.exp\b/.test(body) && /Math\.floor\(Date\.now\(\)\s*\/\s*1000\)/.test(body),
      'verifyCfAccessJWT must reject expired tokens (exp <= now) before trusting claims'
    ).toBe(true);
    // Fail-closed: at least one explicit valid:false return path exists.
    expect(
      /valid:\s*false/.test(body),
      'verifyCfAccessJWT must return { valid: false } on failure (fail-closed)'
    ).toBe(true);
  });

  test('JWKS is cached with a TTL (no per-request fetch, bounded staleness)', () => {
    const src = adminSrc();
    expect(
      /JWKS_TTL_MS/.test(src) &&
        /Date\.now\(\)\s*-\s*_jwksCache\.fetchedAt\s*<\s*JWKS_TTL_MS/.test(src),
      'admin.ts must cache the JWKS with a TTL (JWKS_TTL_MS + fetchedAt freshness check)'
    ).toBe(true);
  });

  test('requireAdmin wires the check: calls verifyCfAccessJWT and gates on the result', () => {
    const src = adminSrc();
    expect(
      /verifyCfAccessJWT\(\s*cfJwt\s*,\s*env\.CF_ACCESS_TEAM_DOMAIN\s*\)/.test(src),
      'requireAdmin must call verifyCfAccessJWT(cfJwt, env.CF_ACCESS_TEAM_DOMAIN) — the verifier must not be dormant'
    ).toBe(true);
    expect(
      /verification\.valid/.test(src),
      'requireAdmin must gate on the verification result (verification.valid) and reject when false'
    ).toBe(true);
  });

  test('CF Access team domain is env-driven, never a hardcoded team domain in the verify path', () => {
    const src = adminSrc();
    expect(
      /env\.CF_ACCESS_TEAM_DOMAIN/.test(src),
      'the team domain must come from env.CF_ACCESS_TEAM_DOMAIN'
    ).toBe(true);
    // No hardcoded cloudflareaccess.com team domain literal in the CODE (comments,
    // e.g. an "// e.g. myteam.cloudflareaccess.com" doc example, are allowed).
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/[^\n]*/g, ''); // line comments
    expect(
      /["'`][a-z0-9.-]+\.cloudflareaccess\.com["'`]/i.test(codeOnly),
      'auth/admin.ts must not hardcode a *.cloudflareaccess.com team domain in code — use env.CF_ACCESS_TEAM_DOMAIN'
    ).toBe(false);
  });
});

// ── Sponsor-home signed token (CCR-PR567 M5) ─────────────────────────────────
// The second edge identity token: an HMAC-signed, sponsor-scoped bearer that
// opens /sponsor. It shares the report signing secret but a distinct `kind`.
// Its constant-time / fail-closed / kind-pinned / expiry properties were locked
// by nothing (green-but-blind); this pins them into the code shape so a refactor
// to a `===` signature compare, a dropped secret check, or a missing kind/exp
// guard fails in the T0 invariants shard.
const SPONSOR_HOME_AUTH_TS = join(
  REPO_ROOT,
  'workers',
  'oursharedevents',
  'src',
  'lib',
  'sponsor-home-auth.ts'
);
function sponsorAuthSrc(): string {
  return readFileSync(SPONSOR_HOME_AUTH_TS, 'utf8');
}
function verifySponsorFnBody(src: string): string {
  const start = src.indexOf('export async function verifySponsorHomeToken');
  expect(
    start,
    'verifySponsorHomeToken must be exported from lib/sponsor-home-auth.ts'
  ).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const nextExport = rest.indexOf('\nexport ');
  return rest.slice(0, nextExport === -1 ? 3000 : nextExport);
}

test.describe('Invariant: sponsor-home signed token verification (TL-045, CCR-PR567 M5)', () => {
  test('verifySponsorHomeToken compares the signature in CONSTANT TIME, never with === / ==', () => {
    const body = verifySponsorFnBody(sponsorAuthSrc());
    expect(
      /constantTimeEqual\s*\(/.test(body),
      'verifySponsorHomeToken must compare the HMAC via constantTimeEqual — a byte-early-exit === leaks the signature through timing'
    ).toBe(true);
    // The signature must not be compared with a raw ===/== (a timing oracle).
    expect(
      /(?:===?\s*sig\b)|(?:\bsig\s*===?)/.test(body),
      'the signature must not be compared with === / == — use constantTimeEqual'
    ).toBe(false);
  });

  test('constantTimeEqual is a real constant-time comparator (length check + XOR accumulate)', () => {
    const src = sponsorAuthSrc();
    expect(/function constantTimeEqual/.test(src), 'constantTimeEqual must be defined').toBe(true);
    // XOR-accumulate into a single diff, checked once after the loop — not an
    // early-return-on-mismatch (which would reintroduce the timing leak).
    expect(
      /diff\s*\|=\s*[^\n]*\^/.test(src),
      'constantTimeEqual must XOR-accumulate every byte (no early return inside the loop)'
    ).toBe(true);
  });

  test('verifySponsorHomeToken is fail-closed on a missing signing secret', () => {
    const body = verifySponsorFnBody(sponsorAuthSrc());
    expect(
      /if\s*\(\s*!secret\s*\)\s*return null/.test(body),
      'must return null when SHARED_REPORT_SIGNING_SECRET is unset (fail-closed)'
    ).toBe(true);
  });

  test('verifySponsorHomeToken pins the token kind and enforces expiry', () => {
    const body = verifySponsorFnBody(sponsorAuthSrc());
    expect(
      /c\.kind\s*!==\s*KIND/.test(body),
      'must reject a payload whose kind is not sponsor_home (no cross-kind confusion with the report token)'
    ).toBe(true);
    expect(
      /c\.exp\s*<=\s*Math\.floor\(Date\.now\(\)\s*\/\s*1000\)/.test(body),
      'must reject an expired token (exp <= now)'
    ).toBe(true);
  });
});
