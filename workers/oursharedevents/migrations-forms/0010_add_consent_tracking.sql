-- Migration 0010: Add consent tracking columns to form tables
-- ADMIN-23: Records privacy notice consent at point of collection.
-- GDPR Art. 7 requires proof of consent. CCPA requires notice at collection.
-- consent_given_at: ISO timestamp when user submitted (implicit consent via form submit)
-- consent_text: the privacy notice text shown at time of submission

ALTER TABLE form_registrations ADD COLUMN consent_given_at TEXT;
ALTER TABLE form_surveys ADD COLUMN consent_given_at TEXT;
ALTER TABLE email_signups ADD COLUMN consent_given_at TEXT;
