-- Migration 0001: Registration table for FORMS_DB (separate from anonymous scan system)
-- Privacy: attendee_email_hash is SHA-256, never raw email.
-- Lifecycle: destroyed after event ends via scheduled job.

CREATE TABLE IF NOT EXISTS form_registrations (
  id                  TEXT PRIMARY KEY,
  event_id            TEXT NOT NULL,
  source_placement_id TEXT,
  attendee_name       TEXT,
  attendee_email_hash TEXT,
  registration_bucket TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'confirmed',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at          TEXT
);
