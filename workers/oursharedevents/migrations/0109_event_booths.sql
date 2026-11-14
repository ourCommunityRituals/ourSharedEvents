-- Migration 0109: event_booths — a booth is part of a fair (OSE-1998,
-- OSE ADR-034 decision 1, accepted by the owner).
--
-- A market or a fair is one event with many stalls inside it. Until now a stall
-- could only be a poster placement with a free-text label. A booth is now its
-- own row under its event:
--   number   the stall number or code the organizer uses, unique in the event
--            and read in any case ("a12" and "A12" are one stall)
--   name     the trading name the public sees. A trading name, never a
--            person's contact (ADR-034 decision 5): the handler refuses an
--            email-shaped or phone-shaped name.
--   category optional, one word from a fixed list. The list lives in
--            src/lib/event-booths.ts (BOOTH_CATEGORIES), not in a CHECK, so the
--            catalog work (OSE-2002) can change it without rebuilding this table.
--   hall_x, hall_y  optional position on the hall plan, as fractions of the
--            plan from 0 to 1. Never a coordinate on earth: the fair's own area
--            cell says where the hall is.
--   is_active, sort  a booth is soft-deleted, never removed once a placement
--            points at it.
--
-- NO PERSON FIELD, on purpose (ADR-034 decision 5): no contact name, email,
-- phone or note. A vendor's contact details are not stored on this side.
-- Gate: workers/oursharedevents/tests/event-booths.spec.ts and the derived PII
-- column gate (tests/pii-invariant.spec.ts) read the built schema.
--
-- A booth takes its brand from its event (no brand column). Its codes are
-- ordinary poster placements that point at it through the new nullable
-- poster_deployments.booth_id. The /q scan path, scan_placement_events and the
-- hourly dedupe do not read the column and do not change.
--
-- Additive only: one new table, two indexes, one nullable column. No row is
-- written or rewritten. SQLite accepts REFERENCES on an added column whose
-- default is NULL, as 0034 (events.series_id) and 0040 did.
--
-- Rollback: revert the Worker and leave the table and the column. The older
-- Worker reads neither. See ROLLBACK_PLAN.md, 0109.

CREATE TABLE IF NOT EXISTS event_booths (
  id         TEXT    PRIMARY KEY,
  event_id   TEXT    NOT NULL REFERENCES events(id),
  number     TEXT    NOT NULL COLLATE NOCASE,
  name       TEXT    NOT NULL,
  category   TEXT,
  hall_x     REAL    CHECK (hall_x IS NULL OR (hall_x >= 0 AND hall_x <= 1)),
  hall_y     REAL    CHECK (hall_y IS NULL OR (hall_y >= 0 AND hall_y <= 1)),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, number)
);

CREATE INDEX IF NOT EXISTS idx_event_booths_event_id ON event_booths(event_id);

ALTER TABLE poster_deployments ADD COLUMN booth_id TEXT REFERENCES event_booths(id);

CREATE INDEX IF NOT EXISTS idx_poster_deployments_booth_id ON poster_deployments(booth_id);
