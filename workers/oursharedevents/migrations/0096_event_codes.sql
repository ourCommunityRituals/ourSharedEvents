-- Migration 0096: event_codes (OSE-1684) — one short code per event.
--
-- Every public screen of an event answers at a short address built from one
-- six-character code (owner decisions 2026-10-09):
--   /e/<code> the event page (the share link; each open counts as a share)
--   /p/<code> the poster   /tv/<code> the TV
--   /r/<code> register     /c/<code>  check-in
-- An event id is 40 characters, which nobody types on a TV remote or reads
-- off a phone to a neighbour.
--
-- One code per event, minted at create (or on first ask for older events) and
-- kept. Uppercase from an alphabet without look-alikes (no 0/O, 1/I/L), read in
-- any case. The table is separate from shortlinks on purpose: shortlinks are
-- printed on posters and each one is counted and reported as a poster code.
-- It holds no person, no count and no time finer than creation.

CREATE TABLE IF NOT EXISTS event_codes (
  code       TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL UNIQUE REFERENCES events(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- share_opens_daily: opens of a shared short link (owner 2026-10-09: "never
-- who, only when" — and what). One number per event × screen × phase × UTC day,
-- incremented in place; never a row per open. No IP, no cookie or anonymous id,
-- no device, no referrer. Kept apart from shortlinks so a share of the poster
-- is never read as a scan of a poster's code.
--   screen: event (/e/), poster (/p/), register (/r/), checkin (/c/). The TV's
--           /tv/ is typed on the venue screen, not shared, and is not counted.
--   phase:  pre_event / event / post_event at the moment of the open, by the
--           rule the event page itself uses (eventPhaseOf).
-- Only real page loads of a public event count: not HEAD, not a link-preview
-- robot, not a draft.
CREATE TABLE IF NOT EXISTS share_opens_daily (
  event_id TEXT    NOT NULL REFERENCES events(id),
  screen   TEXT    NOT NULL CHECK (screen IN ('event', 'poster', 'register', 'checkin')),
  phase    TEXT    NOT NULL CHECK (phase IN ('pre_event', 'event', 'post_event')),
  day      TEXT    NOT NULL, -- UTC YYYY-MM-DD
  opens    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, screen, phase, day)
);
