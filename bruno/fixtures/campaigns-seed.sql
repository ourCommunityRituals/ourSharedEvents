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
--   camp_fx_edit     root, active     sb_camp_edit      both accepted
--                                                        requests 60 to 75 rename it, pause
--                                                        it and make it active again; every
--                                                        pass starts from the title
--                                                        'Campaign Fixture Edit', active
--
-- EVENT LINK (OSE-1552 scope 1, migration 0110). No event starts in a campaign.
-- Requests 30 to 52 put camp-on-evt in camp_fx_toggle, move it to camp_fx_shown
-- and take it out again; every pass starts with events.campaign_id NULL on the
-- three events. camp-ci-evt is the event no root campaign may take.
--
-- THE REPORT (OSE-2046, requests 80 to 84; request 83 is OSE-2089). One more event, camp-rpt-evt (root,
-- sponsors on), read as a SharedReport. Nothing else in the folder touches it.
-- Every placement on it is accepted by both sides. Displays are seeded here,
-- per (sponsor, surface); the floor is 5:
--
--   camp_fx_rpt_many  sb_camp_rpt_a  poster 6, display 7, public 8   one sponsor, three surfaces
--                     sb_camp_rpt_b  poster 4                        under the floor: in no total
--                                    => 2 sponsors, total 21
--   camp_fx_rpt_zero  sb_camp_rpt_0  none      \
--   camp_fx_rpt_one   sb_camp_rpt_1  poster 1   } listed, total withheld; the three read alike
--   camp_fx_rpt_four  sb_camp_rpt_4  poster 4  /
--   camp_fx_rpt_five  sb_camp_rpt_5  poster 5                        at the floor: 5
--
-- The class breakdown of the same report (OSE-2089, request 83). The six
-- sponsors above are gold and not local, so they are the premium class:
--   premium  the published rows: 6 + 7 + 8 + 5 = 26; 6 sponsors taking part
--   local    sb_camp_rpt_l4 (local, in no campaign)  poster 4   total withheld; 1 sponsor
--   mid      no sponsor                                         total withheld; 0 sponsors
-- Local (4 displays) and mid (none) must read alike: null, never 0.
--
-- The folder also creates one campaign, titled 'Campaign Fixture Created'. Rows
-- with that title are removed here, so each pass starts from the same state.
-- Idempotent. Never apply to production.

-- ONE PEOPLE FIGURE (OSE-1784, request 82). camp-rpt-evt also has one poster,
-- pd_camp_rpt, with 7 scans in one hour and 3 in the next (10 different
-- people), and the same 10 people in anon_id_returns. Every people figure of the
-- report is the poster sum, 5: never 10, and the sample size is not published.
--
-- THE "NOTHING YET" NOTE (OSE-2093, requests 85 to 88). Two more events with no
-- scans, no sponsors and no displays, read as SharedReports:
--   camp-rpt-none-evt  nobody seen
--   camp-rpt-few-evt   4 people seen (anon_id_returns rows; made-up ids)
-- Both must carry the same `_event` note: 0 people reads the same as 1 to 4.
--
-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM anon_id_returns WHERE venue_id IN ('camp-rpt-none-evt','camp-rpt-few-evt','camp-rpt-evt');
DELETE FROM scan_placement_events WHERE poster_deployment_id = 'pd_camp_rpt';
DELETE FROM poster_deployments WHERE id = 'pd_camp_rpt';
-- An event points at its campaign (0110), so the link goes before the campaigns.
UPDATE events SET campaign_id = NULL WHERE id IN ('camp-on-evt','camp-off-evt','camp-ci-evt','camp-rpt-evt');
DELETE FROM sponsor_displays WHERE sponsor_id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci','sb_camp_edit',
   'sb_camp_rpt_a','sb_camp_rpt_b','sb_camp_rpt_0','sb_camp_rpt_1','sb_camp_rpt_4','sb_camp_rpt_5','sb_camp_rpt_l4');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci','sb_camp_edit',
   'sb_camp_rpt_a','sb_camp_rpt_b','sb_camp_rpt_0','sb_camp_rpt_1','sb_camp_rpt_4','sb_camp_rpt_5','sb_camp_rpt_l4');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci','sb_camp_edit',
   'sb_camp_rpt_a','sb_camp_rpt_b','sb_camp_rpt_0','sb_camp_rpt_1','sb_camp_rpt_4','sb_camp_rpt_5','sb_camp_rpt_l4');
DELETE FROM sponsor_business WHERE id IN
  ('sb_camp_shown','sb_camp_pending','sb_camp_declined','sb_camp_paused','sb_camp_hidden','sb_camp_mislinked','sb_camp_toggle','sb_camp_ci','sb_camp_edit',
   'sb_camp_rpt_a','sb_camp_rpt_b','sb_camp_rpt_0','sb_camp_rpt_1','sb_camp_rpt_4','sb_camp_rpt_5','sb_camp_rpt_l4');
DELETE FROM campaigns WHERE id IN
  ('camp_fx_shown','camp_fx_pending','camp_fx_declined','camp_fx_paused','camp_fx_hidden','camp_fx_other','camp_fx_toggle','camp_fx_edit',
   'camp_fx_rpt_many','camp_fx_rpt_zero','camp_fx_rpt_one','camp_fx_rpt_four','camp_fx_rpt_five');
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
  ('camp_fx_toggle',   'root',     'Campaign Fixture Toggle',      'active'),
  ('camp_fx_edit',     'root',     'Campaign Fixture Edit',        'active');

-- ── identity (sponsor_business), each in its event's brand.
INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES
  ('sb_camp_shown',     'root',     'Campaign Shown Sponsor',     'gold', 1),
  ('sb_camp_pending',   'root',     'Campaign Pending Sponsor',   'gold', 1),
  ('sb_camp_declined',  'root',     'Campaign Declined Sponsor',  'gold', 1),
  ('sb_camp_paused',    'root',     'Campaign Paused Sponsor',    'gold', 1),
  ('sb_camp_hidden',    'root',     'Campaign Hidden Sponsor',    'gold', 1),
  ('sb_camp_mislinked', 'root',     'Campaign Mislinked Sponsor', 'gold', 1),
  ('sb_camp_toggle',    'root',     'Campaign Toggle Sponsor',    'gold', 1),
  ('sb_camp_ci',        'ci-brand', 'Campaign Other Brand Sponsor', 'gold', 1),
  ('sb_camp_edit',      'root',     'Campaign Edit Sponsor',      'gold', 1);

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
  ('spl_camp_ci',        'sb_camp_ci',        'camp-ci-evt',  'gold', 'camp_fx_other',    'organizer', 1, 1,    1),
  ('spl_camp_edit',      'sb_camp_edit',      'camp-on-evt',  'gold', 'camp_fx_edit',     'organizer', 1, 1,    1);

-- ── the report (OSE-2046): its own event, campaigns, sponsors and displays.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('camp-rpt-evt', 'root', 'Campaign Fixture (report)', 'camp-rpt-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO campaigns (id, brand_id, title, status) VALUES
  ('camp_fx_rpt_many', 'root', 'Campaign Fixture Report Many', 'active'),
  ('camp_fx_rpt_zero', 'root', 'Campaign Fixture Report Zero', 'active'),
  ('camp_fx_rpt_one',  'root', 'Campaign Fixture Report One',  'active'),
  ('camp_fx_rpt_four', 'root', 'Campaign Fixture Report Four', 'active'),
  ('camp_fx_rpt_five', 'root', 'Campaign Fixture Report Five', 'active');

INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES
  ('sb_camp_rpt_a', 'root', 'Campaign Report Sponsor A',    'gold', 1),
  ('sb_camp_rpt_b', 'root', 'Campaign Report Sponsor B',    'gold', 1),
  ('sb_camp_rpt_0', 'root', 'Campaign Report Sponsor Zero', 'gold', 1),
  ('sb_camp_rpt_1', 'root', 'Campaign Report Sponsor One',  'gold', 1),
  ('sb_camp_rpt_4', 'root', 'Campaign Report Sponsor Four', 'gold', 1),
  ('sb_camp_rpt_5', 'root', 'Campaign Report Sponsor Five', 'gold', 1),
  ('sb_camp_rpt_l4', 'root', 'Campaign Report Sponsor Local Four', 'bronze', 1);

INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, campaign_id, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_camp_rpt_a', 'sb_camp_rpt_a', 'camp-rpt-evt', 'gold', 'camp_fx_rpt_many', 'organizer', 1, 1, 1),
  ('spl_camp_rpt_b', 'sb_camp_rpt_b', 'camp-rpt-evt', 'gold', 'camp_fx_rpt_many', 'organizer', 1, 1, 1),
  ('spl_camp_rpt_0', 'sb_camp_rpt_0', 'camp-rpt-evt', 'gold', 'camp_fx_rpt_zero', 'organizer', 1, 1, 1),
  ('spl_camp_rpt_1', 'sb_camp_rpt_1', 'camp-rpt-evt', 'gold', 'camp_fx_rpt_one',  'organizer', 1, 1, 1),
  ('spl_camp_rpt_4', 'sb_camp_rpt_4', 'camp-rpt-evt', 'gold', 'camp_fx_rpt_four', 'organizer', 1, 1, 1),
  ('spl_camp_rpt_5', 'sb_camp_rpt_5', 'camp-rpt-evt', 'gold', 'camp_fx_rpt_five', 'organizer', 1, 1, 1);

-- OSE-2089: one local sponsor (locality_band 1), in no campaign, under the floor.
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, locality_band, campaign_id, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_camp_rpt_l4', 'sb_camp_rpt_l4', 'camp-rpt-evt', 'bronze', 1, NULL, 'organizer', 1, 1, 1);

-- Displays, one row each. The DELETE at the top cleared every row of these
-- sponsors, so each pass starts from exactly these counts.
INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type, created_at) VALUES
  ('sd_camp_rpt_a_poster_0', 'sb_camp_rpt_a', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_poster_1', 'sb_camp_rpt_a', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_poster_2', 'sb_camp_rpt_a', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_poster_3', 'sb_camp_rpt_a', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_poster_4', 'sb_camp_rpt_a', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_poster_5', 'sb_camp_rpt_a', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_0', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_1', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_2', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_3', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_4', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_5', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_display_6', 'sb_camp_rpt_a', 'camp-rpt-evt', 'display', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_0', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_1', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_2', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_3', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_4', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_5', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_6', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_a_public_7', 'sb_camp_rpt_a', 'camp-rpt-evt', 'public', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_b_poster_0', 'sb_camp_rpt_b', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_b_poster_1', 'sb_camp_rpt_b', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_b_poster_2', 'sb_camp_rpt_b', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_b_poster_3', 'sb_camp_rpt_b', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_1_poster_0', 'sb_camp_rpt_1', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_4_poster_0', 'sb_camp_rpt_4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_4_poster_1', 'sb_camp_rpt_4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_4_poster_2', 'sb_camp_rpt_4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_4_poster_3', 'sb_camp_rpt_4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_5_poster_0', 'sb_camp_rpt_5', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_5_poster_1', 'sb_camp_rpt_5', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_5_poster_2', 'sb_camp_rpt_5', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_5_poster_3', 'sb_camp_rpt_5', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_5_poster_4', 'sb_camp_rpt_5', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_l4_poster_0', 'sb_camp_rpt_l4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_l4_poster_1', 'sb_camp_rpt_l4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_l4_poster_2', 'sb_camp_rpt_l4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00'),
  ('sd_camp_rpt_l4_poster_3', 'sb_camp_rpt_l4', 'camp-rpt-evt', 'poster', 'fixture', 'display', '2026-11-01 18:00:00');

-- ── one people figure (OSE-1784): a poster with hours of 7 and 3, and the same 10 people seen.
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label)
VALUES ('pd_camp_rpt', 'camp-rpt-evt', 'fx-camp-rpt-poster', 'Fixture board');
INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES
  ('spe_camp_rpt_19_1', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_19_2', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_19_3', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_19_4', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_19_5', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_19_6', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_19_7', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T19:00'),
  ('spe_camp_rpt_20_1', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T20:00'),
  ('spe_camp_rpt_20_2', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T20:00'),
  ('spe_camp_rpt_20_3', 'camp-rpt-evt', 'pd_camp_rpt', '2026-11-01T20:00');
INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at) VALUES
  ('camp-rpt-person-01', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-02', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-03', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-04', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-05', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-06', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-07', 'camp-rpt-evt', '2026-11-01 19:00:00', '2026-11-01 19:00:00'),
  ('camp-rpt-person-08', 'camp-rpt-evt', '2026-11-01 20:00:00', '2026-11-01 20:00:00'),
  ('camp-rpt-person-09', 'camp-rpt-evt', '2026-11-01 20:00:00', '2026-11-01 20:00:00'),
  ('camp-rpt-person-10', 'camp-rpt-evt', '2026-11-01 20:00:00', '2026-11-01 20:00:00');

-- ── the "nothing yet" note (OSE-2093): two bare events, one with 4 people seen.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES
  ('camp-rpt-none-evt', 'root', 'Campaign Fixture (report, nobody)', 'camp-rpt-none-evt', 'active', 0,
   date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{}', 'synthetic'),
  ('camp-rpt-few-evt', 'root', 'Campaign Fixture (report, four people)', 'camp-rpt-few-evt', 'active', 0,
   date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO anon_id_returns (anon_id_hash, venue_id, first_seen_at, last_seen_at) VALUES
  ('camp-rpt-few-person-1', 'camp-rpt-few-evt', '2026-11-01 18:00:00', '2026-11-01 18:00:00'),
  ('camp-rpt-few-person-2', 'camp-rpt-few-evt', '2026-11-01 18:00:00', '2026-11-01 18:00:00'),
  ('camp-rpt-few-person-3', 'camp-rpt-few-evt', '2026-11-01 18:00:00', '2026-11-01 18:00:00'),
  ('camp-rpt-few-person-4', 'camp-rpt-few-evt', '2026-11-01 18:00:00', '2026-11-01 18:00:00');

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1), as every
-- door in the Worker writes it. Run on every pass, so a row seeded before the
-- rule is corrected too. Gate: workers/oursharedevents/tests/seed-live-rows-verified.spec.ts
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id IN ('camp-on-evt', 'camp-off-evt', 'camp-ci-evt', 'camp-rpt-evt', 'camp-rpt-none-evt', 'camp-rpt-few-evt');
