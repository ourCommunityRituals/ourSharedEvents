-- Lakeside practice family report: staging fixture (Part of OSE-2241).
--
-- Owner, 2026-11-27: the parent company sees one report over every venture,
-- and shares it with a corporate sponsor as one link. This file gives the
-- Lakeside practice tree (lakeside-brand-tree-seed.sql, applied first) some
-- stand-in traffic so the report has something to show on staging:
--
--   lakeside-co        one tournament (Saturday)
--   lakeside-club      two nights at the Lakeside Clubhouse (Monday, Wednesday)
--   lakeside-semipro   one match night (Saturday)
--   lakeside-league    three bar league nights (Tuesday, Thursday)
--   lakeside-network   one streamed night, with 3 scans: under the floor, so it
--                      reads "Fewer than 5" and adds nothing to the total
--
-- Two stand-in sponsors both sides agreed to, and one the organizer has not
-- (it must never show). Every name is a stand-in; no real group, venue,
-- address or person. Map cells are res 7 (about 5 km²).
--
-- data_class = 'demo': practice data. A report link minted with
-- data_class 'all' shows it and says so; a production report never does.
-- Events are unpublished, so no public list or map shows them.
--
-- Applied by CI on staging only, after the brand tree:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/lakeside-family-report-seed.sql
-- Idempotent: the fixed-id child rows are cleared and written again. Never
-- apply to production.

-- ── idempotency: clear prior fixed-id rows (child -> parent) ──
DELETE FROM sponsor_displays WHERE id LIKE 'lkfr-sd-%';
DELETE FROM sponsor_placement WHERE id LIKE 'lkfr-sp-%';
DELETE FROM sponsor_business WHERE id IN ('lkfr-sponsor-a', 'lkfr-sponsor-b', 'lkfr-sponsor-pending');
DELETE FROM scan_placement_events WHERE id LIKE 'lkfr-scan-%';
DELETE FROM poster_deployments WHERE id LIKE 'lkfr-pd-%';

-- ── the events ──
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, settings_json, data_class, h3_res7, host_venue_id)
VALUES
  ('lkfr-co-1',      'lakeside-co',      'Holiday Tournament (practice)', 'lkfr-co-1',      'active', 0, '2027-01-16', '2027-01-16', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664575ffffff', NULL),
  ('lkfr-club-1',    'lakeside-club',    'Club League Night (practice)',  'lkfr-club-1',    'active', 0, '2027-01-06', '2027-01-06', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664575ffffff', 'ven_1a6e51de0c1b00000000000000000001'),
  ('lkfr-club-2',    'lakeside-club',    'Games Night (practice)',        'lkfr-club-2',    'active', 0, '2027-01-04', '2027-01-04', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664575ffffff', 'ven_1a6e51de0c1b00000000000000000001'),
  ('lkfr-semipro-1', 'lakeside-semipro', 'Match Night (practice)',        'lkfr-semipro-1', 'active', 0, '2027-01-09', '2027-01-09', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664cceffffff', NULL),
  ('lkfr-league-1',  'lakeside-league',  'Bar League Night (practice)',   'lkfr-league-1',  'active', 0, '2027-01-05', '2027-01-05', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664574ffffff', NULL),
  ('lkfr-league-2',  'lakeside-league',  'Bar League Night (practice)',   'lkfr-league-2',  'active', 0, '2027-01-07', '2027-01-07', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664544ffffff', NULL),
  ('lkfr-league-3',  'lakeside-league',  'Bar League Night (practice)',   'lkfr-league-3',  'active', 0, '2027-01-12', '2027-01-12', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664572ffffff', NULL),
  ('lkfr-network-1', 'lakeside-network', 'Streamed Night (practice)',     'lkfr-network-1', 'active', 0, '2027-01-09', '2027-01-09', 'America/Chicago', '{"useSponsors":true}', 'demo', '872664cc5ffffff', NULL)
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, status = 'active', is_published = 0,
  start_date = excluded.start_date, end_date = excluded.end_date, settings_json = excluded.settings_json,
  data_class = 'demo', h3_res7 = excluded.h3_res7, host_venue_id = excluded.host_venue_id,
  venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── one poster per event ──
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, is_active)
SELECT 'lkfr-pd-' || id, id, 'qrt_lkfr_' || id, 'Front door (practice)', 'venue', h3_res7, 1
  FROM events WHERE id LIKE 'lkfr-%';

-- ── scans: n per poster-hour, in poster-hours of 2026-12-01 (under the 100 cap) ──
INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 60),
plan(event_id, hour, n) AS (
  VALUES ('lkfr-co-1', 18, 42), ('lkfr-co-1', 19, 57),
         ('lkfr-club-1', 18, 31), ('lkfr-club-1', 19, 48), ('lkfr-club-1', 20, 26),
         ('lkfr-club-2', 19, 22),
         ('lkfr-semipro-1', 19, 55), ('lkfr-semipro-1', 20, 60),
         ('lkfr-league-1', 20, 18), ('lkfr-league-2', 20, 24), ('lkfr-league-3', 21, 13),
         ('lkfr-network-1', 20, 3)
)
SELECT 'lkfr-scan-' || p.event_id || '-' || p.hour || '-' || k.i, p.event_id, 'lkfr-pd-' || p.event_id,
       '2026-12-01T' || printf('%02d', p.hour) || ':00'
  FROM plan p JOIN k ON k.i <= p.n;

-- ── sponsors: two both sides agreed to, one the organizer has not ──
INSERT INTO sponsor_business (id, brand_id, name) VALUES
  ('lkfr-sponsor-a', 'lakeside-club', 'Practice Sponsor A'),
  ('lkfr-sponsor-b', 'lakeside-league', 'Practice Sponsor B'),
  ('lkfr-sponsor-pending', 'lakeside-club', 'Practice Sponsor Pending');

INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted, organizer_accepted)
VALUES
  ('lkfr-sp-a1', 'lkfr-sponsor-a', 'lkfr-club-1', 'standard', 'organizer', 1, 1, 1),
  ('lkfr-sp-a2', 'lkfr-sponsor-a', 'lkfr-club-2', 'standard', 'organizer', 1, 1, 1),
  ('lkfr-sp-b1', 'lkfr-sponsor-b', 'lkfr-league-1', 'standard', 'organizer', 1, 1, 1),
  ('lkfr-sp-b2', 'lkfr-sponsor-b', 'lkfr-league-2', 'standard', 'organizer', 1, 1, 1),
  ('lkfr-sp-p1', 'lkfr-sponsor-pending', 'lkfr-club-1', 'standard', 'organizer', 1, 1, 0);

INSERT INTO sponsor_displays (id, sponsor_id, event_id, surface, placement, event_type)
WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 80),
plan(sponsor_id, event_id, kind, n) AS (
  VALUES ('lkfr-sponsor-a', 'lkfr-club-1', 'display', 74), ('lkfr-sponsor-a', 'lkfr-club-1', 'click', 9),
         ('lkfr-sponsor-a', 'lkfr-club-2', 'display', 38),
         ('lkfr-sponsor-b', 'lkfr-league-1', 'display', 41), ('lkfr-sponsor-b', 'lkfr-league-1', 'click', 6),
         ('lkfr-sponsor-b', 'lkfr-league-2', 'display', 27),
         ('lkfr-sponsor-pending', 'lkfr-club-1', 'display', 50)
)
SELECT 'lkfr-sd-' || p.sponsor_id || '-' || p.event_id || '-' || p.kind || '-' || k.i,
       p.sponsor_id, p.event_id, 'public', 'strip', p.kind
  FROM plan p JOIN k ON k.i <= p.n;
