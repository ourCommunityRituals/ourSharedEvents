-- Corridor baseline and attendees for the SharedReport depth gate (Part of OSE-1751).
--
-- Apply (per-env), IMMEDIATELY before the T4f depth gate:
--   cd workers/oursharedevents
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../tests/ui/smoke/fixtures/corridor-baseline-smoke.sql
--
-- WHY A FILE OF ITS OWN, RUN RIGHT BEFORE THE GATE
-- The staging Worker has a 03:00 UTC cron. Its anon_id_returns step deletes attendee
-- rows with no pepper epoch (these have none), and its baseline refresh recomputes
-- every corridor bucket from real data, so either can replace what is seeded here.
-- Seeded with the other smoke fixtures, a CI run that straddled 03:00 had tens of
-- minutes for that to happen. Applied in the step just before T4f it has seconds.
-- The values cannot be made to survive the cron: the pepper epoch is derived from a
-- secret, so no SQL here can write a current-epoch attendee. The seed is idempotent
-- and is re-asserted on every run.
--
-- 112 people in 90 days and 109 in 30 days, in the bucket (day of week, hour) of this
-- event, the exact pair that named three people when the read path published each
-- window on its own. The report must publish 110 and 105 (rounded down to a multiple
-- of 5, and 5 apart), and the ratios must divide by those. 12 anonymous attendees give
-- this_event_count a published value, so the ratios exist and the check cannot pass on nulls.
-- The bucket is read off the event row, whatever date it was first seeded on.
INSERT OR REPLACE INTO corridor_density_baseline
  (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
SELECT LOWER(h3_res7), CAST(strftime('%w', start_date) AS INTEGER),
       CAST(strftime('%H', start_date) AS INTEGER), 109, 112, datetime('now')
  FROM events WHERE id = 'evt_smoke_tiers';

INSERT OR IGNORE INTO anon_id_returns
  (anon_id_hash, venue_id, first_seen_at, last_seen_at, return_count)
VALUES
  ('a1751000000000000000000000000001', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000002', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000003', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000004', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000005', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000006', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000007', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000008', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000009', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000010', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000011', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1),
  ('a1751000000000000000000000000012', 'evt_smoke_tiers', datetime('now','-7 days'), datetime('now','-7 days'), 1);
