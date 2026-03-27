/**
 * Forms DB client — utilities for the 4-layer form system.
 *
 * All form data lives in FORMS_DB (separate from anonymous scan system DB).
 * Privacy utilities: SHA-256 hashing, AES-GCM encryption, time bucketing.
 */

export interface FormsDbEnv {
  FORMS_DB: D1Database;
  FORMS_ENCRYPTION_KEY?: string;
}

// ─── Hashing ────────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash via Web Crypto. Returns hex string.
 * Used for email dedup and privacy (never store raw emails).
 */
export async function hashEmail(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Time Bucketing ─────────────────────────────────────────────────────────────

/**
 * Round timestamp to hour bucket for privacy (no exact timestamps stored).
 * Returns ISO string truncated to the hour: "2026-03-27T14"
 */
export function bucketTimestamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

// ─── AES-GCM Encryption ────────────────────────────────────────────────────────

/**
 * Derive a CryptoKey from a string secret using PBKDF2.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('oursharedevents-forms-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt email with AES-GCM. Returns base64 string (iv + ciphertext).
 */
export async function encryptEmail(email: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

  // Prepend IV to ciphertext for storage
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt email from AES-GCM base64 string (iv + ciphertext).
 */
export async function decryptEmail(encrypted: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── UUID ───────────────────────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `form-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
