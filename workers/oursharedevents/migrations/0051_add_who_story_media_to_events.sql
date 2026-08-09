-- OSE-664 — admin authoring of the rich 5W / WHO content.
--
-- The plain 5W text fields (what_short/who_host/why_purpose/how_details/
-- where_address, migration 0029) fill the funnel's skeleton. OSE-664 adds the
-- RICH supply side the WHO card (the pre-event conversion engine, OSE-655)
-- consumes: the host/artist story plus media references.
--
--   who_story       host/artist story — rich text, the WHO conversion engine.
--                   Stored raw; escaped on render (esc()) — the XSS wall is the
--                   output escape, so an authored <script> cannot execute.
--   who_image_url   WHO media reference (host/artist image). http(s) only —
--                   any other scheme (javascript:/data:/…) is rejected at the
--                   API layer (validateLogoUrl) so it never reaches this column.
--   what_video_url  WHAT video reference. Same http(s)-only input rule. A
--                   reference/link-out, never an embed (mirrors the OSE-660 maps
--                   link-out stance — no third-party frame in the funnel).
--
-- Additive, all nullable: existing rows read NULL and simply render no story/
-- media until an organizer authors one. No PII — this is event content only.

ALTER TABLE events ADD COLUMN who_story      TEXT;
ALTER TABLE events ADD COLUMN who_image_url  TEXT;
ALTER TABLE events ADD COLUMN what_video_url TEXT;
