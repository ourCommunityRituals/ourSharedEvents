-- Migration 0035: bigquery_export_state — watermark + status per exportable D1 table
--                                          (OSE-272 Session 4)
--
-- This table is the single source of truth for "what have we exported, and
-- how recently?" The SharedReport BigQuery export cron (Session 4) advances
-- per-table watermarks on success. Failure marks the row but does NOT advance
-- the watermark — next tick retries cleanly.
--
-- Per OPERATING_SYSTEM.md §3 (OCR-docs root), per-repo schema design lives
-- with the code that uses it. Design contract:
--   docs/features/SHARED-REPORT-BIGQUERY-EXPORT.md
--
-- Ratified design decisions (2026-05-15):
--   S4-Q1: same cron tick as materialization
--   S4-Q2: incremental export with watermark per table  ← this table
--   S4-Q3: split by regulatory pool                     ← phaseToPool() helper
--   S4-Q4: failure-isolated, no block                   ← per-row state
--
-- Anonymity invariants preserved by construction:
--   - This table tracks BQ export metadata only; no per-attendee data.
--   - Source tables already anonymity-clean (anon_id_hash only).
--   - Export is mechanical pass-through; no re-hashing, no enrichment.
--
-- Off-by-default behavior:
--   - On first run for a table, no state row exists. The export step
--     INSERTs a row with last_exported_at = '1970-01-01T00:00:00Z' so
--     the first sweep covers everything. Subsequent ticks advance the
--     watermark in place.

CREATE TABLE IF NOT EXISTS bigquery_export_state (
  table_name              TEXT PRIMARY KEY,           -- 'anon_id_returns' | 'corridor_density_baseline' | 'event_series'
  last_exported_at        TEXT NOT NULL,              -- watermark — rows with computed_at > this get exported next
  last_export_status      TEXT NOT NULL DEFAULT 'success'
                          CHECK (last_export_status IN ('success', 'failed', 'pending')),
  rows_exported_lifetime  INTEGER NOT NULL DEFAULT 0, -- cumulative count for ops observability
  last_run_at             TEXT NOT NULL DEFAULT (datetime('now')),
  last_error              TEXT,                       -- populated on failure, cleared on success
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- No additional indexes needed — PK is the access pattern. Three rows max.
