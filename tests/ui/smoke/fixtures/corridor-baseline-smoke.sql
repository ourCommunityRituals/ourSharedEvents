-- Corridor baseline and poster scans for the SharedReport depth gate (Part of OSE-1751).
--
-- Apply (per-env), IMMEDIATELY before the T4f depth gate:
--   cd workers/oursharedevents
--   node ../../scripts/ci/d1-seed-staging.mjs DB ../../tests/ui/smoke/fixtures/corridor-baseline-smoke.sql
--
-- WHY A FILE OF ITS OWN, RUN RIGHT BEFORE THE GATE
-- The staging Worker has a 03:00 UTC cron (its anon_id_returns step is retired by
-- OSE-2214, so only the baseline refresh matters now). The refresh recomputes
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
-- of 5, and 5 apart), and the ratios must divide by those. 12 poster scans give
-- this_event_count a published value, so the ratios exist and the check cannot pass on nulls.
-- The bucket is read off the event row, whatever date it was first seeded on.
INSERT OR REPLACE INTO corridor_density_baseline
  (corridor_id, bucket_dow, bucket_hour, window_30d_count, window_90d_count, computed_at)
SELECT LOWER(h3_res7), CAST(strftime('%w', start_date) AS INTEGER),
       CAST(strftime('%H', start_date) AS INTEGER), 109, 112, datetime('now')
  FROM events WHERE id = 'evt_smoke_tiers';

-- OSE-2214: the scan figure is the sum of the event's poster hours, not attendee
-- rows (OSE-1784 made it so; the 12 anon_id_returns rows seeded here before no
-- longer reach the report). 12 scans of one poster in one hour publish 10
-- (floor 5, rounded down to a multiple of 5), so this_event_count has a value
-- and the ratios exist. The cron does not delete poster scans.
INSERT OR IGNORE INTO poster_deployments (id, event_id, qr_token, placement_label)
VALUES ('poster-smoke-1751', 'evt_smoke_tiers', 'qr-smoke-1751', 'Depth gate poster');

INSERT OR IGNORE INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket)
SELECT 'scan-1751-01', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-02', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-03', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-04', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-05', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-06', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-07', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-08', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-09', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-10', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-11', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers' UNION ALL
SELECT 'scan-1751-12', id, 'poster-smoke-1751', strftime('%Y-%m-%dT%H:00', start_date) FROM events WHERE id = 'evt_smoke_tiers';
