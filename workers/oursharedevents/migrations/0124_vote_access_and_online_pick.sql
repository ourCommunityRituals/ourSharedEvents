-- Migration 0124: the Access Pass and the Online Pick (OSE ADR-040 decision 13,
-- the proposal in OCR-docs PR #200; owner, 2026-11-26).
--
-- 1. vote_access_passes. A host gives an Access Pass so someone who cannot be
--    in the room can vote in the Room Pick. A pass is a token, not a person:
--    the row holds no name, no note, no reason and no recipient, and there is
--    no column to put one in. The token itself is never stored. `lookup` is
--    HMAC(K_access_lookup, token) under a server-only subkey
--    (src/lib/vote-access-pass.ts), so a copy of the database cannot be used
--    to vote, or to test a guessed token offline. At most 4 passes a set, ever:
--    a revoked one still counts (the cap is checked inside the INSERT, src/lib/vote-access-pass.ts). The
--    rows of a set are deleted when the set becomes final; only the audit log's
--    "a pass was given by this admin at this hour" lines stay.
--
-- 2. The Online Pick lives in tables of its own: vote_crowd_sets,
--    vote_crowd_tallies, vote_crowd_receipts and vote_crowd_participants. It
--    rides on the room set's objects (same object ids, same windows) and
--    never shares a counter, a receipt, a marker, T or V with the room. Two
--    tables, not a channel column, so a forgotten WHERE can never mix them:
--    a statement that names a crowd table and a room counter or marker table is
--    refused by the T0 gate (tests/e2e/0-architecture/votes-never-who.invariant.spec.ts,
--    "channels never mix").
--
-- Every table is in DB (ADR-040 decision 1). No column holds a voter, a time
-- of a vote or a side on a marker. The counters and markers have no time
-- column; vote_crowd_sets keeps the hour it was changed, as vote_sets does.
--
-- Rollback: revert the Worker and leave the tables (they hold nothing about a
-- person). See ROLLBACK_PLAN.md, 0124.

CREATE TABLE IF NOT EXISTS vote_access_passes (
  id          TEXT    PRIMARY KEY CHECK (id GLOB 'vap_*' AND length(id) = 36 AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
  set_id      TEXT    NOT NULL,
  event_id    TEXT    NOT NULL REFERENCES events(id),
  lookup      TEXT    NOT NULL UNIQUE CHECK (length(lookup) = 64 AND lookup NOT GLOB '*[^0-9a-f]*'),
  is_revoked  INTEGER NOT NULL DEFAULT 0 CHECK (is_revoked IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:00:00', 'now')),
  FOREIGN KEY (set_id, event_id) REFERENCES vote_sets(id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_vote_access_passes_set ON vote_access_passes(set_id, is_revoked);

CREATE TABLE IF NOT EXISTS vote_crowd_sets (
  set_id           TEXT    PRIMARY KEY,
  event_id         TEXT    NOT NULL UNIQUE REFERENCES events(id),
  is_on            INTEGER NOT NULL DEFAULT 0 CHECK (is_on IN (0, 1)),
  pepper_epoch     TEXT,
  secret_margin    INTEGER CHECK (secret_margin IS NULL OR secret_margin IN (5, 6, 7, 8, 9)),
  secret_floor     INTEGER CHECK (secret_floor IS NULL OR secret_floor IN (10, 11, 12, 13, 14)),
  is_final         INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
  outcome          TEXT    CHECK (outcome IS NULL OR outcome IN ('winner', 'too_close')),
  winner_object_id TEXT,
  -- The host's swarm alarm (lib/vote-crowd.ts noteCrowdPassMinted): one-way, set to
  -- 1 when Online Pick passes for the event pass a full room's minute. No count, no time.
  burst_seen       INTEGER NOT NULL DEFAULT 0 CHECK (burst_seen IN (0, 1)),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:00:00', 'now')),
  FOREIGN KEY (set_id, event_id) REFERENCES vote_sets(id, event_id),
  CHECK (is_final = 0 OR (is_on = 0 AND secret_margin IS NULL AND secret_floor IS NULL))
);

CREATE TABLE IF NOT EXISTS vote_crowd_tallies (
  object_id  TEXT    PRIMARY KEY REFERENCES votable_objects(id),
  up_count   INTEGER NOT NULL DEFAULT 0 CHECK (up_count >= 0),
  down_count INTEGER NOT NULL DEFAULT 0 CHECK (down_count >= 0)
);

CREATE TABLE IF NOT EXISTS vote_crowd_receipts (
  object_id TEXT NOT NULL REFERENCES votable_objects(id),
  receipt   TEXT NOT NULL CHECK (length(receipt) = 64 AND receipt NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (object_id, receipt)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS vote_crowd_participants (
  set_id TEXT NOT NULL REFERENCES vote_crowd_sets(set_id),
  marker TEXT NOT NULL CHECK (length(marker) = 64 AND marker NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (set_id, marker)
) WITHOUT ROWID;
