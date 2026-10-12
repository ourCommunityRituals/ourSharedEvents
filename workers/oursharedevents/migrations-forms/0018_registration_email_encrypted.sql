-- Migration 0018: a registrant's email can be read back, so the organizer can
-- reach them if the event moves or is cancelled (owner decision 2026-10-11).
--
-- The email stays optional on the form. Until now only its peppered hash was
-- kept (dedup, self-delete, erasure), so no one could be told about a change.
-- When an email is given, the register handler now also stores AES-GCM
-- ciphertext here (the `v1:` format of email_signups.email_encrypted).
--
-- The nightly job clears it, with the name, the day after the event's last
-- date; the row and its hash stay until the row's own expiry (90 days).
-- Existing rows have no ciphertext and stay that way: nothing to backfill.

ALTER TABLE form_registrations ADD COLUMN attendee_email_encrypted TEXT;
