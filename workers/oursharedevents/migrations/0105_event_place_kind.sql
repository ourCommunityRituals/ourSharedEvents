-- Migration 0105: events.place_kind — what kind of spot the event's place is
-- (owner, 2026-11-09).
--
-- The landing map zooms into one area (H3 res 7) and draws a dot per event. The
-- owner's rule for where the dot sits: a business or landmark gets its exact
-- point; anything else (a street address, a building, an intersection, which can
-- be someone's home) sits at the centre of its res-9 cell, about one block.
--
-- 'business' when the place lookup (src/lib/event-place.ts) named an
-- establishment or point of interest; 'address' for any other spot it kept.
-- NULL on every existing row, and whenever no lookup placed the event: a NULL
-- is drawn at the block centre, like 'address'. The nightly job fills it for
-- events that already have a place, without moving their coordinates.

ALTER TABLE events ADD COLUMN place_kind TEXT;
