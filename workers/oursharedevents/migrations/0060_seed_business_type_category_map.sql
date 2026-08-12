-- Migration 0060: SEED business_type_category_map (#5 DML). Every is_default resolves to >=1 selectable template.
-- OSE-731 (epic OSE-723, Sponsor Onboarding data-model set).
--
-- DML seed of business_type -> default category, inside the migration so a fresh
-- DB is fully seeded by migrations apply alone. Every is_default row must resolve
-- to >=1 SELECTABLE template — selectable per the locked rule = a template in
-- that category with max_clearance_tier IS NOT NULL AND <= ALLOWED_MAX_TIER
-- (the 0057 gate). The companion invariant spec
-- (business-type-category-map.spec.ts) proves this for every default.
--
-- category values are drawn from the categories that actually contain a
-- selectable template today (bar_events, leagues, general, community,
-- professional, social) — all present in category_registry (0058). The 'schools'
-- and 'travel' categories are deliberately NOT used as defaults: their templates
-- are unmapped (Phase 5 youth / no Phase-1 travel type), so they have no
-- selectable template and would break the '>=1 selectable' invariant.
--
-- Harness safety: single standalone INSERT statement (the migration-smoke harness
-- runs one prepare().run() per ';'). The validation query lives in the invariant
-- spec, not the migration body. Seed-only — bumps NO table/index count gate
-- (0059 already did).
--
-- Invariant compliance:
--   #19 — > 0059, unique prefix, append-only, no destructive table drop.
--   #3  — categories from canonical category_registry; no hardcoded UEC/tier.
--   NO-BACKFILL — writes only to the new table, never to a LOAD_BEARING table.

INSERT OR IGNORE INTO business_type_category_map (id, business_type, category, is_default) VALUES
  ('btc_bar_bar_events',                    'bar',                   'bar_events',   1),
  ('btc_restaurant_bar_events',             'restaurant',            'bar_events',   1),
  ('btc_brewery_bar_events',                'brewery',               'bar_events',   1),
  ('btc_league_org_leagues',                'league_org',            'leagues',      1),
  ('btc_sports_club_leagues',               'sports_club',           'leagues',      1),
  ('btc_nonprofit_general',                 'nonprofit',             'general',      1),
  ('btc_charity_general',                   'charity',               'general',      1),
  ('btc_retail_general',                    'retail',               'general',      1),
  ('btc_professional_services_professional','professional_services', 'professional', 1),
  ('btc_corporate_professional',            'corporate',             'professional', 1),
  ('btc_arts_org_community',                'arts_org',              'community',    1),
  ('btc_faith_org_community',               'faith_org',             'community',    1),
  ('btc_community_org_community',           'community_org',         'community',    1),
  ('btc_photographer_social',               'photographer',          'social',       1);
