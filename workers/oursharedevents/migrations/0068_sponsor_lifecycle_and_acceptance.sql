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
-- ORIGINAL (0068) RULE — NULL-permissive: a placement was hidden only on an
-- explicit REJECT (accepted = 0); NULL did not hide. SUPERSEDED for the SPONSOR
-- side by OSE-1301 (2026-09-13, ADR-019): "silence never becomes consent."
--   • organizer_accepted — still NULL-permissive (creating the placement is the
--     organizer's pick); hidden only on an explicit 0. COALESCE(...,1)=1.
--   • sponsor_accepted   — now STRICT on the render/choice boundary: NULL (silence)
--     does NOT render; only an explicit 1 does. See ADR-019 + the Path-1 render
--     queries (pages.ts, sponsor-resolver.ts Path 1, shared-report-builder.ts,
--     sponsors.ts logo proxy) and sponsor-consent-trace.invariant.spec.ts.
-- The column definition below is unchanged (no backfill migration); this header
-- is reconciled to the current semantic so the schema site is not misleading.
--
-- Invariant compliance:
--   #19 migration_monotonicity: > 0067, matches /^\d{4}_.*\.sql$/, append-only,
--       no destructive drop. Metadata-only ADD COLUMN (defaulted / nullable),
--       zero backfill, zero row rewrite. COUNT-GATED: adds one index
--       (idx_sponsor_business_active) and three columns; schema.spec.ts gates
--       bumped in the same change (66->67 indexes, 11->12 / 13->15 columns).
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
