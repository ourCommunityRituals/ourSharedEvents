-- Online or in person: staging fixture for the T2 Bruno folder
-- "18. Online or in person (OSE-2012)" and tests/playwright/attendance-mode.spec.ts.
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/attendance-mode-seed.sql
--
-- The rule under test (owner, 2026-11-12): every event says how people take
-- part. An online event has no place and is link only: off /events, the landing
-- page and the sitemap, while its own page, its codes and the brand API still
-- answer. Needs migration 0108 (events.attendance_mode).
--
-- ONE EVENT PER CASE, fixed ids (brand 'root'), so each request is a pure assert:
--
--   mode-online-evt    online, LISTED, upcoming   the brand API returns it; /events, the
--                                                 landing page and the sitemap do not
--   mode-inperson-evt  in person, unlisted        its page says "In person"
--   mode-both-evt      both, unlisted             its page says "Online and in person"
--   mode-toggle-evt    in person, unlisted        the folder turns it online and back
--
-- Only the online event is listed, on purpose. A listed event that the rule
-- hides changes nothing on the root pages, so the stock seed's pinned totals
-- (stock/totals.json) stay as they are. The other three are unlisted, like
-- optin-absent-evt, and carry no map cell.
--
-- MODEsl is the online event's /s code, with its count put back to 0, so the
-- folder can see one click land.
--
-- The upserts put every row back to this state on each pass, so a run that
-- stopped half way through the toggle requests cannot leave the next one wrong.
-- data_class='synthetic' marks the events as CI test data. Idempotent. Never
-- apply to production.

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone,
                    location, where_address, attendance_mode, data_class)
VALUES ('mode-online-evt', 'root', 'Mode Fixture (online)', 'mode-online-evt', 'active', 1,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago',
        NULL, NULL, 'online', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', title = excluded.title, status = 'active',
  is_published = 1, listed_from = NULL,
  start_date = excluded.start_date, end_date = excluded.end_date,
  location = NULL, where_address = NULL, lat = NULL, lon = NULL, h3_res9 = NULL, h3_res7 = NULL,
  place_kind = NULL, place_checked_at = NULL,
  attendance_mode = 'online', data_class = 'synthetic', updated_at = datetime('now'),
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone,
                    location, attendance_mode, data_class)
VALUES ('mode-inperson-evt', 'root', 'Mode Fixture (in person)', 'mode-inperson-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago',
        'Mode Fixture Hall', 'in_person', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', title = excluded.title, status = 'active',
  is_published = 0, start_date = excluded.start_date, end_date = excluded.end_date,
  location = 'Mode Fixture Hall', where_address = NULL,
  attendance_mode = 'in_person', data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone,
                    location, attendance_mode, data_class)
VALUES ('mode-both-evt', 'root', 'Mode Fixture (both)', 'mode-both-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago',
        'Mode Fixture Hall', 'both', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', title = excluded.title, status = 'active',
  is_published = 0, start_date = excluded.start_date, end_date = excluded.end_date,
  location = 'Mode Fixture Hall', where_address = NULL,
  attendance_mode = 'both', data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone,
                    location, attendance_mode, data_class)
VALUES ('mode-toggle-evt', 'root', 'Mode Fixture (toggle)', 'mode-toggle-evt', 'active', 0,
        date('now','+21 days'), date('now','+21 days'), 'America/Chicago',
        'Mode Fixture Hall', 'in_person', 'synthetic')
ON CONFLICT(id) DO UPDATE SET brand_id = 'root', title = excluded.title, status = 'active',
  is_published = 0, start_date = excluded.start_date, end_date = excluded.end_date,
  location = 'Mode Fixture Hall', where_address = NULL, lat = NULL, lon = NULL,
  h3_res9 = NULL, h3_res7 = NULL, place_kind = NULL, place_checked_at = NULL,
  attendance_mode = 'in_person', data_class = 'synthetic',
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
VALUES ('MODEsl', 'mode-online-evt', 'public', 0, datetime('now'))
ON CONFLICT(code) DO UPDATE SET event_id = 'mode-online-evt', kind = 'public', clicks = 0;
