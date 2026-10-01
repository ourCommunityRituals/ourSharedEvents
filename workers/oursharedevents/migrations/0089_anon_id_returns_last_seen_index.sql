-- Migration 0089: index anon_id_returns for the corridor-returns export (OSE-1460 review).
--
-- The export (lib/shared-report-export.ts) runs two reads on every scheduled run:
--   1. the watermark probe, `WHERE computed_at > ?` (COUNT + MAX), and
--   2. the rolling 90-day snapshot, `WHERE air.last_seen_at >= ?`.
-- Without these indexes each run scans the whole longitudinal table, so nightly
-- work grows with all retained history; with them, each read touches only the
-- rows it needs.

CREATE INDEX IF NOT EXISTS idx_anon_id_returns_last_seen
  ON anon_id_returns (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_anon_id_returns_computed_at
  ON anon_id_returns (computed_at);
