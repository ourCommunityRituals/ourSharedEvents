-- Multi-tier sponsor fixture for the smoke/depth tiers (Part of OSE-834).
--
-- Apply (per-env, like tests/ui/smoke/fixtures/smoke-events.sql):
--   cd workers/oursharedevents
--   npx wrangler d1 execute DB --env staging --remote \
--     --file ../../tests/ui/smoke/fixtures/sponsors-tiers-smoke.sql
--
-- WHY THIS EXISTS
-- OSE-834: a blocking T4 tier goes green on a thin seed. smoke-events.sql carries
-- 3 bare events and no sponsor rows, so the sponsor-facing tiers (sponsor journey,
-- SharedReport class breakdown / depth) skip on absent fixtures. This seeds one
-- DEDICATED event with sponsors across ALL THREE report classes so those tiers
-- have real, FK-valid, ≥2-tier data to assert against.
--
-- DEDICATED event (evt_smoke_tiers), NOT the page-smoke events (evt_smoke_{pre,
-- live,post}) and NOT evt_smoke_sponsored — so adding sponsor rows here can never
-- shift a page-smoke (T4d/T4e) or the single-sponsor write-path fixture
-- (sponsored-event.sql, OSE-551). Same dedicated-event doctrine as that file.
--
-- CLASS derivation is server-side (shared-report-builder.ts classifySponsor):
--   locality_band = 1                         -> 'local'  (wins regardless of tier)
--   locality_band = 0 AND tier in {title,platinum,gold} -> 'premium'
--   locality_band = 0 AND any other tier      -> 'mid'
-- is_local (locality_band) ⟂ paid tier is the covenant floor (#25) — proven here by
-- a local sponsor that also holds a premium-set tier ('gold') yet classes as local.
--
-- data_class='synthetic' (events CHECK enforces the honest marker). Geo = Beverly
-- Arts Center corridor so a local sponsor's h3_res7 matches the event's.
-- Idempotent: INSERT OR IGNORE keyed by stable ids; safe to re-run every CI pass.
-- Standalone fixture, NOT a numbered migration (a migrations/NNNN file would bump
-- REQUIRED_DB_MIGRATION and 503 every route until the bound D1 is at that version).

INSERT OR IGNORE INTO events
  (id, brand_id, title, slug, status, location, where_address,
   lat, lon, h3_res9, h3_res7, start_date, end_date, data_class)
VALUES
  ('evt_smoke_tiers', 'ose', 'Smoke Tiers Bocce', 'smoke-tiers', 'active',
   'Beverly Arts Center, Chicago IL', '2407 W 111th St',
   41.6903, -87.6768, '89266457533ffff', '872664575ffffff',
   datetime('now','-7 days'), datetime('now','-7 days','+4 hours'), 'synthetic');

-- Durable business identities (sponsor_business, 0065). brand_id='ose' (#9).
INSERT OR IGNORE INTO sponsor_business
  (id, brand_id, name, website_url, business_type, lat, lon, h3_res9, h3_res7)
VALUES
  ('sp_tiers_local',   'ose', 'Smoke Tiers Local',   'https://example.com/local',   'venue',
   41.6903, -87.6768, '89266457533ffff', '872664575ffffff'),
  ('sp_tiers_mid',     'ose', 'Smoke Tiers Mid',     'https://example.com/mid',     'retail',
   41.7100, -87.7000, '89266451234ffff', '872664512ffffff'),
  ('sp_tiers_premium', 'ose', 'Smoke Tiers Premium', 'https://example.com/premium', 'brand',
   41.9000, -87.6300, '89266459876ffff', '872664598ffffff');

-- Per-event attachments (sponsor_placement, 0067). tier = per-event rotation weight
-- only (#25); the report CLASS is derived from locality_band + tier as above.
--   local:   locality_band=1 (classes 'local' even though tier='gold')
--   mid:     locality_band=0, tier='silver' -> 'mid'
--   premium: locality_band=0, tier='gold'   -> 'premium'
-- click_token / display_token are UNIQUE — distinct per placement.
-- sponsor_accepted = 1 on every row: strict consent (ADR-019 / M4) renders a
-- sponsor ONLY when accepted. These tier fixtures must be VISIBLE for the
-- SharedReport class/depth tiers to have data; a pending (NULL) seed is hidden by
-- the resolver, which is what failed T2/T4 on staging.
INSERT OR IGNORE INTO sponsor_placement
  (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
   click_token, display_token, is_active, sponsor_accepted)
VALUES
  ('spl_tiers_local',   'sp_tiers_local',   'evt_smoke_tiers', 'gold',   'organizer', 1, 1,
   'ctok_tiers_local',   'dtok_tiers_local',   1, 1),
  ('spl_tiers_mid',     'sp_tiers_mid',     'evt_smoke_tiers', 'silver', 'organizer', 1, 0,
   'ctok_tiers_mid',     'dtok_tiers_mid',     1, 1),
  ('spl_tiers_premium', 'sp_tiers_premium', 'evt_smoke_tiers', 'gold',   'organizer', 1, 0,
   'ctok_tiers_premium', 'dtok_tiers_premium', 1, 1);

-- INSERT OR IGNORE skips rows a prior CI seed already wrote (pending), so force
-- the accepted state on all three explicitly — idempotent, effective on re-seed.
UPDATE sponsor_placement SET sponsor_accepted = 1
 WHERE id IN ('spl_tiers_local', 'spl_tiers_mid', 'spl_tiers_premium');
