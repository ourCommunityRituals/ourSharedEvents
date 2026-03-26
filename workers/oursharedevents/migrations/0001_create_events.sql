-- Migration 0001: Create events table
-- The events table is the root entity for the entire platform.
-- slug_locked prevents marketing URL changes after first scan.

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  brand_id        TEXT NOT NULL,
  title           TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  slug_locked     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft',
  description     TEXT,
  location        TEXT,
  start_date      TEXT,
  end_date        TEXT,
  timezone        TEXT DEFAULT 'America/New_York',
  cover_image_url TEXT,
  theme_config    TEXT,
  data_json       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
