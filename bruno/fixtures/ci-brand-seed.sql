-- CI brand — staging fixture for the CI service actor (OSE-1800).
--
-- The CI service actor (a Cloudflare Access service token accepted as
-- `svc:<common_name>`, auth/admin.ts serviceActorName) is a BRAND admin of the
-- one brand in CI_SERVICE_ACTOR_BRAND ("ci-brand" in wrangler.toml staging),
-- never a platform admin. Folder 6 of the Bruno API collection reads this
-- brand's event while staging is on Free and asserts the brand-admin view is
-- capped (who × plan, OSE-682): no per-day series, no per-poster counts, the
-- paid report refused.
--
-- Applied by CI before the Bruno contract run (api section):
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../bruno/fixtures/ci-brand-seed.sql
--
-- OWN BRAND AND EVENT: nothing else reads ci-brand. The event is active but
-- unpublished (off the landing list and the attendee map), synthetic. Six scans
-- in one poster-hour clear the under-5 floor, so the paid case has something to
-- withhold. Idempotent: every row is an upsert by fixed id.

INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date, timezone, data_class, h3_res7)
VALUES ('ci-free-evt', 'ci-brand', 'CI Brand Fixture (Free)', 'ci-free-evt', 'active', 0,
        '2099-06-01', '2099-06-01', 'America/Chicago', 'synthetic', '872664c1affffff')
ON CONFLICT(id) DO UPDATE SET brand_id = 'ci-brand', status = 'active', is_published = 0,
  data_class = 'synthetic', h3_res7 = '872664c1affffff',
  -- A spine-key input changed, so both keys are cleared (OSE-1615): the nightly check rebuilds them.
  venue_canonical_id = NULL, event_correlation_id = NULL;

INSERT INTO poster_deployments (id, event_id, qr_token, placement_label, placement_type, h3_res7, is_active)
VALUES ('ci-pd-1', 'ci-free-evt', 'qrt_ci_pd_1', 'CI front door', 'venue', '872664c1affffff', 1)
ON CONFLICT(id) DO UPDATE SET event_id = 'ci-free-evt', h3_res7 = '872664c1affffff', is_active = 1;

INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES
  ('ci-scan-1', 'ci-free-evt', 'ci-pd-1', '2026-05-07T19:00'),
  ('ci-scan-2', 'ci-free-evt', 'ci-pd-1', '2026-05-07T19:00'),
  ('ci-scan-3', 'ci-free-evt', 'ci-pd-1', '2026-05-07T19:00'),
  ('ci-scan-4', 'ci-free-evt', 'ci-pd-1', '2026-05-07T19:00'),
  ('ci-scan-5', 'ci-free-evt', 'ci-pd-1', '2026-05-07T19:00'),
  ('ci-scan-6', 'ci-free-evt', 'ci-pd-1', '2026-05-07T19:00')
ON CONFLICT(id) DO NOTHING;
