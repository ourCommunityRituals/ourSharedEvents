-- Staging fixture for the sponsor logo and card check (OSE-1436).
--
-- Apply (per-env, like tests/ui/smoke/fixtures/sponsored-event.sql):
--   cd workers/oursharedevents
--   npx wrangler d1 execute DB --env staging --remote --file ../../tests/ui/smoke/fixtures/sponsor-logo-check.sql
--
-- WHY THIS EXISTS
-- No automated test sees real rendered logos, the CSP, COEP and the edge cache
-- together, and until this fixture staging had no public event to look at: the
-- public-card seed's event is unlisted (its public page is a 404) and the smoke
-- sponsored event has one sponsor with no logo. This seeds ONE public, upcoming
-- event with the three sponsors the check needs:
--   A  header logo, sidebar logo and a website
--   B  no logo, no website; display name, location, phone and email
--   C  a logo URL that cannot load, so the default image must take its place
--
-- Pages to open at phone width once seeded:
--   /events/evt_sponsor_logo_check              event page (strip under the title)
--   /events?event=evt_sponsor_logo_check        events banner
--   /poster?event=evt_sponsor_logo_check        poster
--   /display?event=evt_sponsor_logo_check       TV (top banner + side rail)
--   /forms/evt_sponsor_logo_check?type=register form page
--   /sponsors/sp_logo_check_b                   sponsor B's card
--
-- data_class='synthetic': test data. Brand 'root' so the public pages list it.
-- Standalone fixture, not a numbered migration (same reason as sponsored-event.sql).
-- Idempotent: every row is keyed by a stable id and re-asserted on each run, and
-- the date is pushed out again so the event stays upcoming.

INSERT INTO events
  (id, brand_id, title, slug, status, is_published, location, where_address,
   start_date, end_date, timezone, what_short, data_class)
VALUES
  ('evt_sponsor_logo_check', 'root', 'Sponsor Logo Check (fixture)', 'sponsor-logo-check',
   'active', 1, 'Beverly Arts Center, Chicago IL', '2407 W 111th St',
   date('now', '+21 days'), date('now', '+21 days'), 'America/Chicago',
   'A staging fixture for checking sponsor logos. Not a real event.', 'synthetic')
ON CONFLICT(id) DO UPDATE SET
  status = 'active', is_published = 1, data_class = 'synthetic',
  start_date = date('now', '+21 days'), end_date = date('now', '+21 days');

INSERT INTO sponsor_business
  (id, brand_id, name, display_name, website_url, address_line, contact_phone, contact_email, tier, is_active)
VALUES
  ('sp_logo_check_a', 'root', 'Logo Check Bakery LLC', 'Logo Check Bakery',
   'https://example.com', NULL, NULL, NULL, 'gold', 1),
  ('sp_logo_check_b', 'root', 'No Logo Hardware Inc', 'No Logo Hardware',
   NULL, '2407 W 111th St, Chicago IL', '+1 773 555 0100', 'hello@example.com', 'gold', 1),
  ('sp_logo_check_c', 'root', 'Broken Logo Books', NULL,
   NULL, NULL, NULL, NULL, 'gold', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, display_name = excluded.display_name,
  website_url = excluded.website_url, address_line = excluded.address_line,
  contact_phone = excluded.contact_phone, contact_email = excluded.contact_email,
  is_active = 1;

-- 'logo' is the header logo, 'logo_compact' the sidebar logo. C's host cannot
-- resolve, so the logo proxy must answer with the default image.
INSERT INTO sponsor_asset (id, sponsor_business_id, format, url) VALUES
  ('sa_logo_check_a_logo',    'sp_logo_check_a', 'logo',
   'https://avatars.githubusercontent.com/u/270526162?v=4&s=200'),
  ('sa_logo_check_a_compact', 'sp_logo_check_a', 'logo_compact',
   'https://avatars.githubusercontent.com/u/270526162?v=4&s=96'),
  ('sa_logo_check_c_logo',    'sp_logo_check_c', 'logo',
   'https://logo.invalid/ose-1436.png')
ON CONFLICT(id) DO UPDATE SET url = excluded.url;

-- sponsor_accepted = 1 and organizer_accepted = 1: a sponsor renders only when
-- both sides agreed (ADR-019).
INSERT INTO sponsor_placement
  (id, sponsor_business_id, event_id, tier, source, click_token, display_token,
   is_active, sponsor_accepted, organizer_accepted)
VALUES
  ('spl_logo_check_a', 'sp_logo_check_a', 'evt_sponsor_logo_check', 'gold', 'organizer',
   'ctok_logo_check_a', 'dtok_logo_check_a', 1, 1, 1),
  ('spl_logo_check_b', 'sp_logo_check_b', 'evt_sponsor_logo_check', 'gold', 'organizer',
   'ctok_logo_check_b', 'dtok_logo_check_b', 1, 1, 1),
  ('spl_logo_check_c', 'sp_logo_check_c', 'evt_sponsor_logo_check', 'gold', 'organizer',
   'ctok_logo_check_c', 'dtok_logo_check_c', 1, 1, 1)
ON CONFLICT(id) DO UPDATE SET is_active = 1, sponsor_accepted = 1, organizer_accepted = 1;
