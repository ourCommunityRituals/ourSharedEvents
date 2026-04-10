-- Migration 0016: Add anonymous_id to scans table
-- ADMIN-6: Privacy-first anonymous tracking via cookie.
-- Correlates a visitor across scans without storing PII.
-- The anonymous_id is a random UUID set via HttpOnly cookie.

ALTER TABLE scans ADD COLUMN anonymous_id TEXT;

CREATE INDEX IF NOT EXISTS idx_scans_anonymous
  ON scans(event_id, anonymous_id);
