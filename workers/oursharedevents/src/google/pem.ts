/**
 * PEM key parsing for Google Service Account auth (OSE-215 / BE-19)
 * Zero dependencies — uses WebCrypto only (Workers-compatible).
 */

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: 'MISSING_SECRET' | 'KEY_IMPORT_FAILED' | 'TOKEN_EXCHANGE_FAILED',
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/**
 * Import an RS256 private key from a PEM string.
 * Strips PEM headers and decodes the base64 DER payload.
 */
export async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
  try {
    const pemContents = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey(
      'pkcs8',
      binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (err) {
    throw new GoogleAuthError(
      'KEY_IMPORT_FAILED',
      'Failed to import RSA private key from PEM',
      err
    );
  }
}
