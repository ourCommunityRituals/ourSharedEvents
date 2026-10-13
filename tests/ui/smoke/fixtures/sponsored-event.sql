-- Durable "a real sponsor exists here" fixture for the write-path invariants (OSE-551).
--
-- Apply (per-env, like tests/ui/smoke/fixtures/smoke-events.sql):
--   cd workers/oursharedevents
--   npx wrangler d1 execute ocr-db-staging --env staging --remote --file ../../tests/ui/smoke/fixtures/sponsored-event.sql
--
-- WHY THIS EXISTS
-- The anonymous-id + ncr-accumulation architecture invariants POST an impression/
-- click against a sponsor resolved from GET /api/v2/events/:id/sponsors and assert
-- 201. The read path (data-provider.ts: live -> CF cache -> mock) can surface a
-- sponsor that has NO backing sponsor_business row (mock fixture, or a stale cache
-- entry). sponsor_displays carries FOREIGN KEY (sponsor_id) REFERENCES
-- sponsor_business(id), so logging against such a sponsor 503s (DB_ERROR) — the
-- read looked populated but the write had no FK-valid target (green != true).
--
-- This seeds a DEDICATED event carrying ONE real, active, FK-valid sponsor so the
-- write path always has a real target and returns 201. Dedicated event (not
-- test-event-001) so it never collides with the T2 Newman covenant seed's
-- "exactly these 4" assertions. The write-path specs target it via
-- SMOKE_EVENT_SPONSORED=evt_smoke_sponsored.
--
-- data_class='synthetic' — this is test data, not production (events CHECK
-- constraint enforces the honest marker). Geo = Beverly Arts Center (matches the
-- covenant-event-geo.sql corridor cell) so the sponsor derives is_local=1.
--
-- Standalone fixture, NOT a numbered migration: a migrations/NNNN file would bump
-- REQUIRED_DB_MIGRATION (schema-guard) and 503 every route until the bound D1 is
-- at that version — coupling this test data to the deferred prod migrate (A5/
-- OSE-802). Fixture data belongs in the data layer, applied per-env.
--
-- Idempotent: INSERT OR IGNORE keyed by stable ids; safe to re-run every CI pass.

INSERT OR IGNORE INTO events
  (id, brand_id, title, slug, status, location, where_address,
   lat, lon, h3_res9, h3_res7, start_date, end_date, data_class)
VALUES
  ('evt_smoke_sponsored', 'ose', 'Smoke Sponsored Bocce', 'smoke-sponsored', 'active',
   'Beverly Arts Center, Chicago IL', '2407 W 111th St',
   41.6903, -87.6768, '89266457533ffff', '872664575ffffff',
   datetime('now','-1 hour'), datetime('now','+3 hours'), 'synthetic');

INSERT OR IGNORE INTO sponsor_business
  (id, brand_id, name, website_url, business_type, lat, lon, h3_res9, h3_res7)
VALUES
  ('sp_smoke_local', 'ose', 'Smoke Local Sponsor', 'https://example.com', 'venue',
   41.6903, -87.6768, '89266457533ffff', '872664575ffffff');

-- sponsor_accepted = 1: strict consent (ADR-019 / M4) renders a sponsor ONLY when
-- accepted, and this fixture represents a VISIBLE sponsor (the T4 invariant asserts
-- the event exposes an active sponsor). A pending (NULL) seed is hidden by the
-- resolver + the impression/click gate, which is what failed T2/T4 on staging.
INSERT OR IGNORE INTO sponsor_placement
  (id, sponsor_business_id, event_id, tier, source, polarity, locality_band,
   click_token, display_token, is_active, sponsor_accepted)
VALUES
  ('spl_smoke_local', 'sp_smoke_local', 'evt_smoke_sponsored', 'gold', 'organizer', 1, 1,
   'ctok_smoke_local', 'dtok_smoke_local', 1, 1);

-- INSERT OR IGNORE above skips a row a prior CI seed already wrote (pending), so
-- the column default alone would not fix an already-seeded staging D1. Force the
-- accepted state explicitly — idempotent, and effective on every re-seed.
UPDATE sponsor_placement SET sponsor_accepted = 1 WHERE id = 'spl_smoke_local';

-- The event row above is INSERT OR IGNORE too, so a row seeded once keeps its first
-- window ("now -1h .. now +3h" on the day it was seeded). Weeks later it is post_event,
-- the TV drops wrapped events (OSE-1521) and never loads its sponsors, and the never-who
-- display test fires no impression (T4a red on main from 2026-10-04). Re-open the window
-- on every pass so the fixture is always a live event.
-- OSE-1615: the start is an input of the spine keys, so the statement clears them.
UPDATE events
  SET start_date = datetime('now','-1 hour'),
      end_date   = datetime('now','+3 hours'),
      status     = 'active',
      venue_canonical_id = NULL,
      event_correlation_id = NULL
  WHERE id = 'evt_smoke_sponsored';
