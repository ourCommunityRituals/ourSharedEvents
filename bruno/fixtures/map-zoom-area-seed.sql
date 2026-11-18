-- Zoomed landing map, place panels and map links (epic OSE-1880): staging fixture.
--
-- Ten published, synthetic events on the root brand in ONE res-7 area that the
-- stock data does not use (872664405ffffff), at three places far enough apart
-- to stay three dots (more than DOT_MERGE, lib/attendee-map.ts). Places are
-- numbered top to bottom, so north is 1:
--   place 1  map-zoom-a       41.6210,-87.8555  res9 892664405d7ffff  a business
--   place 2  map-zoom-b, -c   41.6119,-87.8657  res9 89266440547ffff  two events
--                                                                     on one block
--   place 3  map-zoom-d       41.6061,-87.8483  res9 89266440537ffff  3 days out
--            map-zoom-e .. -j                                         20 to 25 days out
-- Cells from h3-js latLngToCell at res 7 and res 9, as lib/h3-tagging.ts tags them.
--
-- Why ten: the landing leads with its hexagon map at 10 events (LIST_MAX,
-- lib/landing-area.ts), so this fixture alone makes the hexagon of its area
-- tappable, on a local D1 as on staging.
-- Why map-zoom-d is 3 days out: it is the only event the landing's "Next 7 days"
-- pill keeps, so the pill hides places 1 and 2 and keeps place 3.
--
-- Links (shortlinks, the poster's codes; lib/map-place-links.ts):
--   map-zoom-a  on the poster: public, register, check-in (never offered by the
--               map), tickets and donation (https, offered), menu with an http
--               target (refused); off the poster: website (not offered).
--   map-zoom-b  tickets (https, offered). Four buttons, so Share is alone on its row.
--   map-zoom-c .. map-zoom-j  none: Open event, Register, Share.
-- Share codes (event_codes): map-zoom-a MZPANA, map-zoom-b MZPANB; the others
-- have none, so their Share carries the event page itself.
--
-- Counts, set to known numbers on every run so "unchanged" can be read exactly.
-- Every code holds 5 taps or more, so the organizer's floored read
-- (GET /api/v2/admin/events/:id/pre-event-activity) shows the exact total:
--   map-zoom-a  taps 42 (9+5+5+7+6+5+5)   share opens 5
--   map-zoom-b  taps 8                    share opens 5
-- scripts/ci/map-counts-check.mjs reads the same numbers straight from D1.
--
-- Read by bruno/ose-pages/14. Landing map zoom (OSE-1886 OSE-1891 OSE-1896) and
-- by tests/e2e/3-flows/map-place-panel.spec.ts and
-- tests/e2e/2-pages/map-place-panel-layout.spec.ts. Applied by CI before each:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/map-zoom-area-seed.sql
--
-- Dates are relative (3 to 25 days out) so the rows never age off the landing.
-- Published only for the run: map-zoom-area-reset.sql unpublishes them after it.
-- Idempotent: upserts by fixed id or code. Never apply to production.

INSERT INTO events (id, brand_id, title, slug, status, is_published, location, where_address,
                    start_date, end_date, timezone, data_class, lat, lon, h3_res9, h3_res7,
                    place_kind)
VALUES
  ('map-zoom-a', 'root', 'Map Zoom Check (league night)', 'map-zoom-a',
   'active', 1, 'Zoom Check Lanes', NULL, date('now', '+10 days'), date('now', '+10 days'),
   'America/Chicago', 'synthetic', 41.6210, -87.8555, '892664405d7ffff', '872664405ffffff',
   'business'),
  ('map-zoom-b', 'root', 'Map Zoom Check (block party)', 'map-zoom-b',
   'active', 1, 'A hall', NULL, date('now', '+11 days'), date('now', '+11 days'),
   'America/Chicago', 'synthetic', 41.6119, -87.8657, '89266440547ffff', '872664405ffffff',
   'address'),
  ('map-zoom-c', 'root', 'Map Zoom Check (yard sale)', 'map-zoom-c',
   'active', 1, 'A yard', NULL, date('now', '+12 days'), date('now', '+12 days'),
   'America/Chicago', 'synthetic', 41.6119, -87.8657, '89266440547ffff', '872664405ffffff',
   'address'),
  ('map-zoom-d', 'root', 'Map Zoom Check (repair cafe)', 'map-zoom-d',
   'active', 1, 'A library room', NULL, date('now', '+3 days'), date('now', '+3 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address'),
  ('map-zoom-e', 'root', 'Map Zoom Check (story hour 1)', 'map-zoom-e',
   'active', 1, 'A library room', NULL, date('now', '+20 days'), date('now', '+20 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address'),
  ('map-zoom-f', 'root', 'Map Zoom Check (story hour 2)', 'map-zoom-f',
   'active', 1, 'A library room', NULL, date('now', '+21 days'), date('now', '+21 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address'),
  ('map-zoom-g', 'root', 'Map Zoom Check (story hour 3)', 'map-zoom-g',
   'active', 1, 'A library room', NULL, date('now', '+22 days'), date('now', '+22 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address'),
  ('map-zoom-h', 'root', 'Map Zoom Check (story hour 4)', 'map-zoom-h',
   'active', 1, 'A library room', NULL, date('now', '+23 days'), date('now', '+23 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address'),
  ('map-zoom-i', 'root', 'Map Zoom Check (story hour 5)', 'map-zoom-i',
   'active', 1, 'A library room', NULL, date('now', '+24 days'), date('now', '+24 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address'),
  ('map-zoom-j', 'root', 'Map Zoom Check (story hour 6)', 'map-zoom-j',
   'active', 1, 'A library room', NULL, date('now', '+25 days'), date('now', '+25 days'),
   'America/Chicago', 'synthetic', 41.6061, -87.8483, '89266440537ffff', '872664405ffffff',
   'address')
ON CONFLICT(id) DO UPDATE SET
  brand_id = excluded.brand_id, title = excluded.title, slug = excluded.slug, status = 'active',
  is_published = 1, location = excluded.location, where_address = excluded.where_address,
  start_date = excluded.start_date, end_date = excluded.end_date, data_class = 'synthetic',
  lat = excluded.lat, lon = excluded.lon, h3_res9 = excluded.h3_res9,
  h3_res7 = excluded.h3_res7, place_kind = excluded.place_kind,
  -- A spine-key input may have changed, so both keys are cleared (OSE-1615).
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO shortlinks (code, event_id, kind, target_url, poster_position, clicks)
VALUES
  ('mzPub1', 'map-zoom-a', 'public',   NULL,                                       1,    9),
  ('mzReg1', 'map-zoom-a', 'register', NULL,                                       2,    5),
  ('mzChk1', 'map-zoom-a', 'checkin',  NULL,                                       3,    5),
  ('mzTix1', 'map-zoom-a', 'tickets',  'https://tickets.map-zoom.example/a',       4,    7),
  ('mzDon1', 'map-zoom-a', 'donation', 'https://give.map-zoom.example/a',          5,    6),
  ('mzHtp1', 'map-zoom-a', 'menu',     'http://not-https.map-zoom.example/a',      6,    5),
  ('mzOff1', 'map-zoom-a', 'website',  'https://off-poster.map-zoom.example/a',    NULL, 5),
  ('mzTix2', 'map-zoom-b', 'tickets',  'https://tickets.map-zoom.example/b',       1,    8)
ON CONFLICT(code) DO UPDATE SET
  event_id = excluded.event_id, kind = excluded.kind, target_url = excluded.target_url,
  poster_position = excluded.poster_position, clicks = excluded.clicks, last_clicked_at = NULL;

DELETE FROM shortlink_click_daily
WHERE code IN ('mzPub1', 'mzReg1', 'mzChk1', 'mzTix1', 'mzDon1', 'mzHtp1', 'mzOff1', 'mzTix2');

DELETE FROM event_codes
WHERE event_id IN ('map-zoom-a', 'map-zoom-b', 'map-zoom-c', 'map-zoom-d',
                   'map-zoom-e', 'map-zoom-f', 'map-zoom-g', 'map-zoom-h', 'map-zoom-i', 'map-zoom-j')
   OR code IN ('MZPANA', 'MZPANB');
INSERT INTO event_codes (code, event_id) VALUES
  ('MZPANA', 'map-zoom-a'),
  ('MZPANB', 'map-zoom-b');

DELETE FROM share_opens_daily
WHERE event_id IN ('map-zoom-a', 'map-zoom-b', 'map-zoom-c', 'map-zoom-d',
                   'map-zoom-e', 'map-zoom-f', 'map-zoom-g', 'map-zoom-h', 'map-zoom-i', 'map-zoom-j');
INSERT INTO share_opens_daily (event_id, screen, phase, day, opens) VALUES
  ('map-zoom-a', 'event', 'pre_event', '2026-01-01', 5),
  ('map-zoom-b', 'event', 'pre_event', '2026-01-01', 5);

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1), as every
-- door in the Worker writes it. Run on every pass, so a row seeded before the
-- rule is corrected too. Gate: workers/oursharedevents/tests/seed-live-rows-verified.spec.ts
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id IN ('map-zoom-a', 'map-zoom-b', 'map-zoom-c', 'map-zoom-d', 'map-zoom-e', 'map-zoom-f', 'map-zoom-g', 'map-zoom-h', 'map-zoom-i', 'map-zoom-j');
