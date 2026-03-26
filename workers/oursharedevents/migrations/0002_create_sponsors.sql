-- Migration 0002: Create sponsors table
-- JSON placement_formats array stores sponsor display configs.
-- click_token + impression_token are UNIQUE for tracking attribution.

CREATE TABLE IF NOT EXISTS sponsors (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  logo_url          TEXT,
  website_url       TEXT,
  tier              TEXT NOT NULL DEFAULT 'standard',
  placement_formats TEXT DEFAULT '[]',
  click_token       TEXT UNIQUE,
  impression_token  TEXT UNIQUE,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);
