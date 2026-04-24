-- Migration 0012: Add consent_type to form tables for GDPR lawful basis tracking
-- GDPR Art. 6 requires documenting the lawful basis for processing personal data.
-- CCPA distinguishes categories of personal information and purpose of collection.
-- CASL (Canada) and similar laws distinguish express vs implied consent.
-- Values: 'explicit' (default, form submit = informed consent), 'implied', 'legitimate_interest'

ALTER TABLE email_signups      ADD COLUMN consent_type TEXT NOT NULL DEFAULT 'explicit';
ALTER TABLE form_registrations ADD COLUMN consent_type TEXT NOT NULL DEFAULT 'explicit';
ALTER TABLE form_surveys       ADD COLUMN consent_type TEXT NOT NULL DEFAULT 'explicit';
