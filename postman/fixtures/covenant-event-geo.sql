-- OSE-891 — geo-tag the test-event-001 covenant fixture on the target D1.
--
-- Apply before running the T3 Newman OSE-INV5 Sponsor Covenant (ose-api.json §11):
--   cd workers/oursharedevents
--   npx wrangler d1 execute DB --env staging --remote --file ../../postman/fixtures/covenant-event-geo.sql
--
-- WHY THIS IS A FIXTURE, NOT A MIGRATION
-- test-event-001 (seeded by tests/ui/smoke/fixtures/test-event-001.sql, OSE-1419)
-- carries NO coordinates, so events.h3_res7 is NULL. The Local Sponsor Covenant
-- derives is_local server-side by matching a sponsor's h3_res7 CORRIDOR cell to
-- the EVENT's (handlers/sponsors.ts handleAdminCreateSponsor); with a null event
-- cell EVERY sponsor resolves is_local=0 and the covenant's locality dimension
-- is untestable at L3.
--
-- This is deliberately a standalone fixture rather than a numbered migration:
-- a new migrations/NNNN file would force REQUIRED_DB_MIGRATION (schema-guard.ts,
-- CI-enforced by scripts/check-schema-guard.mjs) to bump, and the guard 503s every
-- route until the bound D1 is at that version — coupling this test fixture to the
-- deferred prod D1 migrate (A5/OSE-802). Fixture geo is test data; it belongs in
-- the data layer, applied per-env like tests/ui/smoke/fixtures/smoke-events.sql.
--
-- Coordinates: Beverly Arts Center, 2407 W 111th St, Chicago IL 60655 (matches the
-- seed's "Beverly Arts Center, Chicago IL" location). NCR cells computed via
-- h3-js — the same lib + resolutions the worker uses in lib/h3-tagging.ts:
--   res9 (NODE) = 89266457533ffff    res7 (CORRIDOR) = 872664575ffffff
--
-- Idempotent: a plain UPDATE keyed by the primary id; safe to re-run.
UPDATE events
SET lat = 41.6903,
    lon = -87.6768,
    h3_res9 = '89266457533ffff',
    h3_res7 = '872664575ffffff'
WHERE id = 'test-event-001';
