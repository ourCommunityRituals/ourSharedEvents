-- Migration 0054: sponsor_asset_draft — per-format focal/crop render inputs (#2).
-- OSE-725 (epic OSE-723, Sponsor Onboarding data-model set).
--
-- Net-new per-format creative asset draft. FK draft_token -> sponsor_business_draft
-- (forces 0054-after-0053). Stores the four aspect-ratio formats with focal
-- point + crop rect; re-keyed to sponsor_id at promotion (OSE-736).
--
-- The four formats are RENDER INPUTS, never purchasable slots. The schema
-- deliberately carries NO tier / placement / share / weight / rank column, so
-- allocateShares has no dimension to weight by format (#25 hard wall). This is
-- asserted structurally by sponsor-resolver-invisibility.invariant.spec.ts.
--
-- UNIQUE(draft_token, format) makes in-place re-upload an UPSERT (ON CONFLICT)
-- via the order-10 handler (OSE-733). Formats are the single frozen constant
-- ['poster','banner','vertical','square'] shared with 0055 *_url columns, the
-- order-10 R2 path segment, and the order-12 route enum.
--
-- Invariant compliance:
--   #19 — > 0053, matches /^\d{4}_.*\.sql$/, unique prefix, no DROP TABLE.
--   #25 — no tier/placement/share/weight/rank column (render-inputs wall).
--   #9  — scoped via the parent draft (brand_id lives on sponsor_business_draft).
--   ADR-001 — FK stays in MAIN DB.

CREATE TABLE IF NOT EXISTS sponsor_asset_draft (
  id            TEXT PRIMARY KEY,
  draft_token   TEXT NOT NULL,
  format        TEXT NOT NULL CHECK(format IN ('poster','banner','vertical','square')),
  url           TEXT,
  content_type  TEXT,
  focal_x       REAL,
  focal_y       REAL,
  crop_rect     TEXT,                      -- JSON {x,y,w,h}
  validated_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (draft_token) REFERENCES sponsor_business_draft(draft_token),
  UNIQUE(draft_token, format)              -- upsert target for order-10 re-upload (ON CONFLICT REPLACE)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_asset_draft_token ON sponsor_asset_draft(draft_token);
