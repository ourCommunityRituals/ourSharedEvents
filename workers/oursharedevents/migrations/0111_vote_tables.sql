-- Migration 0111: the vote tables (OSE-2125, S2 of OSE-1193, OSE ADR-040
-- decisions 1 to 4, accepted by the owner on 2026-11-18).
--
-- An anonymous vote is a counter on an object, never a row about a voter.
-- Six tables, all in DB (the anonymous side), never in FORMS_DB:
--
--   vote_sets          one per event (UNIQUE event_id). It holds objects of one
--                      kind and is played by objects or by teams (played_by),
--                      fixed when it first opens (S3). It has a one-way final
--                      flag, a void flag with its reason, the pepper epoch
--                      stamped once at the first open, three counters with no
--                      object and no time, and the two secret numbers:
--                        secret_margin       T, 5 to 9, the lead a winner needs
--                        secret_floor        V, 10 to 14, the voters needed
--                      No route returns them and no log line carries them. A
--                      CHECK forces both to null on a final set (decision 7).
--   votable_objects    what can be voted on: a song or a stall. The kind list
--                      lives in src/lib/votes.ts (VOTABLE_KINDS), not in a
--                      CHECK. The label refuses email- and phone-shaped text in
--                      code. A team is an opaque group_id. OSE holds no name of
--                      any kind for a team or a player.
--   vote_tallies       two counters per object: up and "not for me". The row is
--                      made with the object. Deleted 30 days after final.
--   vote_receipts      (object_id, receipt): one vote per browser per object.
--   vote_participants  (set_id, receipt): one marker per browser per set.
--   vote_team_markers  (team_id, marker): one marker per browser per team, so a
--                      team's total counts a voter once (Q16).
--
-- The three marker tables hold a keyed value only: HMAC under a server-only
-- subkey of the per-event voter key k, with a different HKDF label for each
-- table (src/lib/votes.ts). No column holds k, a cookie value or a scan key.
-- A marker carries no side and no time. A CHECK accepts only 64 lowercase hex
-- characters, so an `anon_` cookie or an `snk1_` scan key cannot be stored.
-- The marker tables are WITHOUT ROWID: a rowid would number the rows in the
-- order they were written, and that order would line up a voter's receipts.
-- Receipts, participant markers and team markers are deleted at final.
--
-- Time: no column finer than the hour, except votable_objects.closes_at, which
-- names a song's window (2:16 or 7:11 long), never a voter (decision 3). The
-- created_at and updated_at defaults are the hour, in the same format as
-- hourStamp (lib/scan-buffer.ts). final_at has no default. The writer binds
-- hourStamp. The marker and tally tables have no time column at all.
--
-- Gates: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0),
-- tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts (T0),
-- workers/oursharedevents/tests/vote-tables.spec.ts (workers pool).
--
-- Additive only: six new tables and two indexes. No row is written or
-- rewritten, and no existing table changes. No route reads these tables yet.
--
-- Rollback: revert the Worker and leave the tables. The older Worker reads none
-- of them. See ROLLBACK_PLAN.md, 0111.

CREATE TABLE IF NOT EXISTS vote_sets (
  id                 TEXT    PRIMARY KEY,
  event_id           TEXT    NOT NULL UNIQUE REFERENCES events(id),
  state              TEXT    NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'closed')),
  played_by          TEXT    CHECK (played_by IS NULL OR played_by IN ('object', 'team')),
  pepper_epoch       TEXT,
  is_void            INTEGER NOT NULL DEFAULT 0 CHECK (is_void IN (0, 1)),
  void_reason        TEXT,
  is_final           INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
  final_at           TEXT,
  secret_margin      INTEGER CHECK (secret_margin IS NULL OR secret_margin BETWEEN 5 AND 9),
  secret_floor       INTEGER CHECK (secret_floor IS NULL OR secret_floor BETWEEN 10 AND 14),
  counted_votes      INTEGER NOT NULL DEFAULT 0 CHECK (counted_votes >= 0),
  duplicate_votes    INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_votes >= 0),
  refused_votes      INTEGER NOT NULL DEFAULT 0 CHECK (refused_votes >= 0),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:00:00', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:00:00', 'now')),
  CHECK ((is_void = 0 AND void_reason IS NULL) OR (is_void = 1 AND void_reason IS NOT NULL)),
  CHECK ((is_final = 0 AND final_at IS NULL) OR (is_final = 1 AND final_at IS NOT NULL)),
  CHECK (is_final = 0 OR (secret_margin IS NULL AND secret_floor IS NULL))
);

CREATE TABLE IF NOT EXISTS votable_objects (
  id         TEXT    PRIMARY KEY,
  event_id   TEXT    NOT NULL REFERENCES events(id),
  set_id     TEXT    NOT NULL REFERENCES vote_sets(id),
  kind       TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  booth_id   TEXT    REFERENCES event_booths(id),
  group_id   TEXT,
  state      TEXT    NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'closed')),
  closes_at  TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:00:00', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:00:00', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_votable_objects_event_id ON votable_objects(event_id);
CREATE INDEX IF NOT EXISTS idx_votable_objects_set_group ON votable_objects(set_id, group_id);

CREATE TABLE IF NOT EXISTS vote_tallies (
  object_id  TEXT    PRIMARY KEY REFERENCES votable_objects(id),
  up_count   INTEGER NOT NULL DEFAULT 0 CHECK (up_count >= 0),
  down_count INTEGER NOT NULL DEFAULT 0 CHECK (down_count >= 0)
);

CREATE TABLE IF NOT EXISTS vote_receipts (
  object_id TEXT NOT NULL REFERENCES votable_objects(id),
  receipt   TEXT NOT NULL CHECK (length(receipt) = 64 AND receipt NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (object_id, receipt)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS vote_participants (
  set_id  TEXT NOT NULL REFERENCES vote_sets(id),
  receipt TEXT NOT NULL CHECK (length(receipt) = 64 AND receipt NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (set_id, receipt)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS vote_team_markers (
  team_id TEXT NOT NULL,
  marker  TEXT NOT NULL CHECK (length(marker) = 64 AND marker NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (team_id, marker)
) WITHOUT ROWID;
