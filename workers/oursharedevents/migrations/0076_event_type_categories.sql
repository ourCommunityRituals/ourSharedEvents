-- Migration 0076: event_type_category_registry + event_type_registry.category_code (OSE-1344).
--
-- WHY. The Create Event surfaces (advanced form AND the wizard) have no event
-- type control: `events.event_type_id` has existed since 0023 and has never been
-- written by any handler. The 47 seeded types (0024) carry their category ONLY
-- as the UEC-code prefix (`REC-BOCCE-001` → REC) plus a comment in the seed
-- file — there is no lookup a picker could read. `category_registry` (0058) is
-- a DIFFERENT axis: it canonicalizes event_templates.category (layout
-- templates: bar_events / leagues / general), not the type taxonomy.
--
-- WHAT. (1) A small canonical lookup of the 15 UEC clusters with the display
-- names the 0024 seed comments already use ("Sports > Bocce" is
-- REC > REC-BOCCE-001). (2) An explicit `category_code` on the registry,
-- backfilled from the prefix, so the grouping is a column a query can JOIN on
-- rather than string surgery in every reader. Soft-reference (no FK / no
-- CHECK), the same choice 0058 made, so a future cluster can be added without
-- the SQLite rename-recreate dance.
--
-- ORPHAN RULE (acceptance criterion): every active type MUST resolve to a row
-- in event_type_category_registry. Gate: tests/event-type-catalog.spec.ts
-- asserts the orphan count is 0 after migration; the API additionally never
-- drops an unmapped type (it groups it under "Other") so a seed mistake is
-- visible, not silent.
--
-- Invariant compliance:
--   #19 — > 0075, unique prefix, append-only, no destructive table drop.
--   #3  — codes are the clusters already present in the brain-sourced 0024
--         seed; no new UEC codes, no tier integers.
--   ADR-001 — MAIN DB only.

CREATE TABLE IF NOT EXISTS event_type_category_registry (
  category_code TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO event_type_category_registry (category_code, display_name, display_order) VALUES
  ('REC', 'Sports & Recreation',          10),
  ('SOC', 'Social & Community Dining',    20),
  ('ENT', 'Entertainment & Trivia',       30),
  ('PER', 'Performing Arts & Open Mic',   40),
  ('ART', 'Arts, Culture & Live Music',   50),
  ('TAB', 'Tabletop & Board Games',       60),
  ('MKT', 'Neighborhood Markets',         70),
  ('BIZ', 'Business & Networking',        80),
  ('FND', 'Fundraisers',                  90),
  ('VOL', 'Volunteer & Mutual Aid',      100),
  ('CIV', 'Civic & Neighborhood',        110),
  ('GAR', 'Gardening & Outdoor',         120),
  ('FIT', 'Fitness & Running',           130),
  ('LIT', 'Literary & Book Clubs',       140),
  ('FAI', 'Faith Community',             150);

ALTER TABLE event_type_registry ADD COLUMN category_code TEXT;

-- Backfill from the UEC prefix (CLUSTER-TYPE-NNN). Only rows still NULL, so a
-- re-run never overwrites a deliberate reassignment.
UPDATE event_type_registry
   SET category_code = substr(uec_code, 1, instr(uec_code, '-') - 1)
 WHERE category_code IS NULL
   AND instr(uec_code, '-') > 1;

CREATE INDEX IF NOT EXISTS idx_event_type_registry_category ON event_type_registry(category_code);
