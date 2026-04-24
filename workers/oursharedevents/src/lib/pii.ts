/**
 * PII utilities — SHA-256 hashing and AES-GCM encryption for email storage.
 *
 * All crypto via crypto.subtle — zero dependencies, Workers-native.
 *
 * Ciphertext format: `{ENCRYPTION_VERSION}:{base64(iv + ciphertext)}`
 * The version prefix enables key rotation without schema changes:
 *   - v1: PBKDF2/SHA-256 100k iterations, AES-GCM-256, salt = oursharedevents-forms-v1
 *   - v2+ (future): change salt, increment ENCRYPTION_VERSION, decrypt() handles both
 *
 * COPPA/HIPAA readiness notes:
 *   - Consent: callers record consent_given_at; extend to consent_type for COPPA age-gating
 *   - TTL:     callers set retention_expires_at; OSE-203 cron enforces deletion
 *   - Key rotation: version prefix enables re-encrypt-on-read without schema migration
 *   - Audit: pii_audit_log table already exists for HIPAA access logging
 */

// ─── Version ────────────────────────────────────────────────────────────────────

/** Ciphertext version tag. Increment when changing key derivation parameters. */
export const ENCRYPTION_VERSION = 'v1';

// ─── Hashing ────────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash of normalized email. Returns 64-char hex string.
 * Used for dedup — never reveals the raw email.
 */
export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── AES-GCM Encryption ────────────────────────────────────────────────────────

async function deriveKey(secret: string, version: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`oursharedevents-forms-${version}`),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt email with AES-GCM.
 * Returns `{ENCRYPTION_VERSION}:{base64(iv + ciphertext)}`.
 */
export async function encryptEmail(email: string, secret: string): Promise<string> {
  const key = await deriveKey(secret, ENCRYPTION_VERSION);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return `${ENCRYPTION_VERSION}:${btoa(String.fromCharCode(...combined))}`;
}

/**
 * Decrypt email from AES-GCM ciphertext.
 * Accepts versioned format (`v1:base64`) and legacy unversioned base64.
 */
export async function decryptEmail(encrypted: string, secret: string): Promise<string> {
  // Parse version prefix — fall back to v1 for legacy unversioned blobs
  const colonIdx = encrypted.indexOf(':');
  const version = colonIdx !== -1 ? encrypted.slice(0, colonIdx) : ENCRYPTION_VERSION;
  const payload = colonIdx !== -1 ? encrypted.slice(colonIdx + 1) : encrypted;

  const key = await deriveKey(secret, version);
  const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
