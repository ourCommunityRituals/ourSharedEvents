-- Migration 0034: events.series_id — link events to confirmed series
--                                     (OSE-272 Session 2)
--
-- This column is the join key that lets the SharedReport build the
-- headcount_trend field for an event by reading all sibling events in the
-- same `event_series`.
--
-- Why optional (nullable):
--
--   1. One-off events (a single fundraiser, a guest speaker night) don't
--      belong to any series — they get NULL.
--   2. Pending and rejected series rows in event_series MUST NOT be joined
--      to events.series_id. The application layer (Session 3 cron + admin
--      UI) only sets series_id when state='confirmed'.
--   3. Backward compatibility: every existing event row has NULL series_id
--      until either the admin assigns one or the auto-detector lands and
--      gets a confirmed match.
--
-- FK type: TEXT (matches event_series.id PRIMARY KEY type) — enforced by
-- the FK-type-affinity invariant gate (tests/fk-type-invariant.spec.ts).

ALTER TABLE events ADD COLUMN series_id TEXT REFERENCES event_series(id);

-- Hot path: SharedReport headcount_trend reads all events in a series
-- ordered by start_date. The (series_id, start_date) compound index
-- supports that pattern.
CREATE INDEX IF NOT EXISTS idx_events_series_start
  ON events(series_id, start_date);
