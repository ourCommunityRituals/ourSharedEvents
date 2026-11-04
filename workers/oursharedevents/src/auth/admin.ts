/**
 * Admin authentication guard.
 *
 * Method 1: Cloudflare Access JWT (Cf-Access-Jwt-Assertion header)
 *           + RSA signature verification against JWKS (when CF_ACCESS_TEAM_DOMAIN is set)
 *           + email allowlist check (OSE-211 / SEC-5) when configured.
 * Method 2: X-OCR-Internal header against X_OCR_INTERNAL (when ALLOW_OCR_INTERNAL=true)
 * Method 3: Bearer token against ADMIN_KEY (when ALLOW_ADMIN_KEY_FALLBACK=true)
 *
 * Methods 2 and 3 bypass the email allowlist — they carry no email identity
 * and are reserved for CI/CD automation and staging fallback only.
 *
 * Usage:
 *   const deny = await requireAdmin(request, env, requestId);
 *   if (deny) return deny;
 */

import { assertAdminEmailAllowed, type AdminAllowlistEnv } from '../lib/admin-allowlist';

export interface AdminEnv extends AdminAllowlistEnv {
  ADMIN_KEY?: string;
  ADMIN_TOKEN?: string; // legacy alias
  ALLOW_ADMIN_KEY_FALLBACK?: string;
  X_OCR_INTERNAL?: string; // CI/CD internal auth secret
  ALLOW_OCR_INTERNAL?: string; // gate for X-OCR-Internal header
  CF_ACCESS_TEAM_DOMAIN?: string; // e.g. "mzdano.cloudflareaccess.com"
  /**
   * OSE-1377: Application Audience (AUD) tag of the OSE admin Access app. When set,
   * verifyCfAccessJWT additionally pins `aud` (this app) + `iss` (the team) — the
   * team JWKS signs tokens for EVERY app in the tenant, so without the aud pin a
   * signature-valid token minted for any other same-team app would verify. DARK by
   * default (empty ⇒ no aud/iss check ⇒ current behavior). Non-secret; set from the
   * Access app Overview once it exists (OSE-1377 CCR gate V3).
   */
  CF_ACCESS_AUD?: string;
  WORKER_ENV?: string; // 'production' | 'staging' | undefined (local dev)
  /**
   * LOCAL DEV ONLY. When 'true' AND WORKER_ENV is not production/staging,
   * opens the admin UI without auth so the dashboard is viewable on
   * `wrangler dev` (where Cloudflare Access — the real login — doesn't exist).
   * Set ONLY in the gitignored .dev.vars. Never in wrangler.toml [vars]/secrets.
   */
  DEV_OPEN_ADMIN?: string;
}

// ─── CF Access JWT cryptographic verification (OSE-573) ───────────────────────
// Module-level cache survives isolate reuse; avoids a JWKS fetch on every req.

interface JwksCache {
  keys: CryptoKey[];
  fetchedAt: number;
}

let _jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function _fetchJwks(teamDomain: string): Promise<CryptoKey[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  // Stryker disable next-line StringLiteral: equivalent mutant — the Error message text is never asserted; only the throw→fail-closed behaviour is (auth-guard-mutation.spec.ts "JWKS endpoint non-OK … → 401"). OSE-1278.
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  return Promise.all(
    keys.map((k) =>
      // Stryker disable next-line BooleanLiteral: equivalent mutant — the importKey `extractable` flag (false→true) does not change verify() output; a signature still verifies identically. OSE-1278.
      crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
        'verify',
      ])
    )
  );
}

async function _getJwks(teamDomain: string): Promise<CryptoKey[]> {
  // Stryker disable next-line EqualityOperator: equivalent mutant — `<` vs `<=` differ only when the cache age equals the 1h TTL to the exact millisecond, unobservable. The TTL window IS covered (reuse-within-5min / refetch-past-2h in auth-guard-mutation.spec.ts). OSE-1278.
  if (_jwksCache && Date.now() - _jwksCache.fetchedAt < JWKS_TTL_MS) return _jwksCache.keys;
  const keys = await _fetchJwks(teamDomain);
  _jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Test-only: clear the module-level JWKS cache so a test can force a fresh fetch
 * (cache-miss / fetch-failure paths). Not used in production. Prefer this over
 * vi.resetModules()+dynamic import, which is incompatible with StrykerJS per-test
 * coverage (OSE-1278).
 */
export function __resetJwksCacheForTests(): void {
  _jwksCache = null;
}

// Stryker disable next-line StringLiteral,ArithmeticOperator: equivalent mutants — atob() is forgiving-base64 (ignores padding, only rejects length%4===1), so removing/zeroing the '=' padding does not change decoding of real CF Access segments. OSE-1278.
const _pad = (s: string) => s + '='.repeat((4 - (s.length % 4)) % 4);
const _decodeB64 = (s: string) => atob(_pad(s.replace(/-/g, '+').replace(/_/g, '/')));

/**
 * Per-REQUEST memo of the signature verdict. The router pre-flight and
 * requireAdmin both verify the same token on one admin request; this makes the
 * RSA work happen once. Deliberately narrow:
 *   - keyed by the Request object (WeakMap): nothing survives the request, so
 *     no cross-request, cross-tenant or post-JWKS-refresh reuse is possible;
 *   - keyed by team domain + exact token bytes inside that request;
 *   - caches ONLY the signature verdict: exp, iss and the aud pin are re-checked
 *     on every call by verifyCfAccessJWT;
 *   - a rejected verification (JWKS fetch failure) is evicted, never reused.
 * The RSA check itself stays inside verifyCfAccessJWT (edge-token-verification
 * invariant reads it there); this helper only decides whether to run it.
 */
const _signatureMemo = new WeakMap<Request, Map<string, Promise<boolean>>>();

function _signatureOncePerRequest(
  request: Request | undefined,
  key: string,
  check: () => Promise<boolean>
): Promise<boolean> {
  if (!request) return check();
  let memo = _signatureMemo.get(request);
  if (!memo) {
    memo = new Map();
    _signatureMemo.set(request, memo);
  }
  const hit = memo.get(key);
  if (hit) return hit;
  const pending = check();
  memo.set(key, pending);
  const owner = memo;
  pending.catch(() => owner.delete(key));
  return pending;
}

/**
 * Cryptographically verify a CF Access JWT against the team's public JWKS.
 * Returns the decoded payload on success, null on any failure (invalid sig,
 * expired, malformed). Call this ONCE per request before requireAdmin —
 * requireAdmin continues to decode the payload for the allowlist check.
 *
 * Pass `opts.request` to share the signature verdict with later checks on the
 * same request (see _signatureMemo); claims are always re-validated.
 */
export async function verifyCfAccessJWT(
  jwt: string,
  teamDomain: string,
  opts?: { expectedAud?: string; request?: Request }
): Promise<{ valid: true; email?: string } | { valid: false }> {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { valid: false };

    const payload = JSON.parse(_decodeB64(parts[1])) as {
      exp?: number;
      iat?: number;
      email?: string;
      aud?: string | string[];
      iss?: string;
    };
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return { valid: false };

    // The costly step: RSA-verify against the team JWKS. Runs at most once per
    // (request, domain, token) when opts.request is given; claims below run always.
    const checkSignature = async (): Promise<boolean> => {
      const sigInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const sig = Uint8Array.from(_decodeB64(parts[2]), (c) => c.charCodeAt(0));
      const keys = await _getJwks(teamDomain);
      const results = await Promise.all(
        keys.map((k) =>
          // Stryker disable next-line ArrowFunction,BooleanLiteral: equivalent/defensive — `()=>undefined` is falsy-identical to `false` under `results.some(Boolean)`; the `true` arm guards a verify() throw that well-formed key+sig inputs never trigger. A real verify failure (wrong key) IS covered. OSE-1278.
          crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, sig, sigInput).catch(() => false)
        )
      );
      return results.some(Boolean);
    };
    const sigKey = `${teamDomain}\n${jwt}`;
    if (!(await _signatureOncePerRequest(opts?.request, sigKey, checkSignature))) {
      return { valid: false };
    }

    // OSE-1377: audience + issuer pin. The team JWKS signs tokens for EVERY Access
    // app in the tenant, so a valid signature proves only "some app in this team",
    // not "the OSE admin app". When CF_ACCESS_AUD is configured, require the
    // signature-verified payload's `iss` to be this team AND its `aud` (string or
    // array) to include the expected tag. DARK when expectedAud is unset.
    if (opts?.expectedAud) {
      if (payload.iss !== `https://${teamDomain}`) return { valid: false };
      const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
      if (!auds.includes(opts.expectedAud)) return { valid: false };
    }

    return { valid: true, email: payload.email };
  } catch {
    // Stryker disable next-line ObjectLiteral: equivalent mutant — `{}` has `valid: undefined`, which the caller treats identically to `valid: false` (both fail `verification.valid`). The catch→invalid path IS covered (malformed token → 401). OSE-1278.
    return { valid: false };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  // Stryker disable next-line EqualityOperator: equivalent mutant — `<`→`<=` reads charCodeAt(a.length) on both (equal-length path only), NaN^NaN===0, leaving diff unchanged. The per-byte XOR IS covered (wrong-same-length + strict-prefix keys → 401). OSE-1278.
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractBearer(header: string | null): string | null {
  // Stryker disable next-line Regex: equivalent mutant — dropping the `$` end-anchor changes nothing: `(.+)` is greedy and an HTTP header value is single-line, so it already consumes to the end. The `^` start-anchor and `\s+` ARE covered (prefix-junk + multi-space tests). OSE-1278.
  const m = header?.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function getAdminKey(env: AdminEnv): string | null {
  return (env.ADMIN_KEY?.trim() || env.ADMIN_TOKEN?.trim()) ?? null;
}

interface CfAccessPayload {
  valid: boolean;
  email?: string;
}

function extractCfAccessPayload(jwt: string): CfAccessPayload {
  // NOTE (OSE-1278): every early-return below yields `{ valid: false }` with NO
  // `email`, and the ONLY consumer gate is `valid && email` (requireAdmin L265 /
  // extractAdminActor L177). So the `{valid:false}`→`{valid:true}` and
  // `{valid:false}`→`{}` mutants on those guards are EQUIVALENT: an emailless
  // payload fails `valid && email` and falls through regardless. The guards'
  // real jobs (3 segments, exp+iat present, not expired) ARE covered on the
  // signature path via verifyCfAccessJWT direct tests, and on this local-trust
  // path via the 401 assertions in auth-guard-mutation.spec.ts.
  try {
    const parts = jwt.split('.');
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). OSE-1278.
    if (parts.length !== 3) return { valid: false };
    // Stryker disable next-line StringLiteral,ArithmeticOperator: equivalent — atob() forgiving-base64 ignores padding (see verifyCfAccessJWT pad note). OSE-1278.
    const padding = '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + padding)) as {
      exp?: number;
      iat?: number;
      email?: string;
    };
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The exp+iat requirement IS covered (missing-exp / missing-iat → 401). OSE-1278.
    if (!payload.exp || !payload.iat) return { valid: false };
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The `<=` boundary IS covered (exp==now → 401 under fake time). OSE-1278.
    if (payload.exp <= Math.floor(Date.now() / 1000)) return { valid: false };
    return { valid: true, email: payload.email };
  } catch {
    // Stryker disable next-line ObjectLiteral,BooleanLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The catch IS exercised (malformed base64 → 401). OSE-1278.
    return { valid: false };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract the audit actor identifier from the request without enforcing auth.
 * Call AFTER requireAdmin passes; used to populate audit log entries.
 *
 * Returns:
 *   - CF Access email string  (Method 1)
 *   - 'key:ocr-internal'      (Method 2)
 *   - 'key:admin'             (Method 3)
 *   - null                    (unauthenticated / unknown)
 */
export function extractAdminActor(request: Request, env: AdminEnv): string | null {
  // Resolved once per (request, env), OSE-1801. The JWT's `exp` is checked
  // against the clock, and on Workers the clock moves after I/O: a token that was
  // valid when requireAdmin ran could read as expired (null actor) when a handler
  // re-read the actor after the body or a D1 await. The first answer stands for
  // the whole request.
  let perEnv = ACTOR_MEMO.get(request);
  if (perEnv === undefined) {
    perEnv = new WeakMap();
    ACTOR_MEMO.set(request, perEnv);
  }
  const memoKey = env as object;
  if (perEnv.has(memoKey)) return perEnv.get(memoKey) ?? null;
  const actor = resolveAdminActor(request, env);
  perEnv.set(memoKey, actor);
  return actor;
}

const ACTOR_MEMO = new WeakMap<Request, WeakMap<object, string | null>>();

/**
 * True only when the DEV_OPEN_ADMIN local-dev bypass is really on: opted in, and
 * neither production nor staging. A null admin actor allows nothing unless this
 * holds (OSE-1801); callers re-test the condition, never the null.
 */
export function isDevOpenAdmin(env: AdminEnv): boolean {
  return (
    env.DEV_OPEN_ADMIN === 'true' && env.WORKER_ENV !== 'production' && env.WORKER_ENV !== 'staging'
  );
}

function resolveAdminActor(request: Request, env: AdminEnv): string | null {
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  // Stryker disable next-line ConditionalExpression: equivalent mutant — forcing this guard true with no header makes `extractCfAccessPayload(null)` throw→caught→`{valid:false}`, then `valid && email` fails and control falls to the same key checks below. Actor extraction from a real JWT IS covered. OSE-1278.
  if (cfJwt) {
    const { valid, email } = extractCfAccessPayload(cfJwt);
    if (valid && email) return email;
  }
  if (env.ALLOW_OCR_INTERNAL === 'true') {
    const ocrSecret = env.X_OCR_INTERNAL?.trim() ?? null;
    const ocrHeader = request.headers.get('X-OCR-Internal');
    if (ocrSecret && ocrHeader && constantTimeEqual(ocrHeader, ocrSecret))
      return 'key:ocr-internal';
  }
  if (env.ALLOW_ADMIN_KEY_FALLBACK === 'true') {
    const key = getAdminKey(env);
    const token = extractBearer(request.headers.get('Authorization'));
    if (key && token && constantTimeEqual(token, key)) return 'key:admin';
  }
  return null;
}

export async function requireAdmin(
  request: Request,
  env: AdminEnv,
  requestId: string
): Promise<Response | null> {
  // ── LOCAL DEV ONLY — open-admin bypass (local demo walkthrough, OSE-681) ─────
  // Lets the admin UI load in a browser on `wrangler dev`, where Cloudflare
  // Access (the real login) does not exist. Guarded THREE ways so it can never
  // open a deployed environment:
  //   1. Requires explicit opt-in: DEV_OPEN_ADMIN === 'true' (set only in the
  //      gitignored .dev.vars — never in wrangler.toml [vars] or secrets).
  //   2. Refused when WORKER_ENV is 'production' or 'staging'.
  //   3. Emits a loud warning so an accidental enable is always visible.
  // Pin the request's actor now, at the moment auth is decided, so a handler that
  // reads it after the body or a D1 await gets this answer (OSE-1801). Only an
  // Access JWT's actor depends on the clock; key actors are left to the first
  // reader so a key compare runs once (AUTH-002 counts its reads).
  if (request.headers.has('Cf-Access-Jwt-Assertion')) extractAdminActor(request, env);
  if (isDevOpenAdmin(env)) {
    console.warn(
      JSON.stringify({
        event: 'DEV_OPEN_ADMIN_BYPASS',
        warning:
          'admin auth bypassed for LOCAL DEV — must never be enabled in a deployed environment',
        worker_env: env.WORKER_ENV ?? null,
        request_id: requestId,
      })
    );
    return null;
  }

  // Method 1: Cloudflare Access JWT + RSA signature verification (OSE-590 / OSE-211)
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (cfJwt) {
    const isDeployedEnv = env.WORKER_ENV === 'staging' || env.WORKER_ENV === 'production';
    // When CF_ACCESS_TEAM_DOMAIN is configured, the JWT signature MUST be
    // cryptographically verified against the JWKS before trusting any claims.
    // Skipping this check allows a forged JWT with any email to bypass auth.
    let cfTrustable = true;
    if (env.CF_ACCESS_TEAM_DOMAIN) {
      const verification = await verifyCfAccessJWT(cfJwt, env.CF_ACCESS_TEAM_DOMAIN, {
        expectedAud: env.CF_ACCESS_AUD?.trim() || undefined,
        // Reuses the router pre-flight's signature verdict for this request;
        // exp/iss/aud are still re-checked here.
        request,
      });
      if (!verification.valid) {
        return new Response(JSON.stringify({ ok: false, status: 401, code: 'UNAUTH', requestId }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="OurSharedEvents Admin"',
            'X-Request-Id': requestId,
          },
        });
      }
    } else if (isDeployedEnv) {
      // FAIL CLOSED (OSE-1186 G4): a deployed env with no CF_ACCESS_TEAM_DOMAIN
      // cannot verify the signature, so trusting the payload would accept a
      // forged JWT bearing any allowlisted email. Log the misconfiguration and
      // do NOT trust the JWT path — fall through to the secret-bearing Methods
      // 2/3 (→ final 401 if none authenticate). Local dev (no WORKER_ENV) keeps
      // the unverified-extract convenience below.
      console.log(
        JSON.stringify({
          level: 'error',
          event: 'ADMIN_AUTH_MISCONFIG',
          message:
            'CF Access JWT present but CF_ACCESS_TEAM_DOMAIN unset in a deployed env — JWT not trusted (fail-closed)',
          worker_env: env.WORKER_ENV ?? null,
          request_id: requestId,
        })
      );
      cfTrustable = false;
    }

    if (cfTrustable) {
      const { valid, email } = extractCfAccessPayload(cfJwt);
      if (valid && email) {
        // A CF Access JWT carrying a HUMAN email must pass the admin allowlist.
        const allowlistDeny = assertAdminEmailAllowed(email, env, requestId);
        // Stryker disable next-line ConditionalExpression: equivalent mutant — when the email is allowlisted `allowlistDeny` is null, so `if(true) return allowlistDeny` returns the same null the next line returns; when denied it returns the same 403. Both allow and deny outcomes ARE covered. OSE-1278.
        if (allowlistDeny) return allowlistDeny;
        return null;
      }
    }
    // OSE-889: a VALID CF Access JWT with NO email is a **service token**
    // (non-human identity — CF Access injects these when a service token
    // authenticates at the edge). The email allowlist does not apply to it, so we
    // must NOT 403 here: doing so short-circuited before Methods 2/3 and made it
    // impossible for CI to authenticate once CF Access was enforced on the admin
    // path (the recurring OSE-349/OSE-889 failure). Fall through to Method 2
    // (X-OCR-Internal) / Method 3 (ADMIN_KEY) — each of which requires its own
    // secret, so this fall-through never grants access on the JWT alone.
    // (An invalid JWT also falls through and is rejected by the final 401.)
  }

  // Method 2: X-OCR-Internal header (CI/CD automation)
  if (env.ALLOW_OCR_INTERNAL === 'true') {
    const ocrSecret = env.X_OCR_INTERNAL?.trim() ?? null;
    const ocrHeader = request.headers.get('X-OCR-Internal');
    if (ocrSecret && ocrHeader && constantTimeEqual(ocrHeader, ocrSecret)) return null;
  }

  // Method 3: Bearer token fallback
  if (env.ALLOW_ADMIN_KEY_FALLBACK === 'true') {
    const key = getAdminKey(env);
    const token = extractBearer(request.headers.get('Authorization'));
    if (key && token && constantTimeEqual(token, key)) return null;
  }

  return new Response(JSON.stringify({ ok: false, status: 401, code: 'UNAUTH', requestId }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents Admin"',
      'X-Request-Id': requestId,
    },
  });
}
