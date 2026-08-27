-- Migration 0068: sponsor business lifecycle + two-sided placement acceptance.
--
-- TWO PROBLEMS, ONE SHAPE.
--
-- 1. "Delete sponsor" was a no-op wearing a cascade. handleAdminDeleteSponsor
--    only ran `UPDATE sponsor_placement SET is_active = 0 WHERE
--    sponsor_business_id = ?`. It never touched sponsor_business (which has no
--    deleted state at all) or sponsor_event_types. So:
--      - Path 2 (template+geo) re-surfaced the "deleted" business on every
--        matching event forever — it joins sponsor_business and filters only
--        st.is_active, and there was no business-level flag it could check.
--      - Any NEW placement resurrected them on Path 1 too, since inserts
--        default is_active = 1 and nothing consulted the business.
--    Deletion belongs on the business. One flag on one row, read at join time,
--    instead of denormalising a tombstone across N children.
--
-- 2. Placement was unilateral in both directions. Path 1 lets an organizer
--    attach a sponsor with no say from the sponsor; Path 2 lets a sponsor
--    subscribe into an event with no say from the organizer. Each path looked
--    complete alone; side by side, each gives a different party no voice.
--    Acceptance is two-sided: either party may initiate, either party may
--    reject.
--
-- NULL-PERMISSIVE BY DESIGN — this is why there is no backfill.
-- A placement is hidden only when a side has actively REJECTED it
-- (accepted = 0). NULL means "not answered yet" and does NOT hide. Existing
-- placements therefore keep working untouched, and rejection is the operative
-- action rather than approval — matching the product rule: cleared for
-- addition, or rejected.
--
-- Invariant compliance:
--   #19 migration_monotonicity: > 0067, matches /^\d{4}_.*\.sql$/, append-only,
--       no destructive drop. Metadata-only ADD COLUMN (defaulted / nullable),
--       zero backfill, zero row rewrite. NOT count-gated (no new table/index).
--   #9  tenant_isolation: sponsor_business.is_active is read alongside the
--       existing brand_id scoping, never in place of it.
--   #25 sponsor_share_covenant: acceptance is an admit/deny boolean only. No
--       tier, share, weight or position column is added, so nothing here can
--       reach allocateShares().
--
-- NOT DONE HERE: sponsor_placement.is_active is now legacy. Its only writer
-- (the delete cascade) is removed in this change, but the column and its
-- Path 1 filter remain so previously soft-deleted rows stay hidden. Retiring
-- it needs a data migration converting those rows to
-- sponsor_business.is_active = 0 — tracked as a follow-up, deliberately not
-- bundled with a bug fix.

-- ── 1. Business lifecycle — where deletion actually belongs ──────────────────
ALTER TABLE sponsor_business ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_sponsor_business_active
  ON sponsor_business(brand_id, is_active);

-- ── 2. Two-sided acceptance on the placement ────────────────────────────────
-- NULL = not answered. 1 = accepted. 0 = rejected (durable: Path 2 skips a
-- business the organizer has rejected for this event, so a declined match is
-- not re-proposed every time the event is resolved).
ALTER TABLE sponsor_placement ADD COLUMN organizer_accepted INTEGER;
ALTER TABLE sponsor_placement ADD COLUMN sponsor_accepted   INTEGER;
