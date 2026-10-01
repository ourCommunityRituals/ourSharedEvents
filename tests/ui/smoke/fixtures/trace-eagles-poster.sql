-- trace-eagles-poster — the Eagles Hall test poster on staging (OSE-616, QR Path rung 5).
--
-- Apply (staging only; test-event-001.sql first, this hangs off that event):
--   cd workers/oursharedevents
--   npx wrangler d1 execute DB --env staging --remote \
--     --file ../../tests/ui/smoke/fixtures/trace-eagles-poster.sql
--
-- WHY THIS EXISTS
-- scripts/ci/trace-scan-staging.sh scans this poster on staging and confirms the
-- scan was recorded with the poster's place. Eagles Hall (Blue Island IL) is the
-- canonical H3 fixture everywhere else in the suite:
--   lat 41.6571, lon -87.6798 -> res9 89266454447ffff (physical: poster + live scans)
--                              -> res7 872664544ffffff (the corridor)
-- The cells are written here as the values h3-js returns for that point (the
-- same pair tests/events-h3-wiring.spec.ts asserts), because SQL cannot compute
-- them. A fixed qr_token lets the script find the poster without an admin call.
--
-- Idempotent: an upsert keyed on the id. Never apply to production.

INSERT INTO poster_deployments (
  id, event_id, qr_token, placement_label, latitude, longitude,
  h3_res9, h3_res7, is_active
) VALUES (
  'pd_trace_eagles_616',
  'test-event-001',
  'qrt_trace_eagles_616',
  'OSE-616 trace — Eagles Hall front door',
  41.6571,
  -87.6798,
  '89266454447ffff',
  '872664544ffffff',
  1
)
ON CONFLICT(id) DO UPDATE SET
  is_active = 1,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  h3_res9 = excluded.h3_res9,
  h3_res7 = excluded.h3_res7,
  updated_at = datetime('now');
