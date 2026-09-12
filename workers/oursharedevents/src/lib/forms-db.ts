/**
 * Forms DB client — utilities for the 4-layer form system.
 *
 * All form data lives in FORMS_DB (separate from anonymous scan system DB).
 * PII crypto (hash/encrypt/decrypt) lives in ./pii — imported and re-exported here
 * so callers don't need to change their import paths.
 */

export interface FormsDbEnv {
  FORMS_DB: D1Database;
  FORMS_ENCRYPTION_KEY?: string;
}

// Re-export PII utilities so existing callers keep working unchanged.
// OSE-712: assertPepperConfigured is the loud-failure preflight for the
// GDPR/CCPA erasure path (a missing pepper must never silently no-op a delete).
// encryptText/decryptText are the non-normalizing generic crypto primitives
// (DE-01 / A-5): human names must keep their exact case/whitespace, unlike
// email which is normalized by encryptEmail before encryption.
export {
  hashEmail,
  assertPepperConfigured,
  encryptEmail,
  decryptEmail,
  encryptText,
  decryptText,
} from './pii';
export type { HashEmailOptions } from './pii';

// ─── Time Bucketing ─────────────────────────────────────────────────────────────

/**
 * Round timestamp to hour bucket for privacy (no exact timestamps stored).
 * Returns ISO string truncated to the hour: "2026-03-27T14"
 */
export function bucketTimestamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

// ─── UUID ───────────────────────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `form-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
