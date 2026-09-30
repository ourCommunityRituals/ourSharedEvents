-- Migration 0082: poster_deployments.placement_type (OSE-1357 — poster tiers)
--
-- A poster goes up in one of two kinds of place, and the organizer reads them
-- differently:
--
--   'venue'     an AREA of the event's own location ("Front door", "Bar",
--               "Stage left") — which part of the room gets the most scans;
--   'community' a place out in the community (a library, a café) with its own
--               address — how far the poster reaches before the event.
--
-- A categorical label on the ORGANIZER's placement, never on a person: a scan
-- still resolves only to the poster it came from (scan_placement_events →
-- poster_deployment_id), and a short-link tap still has no location at all.
--
-- Existing rows default to 'community' (every poster so far was placed by an
-- address), except those whose address IS the event's own address — those were
-- put up at the venue, so they are backfilled as 'venue'. Additive; the CHECK
-- keeps the column to the two values the admin card offers.

ALTER TABLE poster_deployments ADD COLUMN placement_type TEXT NOT NULL DEFAULT 'community'
  CHECK (placement_type IN ('venue', 'community'));

UPDATE poster_deployments
   SET placement_type = 'venue'
 WHERE address IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM events e
      WHERE e.id = poster_deployments.event_id
        AND (e.where_address = poster_deployments.address
             OR e.location = poster_deployments.address)
   );
