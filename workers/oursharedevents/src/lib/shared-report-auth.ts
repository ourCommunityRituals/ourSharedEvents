/**
 * OSE-272 Session 5 — SharedReport read API auth helpers
 *
 * Two auth mechanisms per Session 5 design (S5-Q1 ratified):
 *
 *   1. Signed-link bearer token — for product consumers (bars, sponsors).
 *      HMAC-SHA256 over JSON payload `{event_id, role, exp}` using a
 *      worker-side secret (SHARED_REPORT_SIGNING_SECRET). Tokens are
 *      short-lived (default 7 days) and bound to a single event.
 *
 *   2. Service-account bearer token — for in-fleet consumers (WKRP).
 *      Constant-time compare against a Doppler secret WKRP_SERVICE_TOKEN.
 *      Validated via the existing `Authorization: Bearer <token>` header.
 *
 * Both verifiers are pure (no D1, no fetch). Token minting is also pure
 * — it just signs a payload. The actual mint endpoint (for bars to issue
 * report links to themselves) is out-of-scope for Session 5; this module
 * provides the primitives.
 *
 * Architectural commitment: this file is consumed only by the
 * SharedReport read handlers. No router import (sanity — same pattern
 * as shared-report.ts).
 */

export interface SharedReportAuthEnv {
  /**
   * HMAC-SHA256 signing secret for signed-link tokens.
   * Workers secret; rotate independently from ANON_ID_HASH_PEPPER.
   * If unset, every signed-link verification returns null (fail-safe).
   */
  SHARED_REPORT_SIGNING_SECRET?: string;
  /**
   * WKRP service-account bearer token for the batch endpoint.
   * If unset, the batch endpoint rejects all callers.
   *
   * OSE-577: WKRP is the NON-ANONYMOUS cross-product platform (invariant #14
   * `explicit_identity`, the deliberate "#1-mirror"). Holding a name-bearing
   * roster on one side and full-depth corridor/venue/time aggregates on the
   * other is an unevaluated JOIN risk, and every control that would catch it
   * (OCR-61/OCR-62 identity invariant + spec, OW-112 boundary firewall) is
   * still Backlog. This is where the choice network gets enforced: consent is
   * not auto-extended to the named-identity side. So this token is classified
   * `cross_product` and FAILS CLOSED on the batch endpoint until those
   * controls land (ADR-017).
   */
  WKRP_SERVICE_TOKEN?: string;
  /**
   * Internal-fleet batch consumer token (OSE-577). Distinct token CLASS from
   * WKRP: an internal, anonymity-respecting consumer that may receive the full
   * SharedReport. Split out so "service" is not one undifferentiated role —
   * keying depth on the endpoint (SR-25's mistake) let ANY service token,
   * including the cross-product one, receive every field. If unset, no caller
   * is granted internal-class access.
   */
  OSE_INTERNAL_BATCH_TOKEN?: string;
}

/**
 * Service-token classes for the batch endpoint (OSE-577).
 *   - 'internal'      → in-fleet, anonymity-respecting consumer; full payload.
 *   - 'cross_product' → WKRP (named-identity platform); fails closed until the
 *                       join-risk controls (OCR-61/62, OW-112) ship.
 */
export type ServiceTokenClass = 'internal' | 'cross_product';

export type SignedLinkRole = 'bar_owner' | 'sponsor' | 'admin';

export interface SignedLinkClaim {
  /** Event ID this token grants read access to. */
  eventId: string;
  /** Who's reading — determines what's visible in the response. */
  role: SignedLinkRole;
  /** Expiry — epoch seconds. */
  exp: number;
  /**
   * Report depth claim — optional, backward compatible.
   * Absent on legacy tokens; resolveDepth() handles missing gracefully.
   */
  depth?: string;
  /**
   * Sponsor ID scope claim — optional, backward compatible.
   * When present on a sponsor token, filterReportByDepth() restricts
   * sponsor_impressions to this sponsor only (cross-contamination guard).
   */
  sponsor_id?: string;
}

const TOKEN_PARTS_DELIMITER = '.';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ─── Internal helpers ──────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

// ─── Signed-link primitives ────────────────────────────────────────────────

const VALID_ROLES: readonly SignedLinkRole[] = ['bar_owner', 'sponsor', 'admin'];

function isValidRole(s: unknown): s is SignedLinkRole {
  return typeof s === 'string' && (VALID_ROLES as readonly string[]).includes(s);
}

/**
 * Mint a signed-link token for `(eventId, role)`.
 *
 * Output shape: `<base64url(payload)>.<hex(sig)>` — single string,
 * Authorization-header friendly.
 *
 * `depth` and `sponsor_id` are optional extensions (flywheel S-3.1.1).
 * Absent fields → legacy behavior: admin/bar_owner → premium, sponsor → local.
 *
 * Returns null if the signing secret is unset. Callers must handle that.
 */
export async function mintSignedLinkToken(
  env: SharedReportAuthEnv,
  eventId: string,
  role: SignedLinkRole,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  opts: { depth?: string; sponsor_id?: string } = {}
): Promise<string | null> {
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const payload: SignedLinkClaim = {
    eventId,
    role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
    ...(opts.sponsor_id !== undefined ? { sponsor_id: opts.sponsor_id } : {}),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payloadStr));
  const sig = await hmacSha256Hex(payloadB64, secret);
  return `${payloadB64}${TOKEN_PARTS_DELIMITER}${sig}`;
}

/**
 * Verify a signed-link token. Returns the parsed claim on success, null
 * on any failure (bad shape, bad sig, expired, missing secret, bad role).
 *
 * Pure — no side effects. Constant-time compare on the signature.
 */
export async function verifySignedLinkToken(
  env: SharedReportAuthEnv,
  token: string | null | undefined
): Promise<SignedLinkClaim | null> {
  if (!token) return null;
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;

  const parts = token.split(TOKEN_PARTS_DELIMITER);
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmacSha256Hex(payloadB64, secret);
  if (!constantTimeEqual(expectedSig, sig)) return null;

  let payload: unknown;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const claim = payload as Record<string, unknown>;
  if (typeof claim.eventId !== 'string' || claim.eventId.length === 0) return null;
  if (!isValidRole(claim.role)) return null;
  if (typeof claim.exp !== 'number' || !Number.isFinite(claim.exp)) return null;
  if (claim.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    eventId: claim.eventId,
    role: claim.role,
    exp: claim.exp,
    ...(typeof claim.depth === 'string' ? { depth: claim.depth } : {}),
    ...(typeof claim.sponsor_id === 'string' ? { sponsor_id: claim.sponsor_id } : {}),
  };
}

// ─── Service-token primitive (WKRP batch endpoint) ─────────────────────────

/**
 * Verify a service-account bearer token. Returns true iff the token
 * matches `env.WKRP_SERVICE_TOKEN` (constant-time compare). Returns
 * false on missing env, missing token, or mismatch.
 *
 * In v1, only WKRP holds a service token. Future fleet consumers will
 * be added as distinct env vars + token types.
 */
export function verifyServiceToken(
  env: SharedReportAuthEnv,
  token: string | null | undefined
): boolean {
  if (!token) return false;
  const expected = env.WKRP_SERVICE_TOKEN?.trim();
  if (!expected) return false;
  return constantTimeEqual(token, expected);
}

/**
 * Classify a service-account bearer token into its CLASS (OSE-577).
 *
 * The batch endpoint no longer keys full-payload access on "is this the batch
 * endpoint" (SR-25's defect — that handed EVERY service token, including the
 * cross-product one, all fields). It keys on WHO holds the token:
 *
 *   - matches `OSE_INTERNAL_BATCH_TOKEN` → 'internal'      (full payload)
 *   - matches `WKRP_SERVICE_TOKEN`       → 'cross_product' (fail closed)
 *   - anything else / no env / no token  → null            (401 unauthorized)
 *
 * Internal is checked FIRST so that if the two secrets were ever mis-set to the
 * same value, the safer classification does not silently grant cross-product
 * full depth via the internal branch — but they must never share a value in
 * practice (distinct Doppler secrets). Both compares are constant-time.
 *
 * Pure — no D1, no fetch. The grant/deny decision lives in the handler.
 */
export function classifyServiceToken(
  env: SharedReportAuthEnv,
  token: string | null | undefined
): ServiceTokenClass | null {
  if (!token) return null;
  const internal = env.OSE_INTERNAL_BATCH_TOKEN?.trim();
  if (internal && constantTimeEqual(token, internal)) return 'internal';
  const wkrp = env.WKRP_SERVICE_TOKEN?.trim();
  if (wkrp && constantTimeEqual(token, wkrp)) return 'cross_product';
  return null;
}

/**
 * Helper: extract the `Bearer <token>` value from an Authorization header.
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
