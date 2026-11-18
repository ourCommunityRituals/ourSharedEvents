-- room-burst-seed — one synthetic event and one poster for the room burst
-- measurement on staging (scripts/ci/room-burst.mjs, .github/workflows/stg-room-burst.yml).
--
-- Applied by the workflow, staging only, through scripts/ci/d1-seed-staging.mjs
-- (--command, never --file). Never apply to production.
--
-- WHY ITS OWN EVENT
-- The burst writes up to a few hundred scan rows. On test-event-001 they would
-- add "people" that other staging checks read. This event exists only for the
-- run: room-burst-reset.sql deletes it, its poster and its scan rows before and
-- after every run.
--
-- The date is in the past, so no public list or map window shows the event.
-- The poster's cells are the Eagles Hall pair the trace poster uses
-- (trace-eagles-poster.sql); a scan reads only the poster's token and id.
-- Idempotent: upserts keyed on the ids.

INSERT INTO events (
  id, brand_id, title, slug, status,
  description, location, start_date, end_date, timezone, data_class
) VALUES (
  'room-burst-event',
  'root',
  'Room burst measurement (synthetic)',
  'room-burst-measurement',
  'active',
  'A staging-only test event. CI scans its poster from one address to measure the scan limiter.',
  'Staging only',
  '2026-05-01',
  '2026-05-01',
  'America/Chicago',
  'synthetic'
)
ON CONFLICT(id) DO UPDATE SET data_class = 'synthetic', status = 'active';

INSERT INTO poster_deployments (
  id, event_id, qr_token, placement_label, latitude, longitude,
  h3_res9, h3_res7, is_active
) VALUES (
  'pd_room_burst',
  'room-burst-event',
  'qrt_room_burst',
  'Room burst measurement poster (staging only)',
  41.6571,
  -87.6798,
  '89266454447ffff',
  '872664544ffffff',
  1
)
ON CONFLICT(id) DO UPDATE SET is_active = 1, updated_at = datetime('now');

-- OSE-2036: a live row is a verified row (active <=> qr_verified = 1), as every
-- door in the Worker writes it. Run on every pass, so a row seeded before the
-- rule is corrected too. Gate: workers/oursharedevents/tests/seed-live-rows-verified.spec.ts
UPDATE events SET qr_verified = CASE WHEN status = 'active' THEN 1 ELSE 0 END
 WHERE id IN ('room-burst-event');
