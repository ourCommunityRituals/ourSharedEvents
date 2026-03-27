-- Migration 0002: Check-in counts for FORMS_DB
-- Zero PII by design — just a running count per event.
-- No individual records. Scan = count + 1.

CREATE TABLE IF NOT EXISTS checkin_counts (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL UNIQUE,
  total_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
