-- Opt-in sponsors: staging fixture for the T2 Bruno folder
-- "16. Opt-in sponsors (OSE-1900)".
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/opt-in-sponsors-seed.sql
--
-- The rule under test (owner, 2026-11-09): a sponsor shows only on an event that
-- chose to have sponsors. The switch is `useSponsors` in events.settings_json,
-- and absent means off. It comes before the two-sided placement consent.
--
-- ONE EVENT PER SWITCH STATE, fixed ids, so each Bruno request is a pure assert:
--
--   optin-on-evt      switch on, listed, upcoming     its accepted sponsor shows everywhere
--   optin-off-evt     switch off, listed, upcoming    its accepted sponsor shows nowhere, and
--                                                     no sponsor can ask to back it
--   optin-absent-evt  switch never set, unlisted      its accepted sponsor shows nowhere
--   optin-toggle-evt  switch never set, unlisted      the folder turns it on and off
--
-- optin-on-evt and optin-off-evt are listed and upcoming on purpose: sponsor
-- discovery only ever offers a listed, upcoming event, so the refusal on
-- optin-off-evt is the switch and nothing else, and the list API shows the card
-- line for one and not the other.
--
-- ONE SPONSOR PER CASE (brand 'root', like the events):
--
--   sb_optin_shown     accepted by both, on optin-on-evt          shows
--   sb_optin_pending   the sponsor has not answered, optin-on-evt does not show (one side only)
--   sb_optin_declined  the organizer said no, optin-on-evt        does not show (one side only)
--   sb_optin_hidden    accepted by both, on optin-off-evt         does not show (the switch)
--   sb_optin_absent    accepted by both, on optin-absent-evt      does not show (the switch)
--   sb_optin_toggle    accepted by both, on optin-toggle-evt      follows the switch
--   sb_optin_seeker    no placement at all                        the sponsor that asks to join
--
-- The upserts put every row back to this state on each pass, settings_json
-- included, so a run that stopped half way through the toggle requests cannot
-- leave the next run in the wrong state. data_class='synthetic' marks the events
-- as CI test data. Idempotent. Never apply to production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_displays WHERE sponsor_id IN
  ('sb_optin_shown','sb_optin_pending','sb_optin_declined','sb_optin_hidden','sb_optin_absent','sb_optin_toggle','sb_optin_seeker');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_optin_shown','sb_optin_pending','sb_optin_declined','sb_optin_hidden','sb_optin_absent','sb_optin_toggle','sb_optin_seeker');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('sb_optin_shown','sb_optin_pending','sb_optin_declined','sb_optin_hidden','sb_optin_absent','sb_optin_toggle','sb_optin_seeker');
DELETE FROM sponsor_business WHERE id IN
  ('sb_optin_shown','sb_optin_pending','sb_optin_declined','sb_optin_hidden','sb_optin_absent','sb_optin_toggle','sb_optin_seeker');

-- ── events (brand 'root'). The start is three weeks out on every pass, so the
-- two listed events never become past events. OSE-1615: the start is an input of
-- the spine keys, so the upsert clears them.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('optin-on-evt', 'root', 'Opt-in Fixture (sponsors on)', 'optin-on-evt', 'active', 1,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 1, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('optin-off-evt', 'root', 'Opt-in Fixture (sponsors off)', 'optin-off-evt', 'active', 1,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":false}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 1, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('optin-absent-evt', 'root', 'Opt-in Fixture (never set)', 'optin-absent-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('optin-toggle-evt', 'root', 'Opt-in Fixture (toggle)', 'optin-toggle-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── identity (sponsor_business). No website, so a tap lands on the public card.
INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES
  ('sb_optin_shown',    'root', 'Opt-in Shown Sponsor',    'gold', 1),
  ('sb_optin_pending',  'root', 'Opt-in Pending Sponsor',  'gold', 1),
  ('sb_optin_declined', 'root', 'Opt-in Declined Sponsor', 'gold', 1),
  ('sb_optin_hidden',   'root', 'Opt-in Hidden Sponsor',   'gold', 1),
  ('sb_optin_absent',   'root', 'Opt-in Absent Sponsor',   'gold', 1),
  ('sb_optin_toggle',   'root', 'Opt-in Toggle Sponsor',   'gold', 1),
  ('sb_optin_seeker',   'root', 'Opt-in Seeker Sponsor',   'gold', 1);

-- ── placements (ADR-019). Every one is on. What differs is who said yes.
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_optin_shown',    'sb_optin_shown',    'optin-on-evt',     'gold', 'organizer', 1, 1,    1),
  ('spl_optin_pending',  'sb_optin_pending',  'optin-on-evt',     'gold', 'organizer', 1, NULL, 1),
  ('spl_optin_declined', 'sb_optin_declined', 'optin-on-evt',     'gold', 'organizer', 1, 1,    0),
  ('spl_optin_hidden',   'sb_optin_hidden',   'optin-off-evt',    'gold', 'organizer', 1, 1,    1),
  ('spl_optin_absent',   'sb_optin_absent',   'optin-absent-evt', 'gold', 'organizer', 1, 1,    1),
  ('spl_optin_toggle',   'sb_optin_toggle',   'optin-toggle-evt', 'gold', 'organizer', 1, 1,    1);
