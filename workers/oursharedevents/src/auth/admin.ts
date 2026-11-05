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
  WORKER_ENV?: string; // 'production' | 'staging' deployed; unset | 'development' | 'test' local
  /**
   * LOCAL DEV ONLY. When 'true' AND WORKER_ENV is a local name (unset, development, test),
   * opens the admin UI without auth so the dashboard is viewable on
   * `wrangler dev` (where Cloudflare Access — the real login — doesn't exist).
   * Set ONLY in the gitignored .dev.vars. Never in wrangler.toml [vars]/secrets.
   */
  DEV_OPEN_ADMIN?: string;
  /**
   * OSE-1800 — STAGING ONLY. Comma-separated Access service-token common names
   * (Client IDs) accepted as `svc:<common_name>` actors: a CI identity that is a
   * brand admin of CI_SERVICE_ACTOR_BRAND, never a platform admin. Inert unless
   * WORKER_ENV is staging and CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set.
   * Never in [env.production.vars] (tests/prod-admin-scope-config.spec.ts).
   */
  CI_SERVICE_ACTORS?: string;
}

/**
 * OSE-1800 — automation actors carry no person's identity: the `key:` actors
 * (X-OCR-Internal, the Bearer admin key) and the staging CI service actor
 * (`svc:`). Used where "a signed-in person" and "automation" are treated
 * differently (write guard, "only mine", the audit Logs source). Key-only
 * routes (requireKeyActor) still check `key:` alone: a `svc:` actor is not a key.
 */
export function isAutomationActor(actor: string | null): boolean {
  return actor !== null && (actor.startsWith('key:') || actor.startsWith('svc:'));
}

/**
 * OSE-1800 — the staging CI service actor's name, or null. A Cloudflare Access
 * service token's JWT carries a `common_name` (its Client ID) and no `email`.
 * It is an actor ONLY when every condition holds:
 *   1. WORKER_ENV is staging;
 *   2. the team domain is set (so requireAdmin verified the signature) and the
 *      token was issued by that team;
 *   3. the Access audience is pinned and the token carries it (the team signs
 *      tokens for every app in the tenant);
 *   4. the common name is listed in CI_SERVICE_ACTORS.
 * The payload here is decoded, not verified: requireAdmin verifies the
 * signature, and this predicate demands the settings under which it did.
 */
function serviceActorName(
  payload: { email?: string; common_name?: unknown; aud?: unknown; iss?: unknown },
  env: AdminEnv
): string | null {
  // Rule 0: requireAdmin relies on this line alone to keep an email token off the
  // svc path (killed by "a token with an email AND a listed common_name …").
  if (payload.email) return null;
  const cn = payload.common_name;
  // Stryker disable next-line ConditionalExpression: equivalent mutant — a non-string or empty common_name can never be in `listed` (strings, empties filtered out), so dropping this check reaches the same `return null` below.
  if (typeof cn !== 'string' || cn.length === 0) return null;
  if (env.WORKER_ENV !== 'staging') return null;
  // Stryker disable next-line OptionalChaining: equivalent since OSE-1801 — serviceActorName is reached only where the JWT is trustable, and on staging that requires CF_ACCESS_TEAM_DOMAIN to be set (jwtIdentityTrustable; requireAdmin's cfTrustable), so it is never undefined here.
  const domain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.CF_ACCESS_AUD?.trim();
  if (!domain || !aud) return null;
  if (payload.iss !== `https://${domain}`) return null;
  // Stryker disable next-line ArrayDeclaration: equivalent — the fallback array only has to not contain the pinned audience; ["Stryker was here"] differs only for an audience configured as that literal. The no-aud case IS covered ("a token with no aud claim is no actor").
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!auds.includes(aud)) return null;
  if (!env.CI_SERVICE_ACTORS) return null;
  // Stryker disable next-line MethodExpression: equivalent — dropping .filter(Boolean) leaves '' entries, and a common name is never '' (checked above), so includes() answers the same.
  const listed = env.CI_SERVICE_ACTORS.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!listed.includes(cn)) return null;
  return `svc:${cn}`;
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
/** Why an Access JWT was refused (logged; never the token or its claims). */
export type JwtRefusal =
  'malformed' | 'expired' | 'not_yet_valid' | 'email_shape' | 'signature' | 'issuer' | 'audience';

export async function verifyCfAccessJWT(
  jwt: string,
  teamDomain: string,
  opts?: { expectedAud?: string; request?: Request }
): Promise<{ valid: true; email?: string } | { valid: false; reason: JwtRefusal }> {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'malformed' };

    const payload = JSON.parse(_decodeB64(parts[1])) as {
      exp?: number;
      iat?: unknown;
      nbf?: unknown;
      email?: unknown;
      aud?: string | string[];
      iss?: string;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= nowSec) return { valid: false, reason: 'expired' };
    // OSE-1801: a token that is not valid yet, or an email that is not a plain
    // address (e.g. "key:x@...", which would read as an automation actor), is no
    // identity at all. An empty or null email is no email (a service token).
    if (notYetValid(payload, nowSec)) return { valid: false, reason: 'not_yet_valid' };
    const email = normaliseEmailClaim(payload.email);
    if (email !== undefined && !isPlainAdminEmail(email))
      return { valid: false, reason: 'email_shape' };

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
      return { valid: false, reason: 'signature' };
    }

    // OSE-1377: audience + issuer pin. The team JWKS signs tokens for EVERY Access
    // app in the tenant, so a valid signature proves only "some app in this team",
    // not "the OSE admin app". When CF_ACCESS_AUD is configured, require the
    // signature-verified payload's `iss` to be this team AND its `aud` (string or
    // array) to include the expected tag. DARK when expectedAud is unset.
    if (opts?.expectedAud) {
      if (payload.iss !== `https://${teamDomain}`) return { valid: false, reason: 'issuer' };
      // Stryker disable next-line ArrayDeclaration: equivalent — as in serviceActorName, the fallback only has to not contain the expected audience. A token with no aud IS refused when the audience is pinned (auth-jwks-verify / ci-service-actor specs).
      const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
      if (!auds.includes(opts.expectedAud)) return { valid: false, reason: 'audience' };
    }

    return { valid: true, email };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * OSE-1801: an admin email from Cloudflare Access must be a plain address. The
 * actor's class is read from its prefix (`key:`, `svc:` are automation), so an
 * email such as "key:x@oursharedevents.com" must never become an actor: a colon,
 * a space or any other character outside this set refuses the identity.
 */
const PLAIN_EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
export function isPlainAdminEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && PLAIN_EMAIL.test(email);
}

/** Leeway for clock skew between Cloudflare Access and this Worker. */
const CLOCK_SKEW_SEC = 60;

/**
 * OSE-1801: a token whose `nbf` or `iat` is ahead of now (beyond skew) is not
 * valid yet, and so is one whose `nbf` or `iat` is present but not a number.
 */
function notYetValid(payload: { iat?: unknown; nbf?: unknown }, nowSec: number): boolean {
  for (const claim of [payload.nbf, payload.iat]) {
    if (claim === undefined) continue;
    if (typeof claim !== 'number' || claim > nowSec + CLOCK_SKEW_SEC) return true;
  }
  return false;
}

/** An empty or null email claim is no email (a service token carries none). */
function normaliseEmailClaim(email: unknown): unknown {
  return email === '' || email === null ? undefined : email;
}

/**
 * The only WORKER_ENV values that are local: unset, local dev, the test pool.
 * Everything else, including a typo ("Production", "staging ") or a new name
 * ("preview"), is treated as deployed (OSE-1801, CCR 2026-11-04 R1-02). One list
 * for both decisions that hang on it: whether an unverified Access JWT may name
 * the actor, and whether the DEV_OPEN_ADMIN bypass may open.
 */
const LOCAL_WORKER_ENVS: ReadonlySet<string | undefined> = new Set([
  undefined,
  'development',
  'test',
]);

function isLocalWorkerEnv(env: AdminEnv): boolean {
  return LOCAL_WORKER_ENVS.has(env.WORKER_ENV);
}

/**
 * OSE-1801: may the Access JWT name the actor? Only where requireAdmin trusts it:
 * the team domain is set (so the signature is verified), or WORKER_ENV is one of
 * the local names above. Anywhere else the actor is a key, never an email decoded
 * from an unverified token.
 */
function jwtIdentityTrustable(env: AdminEnv): boolean {
  return Boolean(env.CF_ACCESS_TEAM_DOMAIN) || isLocalWorkerEnv(env);
}

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
  /** OSE-1800: a service token's Client ID; with aud/iss, read by serviceActorName. */
  common_name?: unknown;
  aud?: unknown;
  iss?: unknown;
}

function extractCfAccessPayload(jwt: string): CfAccessPayload {
  // NOTE (OSE-1278): every early-return below yields `{ valid: false }` with NO
  // `email` and no `common_name`, and the consumers read an identity only through
  // `valid && email` or serviceActorName (which needs a common_name), in
  // resolveAdminActor and requireAdmin. So the `{valid:false}`→`{valid:true}` and
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
      nbf?: unknown;
      email?: unknown;
      common_name?: unknown;
      aud?: unknown;
      iss?: unknown;
    };
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The exp+iat requirement IS covered (missing-exp / missing-iat → 401). OSE-1278.
    if (!payload.exp || !payload.iat) return { valid: false };
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The `<=` boundary IS covered (exp==now → 401 under fake time). OSE-1278.
    if (payload.exp <= Math.floor(Date.now() / 1000)) return { valid: false };
    // OSE-1801: not valid yet, or an email that is not a plain address: no identity.
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE), and a svc payload without common_name is no actor either. The rule itself IS covered (nbf/iat cases in admin-actor-memo.spec.ts and auth-jwks-verify.spec.ts).
    if (notYetValid(payload, Math.floor(Date.now() / 1000))) return { valid: false };
    const email = normaliseEmailClaim(payload.email);
    // Stryker disable next-line BooleanLiteral,ObjectLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The rule itself IS covered (plain-address cases in admin-actor-memo.spec.ts, the router key: email test).
    if (email !== undefined && !isPlainAdminEmail(email)) return { valid: false };
    return {
      valid: true,
      email: email as string | undefined,
      common_name: payload.common_name,
      aud: payload.aud,
      iss: payload.iss,
    };
  } catch {
    // Stryker disable next-line ObjectLiteral,BooleanLiteral: equivalent — emailless return, masked by `valid && email` (see NOTE). The catch IS exercised (malformed base64 → 401). OSE-1278.
    return { valid: false };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * The request's admin actor, without enforcing auth. It drives brand scope and
 * audit attribution. route() reads it at entry (router.ts `_actor`) and the answer
 * is kept for the whole request (OSE-1801), so every later reader, requireAdmin
 * and the handlers included, sees the same actor.
 *
 * Returns:
 *   - CF Access email string      (Method 1; only where the JWT is trustable)
 *   - 'svc:<common_name>'         (staging CI service token, OSE-1800)
 *   - 'key:ocr-internal'          (Method 2)
 *   - 'key:admin'                 (Method 3)
 *   - null                        (unauthenticated / unknown)
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
 * OSE-1801: a handler that builds a new Request for another handler (event repeat
 * to create) hands the actor on with it, so the inner request does not decode the
 * token again after I/O. Copies the caller's resolved actor; never widens it.
 */
export function inheritAdminActor(from: Request, to: Request, env: AdminEnv): void {
  const actor = extractAdminActor(from, env);
  let perEnv = ACTOR_MEMO.get(to);
  if (perEnv === undefined) {
    perEnv = new WeakMap();
    ACTOR_MEMO.set(to, perEnv);
  }
  perEnv.set(env as object, actor);
}

/**
 * OSE-1801: one structured line when a handler refuses a null actor. After the
 * memo this should never fire on a deployed worker, so it is a cheap alarm. The
 * response the caller gets is unchanged (no existence oracle).
 */
export function logNullAdminActorDenied(site: string, env: AdminEnv, requestId?: string): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'ADMIN_NULL_ACTOR_DENIED',
      site,
      worker_env: env.WORKER_ENV ?? null,
      request_id: requestId ?? null,
    })
  );
}

/**
 * OSE-1801: one structured line per refused Access JWT, with the reason code. The
 * token, its email and its claims are never logged.
 */
export function logJwtRefused(
  reason: JwtRefusal | 'actor_mismatch' | 'no_actor' | 'not_allowlisted',
  where: 'preflight' | 'requireAdmin',
  env: AdminEnv,
  requestId?: string
): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'ADMIN_JWT_REFUSED',
      reason,
      where,
      worker_env: env.WORKER_ENV ?? null,
      request_id: requestId ?? null,
    })
  );
}

/**
 * True only when the DEV_OPEN_ADMIN local-dev bypass is really on: opted in, and
 * WORKER_ENV is one of the local names (LOCAL_WORKER_ENVS). "Production",
 * "preview" or "staging " with a space are not local. A null admin actor allows
 * nothing unless this holds; callers re-test the condition, never the null.
 * Note: a deploy without --env carries the top-level WORKER_ENV="development", so
 * this rests on DEV_OPEN_ADMIN never being set on a deployed worker; the
 * deploy-config gate (tests/prod-admin-scope-config.spec.ts) keeps it out of
 * wrangler.toml.
 */
export function isDevOpenAdmin(env: AdminEnv): boolean {
  return env.DEV_OPEN_ADMIN === 'true' && isLocalWorkerEnv(env);
}

function resolveAdminActor(request: Request, env: AdminEnv): string | null {
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
  // Stryker disable next-line ConditionalExpression: equivalent mutant — forcing this guard true with no header makes `extractCfAccessPayload(null)` throw→caught→`{valid:false}`, then `valid && email` fails and control falls to the same key checks below. Actor extraction from a real JWT IS covered. OSE-1278.
  if (cfJwt && jwtIdentityTrustable(env)) {
    const payload = extractCfAccessPayload(cfJwt);
    if (payload.valid && payload.email) return payload.email;
    // OSE-1800: the staging CI service actor (see serviceActorName).
    // Stryker disable next-line ConditionalExpression: equivalent — an invalid decode returns only { valid: false }, with no common_name, so serviceActorName answers null either way. The expired-token case IS covered (ci-service-actor.spec.ts).
    if (payload.valid) {
      const svc = serviceActorName(payload, env);
      if (svc) return svc;
    }
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

/** 401 when the identity requireAdmin would allow is not the request's pinned actor. */
function refuseActorMismatch(env: AdminEnv, requestId: string): Response {
  logJwtRefused('actor_mismatch', 'requireAdmin', env, requestId);
  return new Response(JSON.stringify({ ok: false, status: 401, code: 'UNAUTH', requestId }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents Admin"',
      'X-Request-Id': requestId,
    },
  });
}

export async function requireAdmin(
  request: Request,
  env: AdminEnv,
  requestId: string
): Promise<Response | null> {
  // ── LOCAL DEV ONLY — open-admin bypass (local demo walkthrough, OSE-681) ─────
  // Lets the admin UI load in a browser on `wrangler dev`, where Cloudflare
  // Access (the real login) does not exist. Guarded three ways:
  //   1. Requires explicit opt-in: DEV_OPEN_ADMIN === 'true' (set only in the
  //      gitignored .dev.vars; a config test keeps it out of wrangler.toml).
  //   2. Opens only when WORKER_ENV is a local name (unset, development, test).
  //      A deploy without --env carries "development", so 1 is what keeps it shut.
  //   3. Emits a loud warning so an accidental enable is always visible.
  // OSE-1801: route() already resolved the actor at entry; this read keeps the
  // same guarantee for a caller that reaches requireAdmin without route() (a
  // direct call). Only an Access JWT's actor depends on the clock, so key actors
  // are left to the first reader and a key compare runs once (AUTH-002).
  // Stryker disable next-line ConditionalExpression,CallExpression: equivalent in requireAdmin's answer. ConditionalExpression: reading the actor for a key request too changes only the number of key compares, which tests/red-team/auth-boundary.spec.ts (AUTH-002, workers pool) counts. CallExpression: without this read the pinned read below runs after verifyCfAccessJWT's await, on the same clock as extractCfAccessPayload, so pin and identity still agree; verifyCfAccessJWT's own claim checks run before that await, on this read's clock. The read pins the memo early for a direct caller's later readers (CCR 2026-11-04 L2-S1).
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
  // A trusted Access token that named no actor here (an unlisted service token,
  // or one that expired during the signature check) falls through to the key
  // methods; if they fail too, the final 401 says why (CCR review, PR #1107).
  let jwtNamedNoActor = false;
  if (cfJwt) {
    const isLocalEnv = isLocalWorkerEnv(env);
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
        logJwtRefused(verification.reason, 'requireAdmin', env, requestId);
        return new Response(JSON.stringify({ ok: false, status: 401, code: 'UNAUTH', requestId }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="OurSharedEvents Admin"',
            'X-Request-Id': requestId,
          },
        });
      }
    } else if (!isLocalEnv) {
      // FAIL CLOSED (OSE-1186 G4; OSE-1801 widened it from the exact names
      // staging/production to every non-local WORKER_ENV): without
      // CF_ACCESS_TEAM_DOMAIN the signature cannot be verified, so trusting the
      // payload would accept a forged JWT bearing any allowlisted email. Log the
      // misconfiguration and do NOT trust the JWT path; fall through to the
      // secret-bearing Methods 2/3 (final 401 if none authenticate). Only a local
      // WORKER_ENV keeps the unverified-extract convenience below.
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
      const payload = extractCfAccessPayload(cfJwt);
      const { valid, email } = payload;
      // OSE-1801: the identity allowed here must be the actor the request was
      // pinned to at entry (route() reads it first; the read above covers a
      // direct caller). A token that was not valid yet at entry pinned a null
      // actor; becoming valid during the request must not let it in with no
      // actor (router order no longer carries this; CCR 2026-11-04 L2-S1).
      const pinned = extractAdminActor(request, env);
      // OSE-1800: a staging CI service token that is LISTED is an actor of its
      // own (svc:<common_name>, a brand admin, never platform). The predicate
      // requires the team domain, so the signature was verified above.
      // An email-bearing token is refused by serviceActorName's own rule 0 (killed by
      // "a token with an email AND a listed common_name is the email actor").
      // Stryker disable next-line ConditionalExpression: equivalent — an invalid decode returns only { valid: false }, with no common_name, so serviceActorName answers null either way (as in resolveAdminActor). The expired-token case IS covered (ci-service-actor.spec.ts).
      const svc = valid ? serviceActorName(payload, env) : null;
      if (svc) return pinned === svc ? null : refuseActorMismatch(env, requestId);
      if (valid && email) {
        // A CF Access JWT carrying a HUMAN email must pass the admin allowlist.
        const allowlistDeny = assertAdminEmailAllowed(email, env, requestId);
        // Not an equivalent mutant since OSE-1801: `if (true)` would return the
        // allowlist null before the pinned-actor check below (killed by the
        // not-valid-yet-at-entry test in admin-actor-memo.spec.ts).
        if (allowlistDeny) {
          // A signed token for an email off the allowlist is a refusal too
          // (PR #1107 review); the 403 itself is built by the allowlist.
          logJwtRefused('not_allowlisted', 'requireAdmin', env, requestId);
          return allowlistDeny;
        }
        return pinned === email ? null : refuseActorMismatch(env, requestId);
      }
      jwtNamedNoActor = true;
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

  if (jwtNamedNoActor) logJwtRefused('no_actor', 'requireAdmin', env, requestId);
  return new Response(JSON.stringify({ ok: false, status: 401, code: 'UNAUTH', requestId }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="OurSharedEvents Admin"',
      'X-Request-Id': requestId,
    },
  });
}
