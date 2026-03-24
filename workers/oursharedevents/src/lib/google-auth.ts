/**
 * Google Service Account Authentication
 *
 * JWT-based service account auth for Google APIs using Web Crypto API.
 * Handles PEM parsing, JWT signing, token exchange, and in-memory caching.
 *
 * D1 Migration note (Phase 2): This file is deleted when Google Sheets is removed.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // refresh 60s before actual expiry

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GoogleAuthEnv {
  GOOGLE_SA_CLIENT_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY_PEM?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// ─── Error ─────────────────────────────────────────────────────────────────────

export class GoogleAuthError extends Error {
  readonly code: string;
  readonly googleStatus?: number;

  constructor(code: string, message: string, googleStatus?: number) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.googleStatus = googleStatus;
  }
}

// ─── Token cache (in-memory per isolate) ──────────────────────────────────────

let tokenCache: CachedToken | null = null;

function getCachedToken(): string | null {
  if (!tokenCache) return null;
  if (tokenCache.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    return tokenCache.accessToken;
  }
  tokenCache = null;
  return null;
}

// ─── PEM helpers ──────────────────────────────────────────────────────────────

function stripPemHeaders(pem: string): string {
  return pem
    .replace(/-----BEGIN[^-]+-----/, '')
    .replace(/-----END[^-]+-----/, '')
    .replace(/\s/g, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const base64 = stripPemHeaders(pem);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      bytes.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (err) {
    throw new GoogleAuthError(
      'GOOGLE_AUTH_KEY_IMPORT_FAILED',
      `Failed to import private key: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ─── JWT building ─────────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function buildJwt(email: string, pem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: email, scope: GOOGLE_SHEETS_SCOPE, aud: GOOGLE_TOKEN_URL,
    iat: now, exp: now + 3600,
  })));

  const unsigned = `${header}.${claims}`;
  const key = await importPrivateKey(pem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function hasGoogleCredentials(env: GoogleAuthEnv): boolean {
  return !!(env.GOOGLE_SA_CLIENT_EMAIL && env.GOOGLE_SA_PRIVATE_KEY_PEM);
}

/**
 * Get a valid Google OAuth access token.
 * Returns cached token when available; mints a new one otherwise.
 */
export async function getGoogleAccessToken(env: GoogleAuthEnv): Promise<string> {
  const cached = getCachedToken();
  if (cached) return cached;

  if (!env.GOOGLE_SA_CLIENT_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY_PEM) {
    throw new GoogleAuthError('GOOGLE_AUTH_MISSING_SECRET', 'Missing GOOGLE_SA_CLIENT_EMAIL or GOOGLE_SA_PRIVATE_KEY_PEM');
  }

  const jwt = await buildJwt(env.GOOGLE_SA_CLIENT_EMAIL, env.GOOGLE_SA_PRIVATE_KEY_PEM);

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new GoogleAuthError('GOOGLE_AUTH_TOKEN_EXCHANGE_FAILED', `Token exchange failed: HTTP ${res.status}`, res.status);
  }

  const { access_token, expires_in } = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { accessToken: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}
