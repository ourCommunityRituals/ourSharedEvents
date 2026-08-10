-- Migration 0047: Add H3 NCR cells to poster_deployments (OSE poster geo-tagging)
--
-- Context:
--   poster_deployments has had latitude/longitude since migration 0003 but
--   those coordinates were never indexed into the NCR H3 hierarchy.
--   Each deployed poster has a distinct physical location — a poster at the
--   venue entrance vs. one two blocks away are in different res9 nodes even
--   if they're in the same res7 corridor. H3 tagging enables the SharedReport
--   to answer "which physical placement drove scans?" at node resolution.
--
-- Resolution contract:
--   h3_res9 (NCR Node, ~174m²): identifies the specific corner/block where
--     a poster was placed. Enables per-placement scan attribution in SharedReport.
--   h3_res7 (NCR Corridor, ~5km²): identifies the commercial corridor the
--     poster is in. Allows poster-level corridor density comparison vs.
--     event-level density.
--
-- Computed at deployment creation/update time via the h3-tagging lib,
-- same pattern as events (migration 0037) and sponsors (migration 0045).
-- NULL when latitude/longitude are not provided at deployment time.

ALTER TABLE poster_deployments ADD COLUMN h3_res9 TEXT;  -- NCR Node cell (res 9 ≈ 0.1 km²)
ALTER TABLE poster_deployments ADD COLUMN h3_res7 TEXT;  -- NCR Corridor cell (res 7 ≈ 5 km²)
