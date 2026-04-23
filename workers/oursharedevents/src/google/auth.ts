/**
 * Google Service Account auth — JWT assertion flow (OSE-215 / BE-19)
 *
 * Flow:
 *   1. Build a JWT signed with the SA private key (RS256)
 *   2. POST to Google's token endpoint to get an OAuth2 access token
 *   3. Cache the token in memory with a 60-second expiry buffer
 *
 * Token endpoint: https://oauth2.googleapis.com/token
 * Scope: https://www.googleapis.com/auth/bigquery.insertdata
 */

import { importPrivateKeyFromPem, GoogleAuthError } from './pem';

export { GoogleAuthError };

export interface GoogleAuthEnv {
  GOOGLE_SA_CLIENT_EMAIL?: string;
  GOOGLE_SA_PRIVATE_KEY_PEM?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number; // ms since epoch
}

// Module-level in-memory cache — survives across requests in same isolate
let _cache: TokenCache | null = null;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/bigquery.insertdata';
const BUFFER_SECONDS = 60; // refresh 60s before expiry

export function hasGoogleCredentials(env: GoogleAuthEnv): boolean {
  return Boolean(env.GOOGLE_SA_CLIENT_EMAIL?.trim() && env.GOOGLE_SA_PRIVATE_KEY_PEM?.trim());
}

export async function checkGoogleAuthHealth(
  env: GoogleAuthEnv
): Promise<{ ok: boolean; reason?: string }> {
  if (!hasGoogleCredentials(env)) {
    return { ok: false, reason: 'GOOGLE_SA_CLIENT_EMAIL or GOOGLE_SA_PRIVATE_KEY_PEM not set' };
  }
  try {
    await getGoogleAccessToken(env);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Build a base64url-encoded string (no padding) */
function base64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Mint a signed JWT assertion for the Google token endpoint */
async function mintJwt(clientEmail: string, privateKey: CryptoKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      exp: now + 3600,
      iat: now,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Get a valid Google access token, using the in-memory cache.
 * Refreshes automatically 60s before expiry.
 */
export async function getGoogleAccessToken(
  env: GoogleAuthEnv
): Promise<{ token: string; fromCache: boolean }> {
  if (!env.GOOGLE_SA_CLIENT_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY_PEM) {
    throw new GoogleAuthError('MISSING_SECRET', 'Google SA credentials not configured');
  }

  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return { token: _cache.token, fromCache: true };
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await importPrivateKeyFromPem(env.GOOGLE_SA_PRIVATE_KEY_PEM);
  } catch (err) {
    throw err instanceof GoogleAuthError
      ? err
      : new GoogleAuthError('KEY_IMPORT_FAILED', 'PEM import failed', err);
  }

  const jwt = await mintJwt(env.GOOGLE_SA_CLIENT_EMAIL, privateKey);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GoogleAuthError(
      'TOKEN_EXCHANGE_FAILED',
      `Google token exchange failed: ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  _cache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - BUFFER_SECONDS) * 1000,
  };
  return { token: _cache.token, fromCache: false };
}

/** Reset the token cache (for testing) */
export function _resetTokenCache(): void {
  _cache = null;
}
