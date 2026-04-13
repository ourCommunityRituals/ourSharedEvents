-- Migration 0019: sponsor_event_types (many-to-many)
--
-- Links sponsors to event templates, enabling a single sponsor
-- to appear at all events of specific types (e.g., bar_night, trivia).
-- Q1 validation: Can a sponsor sign up for 5 event types?

CREATE TABLE IF NOT EXISTS sponsor_event_types (
  id          TEXT PRIMARY KEY,
  sponsor_id  TEXT NOT NULL,
  template_id TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sponsor_id) REFERENCES sponsors(id),
  FOREIGN KEY (template_id) REFERENCES event_templates(id),
  UNIQUE(sponsor_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_event_types_sponsor ON sponsor_event_types(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_event_types_template ON sponsor_event_types(template_id);
