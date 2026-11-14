-- Zoomed map fixture: take its ten events off the public lists again.
--
-- map-zoom-area-seed.sql publishes ten synthetic events in one area
-- (872664405ffffff) so the Pages collection and the T4 map specs can read them.
-- Staging is one site with stock data (owner 2026-11-06), so CI unpublishes them
-- as soon as the run that reads them ends, pass or fail:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/map-zoom-area-reset.sql
--
-- Their links, share codes and seeded counts stay as rows; no page offers them
-- while the events are unpublished, and the next seed sets them again.
-- Idempotent: an UPDATE by fixed id. Never apply to production.

UPDATE events
SET is_published = 0
WHERE id IN ('map-zoom-a', 'map-zoom-b', 'map-zoom-c', 'map-zoom-d',
             'map-zoom-e', 'map-zoom-f', 'map-zoom-g', 'map-zoom-h', 'map-zoom-i', 'map-zoom-j')
  AND data_class = 'synthetic';
