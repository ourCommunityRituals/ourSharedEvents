-- Migration 0020: sponsor_areas (hyperlocal geo targeting)
--
-- Each sponsor can define one or more service areas by zip code
-- or lat/lon + radius. Used for Q2 validation: does a local sponsor
-- appear only for events in their area?

CREATE TABLE IF NOT EXISTS sponsor_areas (
  id           TEXT PRIMARY KEY,
  sponsor_id   TEXT NOT NULL,
  zip_code     TEXT,
  lat          REAL,
  lon          REAL,
  radius_miles REAL DEFAULT 10,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_areas_sponsor ON sponsor_areas(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_areas_zip ON sponsor_areas(zip_code);
