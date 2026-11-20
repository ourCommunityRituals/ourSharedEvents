-- Routable: take the OSE-2196 fixture's listed events off the list again after
-- the T2 Pages run, pass or fail (staging is one site with stock data, owner
-- 2026-11-06). routable-seed.sql lists them again on the next run.
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/routable-reset.sql
-- Idempotent. Never apply to production.

UPDATE events SET is_published = 0
 WHERE id IN ('rt-listed-pre', 'rt-listed-live', 'rt-grace-pre');
