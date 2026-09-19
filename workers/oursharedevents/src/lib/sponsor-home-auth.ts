/**
 * Sponsor-home signed-link tokens — the sponsor corner of the triangle gets a
 * place to stand.
 *
 * WHY. Until this, a sponsor had NO screen of their own: they were created in
 * /admin (behind CF Access, by the organizer), and their only artefact was a
 * per-event SharedReport link the organizer minted and sent. They could not see
 * which events they are on, which placements are live, or answer "do I accept
 * this placement?" — even though `sponsor_placement.sponsor_accepted` (0068)
 * has existed for a month with nothing able to set it.
 *
 * WHAT THIS IS. A sponsor-scoped, time-limited, HMAC-signed bearer token that
 * opens `/sponsor` for ONE sponsor_business. Same construction as the
 * SharedReport signed link (shared-report-auth.ts) and the sponsor invite
 * (sponsor-invite.ts): base64url(payload).hex(HMAC-SHA256), constant-time
 * compare, fail-closed on a missing secret. Deliberately NOT a login: no
 * password, no session, no cookie. The organizer mints it (audited), hands it
 * over out-of-band, and it expires. Rotating it is minting a new one.
 *
 * WHY A DISTINCT `kind`. The report token grants read on one EVENT; this one
 * grants a view over one SPONSOR's placements across events. They share a
 * secret but never a claim shape, and verify() refuses any payload whose kind
 * is not exactly 'sponsor_home', so a report token can never open the sponsor
 * home and vice versa.
 *
 * Tenant isolation (#9): brand_id rides in the SIGNED claim; every read the
 * page does is bound to `sponsor_business.id = ? AND brand_id = ?`. A forged
 * or cross-tenant id collapses to the same "not valid" page as an expired one.
 *
 * Pure — no D1, no fetch.
 */

export interface SponsorHomeAuthEnv {
  /** Shared with the SharedReport signed link; unset → every token invalid. */
  SHARED_REPORT_SIGNING_SECRET?: string;
}

export interface SponsorHomeClaim {
  kind: 'sponsor_home';
  sponsor_id: string;
  brand_id: string;
  exp: number;
}

const KIND = 'sponsor_home';
const DELIM = '.';
/** 30 days — long enough to cover a season of placements, short enough to rotate. */
export const SPONSOR_HOME_TTL_SECONDS = 30 * 24 * 60 * 60;

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

/** Mint a sponsor-home token. Returns null when no secret is configured. */
export async function mintSponsorHomeToken(
  env: SponsorHomeAuthEnv,
  sponsorId: string,
  brandId: string,
  ttlSeconds = SPONSOR_HOME_TTL_SECONDS
): Promise<{ token: string; exp: number } | null> {
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const claim: SponsorHomeClaim = { kind: KIND, sponsor_id: sponsorId, brand_id: brandId, exp };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(claim)));
  const sig = await hmacHex(payload, secret);
  return { token: `${payload}${DELIM}${sig}`, exp };
}

/** Verify a sponsor-home token. Null on any failure — never throws. */
export async function verifySponsorHomeToken(
  env: SponsorHomeAuthEnv,
  token: string | null | undefined
): Promise<SponsorHomeClaim | null> {
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
  if (typeof c.sponsor_id !== 'string' || !c.sponsor_id) return null;
  if (typeof c.brand_id !== 'string' || !c.brand_id) return null;
  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp)) return null;
  if (c.exp <= Math.floor(Date.now() / 1000)) return null;
  return { kind: KIND, sponsor_id: c.sponsor_id, brand_id: c.brand_id, exp: c.exp };
}
