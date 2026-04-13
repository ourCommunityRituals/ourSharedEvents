-- Migration 0022: sponsor_impressions (analytics tracking)
--
-- Tracks impressions and clicks per sponsor per event per surface.
-- Privacy: no PII — only aggregate counts visible to sponsors.

CREATE TABLE IF NOT EXISTS sponsor_impressions (
  id         TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  surface    TEXT NOT NULL,
  placement  TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'impression',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_sponsor ON sponsor_impressions(sponsor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_event ON sponsor_impressions(event_id);
