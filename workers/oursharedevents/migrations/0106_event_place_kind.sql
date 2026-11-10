-- Migration 0106: events.place_kind — what kind of spot the event's place is
-- (owner, 2026-11-09). Numbered 0105 on its branch; main took 0105 first
-- (0105_sponsor_header_block.sql), so it merged as 0106.
--
-- The landing map zooms into one area (H3 res 7) and draws a dot per place. The
-- owner's rule for where the dot sits, merged with "place, not person" (epic
-- OSE-1880): every place at the centre of its res-9 cell, about one block, a
-- business too. The kind only says how the dot is marked: a business or
-- landmark is drawn solid and named in its panel, never pinpointed; anything
-- else (a street address, a building, an intersection, which can be someone's
-- home) is a pale dashed dot.
--
-- 'business' when the place lookup (src/lib/event-place.ts) named an
-- establishment or point of interest; 'address' for any other spot it kept.
-- NULL on every existing row, and whenever no lookup placed the event: a NULL
-- is drawn like 'address'. The nightly job fills it for events that already
-- have a place, without moving their coordinates.

ALTER TABLE events ADD COLUMN place_kind TEXT;
