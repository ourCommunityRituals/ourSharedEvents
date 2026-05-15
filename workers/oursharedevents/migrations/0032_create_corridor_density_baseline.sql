-- Migration 0032: corridor_density_baseline — 2-mile corridor rolling aggregate
--                                              (OSE-272 Session 2)
--
-- This table feeds SharedReport field #3 (corridor density vs. baseline).
-- Background + design contract:
-- docs/features/SHARED-REPORT-DATA-PIPELINE.md
--
-- What this table is for:
--
--   For each event E in corridor C on day-of-week D at hour-of-day H, the
--   SharedReport compares E's distinct-anon-id count against the rolling
--   baseline `window_30d_count` for (C, D, H). Density ratio =
--   `event_scans / baseline_30d_count`. This answers "how busy was this
--   venue compared to typical density for this corridor at this time."
--
-- Anonymity invariants (CI-enforced):
--
--   1. ZERO per-attendee fields. Only aggregates: corridor + day-of-week +
--      hour-of-day + rolling-window distinct-count.
--   2. No anon_id, anon_id_hash, ip_hash, or any other per-attendee column.
--   3. Lives in main DB (NOT FORMS_DB) — per ADR-001 architectural isolation.
--   4. WRITTEN BY SCHEDULED WORKER ONLY (nightly cron). User-facing endpoints
--      MUST NOT write here. Same discipline as scan_aggregates (migration 0006)
--      and anon_id_returns (migration 0031).
--
-- Q4 ratified (2026-05-15): the minimum sample size for a usable baseline is
-- 10 events in the 30-day window for the given (corridor, dow, hour) cell.
-- Below that, the SharedReport renderer surfaces "insufficient corridor
-- signal" rather than computing a noisy density ratio. The threshold lives
-- in materialization code, not the schema — easy to retune later.
--
-- Materialization:
--
--   Nightly cron worker reads scan_aggregates joined to events.corridor_id,
--   bucketed by (corridor_id, dow, hour), computes rolling 30-day and 90-day
--   distinct-anon-id counts via the same anon_id_hash dimension as
--   anon_id_returns (migration 0031) — same ANON_ID_HASH_PEPPER, same
--   one-way hash, never raw anon_id.

CREATE TABLE IF NOT EXISTS corridor_density_baseline (
  corridor_id      TEXT NOT NULL,                              -- 2-mile geo bucket (FK to corridors.id)
  bucket_dow       INTEGER NOT NULL,                           -- 0-6 day of week (0 = Sunday)
  bucket_hour      INTEGER NOT NULL,                           -- 0-23 hour of day
  window_30d_count INTEGER NOT NULL DEFAULT 0,                 -- rolling 30-day distinct anon_id_hash count
  window_90d_count INTEGER NOT NULL DEFAULT 0,                 -- rolling 90-day distinct anon_id_hash count
  computed_at      TEXT NOT NULL DEFAULT (datetime('now')),    -- when nightly cron last refreshed this cell
  PRIMARY KEY (corridor_id, bucket_dow, bucket_hour),
  FOREIGN KEY (corridor_id) REFERENCES corridors(id),
  -- Q4 ratified: callers MUST check window_30d_count >= 10 before
  -- computing a density ratio. Below 10, return NULL ratio.
  CHECK (bucket_dow >= 0 AND bucket_dow <= 6),
  CHECK (bucket_hour >= 0 AND bucket_hour <= 23),
  CHECK (window_30d_count >= 0 AND window_90d_count >= 0)
);
