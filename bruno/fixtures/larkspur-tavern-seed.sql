-- Larkspur practice neighborhood tavern — staging fixture (test account, owner 2026-11-27).
--
-- A practice account shaped like a neighborhood bar that runs its own nights:
-- monthly trivia and karaoke, live music, a pinball league and bocce on the
-- patio, a holiday craft fair, and charity nights with local causes. Same
-- pattern as the Meadowlark and Lakeside practice trees: stand-in names for
-- practice on staging only; no real business is named here. Which prospect it
-- stands in for is kept off this public repository.
--
--   larkspur-tavern          the bar itself (runs its seasonal specials)
--    ├── larkspur-nights     trivia, karaoke and live music
--    ├── larkspur-leagues    the pinball league and patio bocce
--    └── larkspur-giving     charity nights and donation drives
--
-- A member of larkspur-tavern reaches all four brands (lib/brand-tree.ts); a
-- member of one venture reaches only that venture. Who is a member is the
-- owner's STAGING_TESTERS setting, never this file.
--
-- Events are synthetic and unpublished: off the landing list and the attendee
-- map. They sit in the same area cell as the CI brand fixture, so no real
-- address is implied. No person, no coordinates.
--
-- Poster art: each event's cover is one of the owner's photographs in
-- stock/art/, copied by the CI step below this seed to a fixed key in the
-- staging uploads bucket (events/<id>/cover.jpg). The path is set here, so a
-- rerun writes the same row and the same object.
--
-- Practice traffic: two past nights carry poster scans, so their SharedReports
-- have numbers to show. Every poster hour is 5 or more, so nothing is withheld
-- by the under-5 floor except where noted. Scans are rows of the
-- scan_placement_events grain the report reads (OSE-1784); no person, no
-- agent hash.
--
-- Applied by CI on staging only, after T1 has run the migrations:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/larkspur-tavern-seed.sql
-- Idempotent: every row is an upsert keyed on its fixed id or brand.

INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('larkspur-nights', 'larkspur-tavern')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'larkspur-tavern';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('larkspur-leagues', 'larkspur-tavern')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'larkspur-tavern';
INSERT INTO brand_parents (brand_id, parent_brand_id) VALUES ('larkspur-giving', 'larkspur-tavern')
ON CONFLICT(brand_id) DO UPDATE SET parent_brand_id = 'larkspur-tavern';

-- The bar, a venue the parent owns. Every event below is held there.
INSERT INTO venues (id, brand_id, name) VALUES
  ('ven_1a45b0e7a7e000000000000000000001', 'larkspur-tavern', 'Larkspur Tavern')
ON CONFLICT(id) DO UPDATE SET brand_id = 'larkspur-tavern', name = 'Larkspur Tavern';

-- The events. One upsert shape for all: (id, brand, title, start, end, type, cover).
-- event_type_id is the nearest type in event_type_registry; gaps are listed in
-- the PR (no bingo, pinball league or charity-night type yet).
INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone,
                    data_class, h3_res7, host_venue_id, event_type_id, cover_image_url)
VALUES
  -- larkspur-nights
  ('lks-trivia-nov-2026', 'larkspur-nights', 'First Wednesday trivia (free, prizes for the top three teams)',
   'lks-trivia-nov-2026', 'active', 0, '2026-11-04', '2026-11-04', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-ent-trivia',
   '/api/v2/uploads/events/lks-trivia-nov-2026/cover.jpg'),
  ('lks-trivia-holiday-2027', 'larkspur-nights', 'Holiday movie trivia',
   'lks-trivia-holiday-2027', 'active', 0, '2027-12-15', '2027-12-15', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-ent-trivia',
   '/api/v2/uploads/events/lks-trivia-holiday-2027/cover.jpg'),
  ('lks-karaoke-2027', 'larkspur-nights', 'Monthly karaoke night',
   'lks-karaoke-2027', 'active', 0, '2027-01-20', '2027-01-20', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-ent-karaoke',
   '/api/v2/uploads/events/lks-karaoke-2027/cover.jpg'),
  ('lks-vinyl-night-2027', 'larkspur-nights', 'Vinyl DJ night: punk and new wave',
   'lks-vinyl-night-2027', 'active', 0, '2027-02-13', '2027-02-13', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-art-music',
   '/api/v2/uploads/events/lks-vinyl-night-2027/cover.jpg'),
  -- larkspur-leagues
  ('lks-pinball-league-2027', 'larkspur-leagues', 'Pinball league: spring season (2nd and 4th Thursdays)',
   'lks-pinball-league-2027', 'active', 0, '2027-03-11', '2027-05-27', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-ent-gamenight',
   '/api/v2/uploads/events/lks-pinball-league-2027/cover.jpg'),
  ('lks-bocce-patio-2027', 'larkspur-leagues', 'Patio bocce tournament',
   'lks-bocce-patio-2027', 'active', 0, '2027-06-12', '2027-06-12', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-rec-bocce',
   '/api/v2/uploads/events/lks-bocce-patio-2027/cover.jpg'),
  -- larkspur-giving
  ('lks-pantry-drive-2026', 'larkspur-giving', 'Fill the pantry: donation drive night',
   'lks-pantry-drive-2026', 'active', 0, '2026-10-16', '2026-10-16', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-vol-fooddrive',
   '/api/v2/uploads/events/lks-pantry-drive-2026/cover.jpg'),
  ('lks-keg-rescue-2027', 'larkspur-giving', 'Drain the keg for an animal rescue',
   'lks-keg-rescue-2027', 'active', 0, '2027-03-26', '2027-03-26', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-fnd-auction',
   '/api/v2/uploads/events/lks-keg-rescue-2027/cover.jpg'),
  -- larkspur-tavern (the bar's own seasonal specials)
  ('lks-craft-fair-2027', 'larkspur-tavern', 'Holiday craft fair: local makers and holiday movies',
   'lks-craft-fair-2027', 'active', 0, '2027-12-11', '2027-12-11', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-mkt-craft',
   '/api/v2/uploads/events/lks-craft-fair-2027/cover.jpg'),
  ('lks-sweater-bingo-2027', 'larkspur-tavern', 'Ugly sweater bingo',
   'lks-sweater-bingo-2027', 'active', 0, '2027-12-19', '2027-12-19', 'America/Chicago',
   'synthetic', '872664c1affffff', 'ven_1a45b0e7a7e000000000000000000001', 'etr-ent-gamenight',
   '/api/v2/uploads/events/lks-sweater-bingo-2027/cover.jpg')
ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, title = excluded.title,
  status = 'active', is_published = 0, start_date = excluded.start_date, end_date = excluded.end_date,
  data_class = 'synthetic', h3_res7 = '872664c1affffff',
  host_venue_id = 'ven_1a45b0e7a7e000000000000000000001', event_type_id = excluded.event_type_id,
  cover_image_url = excluded.cover_image_url, venue_canonical_id = NULL, event_correlation_id = NULL;

-- ── Practice traffic: two past nights, two posters each ─────────────────────
INSERT INTO poster_deployments (id, event_id, qr_token, placement_label) VALUES
  ('pd_lks_trivia_door',  'lks-trivia-nov-2026',   'fx-lks-trivia-door',  'Front door'),
  ('pd_lks_trivia_table', 'lks-trivia-nov-2026',   'fx-lks-trivia-table', 'Table tents'),
  ('pd_lks_pantry_door',  'lks-pantry-drive-2026', 'fx-lks-pantry-door',  'Front door'),
  ('pd_lks_pantry_board', 'lks-pantry-drive-2026', 'fx-lks-pantry-board', 'Neighborhood board')
ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, qr_token = excluded.qr_token,
  placement_label = excluded.placement_label;

-- Scan rows by (poster, hour, how many). A recursive counter writes n rows per
-- line with fixed ids, so a rerun replaces the same rows.
--   trivia  door  19:00 x14, 20:00 x6   table 19:00 x9, 20:00 x11, 21:00 x3 (withheld)
--   pantry  door  18:00 x8,  19:00 x12  board 18:00 x5
INSERT OR REPLACE INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
WITH RECURSIVE
  plan(pd, ev, bucket, n) AS (VALUES
    ('pd_lks_trivia_door',  'lks-trivia-nov-2026',   '2026-11-04T19:00', 14),
    ('pd_lks_trivia_door',  'lks-trivia-nov-2026',   '2026-11-04T20:00', 6),
    ('pd_lks_trivia_table', 'lks-trivia-nov-2026',   '2026-11-04T19:00', 9),
    ('pd_lks_trivia_table', 'lks-trivia-nov-2026',   '2026-11-04T20:00', 11),
    ('pd_lks_trivia_table', 'lks-trivia-nov-2026',   '2026-11-04T21:00', 3),
    ('pd_lks_pantry_door',  'lks-pantry-drive-2026', '2026-10-16T18:00', 8),
    ('pd_lks_pantry_door',  'lks-pantry-drive-2026', '2026-10-16T19:00', 12),
    ('pd_lks_pantry_board', 'lks-pantry-drive-2026', '2026-10-16T18:00', 5)),
  k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 20)
SELECT 'spe_' || substr(pd, 4) || '_' || substr(bucket, 12, 2) || '_' || i, ev, pd, bucket
  FROM plan JOIN k ON k.i <= plan.n;

-- When the report was materialized (the builder reads only MAX(computed_at)).
INSERT INTO scan_aggregates (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
VALUES ('sa-lks-trivia-nov-2026', 'lks-trivia-nov-2026', '2026-11-04', NULL, 43, 0, datetime('now')),
       ('sa-lks-pantry-drive-2026', 'lks-pantry-drive-2026', '2026-10-16', NULL, 25, 0, datetime('now'))
ON CONFLICT(id) DO UPDATE SET total_scans = excluded.total_scans, computed_at = datetime('now');

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1), as every
-- door in the Worker writes it. Run on every pass, so a row seeded before the
-- rule is corrected too. Gate: workers/oursharedevents/tests/seed-live-rows-verified.spec.ts
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id IN ('lks-trivia-nov-2026', 'lks-trivia-holiday-2027', 'lks-karaoke-2027', 'lks-vinyl-night-2027',
              'lks-pinball-league-2027', 'lks-bocce-patio-2027', 'lks-pantry-drive-2026',
              'lks-keg-rescue-2027', 'lks-craft-fair-2027', 'lks-sweater-bingo-2027');
