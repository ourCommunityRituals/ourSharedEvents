-- Migration 0004: Create scans table
-- Privacy by schema: NO exact timestamp stored — only scan_bucket.
-- scan_bucket groups scans into time windows to prevent individual tracking.

CREATE TABLE IF NOT EXISTS scans (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL,
  poster_deployment_id  TEXT NOT NULL,
  scan_bucket           TEXT NOT NULL,
  user_agent_hash       TEXT,
  referrer_domain       TEXT,
  country_code          TEXT,
  region_code           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (poster_deployment_id) REFERENCES poster_deployments(id)
);
