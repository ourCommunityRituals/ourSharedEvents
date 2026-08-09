-- Migration 0046: remove FK constraint from corridor density tables (BE-24b)
--
-- Context:
--   corridor_density_baseline (0032) and corridor_density_snapshots (0044)
--   had FOREIGN KEY (corridor_id) REFERENCES corridors(id). This tied the
--   density pipeline to the corridors table, which stores named geographic
--   corridor records requiring origin_node_id / destination_node_id FKs.
--
-- BE-24b architectural decision:
--   The H3 res7 cell string (~5km² hexagon) IS the corridor identifier for
--   density purposes. The corridors table is for named route planning, not
--   density bucketing. The FK was architectural overreach — two different
--   concepts sharing the same column name. Removing the FK decouples them.
--
--   refreshCorridorBaselines now groups by events.h3_res7 (falling back to
--   events.corridor_id for events geocoded before BE-24b) and writes h3 cell
--   strings into corridor_density_baseline.corridor_id.
--
-- Idempotency:
--   DROP TABLE IF EXISTS drops the old table if present. CREATE TABLE IF NOT
--   EXISTS creates the new one. On subsequent migration re-runs, the DROP is
--   a no-op for anything already gone; on a fresh run, it removes and recreates.
--   Net: always ends with a fresh, FK-free table. Safe to run multiple times.
--
-- Data loss note:
--   Both tables are populated only by the nightly scheduled cron. A migration
--   that drops and recreates them clears any accumulated data, which is
--   acceptable — the cron will repopulate on next run from the canonical
--   scan_aggregates and anon_id_returns sources.

DROP TABLE IF EXISTS corridor_density_baseline;
CREATE TABLE IF NOT EXISTS corridor_density_baseline (
  corridor_id      TEXT NOT NULL,  -- H3 res7 cell string OR legacy corridors.id
  bucket_dow       INTEGER NOT NULL,
  bucket_hour      INTEGER NOT NULL,
  window_30d_count INTEGER NOT NULL DEFAULT 0,
  window_90d_count INTEGER NOT NULL DEFAULT 0,
  computed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (corridor_id, bucket_dow, bucket_hour),
  CHECK (bucket_dow >= 0 AND bucket_dow <= 6),
  CHECK (bucket_hour >= 0 AND bucket_hour <= 23),
  CHECK (window_30d_count >= 0 AND window_90d_count >= 0)
);

DROP TABLE IF EXISTS corridor_density_snapshots;
CREATE TABLE IF NOT EXISTS corridor_density_snapshots (
  id                TEXT PRIMARY KEY,
  corridor_id       TEXT NOT NULL,  -- H3 res7 cell string OR legacy corridors.id
  bucket_dow        INTEGER NOT NULL,
  bucket_hour       INTEGER NOT NULL,
  snapshot_date     TEXT NOT NULL,
  window_30d_count  INTEGER NOT NULL DEFAULT 0,
  window_90d_count  INTEGER NOT NULL DEFAULT 0,
  computed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (corridor_id, bucket_dow, bucket_hour, snapshot_date),
  CHECK (bucket_dow >= 0 AND bucket_dow <= 6),
  CHECK (bucket_hour >= 0 AND bucket_hour <= 23),
  CHECK (window_30d_count >= 0 AND window_90d_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_cds_corridor_dow_hour ON corridor_density_snapshots(corridor_id, bucket_dow, bucket_hour);
CREATE INDEX IF NOT EXISTS idx_cds_snapshot_date ON corridor_density_snapshots(snapshot_date);
