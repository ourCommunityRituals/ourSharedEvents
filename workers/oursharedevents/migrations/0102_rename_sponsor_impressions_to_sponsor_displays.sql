-- Migration 0102: sponsor_impressions becomes sponsor_displays (OSE-931).
--
-- "Display" is the honest word: it states a render fact, an ad on the screen
-- while the attendee had it up, as opposed to a claimed view (PO, 2026-08-20;
-- docs/architecture/HONESTY-LEXICON.md). The schema-lexicon gate flagged the
-- table and its three indexes, and they were held as exemptions pointing here.
--
-- What changes:
--   - table      sponsor_impressions            -> sponsor_displays
--   - indexes    idx_sponsor_impressions_*      -> idx_sponsor_displays_*
--   - event_type DEFAULT 'impression'           -> DEFAULT 'display', and the
--                stored value 'impression'      -> 'display' (a click stays 'click')
-- The columns and the foreign keys are exactly 0067's. The SharedReport field,
-- its depth section and the snapshot move in the same change set.
--
-- SQLite cannot change a column default, so the table is rebuilt: create the
-- new table, copy every row with the value mapped, drop the old one.
--
-- Idempotent for a re-applied statement list: the first statement makes sure
-- the source exists, so a second run copies nothing from an empty table.

CREATE TABLE IF NOT EXISTS sponsor_impressions (
  id         TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  surface    TEXT NOT NULL,
  placement  TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'impression',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  h3_res7    TEXT,
  FOREIGN KEY (sponsor_id) REFERENCES sponsor_business(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS sponsor_displays (
  id         TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,   -- FK -> sponsor_business(id)
  event_id   TEXT NOT NULL,
  surface    TEXT NOT NULL,
  placement  TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'display',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  h3_res7    TEXT,
  FOREIGN KEY (sponsor_id) REFERENCES sponsor_business(id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

INSERT OR IGNORE INTO sponsor_displays
  (id, sponsor_id, event_id, surface, placement, event_type, created_at, h3_res7)
SELECT id, sponsor_id, event_id, surface, placement,
       CASE event_type WHEN 'impression' THEN 'display' ELSE event_type END,
       created_at, h3_res7
  FROM sponsor_impressions;

DROP INDEX IF EXISTS idx_sponsor_impressions_sponsor;
DROP INDEX IF EXISTS idx_sponsor_impressions_event;
DROP INDEX IF EXISTS idx_sponsor_impressions_h3_res7;
DROP TABLE IF EXISTS sponsor_impressions;

CREATE INDEX IF NOT EXISTS idx_sponsor_displays_sponsor ON sponsor_displays(sponsor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sponsor_displays_event ON sponsor_displays(event_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_displays_h3_res7
  ON sponsor_displays(h3_res7)
  WHERE h3_res7 IS NOT NULL;
