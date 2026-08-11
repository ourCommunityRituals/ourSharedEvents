-- Migration 0044: corridor_density_snapshots — append-only archive of density baseline readings.
-- Each nightly cron run that overwrites corridor_density_baseline also appends a row here.
-- This preserves historical corridor density readings for OER longitudinal intelligence.
-- corridor_density_baseline is authoritative for SharedReport reads; this table is read-only
-- for analytics/OER consumers.

CREATE TABLE IF NOT EXISTS corridor_density_snapshots (
  id                TEXT PRIMARY KEY,
  corridor_id       TEXT NOT NULL,
  bucket_dow        INTEGER NOT NULL,
  bucket_hour       INTEGER NOT NULL,
  snapshot_date     TEXT NOT NULL,   -- date of the nightly cron run (YYYY-MM-DD)
  window_30d_count  INTEGER NOT NULL DEFAULT 0,
  window_90d_count  INTEGER NOT NULL DEFAULT 0,
  computed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (corridor_id) REFERENCES corridors(id),
  -- One snapshot per (corridor, dow, hour, date) — idempotent on re-run
  UNIQUE (corridor_id, bucket_dow, bucket_hour, snapshot_date),
  CHECK (bucket_dow >= 0 AND bucket_dow <= 6),
  CHECK (bucket_hour >= 0 AND bucket_hour <= 23),
  CHECK (window_30d_count >= 0 AND window_90d_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cds_corridor_dow_hour ON corridor_density_snapshots(corridor_id, bucket_dow, bucket_hour);
CREATE INDEX IF NOT EXISTS idx_cds_snapshot_date ON corridor_density_snapshots(snapshot_date);
