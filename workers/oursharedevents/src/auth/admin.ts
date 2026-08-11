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
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  return Promise.all(
    keys.map((k) =>
      crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
        'verify',
      ])
    )
  );
}

async function _getJwks(teamDomain: string): Promise<CryptoKey[]> {
  if (_jwksCache && Date.now() - _jwksCache.fetchedAt < JWKS_TTL_MS) return _jwksCache.keys;
  const keys = await _fetchJwks(teamDomain);
  _jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Cryptographically verify a CF Access JWT against the team's public JWKS.
 * Returns the decoded payload on success, null on any failure (invalid sig,
 * expired, malformed). Call this ONCE per request before requireAdmin —
 * requireAdmin continues to decode the payload for the allowlist check.
 */
export async function verifyCfAccessJWT(
  jwt: string,
  teamDomain: string
): Promise<{ valid: true; email?: string } | { valid: false }> {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { valid: false };

    const pad = (s: string) => s + '='.repeat((4 - (s.length % 4)) % 4);
    const decodeB64 = (s: string) => atob(pad(s.replace(/-/g, '+').replace(/_/g, '/')));

    const payload = JSON.parse(decodeB64(parts[1])) as {
      exp?: number;
      iat?: number;
      email?: string;
    };
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return { valid: false };

    const sigInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Uint8Array.from(decodeB64(parts[2]), (c) => c.charCodeAt(0));

    const keys = await _getJwks(teamDomain);
    const results = await Promise.all(
      keys.map((k) =>
        crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, sig, sigInput).catch(() => false)
      )
    );
    if (!results.some(Boolean)) return { valid: false };

    return { valid: true, email: payload.email };
  } catch {
    return { valid: false };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractBearer(header: string | null): string | null {
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
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return { valid: false };
    const padding = '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + padding)) as {
      exp?: number;
      iat?: number;
      email?: string;
    };
    if (!payload.exp || !payload.iat) return { valid: false };
    if (payload.exp <= Math.floor(Date.now() / 1000)) return { valid: false };
    return { valid: true, email: payload.email };
  } catch {
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
  const cfJwt = request.headers.get('Cf-Access-Jwt-Assertion');
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
  if (
    env.DEV_OPEN_ADMIN === 'true' &&
    env.WORKER_ENV !== 'production' &&
    env.WORKER_ENV !== 'staging'
  ) {
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
    // When CF_ACCESS_TEAM_DOMAIN is configured, the JWT signature MUST be
    // cryptographically verified against the JWKS before trusting any claims.
    // Skipping this check allows a forged JWT with any email to bypass auth.
    if (env.CF_ACCESS_TEAM_DOMAIN) {
      const verification = await verifyCfAccessJWT(cfJwt, env.CF_ACCESS_TEAM_DOMAIN);
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
    }

    const { valid, email } = extractCfAccessPayload(cfJwt);
    if (valid) {
      // If a CF Access JWT is present, the email claim must pass the allowlist.
      // No email claim in the JWT → treated as unauthorised (fail-safe).
      if (!email) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: 403,
            code: 'ADMIN_NOT_ALLOWED',
            error: 'CF Access JWT contains no email claim.',
            requestId,
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
          }
        );
      }
      const allowlistDeny = assertAdminEmailAllowed(email, env, requestId);
      if (allowlistDeny) return allowlistDeny;
      return null;
    }
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
