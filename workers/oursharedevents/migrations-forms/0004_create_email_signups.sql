-- Migration 0004: Email signup table for FORMS_DB
-- Privacy: email_encrypted uses AES-GCM (key in FORMS_ENCRYPTION_KEY secret).
-- email_hash is SHA-256 for dedup — never stores raw email.
-- Lifecycle: 30-day retention post-event, auto-delete on schedule.

CREATE TABLE IF NOT EXISTS email_signups (
  id                   TEXT PRIMARY KEY,
  event_id             TEXT NOT NULL,
  email_hash           TEXT NOT NULL,
  email_encrypted      TEXT NOT NULL,
  signup_bucket        TEXT NOT NULL,
  retention_expires_at TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
