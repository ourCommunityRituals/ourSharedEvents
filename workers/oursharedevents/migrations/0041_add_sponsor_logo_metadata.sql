-- Migration 0041: Add sponsor logo metadata columns.
-- Tracks the validated content-type and last-validated timestamp so the
-- proxy endpoint can short-circuit the content-type check on cached entries.
-- Both columns are nullable and backward-compatible (existing rows get NULL).

ALTER TABLE sponsors ADD COLUMN logo_content_type TEXT;
ALTER TABLE sponsors ADD COLUMN logo_validated_at  TEXT;
