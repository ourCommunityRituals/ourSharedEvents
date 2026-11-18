-- room-burst-reset — remove everything room-burst-seed.sql and a burst run made.
--
-- Run before the seed (leftovers from a cancelled run) and after the burst
-- (always), through scripts/ci/d1-seed-staging.mjs. Staging only.
-- Children first, so no foreign key is left pointing at a deleted row.

DELETE FROM scan_placement_events WHERE event_id = 'room-burst-event';
DELETE FROM scan_node_returns WHERE event_id = 'room-burst-event';
DELETE FROM poster_deployments WHERE id = 'pd_room_burst';
DELETE FROM events WHERE id = 'room-burst-event';
