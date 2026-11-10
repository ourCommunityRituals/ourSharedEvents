-- Sponsor thumbnails on the event page: staging fixture for the T2 Bruno folder
-- "17. Sponsor thumbnails (OSE-1955)".
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/sponsor-thumb-seed.sql
--
-- The rule under test (owner, 2026-11-09): between the header and "What", a
-- sponsor with a logo is thumbnail art only (the compact logo, else the header
-- logo) through the same-origin proxy /api/v2/sponsors/<id>/logo?slot=sidebar,
-- with its title as alt. A sponsor with no logo is its name, plus its address.
--
-- ONE EVENT PER PHASE, plus one with the switch off (fixed ids, brand 'root',
-- is_published = 0 so none of them reaches the landing list or the map; an
-- active event's page renders whether listed or not):
--
--   thumb-pre-evt   three weeks out        the full sponsor set below
--   thumb-live-evt  started an hour ago    compact art + a name
--   thumb-post-evt  a week ago             compact art + a name
--   thumb-off-evt   switch off             one accepted logo sponsor, shown nowhere
--
-- ONE SPONSOR PER CASE (ORDER BY id on the page, so the order below is the page order):
--
--   sb_thumb_badurl     compact logo on 127.0.0.1 (fails the proxy's host rule)   art on the page, proxy 422
--   sb_thumb_compact    compact logo only, https website, display name             art, alt = display name
--   sb_thumb_creds      compact logo with a user and password in the URL           art on the page, proxy 422
--   sb_thumb_empty      a logo row whose URL is ''                                 its name, proxy 404
--   sb_thumb_header     header logo only                                           art (the fallback)
--   sb_thumb_jsweb      no logo, website 'javascript:alert(1)'                     its name, card link
--   sb_thumb_name       no logo, address line                                      its name + the address
--   sb_thumb_oneside    logo, the sponsor has not answered                         nowhere, proxy 404
--   sb_thumb_switchoff  logo, accepted by both, on thumb-off-evt                   nowhere, proxy 404
--   sb_thumb_xss        logo; markup in the name and in the display name           art, alt escaped
--
-- THE REAL LOGO is the org's GitHub avatar (as in sponsor-public-card-seed.sql):
-- public, image/png, no redirect, and edge-cached for a day by the proxy.
-- 127.0.0.1 and the credentials URL are rows written past the admin check on
-- purpose: they stand for legacy or hand-edited rows the proxy must refuse.
-- The 429 and the DB-read failure are not here (they would disturb shared
-- staging); they are covered in the workers pool,
-- workers/oursharedevents/tests/sponsor-thumb-flows.spec.ts.
--
-- data_class='synthetic' marks the events as CI test data. Idempotent:
-- delete-by-id (child -> parent), then insert (parent -> child), and the dates
-- move with each pass. Never apply to production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_displays WHERE sponsor_id IN
  ('sb_thumb_badurl','sb_thumb_compact','sb_thumb_creds','sb_thumb_empty','sb_thumb_header',
   'sb_thumb_jsweb','sb_thumb_name','sb_thumb_oneside','sb_thumb_switchoff','sb_thumb_xss');
DELETE FROM sponsor_asset WHERE sponsor_business_id IN
  ('sb_thumb_badurl','sb_thumb_compact','sb_thumb_creds','sb_thumb_empty','sb_thumb_header',
   'sb_thumb_jsweb','sb_thumb_name','sb_thumb_oneside','sb_thumb_switchoff','sb_thumb_xss');
DELETE FROM sponsor_placement WHERE sponsor_business_id IN
  ('sb_thumb_badurl','sb_thumb_compact','sb_thumb_creds','sb_thumb_empty','sb_thumb_header',
   'sb_thumb_jsweb','sb_thumb_name','sb_thumb_oneside','sb_thumb_switchoff','sb_thumb_xss');
DELETE FROM sponsor_business WHERE id IN
  ('sb_thumb_badurl','sb_thumb_compact','sb_thumb_creds','sb_thumb_empty','sb_thumb_header',
   'sb_thumb_jsweb','sb_thumb_name','sb_thumb_oneside','sb_thumb_switchoff','sb_thumb_xss');

-- ── events. ISO 8601 with a Z: the phase rule reads a bare SQLite datetime
-- ('YYYY-MM-DD HH:MM:SS') as a day, so an event an hour old was not yet live.
-- OSE-1615: a start is an input of the spine keys, so the upsert clears them.
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class)
VALUES
  ('thumb-pre-evt',  'root', 'Thumbnail Fixture (upcoming)', 'thumb-pre-evt',  'active', 0,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+21 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','+21 days','+3 hours'), 'America/Chicago', '{"useSponsors":true}', 'synthetic'),
  ('thumb-live-evt', 'root', 'Thumbnail Fixture (live)',     'thumb-live-evt', 'active', 0,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour'), strftime('%Y-%m-%dT%H:%M:%SZ','now','+6 hours'), NULL, '{"useSponsors":true}', 'synthetic'),
  ('thumb-post-evt', 'root', 'Thumbnail Fixture (past)',     'thumb-post-evt', 'active', 0,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days','+3 hours'), NULL, '{"useSponsors":true}', 'synthetic'),
  ('thumb-off-evt',  'root', 'Thumbnail Fixture (switch off)', 'thumb-off-evt', 'active', 0,
   strftime('%Y-%m-%dT%H:%M:%SZ','now','+21 days'), strftime('%Y-%m-%dT%H:%M:%SZ','now','+21 days','+3 hours'), 'America/Chicago', '{"useSponsors":false}', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, timezone = excluded.timezone,
  settings_json = excluded.settings_json, data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── identity (sponsor_business)
INSERT INTO sponsor_business (id, brand_id, name, display_name, website_url, address_line, tier, is_active) VALUES
  ('sb_thumb_badurl',    'root', 'Thumb Bad Url',          NULL,                         NULL,                  NULL,                    'gold', 1),
  ('sb_thumb_compact',   'root', 'Thumb Compact Co LLC',   'Thumb Compact',              'https://example.com', NULL,                    'gold', 1),
  ('sb_thumb_creds',     'root', 'Thumb Creds',            NULL,                         NULL,                  NULL,                    'gold', 1),
  ('sb_thumb_empty',     'root', 'Thumb Empty Logo',       NULL,                         NULL,                  NULL,                    'gold', 1),
  ('sb_thumb_header',    'root', 'Thumb Header Only',      NULL,                         NULL,                  NULL,                    'gold', 1),
  ('sb_thumb_jsweb',     'root', 'Thumb Js Site',          NULL,                         'javascript:alert(1)', NULL,                    'gold', 1),
  ('sb_thumb_name',      'root', 'Thumb Name Hardware',    NULL,                         NULL,                  '1 Fixture Way, Chicago IL', 'gold', 1),
  ('sb_thumb_oneside',   'root', 'Thumb One Side',         NULL,                         NULL,                  NULL,                    'gold', 1),
  ('sb_thumb_switchoff', 'root', 'Thumb Switch Off',       NULL,                         NULL,                  NULL,                    'gold', 1),
  ('sb_thumb_xss',       'root', 'Thumb "><script>alert(1)</script>', 'Thumb" onerror="alert(1)', NULL,          NULL,                    'gold', 1);

-- ── creative (sponsor_asset): 'logo' is the header logo, 'logo_compact' the sidebar logo.
INSERT INTO sponsor_asset (id, sponsor_business_id, format, url) VALUES
  ('sa_thumb_badurl',    'sb_thumb_badurl',    'logo_compact', 'https://127.0.0.1/ose-1955.png'),
  ('sa_thumb_compact',   'sb_thumb_compact',   'logo_compact', 'https://avatars.githubusercontent.com/u/270526162?v=4&s=96'),
  ('sa_thumb_creds',     'sb_thumb_creds',     'logo_compact', 'https://ose1955:hunter2@avatars.githubusercontent.com/u/270526162?v=4&s=97'),
  ('sa_thumb_empty',     'sb_thumb_empty',     'logo_compact', ''),
  ('sa_thumb_header',    'sb_thumb_header',    'logo',         'https://avatars.githubusercontent.com/u/270526162?v=4&s=200'),
  ('sa_thumb_oneside',   'sb_thumb_oneside',   'logo_compact', 'https://avatars.githubusercontent.com/u/270526162?v=4&s=96'),
  ('sa_thumb_switchoff', 'sb_thumb_switchoff', 'logo_compact', 'https://avatars.githubusercontent.com/u/270526162?v=4&s=96'),
  ('sa_thumb_xss',       'sb_thumb_xss',       'logo_compact', 'https://avatars.githubusercontent.com/u/270526162?v=4&s=96');

-- ── placements (ADR-019): on show means both sides said yes, on an event that opted in.
INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted) VALUES
  ('spl_thumb_badurl',       'sb_thumb_badurl',    'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_compact_pre',  'sb_thumb_compact',   'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_compact_live', 'sb_thumb_compact',   'thumb-live-evt', 'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_compact_post', 'sb_thumb_compact',   'thumb-post-evt', 'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_creds',        'sb_thumb_creds',     'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_empty',        'sb_thumb_empty',     'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_header',       'sb_thumb_header',    'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_jsweb',        'sb_thumb_jsweb',     'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_name_pre',     'sb_thumb_name',      'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_name_live',    'sb_thumb_name',      'thumb-live-evt', 'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_name_post',    'sb_thumb_name',      'thumb-post-evt', 'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_oneside',      'sb_thumb_oneside',   'thumb-pre-evt',  'gold', 'organizer', 1, NULL, 1),
  ('spl_thumb_switchoff',    'sb_thumb_switchoff', 'thumb-off-evt',  'gold', 'organizer', 1, 1,    1),
  ('spl_thumb_xss',          'sb_thumb_xss',       'thumb-pre-evt',  'gold', 'organizer', 1, 1,    1);
