-- Migration 0100: the scan split tables keep no time finer than the hour
-- (OSE-923, CCR finding N-DS-2, 2026-10-02).
--
-- scan_placement_events (WHERE) and scan_node_returns (WHO) are written in one
-- batch, and both got `created_at` = datetime('now'), to the second. A join on
-- (event_id, created_at) then re-links who to where one scan at a time, whatever
-- the bucket size. That is the correlation the OSE-798 split exists to prevent;
-- hashing the browser id at rest (OSE-1659) does not close it.
--
-- From here `created_at` is the scan's hour bucket and nothing finer, on both
-- tables, so it carries no information `scan_bucket` does not. The Worker writes
-- it that way (lib/scan-buffer.ts); this clears what is already stored.
--
-- Counts are unchanged: no reader selects created_at from either table. Only the
-- return-signal retention sweep read it, and it now reads scan_bucket.
--
-- D1 refuses a long GLOB pattern ("too complex"), so the bucket shape is
-- checked with length and substr. Idempotent: a row already at the hour is left as it is.

UPDATE scan_placement_events
   SET created_at = replace(scan_bucket, 'T', ' ') || ':00'
 WHERE length(scan_bucket) = 16 AND substr(scan_bucket, 11, 1) = 'T' AND substr(scan_bucket, 14, 3) = ':00'
   AND created_at <> replace(scan_bucket, 'T', ' ') || ':00';

UPDATE scan_node_returns
   SET created_at = replace(scan_bucket, 'T', ' ') || ':00'
 WHERE length(scan_bucket) = 16 AND substr(scan_bucket, 11, 1) = 'T' AND substr(scan_bucket, 14, 3) = ':00'
   AND created_at <> replace(scan_bucket, 'T', ' ') || ':00';

-- A row whose bucket is not in the expected shape still loses its seconds.
UPDATE scan_placement_events
   SET created_at = strftime('%Y-%m-%d %H:00:00', created_at)
 WHERE substr(created_at, 15) <> '00:00';

UPDATE scan_node_returns
   SET created_at = strftime('%Y-%m-%d %H:00:00', created_at)
 WHERE substr(created_at, 15) <> '00:00';
