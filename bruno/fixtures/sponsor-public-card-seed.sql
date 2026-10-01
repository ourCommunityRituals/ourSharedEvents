-- Public sponsor card + logo proxy — staging fixture for the T2 Bruno folder
-- "14. Public Sponsor Card & Logo" (OSE-1432).
--
-- Applied by CI before the Bruno contract run (api section):
--   npx wrangler d1 execute DB --env staging --remote \
--     --file ../../bruno/fixtures/sponsor-public-card-seed.sql
--
-- ONE SPONSOR PER CASE, fixed ids, so each Bruno request is a pure assert:
--
--   sb_pcard_onshow    on show, real logo           card 200, logo 200 (+ ?slot=sidebar falls back to it)
--   sb_pcard_nologo    on show, no logo             card 200 with the OSE default image, logo 404
--   sb_pcard_deadlogo  on show, logo on .invalid    logo 502 (RFC 2606: .invalid never resolves,
--                                                   yet it passes isBlockedLogoHost — a named host)
--   sb_pcard_pool      active, has a logo, NO placement   card 404, logo 404 (the gate, not the data)
--   sb_pcard_draft     accepted placement on a DRAFT event only   card 404
--
-- OWN EVENT, NOT test-event-001. The covenant block (section 11) asserts the
-- sponsor ORDER on test-event-001; extra on-show sponsors there would change it.
-- pcard-live-evt is status='active' (its public page renders, so its sponsors are
-- on show — SPONSOR_ON_SHOW_SQL) but is_published=0, so it stays off the landing
-- list and the attendee map. on-show deliberately ignores is_published.
--
-- THE REAL LOGO is the org's own GitHub avatar: public although the repos are
-- private, served as image/png with no redirect, ~1.5 KB, and it lives as long as
-- the org does. The proxy edge-caches a success for a day, so T2 asks GitHub at
-- most about once a day per colo.
--
-- The 429 case is NOT here: tripping the public-read limiter on shared staging
-- would 429 other tests from the same runner. It is covered in the workers pool
-- (tests/sponsor-public-card.spec.ts, "rate-limited").
--
-- data_class='synthetic' marks the events as CI test data. Idempotent:
-- delete-by-id (child -> parent), then insert (parent -> child). Never apply to
-- production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_impressions WHERE sponsor_id IN
  ('sb_pcard_onshow','sb_pcard_nologo','sb_pcard_deadlogo','sb_pcard_pool','sb_pcard_draft');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_pcard_onshow','sb_pcard_nologo','sb_pcard_deadlogo','sb_pcard_pool','sb_pcard_draft');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('sb_pcard_onshow','sb_pcard_nologo','sb_pcard_deadlogo','sb_pcard_pool','sb_pcard_draft');
DELETE FROM sponsor_business WHERE id IN
  ('sb_pcard_onshow','sb_pcard_nologo','sb_pcard_deadlogo','sb_pcard_pool','sb_pcard_draft');

-- ── events: one live-but-unlisted, one draft (brand 'root') ──
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class)
VALUES ('pcard-live-evt', 'root', 'Sponsor Card Fixture (live)', 'pcard-live-evt', 'active', 0,
        '2026-05-01', '2026-05-01', 'America/Chicago', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 0, data_class = 'synthetic';

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class)
VALUES ('pcard-draft-evt', 'root', 'Sponsor Card Fixture (draft)', 'pcard-draft-evt', 'draft', 0,
        '2026-05-01', '2026-05-01', 'America/Chicago', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'draft', is_published = 0, data_class = 'synthetic';

-- ── identity (sponsor_business) ──
-- The on-show sponsor has no website, so its public tap lands on this card.
INSERT INTO sponsor_business (id, brand_id, name, display_name, address_line, tier, is_active) VALUES
  ('sb_pcard_onshow',   'root', 'Public Card OnShow LLC', 'Public Card On Show', '1 Fixture Way, Chicago IL', 'gold', 1),
  ('sb_pcard_nologo',   'root', 'Public Card NoLogo',     NULL,                  NULL,                        'gold', 1),
  ('sb_pcard_deadlogo', 'root', 'Public Card DeadLogo',   NULL,                  NULL,                        'gold', 1),
  ('sb_pcard_pool',     'root', 'Public Card Pool',       NULL,                  NULL,                        'gold', 1),
  ('sb_pcard_draft',    'root', 'Public Card Draft',      NULL,                  NULL,                        'gold', 1);

-- ── logos (sponsor_asset, format 'logo' = the header logo) ──
INSERT INTO sponsor_asset (id, sponsor_business_id, format, url) VALUES
  ('sa_pcard_onshow_logo',   'sb_pcard_onshow',   'logo', 'https://avatars.githubusercontent.com/u/270526162?v=4&s=200'),
  ('sa_pcard_deadlogo_logo', 'sb_pcard_deadlogo', 'logo', 'https://logo.invalid/ose-1432.png'),
  ('sa_pcard_pool_logo',     'sb_pcard_pool',     'logo', 'https://avatars.githubusercontent.com/u/270526162?v=4&s=200');

-- ── placements, accepted by both sides (ADR-019) ──
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_pcard_onshow',   'sb_pcard_onshow',   'pcard-live-evt',  'gold', 'organizer', 1, 1, 1),
  ('spl_pcard_nologo',   'sb_pcard_nologo',   'pcard-live-evt',  'gold', 'organizer', 1, 1, 1),
  ('spl_pcard_deadlogo', 'sb_pcard_deadlogo', 'pcard-live-evt',  'gold', 'organizer', 1, 1, 1),
  ('spl_pcard_draft',    'sb_pcard_draft',    'pcard-draft-evt', 'gold', 'organizer', 1, 1, 1);
