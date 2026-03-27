-- Migration 0005: Indexes for FORMS_DB tables
-- Must run last — all tables must exist before indexes are created.

CREATE INDEX IF NOT EXISTS idx_form_registrations_event
  ON form_registrations(event_id);

CREATE INDEX IF NOT EXISTS idx_form_registrations_expires
  ON form_registrations(expires_at);

CREATE INDEX IF NOT EXISTS idx_checkin_counts_event
  ON checkin_counts(event_id);

CREATE INDEX IF NOT EXISTS idx_form_surveys_event
  ON form_surveys(event_id);

CREATE INDEX IF NOT EXISTS idx_form_surveys_pii
  ON form_surveys(pii_scrubbed);

CREATE INDEX IF NOT EXISTS idx_email_signups_event
  ON email_signups(event_id);

CREATE INDEX IF NOT EXISTS idx_email_signups_retention
  ON email_signups(retention_expires_at);
