-- Migration 0099: events.place_checked_at — when the event's place was last
-- looked up on the map (owner report 2026-10-11).
--
-- The landing's zip search lists an event only if it has a map cell (h3_res7),
-- and a cell comes only from lat/lon. Neither create form sent coordinates, so
-- on staging 3 of 174 live events had a cell and a search for 60406 missed
-- events at its own bars. Saving an event now looks its place up once
-- (src/lib/event-place.ts), and the nightly job looks up events saved before
-- this change.
--
-- This column is set whenever a lookup is answered, found or not. The nightly
-- job only takes rows where it is NULL, so a place that cannot be found is not
-- paid for again every night; editing the place text clears it and tries again.
-- NULL on every existing row. A venue's place is not about any person.

ALTER TABLE events ADD COLUMN place_checked_at TEXT;
