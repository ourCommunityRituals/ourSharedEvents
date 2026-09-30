-- Migration 0080: shortlinks.poster_position (OSE-1357 part 2)
--
-- A poster now carries MORE THAN ONE code, each pointing at a target the
-- organizer picks (event page, anonymous check-in, donate, sign-up/tickets/
-- other https link, an ourWKRP link). Every code is still one `shortlinks` row
-- — one /s/ routing link per (event, kind) — so this adds only the ORDER:
--
--   poster_position = 0      the event page (always first)
--   poster_position = 1..N   the organizer's chosen codes, in their order
--   poster_position IS NULL  not on the poster
--
-- Taking a code OFF the poster sets NULL; the row is never deleted, so a poster
-- already printed with that code keeps working. Clicks stay a bare counter
-- (clicks + last_clicked_at) — this column carries no location and no person.
-- Events that never saved a code list keep NULL everywhere and fall back to the
-- original Event page + typed-link slots. Nullable + additive.

ALTER TABLE shortlinks ADD COLUMN poster_position INTEGER;
