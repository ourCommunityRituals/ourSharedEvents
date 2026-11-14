-- Campaigns an organizer can use: staging fixture for the T2 Bruno folder
-- "18. Campaigns (S14)".
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/campaigns-seed.sql
--
-- The rules under test (showcase plan S14, owner 2026-11-12):
--   1. another brand's campaign can never be attached or seen;
--   2. a campaign appears in the public sponsor bundle only for a placement that
--      is on show (the event opted in, the sponsor accepted, the organizer accepted);
--   3. a campaign title is never a filter, a search key or a sort key.
--
-- EVENTS, fixed ids, unlisted (off the landing list and the map), synthetic:
--
--   camp-on-evt    brand root, sponsors on      the cases below
--   camp-off-evt   brand root, sponsors off     its accepted sponsor and campaign show nowhere
--   camp-ci-evt    brand ci-brand, sponsors on  holds another brand's placement
--
-- ONE CAMPAIGN AND ONE SPONSOR PER CASE, so a title found in a response names
-- exactly one case:
--
--   camp_fx_shown     root, active     sb_camp_shown     both accepted            campaign shows
--   camp_fx_pending   root, active     sb_camp_pending   sponsor has not answered  nothing shows
--   camp_fx_declined  root, active     sb_camp_declined  organizer said no         nothing shows
--   camp_fx_paused    root, paused     sb_camp_paused    both accepted            sponsor shows, no campaign
--   camp_fx_hidden    root, active     sb_camp_hidden    both accepted, switch off nothing shows
--   camp_fx_other     ci-brand, active sb_camp_mislinked both accepted, on a root
--                                                        event, linked past the API
--                                                        to the other brand's campaign
--                                                                                 sponsor shows, no campaign
--   camp_fx_toggle    root, active     sb_camp_toggle    both accepted, no campaign
--                                                        the folder attaches and detaches it
--   (camp_fx_other)                    sb_camp_ci        both accepted, on camp-ci-evt
--                                                        the placement no root campaign may take
--
-- The folder also creates one campaign, titled 'Campaign Fixture Created'. Rows
-- with that title are removed here, so each pass starts from the same state.
-- Idempotent. Never apply to production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_displays WHERE sponsor_id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci');
DELETE FROM sponsor_business WHERE id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci');
DELETE FROM campaigns WHERE id IN
  ('camp_fx_shown','camp_fx_pending','camp_fx_declined','camp_fx_paused','camp_fx_hidden','camp_fx_other','camp_fx_toggle');
DELETE FROM campaigns WHERE title = 'Campaign Fixture Created'
  AND id NOT IN (SELECT campaign_id FROM sponsor_placement WHERE campaign_id IS NOT NULL);

-- ── events. The start is three weeks out on every pass. OSE-1615: the start is
-- an input of the spine keys, so the upsert clears them.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('camp-on-evt', 'root', 'Campaign Fixture (sponsors on)', 'camp-on-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('camp-off-evt', 'root', 'Campaign Fixture (sponsors off)', 'camp-off-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":false}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('camp-ci-evt', 'ci-brand', 'Campaign Fixture (other brand)', 'camp-ci-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'ci-brand', status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── campaigns: a title and a status, in one brand each.
INSERT INTO campaigns (id, brand_id, title, status) VALUES
  ('camp_fx_shown',    'root',     'Campaign Fixture Shown',       'active'),
  ('camp_fx_pending',  'root',     'Campaign Fixture Pending',     'active'),
  ('camp_fx_declined', 'root',     'Campaign Fixture Declined',    'active'),
  ('camp_fx_paused',   'root',     'Campaign Fixture Paused',      'paused'),
  ('camp_fx_hidden',   'root',     'Campaign Fixture Hidden',      'active'),
  ('camp_fx_other',    'ci-brand', 'Campaign Fixture Other Brand', 'active'),
  ('camp_fx_toggle',   'root',     'Campaign Fixture Toggle',      'active');

-- ── identity (sponsor_business), each in its event's brand.
INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES
  ('sb_camp_shown',     'root',     'Campaign Shown Sponsor',     'gold', 1),
  ('sb_camp_pending',   'root',     'Campaign Pending Sponsor',   'gold', 1),
  ('sb_camp_declined',  'root',     'Campaign Declined Sponsor',  'gold', 1),
  ('sb_camp_paused',    'root',     'Campaign Paused Sponsor',    'gold', 1),
  ('sb_camp_hidden',    'root',     'Campaign Hidden Sponsor',    'gold', 1),
  ('sb_camp_mislinked', 'root',     'Campaign Mislinked Sponsor', 'gold', 1),
  ('sb_camp_toggle',    'root',     'Campaign Toggle Sponsor',    'gold', 1),
  ('sb_camp_ci',        'ci-brand', 'Campaign Other Brand Sponsor', 'gold', 1);

-- ── placements (ADR-019). Every one is on. What differs is who said yes, the
-- event's switch, and the campaign.
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, campaign_id, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_camp_shown',     'sb_camp_shown',     'camp-on-evt',  'gold', 'camp_fx_shown',    'organizer', 1, 1,    1),
  ('spl_camp_pending',   'sb_camp_pending',   'camp-on-evt',  'gold', 'camp_fx_pending',  'organizer', 1, NULL, 1),
  ('spl_camp_declined',  'sb_camp_declined',  'camp-on-evt',  'gold', 'camp_fx_declined', 'organizer', 1, 1,    0),
  ('spl_camp_paused',    'sb_camp_paused',    'camp-on-evt',  'gold', 'camp_fx_paused',   'organizer', 1, 1,    1),
  ('spl_camp_hidden',    'sb_camp_hidden',    'camp-off-evt', 'gold', 'camp_fx_hidden',   'organizer', 1, 1,    1),
  ('spl_camp_mislinked', 'sb_camp_mislinked', 'camp-on-evt',  'gold', 'camp_fx_other',    'organizer', 1, 1,    1),
  ('spl_camp_toggle',    'sb_camp_toggle',    'camp-on-evt',  'gold', NULL,               'organizer', 1, 1,    1),
  ('spl_camp_ci',        'sb_camp_ci',        'camp-ci-evt',  'gold', 'camp_fx_other',    'organizer', 1, 1,    1);
