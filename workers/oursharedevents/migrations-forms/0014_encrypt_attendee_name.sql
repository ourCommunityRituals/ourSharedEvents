-- Migration 0014: Encrypt attendee_name at rest (DE-01 / Anonymous Contract A-5).
--
-- A-5 requires personal data to be "encrypted at rest". attendee_name was
-- stored in cleartext in the legacy `attendee_name` column — a SecurityCritical
-- violation. This adds `attendee_name_encrypted` (AES-GCM `v1:base64` ciphertext,
-- same versioned format as email_signups.email_encrypted). The write path now
-- populates attendee_name_encrypted and binds NULL to the legacy column.
--
-- The legacy `attendee_name` column is intentionally NOT dropped: pre-existing
-- rows may still carry cleartext there and the read paths fall back to it until
-- the retention TTL destroys those rows. New writes never populate it.

ALTER TABLE form_registrations ADD COLUMN attendee_name_encrypted TEXT;
