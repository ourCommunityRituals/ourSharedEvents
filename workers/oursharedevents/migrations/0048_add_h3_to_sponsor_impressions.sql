-- Migration 0048: Add h3_res7 to sponsor_impressions (OSE-635 / BE-SEC-GEO-1).
--
-- Digital click geo-privacy invariant: sponsor clicks and impressions record
-- only res7 (~5km² corridor) — NOT res9 (~174m² node) — so the click-time
-- geo cannot be used to reconstruct an attendee's exact position.
--
-- res9 is deliberately omitted here. It appears on scan_aggregates (physical
-- QR scans where the poster location is a public physical placement, not the
-- attendee's device location) but NOT on digital impression/click rows where
-- the cell would approximate the user's current location.
--
-- The column is nullable. Backfill is not required — historical impressions
-- predate the NCR geo layer and will remain NULL. New rows written by
-- handleLogImpression / handleLogClick will include the cell from the parent
-- event's h3_res7 field at write time.

ALTER TABLE sponsor_impressions ADD COLUMN h3_res7 TEXT;

CREATE INDEX IF NOT EXISTS idx_sponsor_impressions_h3_res7
  ON sponsor_impressions(h3_res7)
  WHERE h3_res7 IS NOT NULL;
