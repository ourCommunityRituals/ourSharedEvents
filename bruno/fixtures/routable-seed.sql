-- Routable: staging fixture for the T2 Bruno Pages folder
-- "17. Routable (OSE-2196)".
--
-- Applied by CI before the Bruno contract run (pages section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/routable-seed.sql
--
-- The rule under test (owner, 2026-11-19): "Anything that is listed as private
-- or off map cannot be routed to." Directions are for listed places only
-- (isRoutable / eventRoutableSql, workers/oursharedevents/src/domain/event-state.ts).
--
--   rt-offmap-pre    active, off the map, three weeks out   no route at all
--   rt-offmap-live   active, off the map, on today          no route at all
--   rt-listed-pre    active, listed, three weeks out        keeps its Directions
--   rt-listed-live   active, listed, on today               keeps its Directions
--
-- Every event has exact coordinates and a street address, so a route that
-- leaks would show. The coordinates use digits nothing else on staging uses.
-- The off-map events sit in the zoomed map fixture's area (872664405ffffff,
-- map-zoom-area-seed.sql), so the folder can read that the zoomed map never
-- names them or routes to them. They are not listed, so they never add to that
-- area's count. The listed events have no cell, so they are on no area's map.
--
-- Dates are relative, so the rows never age. The upserts put every row back to
-- this state on each pass. data_class = 'synthetic' marks them as CI test data.
-- Idempotent. Never apply to production.

INSERT INTO events (id, brand_id, title, slug, status, is_published, listed_from,
                    location, where_address, lat, lon, h3_res7,
                    start_date, end_date, timezone, data_class)
VALUES
  ('rt-offmap-pre', 'root', 'Routable Check (off map, upcoming)', 'rt-offmap-pre',
   'active', 0, NULL, 'Routable Check Hall', '2196 West Unlisted Rd, Blue Island IL 60406',
   41.615273, -87.860418, '872664405ffffff',
   date('now', '+21 days'), date('now', '+21 days'), 'America/Chicago', 'synthetic'),
  ('rt-offmap-live', 'root', 'Routable Check (off map, today)', 'rt-offmap-live',
   'active', 0, NULL, 'Routable Check Hall', '2196 West Unlisted Rd, Blue Island IL 60406',
   41.615273, -87.860418, '872664405ffffff',
   date('now', '-1 day'), date('now', '+1 day'), 'America/Chicago', 'synthetic'),
  ('rt-listed-pre', 'root', 'Routable Check (listed, upcoming)', 'rt-listed-pre',
   'active', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'),
   'Routable Check Lanes', '2196 East Listed Ave, Blue Island IL 60406',
   41.638751, -87.684203, NULL,
   date('now', '+21 days'), date('now', '+21 days'), 'America/Chicago', 'synthetic'),
  ('rt-listed-live', 'root', 'Routable Check (listed, today)', 'rt-listed-live',
   'active', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'),
   'Routable Check Lanes', '2196 East Listed Ave, Blue Island IL 60406',
   41.638751, -87.684203, NULL,
   date('now', '-1 day'), date('now', '+1 day'), 'America/Chicago', 'synthetic')
ON CONFLICT(id) DO UPDATE SET
  status = 'active', is_published = excluded.is_published, listed_from = excluded.listed_from,
  location = excluded.location, where_address = excluded.where_address,
  lat = excluded.lat, lon = excluded.lon, h3_res9 = NULL, h3_res7 = excluded.h3_res7,
  start_date = excluded.start_date, end_date = excluded.end_date, starts_at = NULL,
  timezone = excluded.timezone, data_class = 'synthetic', attendance_mode = 'in_person',
  venue_canonical_id = NULL, event_correlation_id = NULL;
