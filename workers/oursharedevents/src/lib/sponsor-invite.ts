/**
 * Sponsor onboarding invite-token primitives (OSE-732 / T6a).
 *
 * A sponsor onboarding link carries a signed invite token. The token is the
 * SOLE authority for the tenant scope of a draft capture: `brand_id` (and
 * optional `event_id` / `campaign_id`) are read from the SIGNED claim, NEVER
 * from the request body (#9 tenant isolation). This mirrors the HMAC-SHA256
 * signed-link pattern already used by shared-report-auth.ts (OSE-272 S5) — same
 * base64url(payload).hex(sig) shape, constant-time compare, fail-safe on a
 * missing secret.
 *
 * Verify-only is what T6a needs (draft capture). Minting is exercised by tests
 * and will back a future admin "issue invite" endpoint (out of scope here); the
 * mint helper lives here so both sides share one implementation.
 *
 * Pure — no D1, no fetch.
 */

export interface SponsorInviteEnv {
  /**
   * HMAC-SHA256 signing secret for sponsor invite tokens. Workers secret.
   * If unset, EVERY verification returns null (fail-safe — no invite is valid
   * without a configured secret, so draft capture is closed by default).
   */
  SPONSOR_INVITE_SIGNING_SECRET?: string;
}

export interface SponsorInviteClaim {
  /** Brand this invite scopes to — the ONLY source of a draft's brand_id (#9). */
  brand_id: string;
  /** Optional event scope. */
  event_id?: string;
  /** Optional campaign scope. */
  campaign_id?: string;
  /** Expiry — epoch seconds. */
  exp: number;
}

const DELIM = '.';
const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

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
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
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

/**
 * Mint a sponsor invite token for `brand_id` (+ optional event/campaign scope).
 * Output: `<base64url(payload)>.<hex(sig)>`. Returns null if the secret is unset.
 */
export async function mintSponsorInviteToken(
  env: SponsorInviteEnv,
  claim: Omit<SponsorInviteClaim, 'exp'> & { exp?: number },
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<string | null> {
  const secret = env.SPONSOR_INVITE_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const payload: SponsorInviteClaim = {
    brand_id: claim.brand_id,
    ...(claim.event_id !== undefined ? { event_id: claim.event_id } : {}),
    ...(claim.campaign_id !== undefined ? { campaign_id: claim.campaign_id } : {}),
    exp: claim.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256Hex(payloadB64, secret);
  return `${payloadB64}${DELIM}${sig}`;
}

/**
 * Verify a sponsor invite token. Returns the claim on success, null on ANY
 * failure (bad shape, bad sig, expired, missing/empty brand_id, missing secret).
 * Constant-time signature compare. Pure.
 */
export async function verifySponsorInviteToken(
  env: SponsorInviteEnv,
  token: string | null | undefined
): Promise<SponsorInviteClaim | null> {
  if (!token) return null;
  const secret = env.SPONSOR_INVITE_SIGNING_SECRET?.trim();
  if (!secret) return null;

  const parts = token.split(DELIM);
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmacSha256Hex(payloadB64, secret);
  if (!constantTimeEqual(expectedSig, sig)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const claim = payload as Record<string, unknown>;
  if (typeof claim.brand_id !== 'string' || claim.brand_id.length === 0) return null;
  if (typeof claim.exp !== 'number' || !Number.isFinite(claim.exp)) return null;
  if (claim.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    brand_id: claim.brand_id,
    ...(typeof claim.event_id === 'string' ? { event_id: claim.event_id } : {}),
    ...(typeof claim.campaign_id === 'string' ? { campaign_id: claim.campaign_id } : {}),
    exp: claim.exp,
  };
}
