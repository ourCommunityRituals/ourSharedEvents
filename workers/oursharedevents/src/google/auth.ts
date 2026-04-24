/**
 * Google Workload Identity Federation auth (OSE-215 / BE-19)
 *
 * Keyless auth flow — no SA JSON keys required:
 *   1. Worker signs a JWT with WIF_PRIVATE_KEY_PEM (not a GCP SA key)
 *   2. Exchanges with GCP STS → short-lived federated access token
 *   3. Token used directly for BigQuery API calls
 *
 * GCP setup required:
 *   - Workload Identity Pool (cf-workers-pool)
 *   - OIDC Provider (cf-workers-oidc) with issuer = Worker URL
 *   - BigQuery IAM binding for the pool principal
 *
 * Worker must serve:
 *   GET /.well-known/openid-configuration
 *   GET /.well-known/jwks.json  (public key from WIF_PUBLIC_JWKS)
 */

import { importPrivateKeyFromPem, GoogleAuthError } from './pem';

export { GoogleAuthError };

export interface GoogleAuthEnv {
  /** RSA private key PEM for signing WIF JWTs (wrangler secret) */
  WIF_PRIVATE_KEY_PEM?: string;
  /** JWKS JSON string containing the public key (wrangler var — not secret) */
  WIF_PUBLIC_JWKS?: string;
  /** GCP project number (12 digits, different from project ID) */
  GCP_PROJECT_NUMBER?: string;
  /** WIF pool ID, e.g. 'cf-workers-pool' */
  WIF_POOL_ID?: string;
  /** WIF provider ID, e.g. 'cf-workers-oidc' */
  WIF_PROVIDER_ID?: string;
  /** Worker issuer URL, e.g. 'https://oursharedevents.workers.dev' */
  WIF_ISSUER?: string;
}

const STS_ENDPOINT = 'https://sts.googleapis.com/v1/token';
const BQ_SCOPE =
  'https://www.googleapis.com/auth/bigquery.insertdata https://www.googleapis.com/auth/bigquery.readonly';
const BUFFER_SECONDS = 60;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let _cache: TokenCache | null = null;

export function hasGoogleCredentials(env: GoogleAuthEnv): boolean {
  return Boolean(
    env.WIF_PRIVATE_KEY_PEM?.trim() &&
    env.GCP_PROJECT_NUMBER?.trim() &&
    env.WIF_POOL_ID?.trim() &&
    env.WIF_PROVIDER_ID?.trim()
  );
}

export async function checkGoogleAuthHealth(
  env: GoogleAuthEnv
): Promise<{ ok: boolean; reason?: string }> {
  if (!hasGoogleCredentials(env)) {
    return {
      ok: false,
      reason:
        'WIF credentials not fully configured (WIF_PRIVATE_KEY_PEM, GCP_PROJECT_NUMBER, WIF_POOL_ID, WIF_PROVIDER_ID)',
    };
  }
  try {
    await getGoogleAccessToken(env);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function base64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildAudience(env: GoogleAuthEnv): string {
  return `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${env.WIF_POOL_ID}/providers/${env.WIF_PROVIDER_ID}`;
}

async function mintWifJwt(env: GoogleAuthEnv, privateKey: CryptoKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const issuer = env.WIF_ISSUER?.trim() ?? 'https://oursharedevents.workers.dev';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ose-wif-key-1' }));
  const payload = base64url(
    JSON.stringify({
      iss: issuer,
      sub: 'ose-worker',
      aud: buildAudience(env),
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

export async function getGoogleAccessToken(
  env: GoogleAuthEnv
): Promise<{ token: string; fromCache: boolean }> {
  if (!hasGoogleCredentials(env)) {
    throw new GoogleAuthError(
      'MISSING_SECRET',
      'WIF credentials not configured — set WIF_PRIVATE_KEY_PEM, GCP_PROJECT_NUMBER, WIF_POOL_ID, WIF_PROVIDER_ID'
    );
  }

  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return { token: _cache.token, fromCache: true };
  }

  const privateKey = await importPrivateKeyFromPem(env.WIF_PRIVATE_KEY_PEM!);
  const jwt = await mintWifJwt(env, privateKey);

  const res = await fetch(STS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience: buildAudience(env),
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: BQ_SCOPE,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: jwt,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GoogleAuthError(
      'TOKEN_EXCHANGE_FAILED',
      `GCP STS token exchange failed: ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  _cache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - BUFFER_SECONDS) * 1000,
  };
  return { token: _cache.token, fromCache: false };
}

export function _resetTokenCache(): void {
  _cache = null;
}
