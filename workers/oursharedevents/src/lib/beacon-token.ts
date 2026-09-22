/**
 * Sponsor beacon tokens — the authenticated half of OSE-1310.
 *
 * WHY. D3 (CCR 2026-09-14) closed the "fabricated pair" hole: an impression or
 * click can only be logged for an (event, sponsor) that resolves to a real,
 * brand-matched, active placement. The invalid-traffic filter (invalid-traffic.ts)
 * then closed the "replay/flood" hole: bot UA, duplicate beacons, and cadence
 * floods are refused before the insert. What remained open per the ticket:
 * `POST /impression` and `/click` are still, structurally, unauthenticated public
 * write endpoints — anyone who reads a public sponsor-bundle response can see a
 * valid (event, sponsor) pair and script a POST directly, without ever having
 * rendered anything. Nothing tied a write to an actual bundle render.
 *
 * WHAT THIS IS. A short-lived, HMAC-signed, per-(event, sponsor) bearer token,
 * minted into EVERY sponsor entry of a sponsor-bundle response and required on
 * the corresponding impression/click write. Same construction as the other
 * signed links in this file family (shared-report-auth.ts, sponsor-invite.ts,
 * sponsor-home-auth.ts): base64url(payload).hex(HMAC-SHA256), constant-time
 * compare, sharing SHARED_REPORT_SIGNING_SECRET with a distinct `kind` so a
 * report token or sponsor-home token can never be replayed here.
 *
 * TTL is intentionally short (a few minutes, not days): a render fetches the
 * bundle and fires its impression beacons in the same tick — see display.html /
 * public.html, where `logImpression` is called synchronously off the awaited
 * bundle response. A long-lived kiosk page that never reloads still only mints
 * ONE token per page load and spends it immediately, so a short TTL costs
 * nothing in the real flows and keeps a leaked token's usable window small.
 *
 * FAILS CLOSED, unlike invalid-traffic.ts. That module fails OPEN on KV outage
 * because it is a best-effort heuristic layered on top of an already-authorized
 * write; losing it during an outage would silently zero the proof layer, which
 * is worse than a brief over-count. This module is the authorization gate
 * itself — if the signing secret is unset or a token doesn't verify, the
 * beacon is not counted. There is no safe "fail open" for "prove you rendered
 * this," so an unset secret means every write comes back as the same honest
 * `202 { counted:false }` shape the IVT filter already uses, not a 5xx or a
 * silently-accepted forgery.
 *
 * Pure — no D1, no fetch.
 */

export interface BeaconTokenEnv {
  /**
   * Shared with the SharedReport signed link and the sponsor-home token.
   * If unset, EVERY beacon token fails to mint and fails to verify — impression
   * and click writes then always report the honest "not counted" shape.
   */
  SHARED_REPORT_SIGNING_SECRET?: string;
}

export interface BeaconClaim {
  kind: 'beacon';
  event_id: string;
  sponsor_id: string;
  exp: number;
}

const KIND = 'beacon';
const DELIM = '.';
/**
 * 10 minutes. Generous relative to the actual mint-to-spend gap (bundle fetch →
 * synchronous impression POST, typically sub-second), but short enough that a
 * captured token is useless shortly after the render it was minted for.
 */
export const BEACON_TOKEN_TTL_SECONDS = 10 * 60;

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  );
  let hex = '';
  for (let i = 0; i < sig.length; i++) hex += sig[i].toString(16).padStart(2, '0');
  return hex;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a beacon token for one (event, sponsor) pair. Null when no secret is configured. */
export async function mintBeaconToken(
  env: BeaconTokenEnv,
  eventId: string,
  sponsorId: string,
  ttlSeconds = BEACON_TOKEN_TTL_SECONDS
): Promise<string | null> {
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const claim: BeaconClaim = { kind: KIND, event_id: eventId, sponsor_id: sponsorId, exp };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(claim)));
  const sig = await hmacHex(payload, secret);
  return `${payload}${DELIM}${sig}`;
}

/**
 * Verify a beacon token is valid, unexpired, and scoped to this exact
 * (event, sponsor) pair. Null on any failure — never throws.
 */
export async function verifyBeaconToken(
  env: BeaconTokenEnv,
  token: string | null | undefined,
  eventId: string,
  sponsorId: string
): Promise<BeaconClaim | null> {
  if (!token) return null;
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const parts = token.split(DELIM);
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!constantTimeEqual(await hmacHex(payload, secret), sig)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const c = parsed as Record<string, unknown>;
  if (c.kind !== KIND) return null;
  if (typeof c.event_id !== 'string' || c.event_id !== eventId) return null;
  if (typeof c.sponsor_id !== 'string' || c.sponsor_id !== sponsorId) return null;
  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp)) return null;
  if (c.exp <= Math.floor(Date.now() / 1000)) return null;
  return { kind: KIND, event_id: c.event_id, sponsor_id: c.sponsor_id, exp: c.exp };
}
