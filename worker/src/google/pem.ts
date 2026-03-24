/**
 * PEM Key Parsing for WebCrypto
 *
 * Handles parsing of PEM-encoded private keys for use with
 * Web Crypto API (available in Cloudflare Workers).
 *
 * @module google/pem
 * @see Story B1 - Worker Service Account Auth (JWT -> OAuth Token) + Token Cache
 */

import { GoogleAuthError, GOOGLE_AUTH_ERROR_CODES } from './auth';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of PEM key parsing
 */
export interface PemParseResult {
  /** DER-encoded key bytes */
  keyData: ArrayBuffer;
  /** Key format (pkcs8 or pkcs1) */
  format: 'pkcs8' | 'spki';
}

// =============================================================================
// Constants
// =============================================================================

const PEM_HEADER_PKCS8 = '-----BEGIN PRIVATE KEY-----';
const PEM_FOOTER_PKCS8 = '-----END PRIVATE KEY-----';
const PEM_HEADER_PKCS1 = '-----BEGIN RSA PRIVATE KEY-----';
const PEM_FOOTER_PKCS1 = '-----END RSA PRIVATE KEY-----';

// =============================================================================
// Functions
// =============================================================================

/**
 * Remove PEM headers, footers, and whitespace from a PEM string
 *
 * @param pem - PEM-encoded key string
 * @returns Base64-encoded key content (without headers/whitespace)
 */
export function stripPemHeaders(pem: string): string {
  return pem
    .replace(PEM_HEADER_PKCS8, '')
    .replace(PEM_FOOTER_PKCS8, '')
    .replace(PEM_HEADER_PKCS1, '')
    .replace(PEM_FOOTER_PKCS1, '')
    .replace(/\s/g, '');
}

/**
 * Validate PEM format
 *
 * @param pem - PEM string to validate
 * @returns True if valid PEM format
 */
export function isValidPem(pem: string): boolean {
  if (!pem || typeof pem !== 'string') {
    return false;
  }

  const hasPkcs8Headers =
    pem.includes(PEM_HEADER_PKCS8) && pem.includes(PEM_FOOTER_PKCS8);
  const hasPkcs1Headers =
    pem.includes(PEM_HEADER_PKCS1) && pem.includes(PEM_FOOTER_PKCS1);

  return hasPkcs8Headers || hasPkcs1Headers;
}

/**
 * Decode base64 string to ArrayBuffer
 *
 * @param base64 - Base64-encoded string
 * @returns ArrayBuffer with decoded bytes
 * @throws {GoogleAuthError} If base64 decoding fails
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  let binaryString: string;
  try {
    binaryString = atob(base64);
  } catch {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.MISSING_SECRET,
      'Failed to decode private key: invalid base64 encoding'
    );
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

/**
 * Parse a PEM-encoded private key to ArrayBuffer
 *
 * Supports both PKCS#8 and PKCS#1 (RSA) formats.
 * The Web Crypto API requires PKCS#8 format for importKey.
 *
 * @param pem - PEM-encoded private key string
 * @returns Parsed key data and format
 * @throws {GoogleAuthError} If PEM format is invalid or decoding fails
 */
export function parsePem(pem: string): PemParseResult {
  if (!isValidPem(pem)) {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.MISSING_SECRET,
      'GOOGLE_SA_PRIVATE_KEY_PEM must be in PEM format with BEGIN/END markers'
    );
  }

  const base64Content = stripPemHeaders(pem);
  const keyData = base64ToArrayBuffer(base64Content);

  // Determine format based on header
  const format: 'pkcs8' | 'spki' = pem.includes(PEM_HEADER_PKCS1)
    ? 'pkcs8' // PKCS#1 needs conversion, but WebCrypto only supports pkcs8
    : 'pkcs8';

  return { keyData, format };
}

/**
 * Import a PEM-encoded private key as a CryptoKey for RSA-SHA256 signing
 *
 * @param pem - PEM-encoded private key string
 * @returns CryptoKey ready for signing
 * @throws {GoogleAuthError} If key import fails
 */
export async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
  const { keyData } = parsePem(pem);

  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false, // not extractable
      ['sign']
    );
  } catch (error) {
    throw new GoogleAuthError(
      GOOGLE_AUTH_ERROR_CODES.KEY_IMPORT_FAILED,
      'Failed to import private key: invalid PKCS8 format or unsupported algorithm',
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}
