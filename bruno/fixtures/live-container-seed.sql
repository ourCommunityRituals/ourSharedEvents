-- Live container: staging fixture for the T2 Bruno folder
-- "26. Live container (OSE-2144)".
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/live-container-seed.sql
--
-- The rule under test (owner, 2026-11-18): nothing is more live than its
-- container. A public read of anything that belongs to an event answers only
-- while the event is Published (status = 'active'). Two written exceptions: an
-- archived event that was listed keeps its recap sponsor strip, and an
-- archived event's SharedReport opens with a valid signed link.
--
-- ONE EVENT PER STATE, fixed ids, all opted in to sponsors, so the only thing
-- that differs is the status:
--
--   lc-live-evt      active, unlisted          the control: everything answers
--   lc-draft-evt     draft, unlisted           nothing answers
--   lc-ready-evt     ready, unlisted           nothing answers
--   lc-archived-evt  archived, never listed    nothing answers
--   lc-recap-evt     archived, was listed      only the recap strip (names) and
--                                              the SharedReport answer
--
-- ONE SPONSOR PER EVENT (brand 'root'), accepted by both sides, with a logo URL
-- the logo proxy refuses without fetching (a served logo answers 422, a refused
-- one 404), and ONE QR CODE PER EVENT.
--
-- The upserts put every row back to this state on each pass. data_class =
-- 'synthetic' marks the events as CI test data. Idempotent. Never apply to
-- production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_displays WHERE event_id IN
  ('lc-live-evt','lc-draft-evt','lc-ready-evt','lc-archived-evt','lc-recap-evt');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_lc_live','sb_lc_draft','sb_lc_ready','sb_lc_archived','sb_lc_recap');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('sb_lc_live','sb_lc_draft','sb_lc_ready','sb_lc_archived','sb_lc_recap');
DELETE FROM sponsor_business WHERE id IN
  ('sb_lc_live','sb_lc_draft','sb_lc_ready','sb_lc_archived','sb_lc_recap');

-- ── events (brand 'root'). Upcoming events start three weeks out on every pass;
-- the archived ones ended three days ago. OSE-1615: the start is an input of
-- the spine keys, so the upsert clears them.
INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from, start_date, end_date, timezone, settings_json, data_class)
VALUES ('lc-live-evt', 'root', 'Live Container Fixture (live)', 'lc-live-evt', 'active', 0, NULL,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 0, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from, start_date, end_date, timezone, settings_json, data_class)
VALUES ('lc-draft-evt', 'root', 'Live Container Fixture (draft)', 'lc-draft-evt', 'draft', 0, NULL,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'draft', is_published = 0, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from, start_date, end_date, timezone, settings_json, data_class)
VALUES ('lc-ready-evt', 'root', 'Live Container Fixture (ready)', 'lc-ready-evt', 'ready', 0, NULL,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'ready', is_published = 0, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from, start_date, end_date, timezone, settings_json, data_class)
VALUES ('lc-archived-evt', 'root', 'Live Container Fixture (archived)', 'lc-archived-evt', 'archived', 0, NULL,
        date('now','-3 days'), date('now','-3 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'archived', is_published = 0, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from, start_date, end_date, timezone, settings_json, data_class)
VALUES ('lc-recap-evt', 'root', 'Live Container Fixture (recap)', 'lc-recap-evt', 'archived', 1, date('now','-30 days'),
        date('now','-3 days'), date('now','-3 days'), 'America/Chicago', '{"useSponsors":true}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'archived', is_published = 1, listed_from = excluded.listed_from,
  start_date = excluded.start_date, end_date = excluded.end_date,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── identity (sponsor_business) ──
INSERT INTO sponsor_business (id, brand_id, name, tier, is_active) VALUES
  ('sb_lc_live',     'root', 'Live Container Live Sponsor',     'gold', 1),
  ('sb_lc_draft',    'root', 'Live Container Draft Sponsor',    'gold', 1),
  ('sb_lc_ready',    'root', 'Live Container Ready Sponsor',    'gold', 1),
  ('sb_lc_archived', 'root', 'Live Container Archived Sponsor', 'gold', 1),
  ('sb_lc_recap',    'root', 'Live Container Recap Sponsor',    'gold', 1);

-- ── placements: every one on and accepted by both sides (ADR-019) ──
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_lc_live',     'sb_lc_live',     'lc-live-evt',     'gold', 'organizer', 1, 1, 1),
  ('spl_lc_draft',    'sb_lc_draft',    'lc-draft-evt',    'gold', 'organizer', 1, 1, 1),
  ('spl_lc_ready',    'sb_lc_ready',    'lc-ready-evt',    'gold', 'organizer', 1, 1, 1),
  ('spl_lc_archived', 'sb_lc_archived', 'lc-archived-evt', 'gold', 'organizer', 1, 1, 1),
  ('spl_lc_recap',    'sb_lc_recap',    'lc-recap-evt',    'gold', 'organizer', 1, 1, 1);

-- ── a logo each, at a host the proxy refuses before any fetch (422 when served) ──
INSERT INTO sponsor_asset (id, sponsor_business_id, format, url) VALUES
  ('sa_lc_live',     'sb_lc_live',     'logo', 'https://127.0.0.1/ose-2144.png'),
  ('sa_lc_draft',    'sb_lc_draft',    'logo', 'https://127.0.0.1/ose-2144.png'),
  ('sa_lc_ready',    'sb_lc_ready',    'logo', 'https://127.0.0.1/ose-2144.png'),
  ('sa_lc_archived', 'sb_lc_archived', 'logo', 'https://127.0.0.1/ose-2144.png'),
  ('sa_lc_recap',    'sb_lc_recap',    'logo', 'https://127.0.0.1/ose-2144.png');

-- ── one QR code per event ──
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, is_active)
VALUES ('lc-pd-live', 'lc-live-evt', 'qrt_lc_live', 'Live container wall', 'venue', 1)
ON CONFLICT(id) DO UPDATE SET event_id = 'lc-live-evt', qr_token = 'qrt_lc_live', is_active = 1;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, is_active)
VALUES ('lc-pd-draft', 'lc-draft-evt', 'qrt_lc_draft', 'Live container wall', 'venue', 1)
ON CONFLICT(id) DO UPDATE SET event_id = 'lc-draft-evt', qr_token = 'qrt_lc_draft', is_active = 1;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, is_active)
VALUES ('lc-pd-ready', 'lc-ready-evt', 'qrt_lc_ready', 'Live container wall', 'venue', 1)
ON CONFLICT(id) DO UPDATE SET event_id = 'lc-ready-evt', qr_token = 'qrt_lc_ready', is_active = 1;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, is_active)
VALUES ('lc-pd-archived', 'lc-archived-evt', 'qrt_lc_archived', 'Live container wall', 'venue', 1)
ON CONFLICT(id) DO UPDATE SET event_id = 'lc-archived-evt', qr_token = 'qrt_lc_archived', is_active = 1;
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, is_active)
VALUES ('lc-pd-recap', 'lc-recap-evt', 'qrt_lc_recap', 'Live container wall', 'venue', 1)
ON CONFLICT(id) DO UPDATE SET event_id = 'lc-recap-evt', qr_token = 'qrt_lc_recap', is_active = 1;
