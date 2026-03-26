-- Migration 0003: Create poster_deployments table
-- qr_token UNIQUE is the primary lookup key for all scan operations.

CREATE TABLE IF NOT EXISTS poster_deployments (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  qr_token        TEXT NOT NULL UNIQUE,
  placement_label TEXT,
  location_desc   TEXT,
  latitude        REAL,
  longitude       REAL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
