-- Migration 0101: one scan_node_returns row per browser, event and hour
-- (OSE-923, the dedup half of Layer C).
--
-- The WHO table took one row per scan, so a browser that scanned two posters in
-- the same hour left two rows with the same keyed id, event and bucket. The
-- table is the source of scan_aggregates.total_scans (COUNT(*)) and of the
-- distinct-browser count, so the same person counted twice in `total_scans`.
--
-- From here a browser is one row per event-hour, enforced by a UNIQUE index.
-- The scan write is INSERT OR IGNORE, so a second poster scan in that hour is
-- dropped from the WHO table. It still lands in scan_placement_events, so the
-- per-poster scan counts (dashboards, poster reach) do not change. What does
-- change, on purpose: scan_aggregates.total_scans counts browser-hours, not
-- browser-poster-hours. distinct_agent_hashes (the distinct-scanner count) is
-- unchanged, because it already counted each browser once.
--
-- Rows with no id (anonymous_id IS NULL, the visitor-count fallback) are not
-- covered: SQLite treats NULLs as distinct in a UNIQUE index.
--
-- Existing duplicates are collapsed first, keeping the earliest row by id.
-- Idempotent: a second run finds no duplicate and the index already exists.

DELETE FROM scan_node_returns
 WHERE anonymous_id IS NOT NULL
   AND id NOT IN (
     SELECT MIN(id) FROM scan_node_returns
      WHERE anonymous_id IS NOT NULL
      GROUP BY event_id, anonymous_id, scan_bucket
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_snr_event_anon_bucket
  ON scan_node_returns(event_id, anonymous_id, scan_bucket);
