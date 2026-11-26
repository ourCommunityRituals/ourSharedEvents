-- Migration 0122: vote integrity on a vote set (OSE-2234; OSE ADR-040
-- decision 6, amended 2026-11-26: flood detection, then "as stringent as you
-- can make it"; the owner's goal is that hosts and sponsors cannot push a
-- result up or down. What this migration does not stop is in ADR-040.)
--
-- Three columns on vote_sets. NO TRIGGERS: D1's remote migration runner splits
-- on every `;`, so a trigger body breaks `wrangler d1 migrations apply
-- --remote` (migration 0025), and migration-smoke.spec.ts holds the database
-- at zero triggers. What keeps these columns one-way and fixed is the T0 gate
-- votes-never-who (rule 5), over every SQL statement in the Worker, the
-- migrations, scripts/ and the workflows:
--
--   flood_seen   0 or 1: this night's result may be padded. It turns to 1,
--                once, at final, when more distinct voters took part than the
--                room size the host gave (src/lib/vote-results.ts
--                ROOM_CHECK_UPDATE). It is the only flag the public sees: the
--                voter page's final result then says it may be padded (owner,
--                decision card 2026-11-26, "Room check only, show room size").
--                Nothing sets it back to 0: the gate holds that every statement
--                sets it only to the literal 1.
--
--   burst_seen   0 or 1: the host's alarm. It turns to 1, once, when `/q`
--                mints more vote passes for the event's vote code in one
--                minute than a full room would (src/lib/vote-flood.ts). The
--                host sees it in the admin Voting card; it is never public,
--                because one browser re-scanning fast can trip it (CCR
--                2026-11-26). One-way like flood_seen, by the same gate rule.
--
--   room_size    The most people the room can hold, as the host says when
--                voting first opens (10 to 50000). Null on a set that never
--                opened, and on a set opened before this migration. It is
--                written once, by the first open, and never changes: the gate
--                holds that every statement writing it says `room_size IS
--                NULL`, so a host cannot raise it later to hide padding. Once
--                the set is final, the public result shows it, so the room can
--                see the number the host chose.
--
-- And two columns on venues, the ceiling a host cannot set (owner, decision
-- cards 2026-11-26: "yes" to a ceiling, and "Permit limit, else 500"):
--
--   room_kind    'indoor' or 'outdoor', or null (not set yet). Set only by a
--                platform admin (PUT /api/v2/admin/venues/:id/room-ceiling),
--                never by the venue's owner or an operator there.
--   room_cap     Indoors: the building's fire-marshal capacity (required).
--                Outdoors: the permit's attendance limit, or null when there is
--                none. 10 to 50000. Same writer.
--
--   The ceiling for a set's room size is the venue's room_cap, or 500 when the
--   event is at no venue, at a venue with no setting, or outdoors with no
--   permit limit (src/lib/vote-sets.ts ROOM_CEILING_SQL). A first open with a
--   room size above it is refused, in the same statement that opens.
--
-- Flags, not counts. No column holds a time, a count of votes or
-- voters, an address, a cookie, k or a pass. The minute a flood tripped is not
-- kept in the database: the write does not touch updated_at. (The one log line,
-- VOTE_FLOOD_SEEN with the event id, carries the log host's own time.) The
-- minute's count lives only in a Workers Rate Limiting binding keyed by the
-- event id, in memory. The room check compares the voter count with
-- room_size inside SQL, in the batch that makes the set final, and writes
-- only the flag: the count never reaches the Worker.
--
-- Who sees them: the host, in the admin Voting card (both flags and the room
-- size). Once the set is final, the voter page's result shows the room size
-- and, when flood_seen is 1, says the result may be padded. burst_seen is
-- never public. Never the display, display-config, or any public answer
-- before final (AGENTS.md invariants 2 and 5).
--
-- Time: no new time column.
--
-- Gates: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0),
-- workers/oursharedevents/tests/vote-flood.spec.ts and
-- workers/oursharedevents/tests/vote-integrity.spec.ts (workers pool).
--
-- Additive only: five columns (three on vote_sets, two on venues) with safe
-- defaults. No row is written or rewritten.
--
-- Rollback: revert the Worker and leave the columns. The older
-- Worker reads none of it and never updates any of these columns. See
-- ROLLBACK_PLAN.md, 0122.

ALTER TABLE vote_sets ADD COLUMN flood_seen INTEGER NOT NULL DEFAULT 0
  CHECK (flood_seen IN (0, 1));

ALTER TABLE vote_sets ADD COLUMN room_size INTEGER
  CHECK (room_size IS NULL OR (room_size BETWEEN 10 AND 50000));

ALTER TABLE venues ADD COLUMN room_kind TEXT
  CHECK (room_kind IS NULL OR room_kind IN ('indoor', 'outdoor'));

ALTER TABLE venues ADD COLUMN room_cap INTEGER
  CHECK (room_cap IS NULL OR (room_cap BETWEEN 10 AND 50000));

ALTER TABLE vote_sets ADD COLUMN burst_seen INTEGER NOT NULL DEFAULT 0
  CHECK (burst_seen IN (0, 1));
