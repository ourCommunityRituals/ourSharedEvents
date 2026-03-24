/**
 * Google Sheets API Authentication
 *
 * Implements service account JWT authentication for Google APIs.
 * Uses Web Crypto API available in Cloudflare Workers.
 *
 * Required secrets:
 * - GOOGLE_CLIENT_EMAIL: Service account email
 * - GOOGLE_PRIVATE_KEY: Service account private key (PEM format)
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Token cache to avoid repeated auth calls
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Base64URL encode (RFC 4648)
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
function base64UrlEncode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Convert PEM private key to CryptoKey
 * @param {string} pem - PEM formatted private key
 * @returns {Promise<CryptoKey>}
 */
async function importPrivateKey(pem) {
  // Remove PEM header/footer and whitespace
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  // Decode base64 to binary
  const binaryString = atob(pemContents);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Import as RSA private key for signing
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
}

/**
 * Create a signed JWT for Google API authentication
 * @param {string} clientEmail - Service account email
 * @param {string} privateKey - PEM formatted private key
 * @param {string} scope - OAuth scope (default: sheets)
 * @returns {Promise<string>} Signed JWT
 */
async function createSignedJwt(clientEmail, privateKey, scope = GOOGLE_SHEETS_SCOPE) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600; // 1 hour expiry

  // JWT Header
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  // JWT Claims
  const claims = {
    iss: clientEmail,
    scope: scope,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: exp
  };

  // Encode header and claims
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const unsignedToken = `${headerB64}.${claimsB64}`;

  // Sign the token
  const cryptoKey = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = base64UrlEncode(signature);
  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Exchange signed JWT for access token
 * @param {string} jwt - Signed JWT
 * @returns {Promise<{access_token: string, expires_in: number}>}
 */
async function exchangeJwtForToken(jwt) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Get a valid access token for Google APIs
 * Uses caching to avoid repeated auth calls.
 *
 * @param {Object} env - Worker environment with secrets
 * @returns {Promise<string>} Access token
 */
export async function getAccessToken(env) {
  // Check cache (with 5 minute buffer)
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 300000) {
    return cachedToken;
  }

  // Validate required secrets
  if (!env.GOOGLE_CLIENT_EMAIL) {
    throw new Error('Missing GOOGLE_CLIENT_EMAIL secret');
  }
  if (!env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Missing GOOGLE_PRIVATE_KEY secret');
  }

  // Create signed JWT
  const jwt = await createSignedJwt(
    env.GOOGLE_CLIENT_EMAIL,
    env.GOOGLE_PRIVATE_KEY
  );

  // Exchange for access token
  const tokenResponse = await exchangeJwtForToken(jwt);

  // Cache the token
  cachedToken = tokenResponse.access_token;
  tokenExpiry = now + (tokenResponse.expires_in * 1000);

  return cachedToken;
}

/**
 * Clear the token cache (useful for testing or rotation)
 */
export function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Check if credentials are configured
 * @param {Object} env - Worker environment
 * @returns {boolean}
 */
export function hasCredentials(env) {
  return !!(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}
