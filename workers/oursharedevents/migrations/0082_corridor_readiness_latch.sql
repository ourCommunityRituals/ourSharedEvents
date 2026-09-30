-- Migration 0082: corridor readiness latch (OCR VISION §6.2b, CCR PR 700)
--
-- §6.2b: a corridor's attendee map opens when the forward window (now → +90
-- days) holds at least CORRIDOR_READY_MIN_EVENTS (5) events IN THAT CORRIDOR
-- (H3 resolution 7), and once opened it stays open ("latches"). The latch was
-- deliberately left out of GET /api/v2/events/map because it needs persistent
-- state (events-map.ts: "the latch is persistent state that does not exist
-- yet"). This is that state.
--
-- One row per (brand, corridor cell), written once, the first time the nightly
-- job sees the corridor at or above the threshold. Never updated, never
-- deleted by the application: a latch is a one-way door.
--
-- Carries no identity: a brand id, a public res-7 cell (already in the public
-- event projection) and a timestamp. Nothing here is derived from attendees —
-- the counted unit is published events.

CREATE TABLE IF NOT EXISTS corridor_readiness_latch (
  brand_id   TEXT NOT NULL,
  h3_res7    TEXT NOT NULL,
  latched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (brand_id, h3_res7)
);
