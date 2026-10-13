-- A draft with no start time and no event type — staging fixture for the T2
-- Bruno request "OSE-1644 | PUT status | a draft with no start time or type is
-- refused" (folder 12 of bruno/ose-api).
--
-- Applied by CI before the Bruno contract run (api section), and by the
-- PR-local run (scripts/ci/run-local-vetting.sh):
--   npx wrangler d1 execute DB --env staging --remote \
--     --file ../../bruno/fixtures/core-values-draft-seed.sql
--
-- WHY A FIXTURE AND NOT test-event-001
-- An event cannot leave draft without a start time and an event type (409
-- CORE_VALUES_MISSING, lib/core-values.ts). The rule only applies to a move out
-- of draft or archived, and test-event-001 is active. This row is a draft that
-- has neither value, so the request is a pure assert: the PUT is refused before
-- any write and the row is the same after every run.
--
-- The upsert puts the row back to that state each time. The nightly draft
-- expiry archives a draft untouched for 30 days; without the reset this fixture
-- would one day be archived and the request would test a different edge.
--
-- is_published = 0: it is never on the list or the map, and as a draft it has no
-- public page. data_class = 'synthetic' marks it as CI test data.
-- Idempotent. Never apply to production.

INSERT INTO events (
  id, brand_id, title, slug, status,
  location, timezone, data_class, is_published
) VALUES (
  'bruno-core-values-draft',
  'root',
  'Bruno fixture: a draft with no start time or type',
  'bruno-core-values-draft',
  'draft',
  'Eagles Hall',
  'America/Chicago',
  'synthetic',
  0
)
ON CONFLICT(id) DO UPDATE SET
  status = 'draft',
  start_date = NULL,
  starts_at = NULL,
  event_type_id = NULL,
  venue_canonical_id = NULL,
  event_correlation_id = NULL,
  qr_verified = 0,
  is_published = 0,
  listed_from = NULL,
  data_class = 'synthetic',
  updated_at = datetime('now');
