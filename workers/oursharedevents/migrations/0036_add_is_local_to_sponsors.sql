-- Migration 0036: add is_local to sponsors (OSE-330 Phase 2 — Local Sponsor Covenant)
--
-- Adds a boolean classification ORTHOGONAL to the existing tier column.
-- A sponsor can be both is_local=true AND tier='platinum' — these are
-- independent dimensions. Brain canonical at
-- ocr-docs-brain/sponsor-allocation.yaml documents the contract.
--
-- After this migration:
--   - All existing sponsors have is_local=0 (default) — backward compatible,
--     no display order change for events with no local sponsors
--   - When an admin marks a sponsor as is_local=1, the resolver's
--     locals-first sort kicks in for that sponsor's events
--   - The covenant ("locals never pushed out by premium buyers") becomes
--     mechanically inviolable via tests/e2e/0-architecture/tier-equity.invariant.spec.ts
--
-- D1/SQLite: ALTER TABLE ADD COLUMN with DEFAULT is safe + non-destructive.
-- No NOT NULL constraint needed (DEFAULT 0 covers it).
--
-- References:
--   - ADR-013 (docs/adr/ADR-013-local-sponsor-covenant-display-priority.md)
--   - Brain Invariant #5 (architectural-invariants.yaml — Local Sponsor Covenant)
--   - Brain canonical (sponsor-allocation.yaml)

ALTER TABLE sponsors ADD COLUMN is_local INTEGER NOT NULL DEFAULT 0;

-- Index supports the resolver's WHERE is_local=1 paths + future analytics.
-- Partial index would be ideal (WHERE is_local=1) but SQLite partial-index
-- syntax isn't fully supported across all D1 binding versions; a regular
-- index on a boolean column has negligible overhead at expected scale.
CREATE INDEX IF NOT EXISTS idx_sponsors_is_local ON sponsors(is_local);
