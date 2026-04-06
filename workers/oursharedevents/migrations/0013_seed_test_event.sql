-- Migration 0013: Seed a test event for staging verification
-- This ensures SELECT count(*) FROM events returns at least 1 row.
-- Safe to re-run: uses INSERT OR IGNORE (idempotent).

INSERT OR IGNORE INTO events (
  id, brand_id, title, slug, status,
  description, location, start_date, end_date, timezone
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
  'America/Chicago'
);
