/**
 * The signed link to a parent company's family report (Part of OSE-2241).
 *
 * The parent shares its report with a corporate sponsor as one link. The link
 * carries a token: `<base64url(payload)>.<hex(hmac)>`, payload
 * `{ kind: 'family', brand, dc, exp }`, signed with the SharedReport signing
 * secret (SHARED_REPORT_SIGNING_SECRET).
 *
 * DOMAIN SEPARATION. The signature is over `family-report.` + payload, never
 * over the payload alone, so an event SharedReport token (signed over its
 * payload alone, lib/shared-report-auth.ts) never verifies here, and a family
 * token never verifies as an event token. The payload also names its kind.
 *
 * Pure: no D1, no fetch. A missing secret mints nothing and verifies nothing.
 */
import { BRAND_ID_RE, type FamilyDataClass } from './family-report';

export interface FamilyReportAuthEnv {
  SHARED_REPORT_SIGNING_SECRET?: string;
}

export interface FamilyClaim {
  brand: string;
  dc: FamilyDataClass;
  exp: number;
}

const DOMAIN = 'family-report.';

/** The longest a family link lives: 90 days. The default is 30. */
export const FAMILY_LINK_MAX_DAYS = 90;
export const FAMILY_LINK_DEFAULT_DAYS = 30;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}

async function sign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(DOMAIN + message))
  );
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintFamilyToken(
  env: FamilyReportAuthEnv,
  brand: string,
  dc: FamilyDataClass,
  ttlSeconds: number
): Promise<string | null> {
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!secret) return null;
  const payload = b64urlEncode(
    JSON.stringify({ kind: 'family', brand, dc, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyFamilyToken(
  env: FamilyReportAuthEnv,
  token: string | null | undefined
): Promise<FamilyClaim | null> {
  const secret = env.SHARED_REPORT_SIGNING_SECRET?.trim();
  if (!token || !secret || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!sameText(await sign(payload, secret), sig)) return null;
  let claim: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(b64urlDecode(payload));
    if (!parsed || typeof parsed !== 'object') return null;
    claim = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (claim.kind !== 'family') return null;
  if (typeof claim.brand !== 'string' || !BRAND_ID_RE.test(claim.brand)) return null;
  if (claim.dc !== 'production' && claim.dc !== 'all') return null;
  if (typeof claim.exp !== 'number' || claim.exp <= Math.floor(Date.now() / 1000)) return null;
  return { brand: claim.brand, dc: claim.dc, exp: claim.exp };
}
