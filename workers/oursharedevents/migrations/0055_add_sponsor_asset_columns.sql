-- Migration 0055: sponsors ADD four-format asset columns (#3).
-- OSE-726 (epic OSE-723, Sponsor Onboarding data-model set).
--
-- Adds four production asset URL columns + per-format content_type and
-- validated_at to the live `sponsors` table: 12 nullable, no-default, no-check,
-- matching the ADD-COLUMN exemplars 0036/0040/0041/0045. logo_url stays the
-- COALESCE fallback source (the 'proxy' rung of the order-11 resolver).
--
-- One `sponsors` touch = one file. NO table recreate (avoids churning the 0018
-- recreate + FKs). NO index on these columns — they are read by PK lookup in
-- the order-12 serve path, never scanned. SQLite ADD COLUMN of a nullable TEXT
-- is metadata-only (zero row rewrite, no backfill). Independent of 0053/0054.
--
-- Load-bearing note (#25): these 12 columns are SELECT *'d into SponsorRow but
-- DROPPED at the buildShareRotation projection (sponsor-resolver.ts projects
-- only {id, tier, is_local}) — they never reach allocateShares. The projection
-- freeze is order 11 (OSE-734), not here.
--
-- Invariant compliance:
--   #19 — > 0054, unique prefix, no destructive table drop. sponsors is
--         LOAD_BEARING but ADD COLUMN is metadata-only — the monotonicity gate
--         (which forbids dropping a load-bearing table) is untouched.
--   #25 — render inputs only; no tier/placement/weight; dropped at the projection.
--   #3  — no hardcoded hex/UEC.
--
-- Four-format set is byte-identical to the 0054 CHECK list, the order-10 R2
-- path segment, and the order-12 route enum (single-source, frozen).

ALTER TABLE sponsors ADD COLUMN poster_url            TEXT;
ALTER TABLE sponsors ADD COLUMN poster_content_type   TEXT;
ALTER TABLE sponsors ADD COLUMN poster_validated_at   TEXT;
ALTER TABLE sponsors ADD COLUMN banner_url            TEXT;
ALTER TABLE sponsors ADD COLUMN banner_content_type   TEXT;
ALTER TABLE sponsors ADD COLUMN banner_validated_at   TEXT;
ALTER TABLE sponsors ADD COLUMN vertical_url          TEXT;
ALTER TABLE sponsors ADD COLUMN vertical_content_type TEXT;
ALTER TABLE sponsors ADD COLUMN vertical_validated_at TEXT;
ALTER TABLE sponsors ADD COLUMN square_url            TEXT;
ALTER TABLE sponsors ADD COLUMN square_content_type   TEXT;
ALTER TABLE sponsors ADD COLUMN square_validated_at   TEXT;
