-- Migration 0038: Add H3 cell columns to scan_aggregates (S-6.1.2)
--
-- Denormalizes venue NCR cells onto each scan aggregate row so per-cell
-- density queries work without joining back to events at read time.
--
-- Both columns are nullable. Backfill runs nightly via the shared-report
-- materialization cron (Phase 0 of runSharedReportMaterialization).
-- The cron copies h3_res9/h3_res7 from events for rows where h3_res9
-- IS NULL AND the parent event already has cells tagged.
--
-- Scan ingest NEVER sets these columns — geo enrichment is creation-time
-- only (hot-path invariant, S-6.3.1c). The cron is the only writer.

ALTER TABLE scan_aggregates ADD COLUMN h3_res9 TEXT;   -- NCR Node cell (res 9 ≈ 0.1 km²)
ALTER TABLE scan_aggregates ADD COLUMN h3_res7 TEXT;   -- NCR Corridor cell (res 7 ≈ 5 km²)
