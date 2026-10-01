-- Migration 0089: index anon_id_returns by last_seen_at (OSE-1460 review).
--
-- The corridor-returns export (lib/shared-report-export.ts) snapshots a rolling
-- 90-day window, `WHERE air.last_seen_at >= ?`, on every scheduled run. Without
-- this index each run scans the whole longitudinal table; with it, history older
-- than the window is skipped.

CREATE INDEX IF NOT EXISTS idx_anon_id_returns_last_seen
  ON anon_id_returns (last_seen_at);
