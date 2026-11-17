-- Sponsor line by covenant share: staging fixture for the T2 Bruno folder
-- "21. Sponsor line by covenant share (OSE-1901)".
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/sponsor-line-seed.sql
--
-- The rule under test (owner, 2026-11-09): a spot that shows ONE sponsor name by
-- an event's title picks the name by the covenant share. A higher paid level
-- comes up more often, up to its cap; locals keep at least 30%; the pick reads
-- the event id, the clock hour and the event's own consented sponsors.
--
-- ONE EVENT, fixed id, listed and upcoming (the list API names a sponsor only
-- for a listed event), with sponsors switched on:
--
--   covline-evt
--
-- FOUR SPONSORS THAT SHOW (brand 'root', accepted by both sides), one per level
-- and one local, so the hours of a 100-hour cycle are 40 / 18 / 6 / 36:
--
--   covline-top     title   not local   40 hours
--   covline-mid     gold    not local   18 hours
--   covline-base    bronze  not local    6 hours
--   covline-local   bronze  local       36 hours
--
-- THREE THAT MUST NEVER SHOW, each at the top level, so that counting any one of
-- them would change every sponsor's hours and the folder would read a wrong name:
--
--   covline-pending    the sponsor has not answered
--   covline-declined   the organizer said no
--   covline-inactive   the placement is switched off
--
-- The ids, levels and local flags of the four are held to the code and to the
-- folder's literal cycle by workers/oursharedevents/tests/sponsor-line-pick.spec.ts
-- ("staging fixture"). Change one here and that test goes red.
--
-- The upserts put every row back to this state on each pass. data_class =
-- 'synthetic' marks the event as CI test data. Idempotent. Never apply to
-- production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_displays WHERE sponsor_id IN
  ('covline-top','covline-mid','covline-base','covline-local','covline-pending','covline-declined','covline-inactive');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('covline-top','covline-mid','covline-base','covline-local','covline-pending','covline-declined','covline-inactive');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('covline-top','covline-mid','covline-base','covline-local','covline-pending','covline-declined','covline-inactive');
DELETE FROM sponsor_business WHERE id IN
  ('covline-top','covline-mid','covline-base','covline-local','covline-pending','covline-declined','covline-inactive');

-- ── the event (brand 'root'). The start is three weeks out on every pass, so it
-- never becomes a past event. OSE-1615: the start is an input of the spine keys,
-- so the upsert clears them.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES ('covline-evt', 'root', 'Covenant Line Fixture', 'covline-evt', 'active', 1,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 1, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── sponsors ──
INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES
  ('covline-top', 'root', 'Covline Top Level', 'title', 1),
  ('covline-mid', 'root', 'Covline Middle', 'gold', 1),
  ('covline-base', 'root', 'Covline Base', 'bronze', 1),
  ('covline-local', 'root', 'Covline Local', 'bronze', 1),
  ('covline-pending', 'root', 'Covline Pending', 'title', 1),
  ('covline-declined', 'root', 'Covline Declined', 'title', 1),
  ('covline-inactive', 'root', 'Covline Inactive', 'title', 1);

-- ── placements: level, local flag, then the consent columns ──
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, locality_band, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('pl-covline-top', 'covline-top', 'covline-evt', 'title', 0, 'organizer', 1, 1, 1),
  ('pl-covline-mid', 'covline-mid', 'covline-evt', 'gold', 0, 'organizer', 1, 1, 1),
  ('pl-covline-base', 'covline-base', 'covline-evt', 'bronze', 0, 'organizer', 1, 1, 1),
  ('pl-covline-local', 'covline-local', 'covline-evt', 'bronze', 1, 'organizer', 1, 1, 1),
  ('pl-covline-pending', 'covline-pending', 'covline-evt', 'title', 0, 'organizer', 1, NULL, 1),
  ('pl-covline-declined', 'covline-declined', 'covline-evt', 'title', 0, 'organizer', 1, 1, 0),
  ('pl-covline-inactive', 'covline-inactive', 'covline-evt', 'title', 0, 'organizer', 0, 1, 1);
