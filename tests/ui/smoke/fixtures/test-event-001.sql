-- test-event-001 — the shared staging test event, seeded on purpose (OSE-1419).
--
-- Apply (staging, and before any fixture that hangs rows off this event):
--   cd workers/oursharedevents
--   npx wrangler d1 execute DB --env staging --remote \
--     --file ../../tests/ui/smoke/fixtures/test-event-001.sql
--
-- WHY THIS EXISTS
-- Migration 0013 used to be the only thing that created test-event-001, and it
-- ran on every database, production included. Migration 0086 now removes the row
-- wherever nothing references it, so a fresh database (and production) starts
-- with zero events. Every consumer that needs the event (the T3 Bruno covenant,
-- pages and sharedreport collections, the T4 form E2E, the local launch-story
-- fixture) now gets it from this file instead, and the CI step that applies it
-- is NOT continue-on-error: a missing event fails at the seed, by name, instead
-- of as a confusing 404 three steps later.
--
-- Same id, title and venue as 0013, so every existing assertion keeps its target.
-- data_class='synthetic' marks it as CI test data (events CHECK, migration 0052).
-- Idempotent: INSERT OR IGNORE never overwrites the row staging already holds.
-- Never apply to production.

INSERT OR IGNORE INTO events (
  id, brand_id, title, slug, status,
  description, location, start_date, end_date, timezone, data_class
) VALUES (
  'test-event-001',
  'root',
  'Community Game Night',
  'community-game-night',
  'active',
  'Weekly game night on Chicago''s Southside. Board games, card games, and good company.',
  'Beverly Arts Center, Chicago IL',
  '2026-05-01',
  '2026-05-01',
  'America/Chicago',
  'synthetic'
);
