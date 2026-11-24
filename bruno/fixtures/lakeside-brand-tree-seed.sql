-- Lakeside practice brand tree — staging fixture (Part of OSE-1553, OSE-2219).
--
-- Owner, 2026-11-23: a company's ventures each run their own events as
-- separate brands, and the parent company sees all of them and their roll-up.
-- These are stand-in names for practice on staging only; no real group is
-- named here. The parent is lakeside-co; its four ventures are below it:
--
--   lakeside-co            the parent company (runs its own events too)
--    ├── lakeside-club      a clubhouse with fixed courts
--    ├── lakeside-semipro   a semi-pro league
--    ├── lakeside-league    weekly bar leagues
--    └── lakeside-network   a stream network (online events)
--
-- A member of lakeside-co reaches all five brands (lib/brand-tree.ts); a
-- member of one venture reaches only that venture. Who is a member is the
-- owner's STAGING_TESTERS setting, never this file.
--
-- Applied by CI on staging only, after T1 has run the migrations:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/lakeside-brand-tree-seed.sql
-- Idempotent: every row is an upsert keyed on the brand.

INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('lakeside-club', 'lakeside-co')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'lakeside-co';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('lakeside-semipro', 'lakeside-co')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'lakeside-co';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('lakeside-league', 'lakeside-co')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'lakeside-co';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('lakeside-network', 'lakeside-co')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'lakeside-co';
