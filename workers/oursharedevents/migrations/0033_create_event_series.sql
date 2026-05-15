-- Migration 0033: event_series — recurring event linkage with hybrid
--                                  auto-suggest + admin-confirm lifecycle
--                                  (OSE-272 Session 2)
--
-- This table feeds SharedReport field #6 (headcount trend over recurring
-- instances). Background + design contract:
-- docs/features/SHARED-REPORT-DATA-PIPELINE.md
--
-- Q2 ratified (2026-05-15): hybrid auto-suggest + admin-confirm flow.
--
-- The platform's auto-detector cron (Session 3 sub-deliverable) clusters
-- events by venue + day_of_week + hour_of_day (±1hr tolerance), emits
-- `pending` rows for clusters of >= 3 events. Admin UI presents pending
-- suggestions with accept / reject / edit-name actions. Only `confirmed`
-- rows participate in SharedReport headcount_trend. `rejected` rows are
-- remembered so the detector doesn't re-prompt.
--
-- Three-state lifecycle:
--
--   pending    — auto-detector proposed it; not yet admin-confirmed.
--                NOT used for SharedReport calculations.
--   confirmed  — admin accepted. Used for SharedReport headcount_trend.
--   rejected   — admin explicitly said no. Detector won't re-suggest.
--
-- Anonymity invariants:
--
--   1. No per-attendee fields. Only metadata about the recurring pattern.
--   2. Lives in main DB (NOT FORMS_DB) per ADR-001.
--   3. detected_at / confirmed_at / rejected_reason are platform audit fields,
--      not attendee data.
--
-- Companion: migration 0034 adds events.series_id (optional FK).

CREATE TABLE IF NOT EXISTS event_series (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL,                              -- anchor event_id at the venue
  series_name     TEXT NOT NULL,                              -- 'Thursday Trivia' / 'Monday Bocce' etc.
  cadence         TEXT,                                       -- 'weekly' | 'biweekly' | 'monthly'
  day_of_week     INTEGER,                                    -- 0-6 (0 = Sunday), optional
  hour_of_day     INTEGER,                                    -- 0-23, optional
  active_from     TEXT,                                       -- ISO date, optional
  active_until    TEXT,                                       -- ISO date, optional
  state           TEXT NOT NULL DEFAULT 'pending',            -- 'pending' | 'confirmed' | 'rejected'
  detected_at     TEXT,                                       -- when auto-detector emitted (NULL if admin-created directly)
  confirmed_at    TEXT,                                       -- when admin accepted (NULL until state='confirmed')
  rejected_reason TEXT,                                       -- optional admin note on rejection
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (venue_id) REFERENCES events(id),
  CHECK (state IN ('pending', 'confirmed', 'rejected')),
  CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  CHECK (hour_of_day IS NULL OR (hour_of_day >= 0 AND hour_of_day <= 23))
);

-- Hot path: the admin UI lists pending suggestions per venue, and the
-- SharedReport reads confirmed series per venue. Both filter by
-- (venue_id, state), so a composite index here is the right shape.
CREATE INDEX IF NOT EXISTS idx_event_series_venue_state
  ON event_series(venue_id, state);

-- Auto-detector lookup pattern: for a given venue + dow + hour cluster,
-- check whether a `rejected` row already exists so we don't re-suggest.
CREATE INDEX IF NOT EXISTS idx_event_series_venue_dow_hour
  ON event_series(venue_id, day_of_week, hour_of_day);
