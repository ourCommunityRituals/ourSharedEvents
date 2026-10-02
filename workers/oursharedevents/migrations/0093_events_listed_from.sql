-- Migration 0093: events.listed_from — the publish grace window (PO 2026-10-02).
--
-- Moving an event into `active` stores now + PUBLISH_GRACE_MINUTES here. Until
-- that instant passes the event is live by link but stays off the list, map,
-- sitemap, sponsor discovery and corridor count, so an Undo leaves no public
-- trace (src/lib/publish-grace.ts). NULL means listed as soon as published:
-- every existing row, and events created directly as active.

ALTER TABLE events ADD COLUMN listed_from TEXT;
