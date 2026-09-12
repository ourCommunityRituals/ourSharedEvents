-- Migration 0071: Encrypt subscribers.email at rest (Anonymous Contract A-5)
--
-- Data-at-rest doctrine fix. "PII at rest is never plaintext."
--
-- Rationale
--   Migration 0008 created subscribers.email as a plaintext TEXT UNIQUE column.
--   Migration 0028 correctly hashed the ip_address (abuse-signal, match-only)
--   but left the email in the clear. That violates the A-5 contract: a stolen
--   DB dump exposes every subscriber's raw email address.
--
-- Design (mirrors the email_signups table + handleFormEmailSignup)
--   Store BOTH representations, chosen by what each is FOR:
--     * email_hash      TEXT NOT NULL UNIQUE — peppered HMAC-SHA256 of the
--       normalized email. Carries the idempotent-dedup UNIQUE constraint and is
--       the lookup key for GDPR Art.17 / CCPA erasure. Match-only, never
--       reversible without the pepper.
--     * email_encrypted TEXT NOT NULL — AES-GCM (`v1:` versioned) ciphertext of
--       the email, so the admin subscribers list can still read it back.
--   The plaintext `email` column is DROPPED.
--
-- Why recreate the table
--   SQLite/D1 cannot drop a UNIQUE column in place, and we are replacing the
--   UNIQUE identity (email → email_hash). The supported path is to build a new
--   table with the target shape and swap it in.
--
-- Data loss
--   PRE-DEPLOY: subscribers has no production rows, so no row transform is
--   attempted. The old plaintext `email` values (none) are intentionally not
--   preserved — the plaintext column was not supposed to persist.
--
-- Effective pre-0071 column set (0008 + 0028):
--   id INTEGER PK AUTOINCREMENT, email TEXT UNIQUE, source TEXT, created_at TEXT,
--   ip_hash TEXT. This migration reproduces that set MINUS plaintext `email`
--   PLUS email_hash + email_encrypted.

CREATE TABLE subscribers_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash      TEXT NOT NULL UNIQUE,
  email_encrypted TEXT NOT NULL,
  ip_hash         TEXT,
  source          TEXT NOT NULL DEFAULT 'landing',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP TABLE subscribers;

ALTER TABLE subscribers_new RENAME TO subscribers;
