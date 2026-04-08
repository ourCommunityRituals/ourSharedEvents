-- Migration 0008: Add anonymous_id to form tables
-- ADMIN-6: Privacy-first anonymous tracking via cookie.
-- Correlates a visitor across form submissions (register, checkin, survey, email)
-- without storing PII. Enables queries like "unique visitors who registered AND checked in".

ALTER TABLE form_registrations ADD COLUMN anonymous_id TEXT;
ALTER TABLE checkin_counts ADD COLUMN last_anonymous_id TEXT;
ALTER TABLE form_surveys ADD COLUMN anonymous_id TEXT;
ALTER TABLE email_signups ADD COLUMN anonymous_id TEXT;

CREATE INDEX IF NOT EXISTS idx_registrations_anon
  ON form_registrations(event_id, anonymous_id);

CREATE INDEX IF NOT EXISTS idx_surveys_anon
  ON form_surveys(event_id, anonymous_id);
