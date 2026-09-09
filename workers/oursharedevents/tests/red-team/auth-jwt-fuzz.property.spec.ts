/**
 * OSE-1186 G4 — property-based JWT/claim fuzzing against the fail-closed guard.
 *
 * The structural auth tests use a handful of hand-picked forged JWTs. This
 * explores the claim space: for a deployed env (WORKER_ENV=production) with NO
 * CF_ACCESS_TEAM_DOMAIN and NO fallback secrets, NO adversarially-fuzzed CF
 * Access JWT — any email (including the allowlisted one), any exp/iat, any alg,
 * malformed segments, or pure garbage — may authenticate, and the guard must
 * never throw (fail-closed, not fail-crash).
 *
 * This path takes no JWKS fetch (domain unset), so the fuzz is deterministic and
 * network-free — safe as a PR gate. Runs at FC_RUNS=200 (gate) / 50000 (nightly,
 * overnight-fuzz.yml).
 */

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { requireAdmin, type AdminEnv } from '../../src/auth/admin';

const RUNS = Number(process.env.FC_RUNS ?? 200);
const ALLOWLISTED = 'admin@oursharedevents.com';

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a (mostly) well-formed forged JWT from fuzzed claims. */
const forgedJwtArb = fc
  .record({
    alg: fc.constantFrom('none', 'RS256', 'HS256', 'ES256', ''),
    email: fc.oneof(
      fc.constant(ALLOWLISTED), // the dangerous case: a forgery bearing the real admin email
      fc.emailAddress(),
      fc.string(),
      fc.constant(undefined)
    ),
    exp: fc.oneof(fc.integer(), fc.constant(undefined), fc.double()),
    iat: fc.oneof(fc.integer(), fc.constant(undefined)),
    extra: fc.object(),
  })
  .map(({ alg, email, exp, iat, extra }) => {
    const header = b64url(JSON.stringify({ alg, typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ ...extra, email, exp, iat }));
    return `${header}.${payload}.forged-signature`;
  });

/** Also throw pure garbage at it — wrong segment counts, non-base64, unicode. */
const garbageJwtArb = fc.oneof(
  fc.string(),
  fc.string({ unit: 'binary' }),
  fc.tuple(fc.string(), fc.string()).map(([a, b]) => `${a}.${b}`),
  fc.tuple(fc.string(), fc.string(), fc.string(), fc.string()).map((p) => p.join('.'))
);

function adminReq(jwt: string): Request {
  return new Request('https://x/api/v2/admin/sponsors', {
    headers: { 'Cf-Access-Jwt-Assertion': jwt },
  });
}

// Deployed, no team domain, no fallback secrets → the fail-closed guard governs.
const deployedEnv = {
  WORKER_ENV: 'production',
  ALLOWED_ADMIN_EMAILS: ALLOWLISTED,
} as unknown as AdminEnv;

describe('OSE-1186 G4 — no fuzzed CF Access JWT authenticates in a deployed env (fail-closed)', () => {
  test('forged structured JWTs never authenticate and never throw', async () => {
    await fc.assert(
      fc.asyncProperty(forgedJwtArb, async (jwt) => {
        const res = await requireAdmin(adminReq(jwt), deployedEnv, 'fuzz');
        // Must reject (401) — never null (authenticated), never a thrown 500.
        return res !== null && res.status === 401;
      }),
      { numRuns: RUNS }
    );
  });

  test('garbage JWT strings never authenticate and never throw', async () => {
    await fc.assert(
      fc.asyncProperty(garbageJwtArb, async (jwt) => {
        const res = await requireAdmin(adminReq(jwt), deployedEnv, 'fuzz');
        return res !== null && res.status === 401;
      }),
      { numRuns: RUNS }
    );
  });
});
