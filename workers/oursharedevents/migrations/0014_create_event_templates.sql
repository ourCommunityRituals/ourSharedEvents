-- Migration 0014: Create event_templates table
-- ADR-010: Templates = breadth (available to all), Tiers = depth (gate features).
-- Templates define cosmetic/structural defaults for event creation.
-- They never gate access — the tier system handles that independently.

CREATE TABLE IF NOT EXISTS event_templates (
  id               TEXT PRIMARY KEY,          -- e.g. 'bar_night', 'trivia'
  name             TEXT NOT NULL,             -- Display name
  description      TEXT NOT NULL,             -- One-line description
  category         TEXT NOT NULL,             -- Grouping: bar_events, leagues, general, etc.
  icon             TEXT NOT NULL DEFAULT '✨', -- Emoji icon
  display_order    INTEGER NOT NULL DEFAULT 50,
  stage            TEXT NOT NULL DEFAULT 'mvp', -- 'mvp' or 'v2' (rollout phase, not access gate)
  default_sections TEXT NOT NULL DEFAULT '{}', -- JSON: which sections on/off
  default_ctas     TEXT NOT NULL DEFAULT '[]', -- JSON: suggested CTA labels
  default_ui_presets TEXT NOT NULL DEFAULT '{}', -- JSON: audience, notesLabel, sponsorStripLabel
  example_name     TEXT,                      -- Placeholder event name
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_event_templates_category
  ON event_templates(category, display_order);
