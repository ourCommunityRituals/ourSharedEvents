-- Migration 0003: Survey table for FORMS_DB
-- Privacy: PII scrubbed before data is accessible.
-- pii_scrubbed = 0 means has PII, 1 = scrubbed and safe to read.

CREATE TABLE IF NOT EXISTS form_surveys (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL,
  responses_json   TEXT NOT NULL,
  submitted_bucket TEXT NOT NULL,
  pii_scrubbed     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
