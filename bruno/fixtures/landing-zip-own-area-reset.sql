-- Landing zip own-area fixture: take its three events off the public lists again.
--
-- landing-zip-own-area-seed.sql publishes three synthetic events next to Mount
-- Greenwood (60655) so the Pages collection can read them. On stg, 60655 is the
-- seed's deliberately empty place (owner 2026-11-06: one staging site), so CI
-- unpublishes them as soon as the Bruno contract run ends, pass or fail:
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/landing-zip-own-area-reset.sql
--
-- Idempotent: an UPDATE by fixed id. Never apply to production.

UPDATE events
SET is_published = 0
WHERE id IN ('zip-own-mount-greenwood', 'zip-own-oak-lawn', 'zip-own-evergreen-park')
  AND data_class = 'synthetic';
