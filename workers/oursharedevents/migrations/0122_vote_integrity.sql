-- Migration 0122: vote integrity on a vote set (OSE-2234; OSE ADR-040
-- decision 6, amended 2026-11-26: flood detection, then "as stringent as you
-- can make it", with hosts and sponsors unable to push a result up or down).
--
-- Two columns and two triggers on vote_sets:
--
--   flood_seen   0 or 1: this night's voting looked padded. It turns to 1,
--                once, when `/q` mints more vote passes for the event's vote
--                code in one minute than a full room would
--                (src/lib/vote-flood.ts), or when, at final, more distinct
--                voters took part than the room size the host gave
--                (src/lib/vote-results.ts ROOM_CHECK_UPDATE). Nothing sets it
--                back to 0: the trigger vote_sets_flood_one_way refuses it,
--                whatever code runs, and the gate votes-never-who holds that
--                the code sets it only to the literal 1.
--
--   room_size    The most people the room can hold, as the host says when
--                voting first opens (10 to 50000). Null on a set that never
--                opened, and on a set opened before this migration. It is
--                written once, by the first open, and never changes: the
--                trigger vote_sets_room_size_fixed refuses any change once it
--                is set, so a host cannot raise it later to hide padding.
--
-- A flag, not a count. Neither column holds a time, a count of votes or
-- voters, an address, a cookie, k or a pass. The minute a flood tripped is not
-- kept in the database: the write does not touch updated_at. (The one log line,
-- VOTE_FLOOD_SEEN with the event id, carries the log host's own time.) The
-- minute's count lives only in a Workers Rate Limiting binding keyed by the
-- event id, in memory. The room check compares the voter count with
-- room_size inside SQL, in the batch that makes the set final, and writes
-- only the flag: the count never reaches the Worker.
--
-- Who sees them: the host, in the admin Voting card (the flag and the room
-- size), and, once the set is final, the voter page's result says the result
-- may be padded. Never the display, display-config, or any public answer
-- before final (AGENTS.md invariants 2 and 5). The room size is not public.
--
-- Time: no new time column.
--
-- Gates: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0),
-- workers/oursharedevents/tests/vote-flood.spec.ts and
-- workers/oursharedevents/tests/vote-integrity.spec.ts (workers pool).
--
-- Additive only: two columns with safe defaults and two triggers. No row is
-- written or rewritten.
--
-- Rollback: revert the Worker and leave the columns and triggers. The older
-- Worker reads none of it and never updates either column. See
-- ROLLBACK_PLAN.md, 0122.

ALTER TABLE vote_sets ADD COLUMN flood_seen INTEGER NOT NULL DEFAULT 0
  CHECK (flood_seen IN (0, 1));

ALTER TABLE vote_sets ADD COLUMN room_size INTEGER
  CHECK (room_size IS NULL OR (room_size BETWEEN 10 AND 50000));

CREATE TRIGGER IF NOT EXISTS vote_sets_flood_one_way
  BEFORE UPDATE OF flood_seen ON vote_sets
  WHEN OLD.flood_seen = 1 AND NEW.flood_seen IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'vote_sets.flood_seen is one-way');
END;

CREATE TRIGGER IF NOT EXISTS vote_sets_room_size_fixed
  BEFORE UPDATE OF room_size ON vote_sets
  WHEN OLD.room_size IS NOT NULL AND NEW.room_size IS NOT OLD.room_size
BEGIN
  SELECT RAISE(ABORT, 'vote_sets.room_size is fixed once set');
END;
