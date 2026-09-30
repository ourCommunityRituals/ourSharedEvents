-- Migration 0086: remove migration 0013's test event where nothing uses it (OSE-1419)
--
-- 0013_seed_test_event.sql inserts test-event-001 ('Community Game Night') into
-- every database, production included. Migrations cannot read WORKER_ENV, so a
-- fresh production D1 would list a test event on /events and in /sitemap.xml.
-- It did exactly that until the founder deleted it by hand on 2026-09-29.
--
-- 0013 stays as it is: it is already applied everywhere, and d1_migrations
-- history must not change. This migration undoes its row instead, but only when
-- no other row points at the event:
--   * fresh DB (local, CI, a rebuilt production): the row is unreferenced -> removed.
--   * production today: the row is already gone -> no-op.
--   * staging: fixtures hang shortlinks, placements and impressions off it -> kept.
-- The NOT EXISTS list is every foreign key to events(id) (tables read from
-- sqlite_master on staging, 2026-09-30; anon_id_returns and event_series key it
-- as venue_id). D1 enforces foreign keys, so a missed
-- table would make this DELETE fail loudly rather than orphan a row.
--
-- Staging CI no longer relies on 0013 for the event: it seeds it explicitly and
-- fails loudly if it cannot (tests/ui/smoke/fixtures/test-event-001.sql).
-- Idempotent: a second run finds nothing to delete.

DELETE FROM events
WHERE id = 'test-event-001'
  AND NOT EXISTS (SELECT 1 FROM poster_deployments    WHERE event_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM scan_aggregates       WHERE event_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM shortlinks            WHERE event_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM anon_id_returns       WHERE venue_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM event_series          WHERE venue_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM scan_placement_events WHERE event_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM scan_node_returns     WHERE event_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM sponsor_placement     WHERE event_id = 'test-event-001')
  AND NOT EXISTS (SELECT 1 FROM sponsor_impressions   WHERE event_id = 'test-event-001');
