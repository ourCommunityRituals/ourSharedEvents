-- Migration 0119: a venue someone owns, and the operators who run events there
-- (Part of OSE-2221).
--
-- WHY. Owner, 2026-11-23: a bar owner has several event operators on the
-- property (a trivia host, a league, a DJ), each its own brand. The owner sees
-- all the activity at the place, and the sponsorship it carries. The event
-- already has a venue key (venue_canonical_id, migration 0104), but that is a
-- hash of the name as typed: nobody owns it. This adds the venue as a row.
--
-- WHAT.
--   venues            one place, owned by one brand. A company owns a venue
--                     through its brand, so a parent reaches its venues down
--                     the brand tree (owner, 2026-11-23: yes).
--   venue_operators   a brand the venue lists as running events there:
--                     'on_platform' (its events at the venue roll up to the
--                     venue) or 'grandfathered' (an existing arrangement kept
--                     off the platform: listed, never counted).
--   events.host_venue_id  the venue an event is held at. Set by the event's
--                     own brand, and counted for the venue only while that
--                     brand is the venue's owner or an on-platform operator.
--
-- Invariant compliance:
--   #1  — place, not person: a venue is a name and a res-9 cell. No person
--         column, no coordinates.
--   #9  — tenant isolation: the venue owner reads floored totals of the
--         events listed operators chose to hold there, never an event row, a
--         form or an edit. The platform and public brands own no venue and
--         are no operator.
--   #19 — > 0118, unique prefix, append-only, no table drop.
--   ADR-001 — MAIN DB only.

CREATE TABLE IF NOT EXISTS venues (
  id       TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  name     TEXT NOT NULL,
  h3_res9  TEXT,
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (brand_id NOT IN ('ose-platform', 'root'))
);

CREATE INDEX IF NOT EXISTS idx_venues_brand ON venues (brand_id);

CREATE TABLE IF NOT EXISTS venue_operators (
  venue_id TEXT NOT NULL REFERENCES venues (id),
  brand_id TEXT NOT NULL,
  status   TEXT NOT NULL,
  PRIMARY KEY (venue_id, brand_id),
  CHECK (status IN ('on_platform', 'grandfathered')),
  CHECK (brand_id NOT IN ('ose-platform', 'root'))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_venue_operators_brand ON venue_operators (brand_id);

ALTER TABLE events ADD COLUMN host_venue_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_host_venue ON events (host_venue_id);
