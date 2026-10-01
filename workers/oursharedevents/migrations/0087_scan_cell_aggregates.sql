-- Migration 0087: scan_cell_aggregates — scans counted at the poster's own cell
-- (OSE-1459, ADR-011 "H3 resolution by signal", QR Path to Done rung 5)
--
-- ADR-011: res9 is for physical places only, and a QR scan's place is the
-- poster placement it was scanned at. Every scan comes in through
-- GET /q/:qr_token, so every scan has a poster, and that poster's res9 is
-- where the scan happened. A poster at the venue sits in the venue's cell; a
-- poster across town sits in its own.
--
-- Until now the only scan rollup, scan_aggregates, was one row per
-- (event, hour), tagged with the EVENT VENUE's cells by backfillH3Cells. So a
-- scan at a poster across town was counted at the venue. scan_aggregates
-- stays as it is: an event-level rollup whose h3 columns are the event's
-- venue, holding the session-side metrics (distinct_agent_hashes,
-- top_country) that can only be computed per event.
--
-- This table is the place-side rollup. One row per (event, hour, poster res9
-- cell), counted from scan_placement_events joined to poster_deployments only.
-- Doctrine rule 6 (OSE-798): no durable row carries both a placement and a
-- session-derived value. So the count here is SCANS, never distinct people,
-- and no poster id is stored: the cell is the place. Read paths apply the
-- K-floor per cell (CORRIDOR_MAP_MIN_COUNT).
--
-- Written only by the scheduled materialization (aggregateScanBuckets).
-- Permanent like scan_aggregates (NCR accumulation): no TTL column.

CREATE TABLE IF NOT EXISTS scan_cell_aggregates (
  id          TEXT PRIMARY KEY,           -- cell_{event_id}_{bucket_date}_{bucket_hour}_{h3_res9}
  event_id    TEXT NOT NULL,
  bucket_date TEXT NOT NULL,              -- YYYY-MM-DD (UTC, from scan_bucket)
  bucket_hour INTEGER NOT NULL,           -- 0-23 (UTC)
  h3_res9     TEXT NOT NULL,              -- the poster's NCR node cell (lowercase)
  h3_res7     TEXT,                       -- that node's corridor cell (lowercase)
  scan_count  INTEGER NOT NULL DEFAULT 0, -- scans at posters in this cell, this hour
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_scan_cell_aggregates_event_cell
  ON scan_cell_aggregates(event_id, h3_res9);
