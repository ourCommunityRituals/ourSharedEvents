-- Migration 0006: Create scan_aggregates table
-- WRITTEN BY SCHEDULED WORKER ONLY — never by user-facing endpoints.
-- Pre-computed rollups for dashboard performance.

CREATE TABLE IF NOT EXISTS scan_aggregates (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  bucket_date     TEXT NOT NULL,
  bucket_hour     INTEGER,
  total_scans     INTEGER NOT NULL DEFAULT 0,
  unique_agents   INTEGER NOT NULL DEFAULT 0,
  top_country     TEXT,
  top_region      TEXT,
  computed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
