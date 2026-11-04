-- Report plan cap — staging fixture for the T2 Bruno folder
-- "6. Feature Flags — Admin" (OSE-682: a plan without the paid report reads at Local).
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/report-plan-cap-seed.sql
--
-- One event with a materialized scan signal, so the signed-link read returns 200
-- instead of 409 MATERIALIZATION_PENDING. Folder 6 sets the Free plan, mints an
-- organizer (bar_owner) link for this event, and asserts the read is capped at
-- Local (no map, no poster attribution, upgrade → mid) before it restores the
-- plan staging was on.
--
-- OWN EVENT, NOT test-event-001: nothing else reads plancap-evt, and it stays off
-- the landing list and the attendee map (is_published = 0). 20 distinct scanners
-- clears the under-5 floor. Idempotent: both rows are upserts.

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class)
VALUES ('plancap-evt', 'root', 'Report Plan Cap Fixture', 'plancap-evt', 'active', 0,
        '2026-05-07', '2026-05-07', 'America/Chicago', 'synthetic')
ON CONFLICT(id) DO UPDATE SET status = 'active', is_published = 0, data_class = 'synthetic';

INSERT INTO scan_aggregates (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
VALUES ('sa-plancap-evt', 'plancap-evt', '2026-05-07', NULL, 60, 20, datetime('now'))
ON CONFLICT(id) DO UPDATE SET total_scans = 60, distinct_agent_hashes = 20, computed_at = datetime('now');
