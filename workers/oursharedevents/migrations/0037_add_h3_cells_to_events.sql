-- Migration 0037: Add H3 cell columns to events (Epic 6 F6.1 — S-6.1.1)
--
-- Enables capture-time NCR tagging at venue create/update.
-- Both columns are nullable so existing rows are unaffected.
-- Backfill: nightly cron or one-shot script calls h3-tagging.ts#tagCoordinates
-- for rows where lat/lon IS NOT NULL AND h3_res9 IS NULL.
--
-- Schema refs:
--   lat/lon added in migration 0021 (hyperlocal sponsor matching)
--   Invariant enforcement: h3-tagging.ts must NEVER be imported by scan handlers.
--   This is asserted by the hot-path guard (S-6.3.1c).

ALTER TABLE events ADD COLUMN h3_res9 TEXT;   -- NCR Node cell (res 9 ≈ 0.1 km²)
ALTER TABLE events ADD COLUMN h3_res7 TEXT;   -- NCR Corridor cell (res 7 ≈ 5 km²)
