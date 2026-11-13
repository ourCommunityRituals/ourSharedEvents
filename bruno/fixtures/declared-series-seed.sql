-- A series an organizer declares: staging fixture for the T2 Bruno folder
-- "18. Declared series (OSE-2014)". OSE ADR-028.
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/declared-series-seed.sql
--
-- OWN BRANDS, never 'root': nothing else reads 'series-ci' or 'series-ci-other',
-- so the stock seed's pinned totals are untouched. Every event is unpublished
-- (off the landing list and the attendee map) and data_class='synthetic'.
--
--   series-ci-anchor-evt   brand series-ci        an online room: NO location. The folder
--                                                 declares the series on it.
--   series-ci-try1-evt     brand series-ci        an earlier try of the same room
--   series-ci-try2-evt     brand series-ci        an earlier try of the same room
--   series-ci-sugg-evt     brand series-ci        the anchor of two detector suggestions
--   series-ci-other-evt    brand series-ci-other  another brand's event: it must never join
--
--   evtsrs_ci_suggest      pending, on series-ci-sugg-evt   the folder confirms it
--   evtsrs_ci_decline      pending, on series-ci-sugg-evt   the folder rejects it
--
-- The folder writes: it declares a series, attaches, detaches, confirms and
-- rejects. This file puts every row back to its starting state on each pass
-- (events off every series, the declared series gone, both suggestions pending
-- again), so a run that stopped half way cannot leave the next one wrong.
-- Idempotent. Never apply to production.

-- ── back to the start: events off every series, then the series themselves ──
UPDATE events SET series_id = NULL WHERE id LIKE 'series-ci-%';
DELETE FROM event_series WHERE venue_id LIKE 'series-ci-%';

INSERT INTO events (id, brand_id, title, slug, status, is_published, location, start_date, end_date, timezone, data_class)
VALUES
  ('series-ci-anchor-evt', 'series-ci', 'Series Fixture (anchor, online)', 'series-ci-anchor-evt', 'active', 0, NULL,
   '2026-09-21', '2026-09-21', 'America/Chicago', 'synthetic'),
  ('series-ci-try1-evt', 'series-ci', 'Series Fixture (first try)', 'series-ci-try1-evt', 'active', 0, NULL,
   '2026-09-07', '2026-09-07', 'America/Chicago', 'synthetic'),
  ('series-ci-try2-evt', 'series-ci', 'Series Fixture (second try)', 'series-ci-try2-evt', 'active', 0, NULL,
   '2026-09-14', '2026-09-14', 'America/Chicago', 'synthetic'),
  ('series-ci-sugg-evt', 'series-ci', 'Series Fixture (suggested)', 'series-ci-sugg-evt', 'active', 0, 'CI Hall',
   '2026-09-10', '2026-09-10', 'America/Chicago', 'synthetic'),
  ('series-ci-other-evt', 'series-ci-other', 'Series Fixture (another brand)', 'series-ci-other-evt', 'active', 0, NULL,
   '2026-09-14', '2026-09-14', 'America/Chicago', 'synthetic')
ON CONFLICT(id) DO UPDATE SET
  brand_id = excluded.brand_id, status = 'active', is_published = 0, location = excluded.location,
  start_date = excluded.start_date, end_date = excluded.end_date, timezone = excluded.timezone,
  data_class = 'synthetic', series_id = NULL,
  -- A spine-key input changed, so both keys are cleared (OSE-1615): the nightly check rebuilds them.
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO event_series (id, venue_id, series_name, cadence, day_of_week, hour_of_day, state, detected_at)
VALUES
  ('evtsrs_ci_suggest', 'series-ci-sugg-evt', 'Thursday 7 PM (auto-detected)', 'weekly', 4, 19, 'pending', '2026-10-01T00:00:00.000Z'),
  ('evtsrs_ci_decline', 'series-ci-sugg-evt', 'Thursday 9 PM (auto-detected)', 'weekly', 4, 21, 'pending', '2026-10-01T00:00:00.000Z');
