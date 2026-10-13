-- Migration 0104: events.venue_canonical_id and events.event_correlation_id,
-- the two spine keys (OSE-1615). That the keys exist, live on this table and
-- what each stands for are the PO's decisions of 2026-10-04
-- (.telemetry/tracking-plan.md, Decisions 1 and 2). The exact rule, v1, was
-- pinned by the builder on 2026-10-12 and is marked there for the PO to confirm.
--
--   venue_canonical_id    one physical venue, however an organizer types it
--   event_correlation_id  one event: this venue, this event type, this night
--
-- Every measure already joins through event_id, so two columns here give all of
-- them a venue and an event identity that holds over time. Both are about
-- places and events, never people.
--
-- The server computes both (src/lib/spine-keys.ts) from the venue name, the
-- res-7 cell, the event type code and the start. No coordinate enters either
-- hash. A client never supplies them: create and update answer 400.
--
-- NULL on every existing row. A hash cannot be computed in SQL, so this
-- migration writes no row: the nightly check (runSpineKeyCheck,
-- src/lib/spine-keys-store.ts) computes every row's keys and writes them where
-- they differ from what is stored, at most 200 writes a night. So rows saved
-- before this migration get their keys over the nights that follow, not at
-- once. A row that lacks a venue name, a map cell, a type or a start keeps
-- NULL: a key is never computed from part of its inputs.
--
-- Rows saved before this migration may be keyed less well than later ones:
-- their venue text was typed before anything depended on it, and a past event
-- with no map cell is never looked up again, so it keeps no key.
--
-- A statement that changes location, h3_res7, event_type_id, start_date,
-- timezone or starts_at must also set both keys to NULL. A later migration or
-- seed that forgets is corrected by the nightly check, and counted in its
-- `corrected` figure.
--
-- Rollback: revert the Worker and leave the columns (ROLLBACK_PLAN.md, 0104).
--
-- The indexes serve the joins the keys exist for (all the events at one venue,
-- all the rows of one event night).

ALTER TABLE events ADD COLUMN venue_canonical_id TEXT;
ALTER TABLE events ADD COLUMN event_correlation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_venue_canonical ON events(venue_canonical_id);
CREATE INDEX IF NOT EXISTS idx_events_event_correlation ON events(event_correlation_id);
