-- Migration 0096: event_tv_codes (OSE-1684) — a short code to type on a TV.
--
-- An event's TV page is /events/<id>/tv, and the id is 40 characters, which
-- nobody can type with a TV remote. The organizer reads a six-character code
-- in admin and types /tv/<code> into the TV's browser instead.
--
-- One code per event, minted on first ask and kept. Codes are uppercase from
-- an alphabet without look-alike characters (no 0/O, 1/I/L). The table is
-- separate from shortlinks on purpose: shortlinks are counted, printed on
-- posters and reported, and a TV code is none of those. It holds no person,
-- no count and no time finer than its creation.

CREATE TABLE IF NOT EXISTS event_tv_codes (
  code       TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL UNIQUE REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
