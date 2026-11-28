-- Migration 0126: competition rules, team sizes and per-frame lineups
-- (leagues slice 2, owner 2026-11-28; OCR-docs docs/proposals/
-- PROPOSAL_bocce-team-formats-and-rules.md, sections 2, 4a and 5).
--
--   competitions.rules         the organizer's changes to the picked ruleset, as a
--                              small JSON object (points for a win, tie and loss;
--                              the target score; a time limit; the tie-break order;
--                              the baci bonus; the usual team size). NULL means
--                              the ruleset as it is. src/lib/competitions.ts
--                              parses and checks it; the column is free TEXT so a
--                              new rule needs no table rebuild.
--   competition_entries.team_size
--                              1 to 4 players a side for this team (1v1 to 4v4).
--                              NULL means the competition's usual size.
--   fixture_lineups            for one game, which position (A to D) threw at
--                              which end in which frame, and how many balls.
--                              Optional. A three-player rotation is just
--                              different positions frame to frame.
--
-- NEVER WHO. A lineup holds positions only, never a name, number or account.
-- A name can appear only on ourWKRP, if the player chose it there.
--
-- Additive only: two new nullable columns and one new table, no new index (the
-- table's primary key serves its one read). No existing row changes.
--
-- Rollback: revert the Worker and leave the columns and the table. The older
-- Worker reads none of them. See ROLLBACK_PLAN.md, 0126.

ALTER TABLE competitions ADD COLUMN rules TEXT;

ALTER TABLE competition_entries ADD COLUMN team_size INTEGER CHECK (team_size IS NULL OR team_size BETWEEN 1 AND 4);

CREATE TABLE IF NOT EXISTS fixture_lineups (
  fixture_id  TEXT    NOT NULL REFERENCES fixtures(id),
  frame       INTEGER NOT NULL CHECK (frame BETWEEN 1 AND 99),
  side        TEXT    NOT NULL CHECK (side IN ('a', 'b')),
  position    TEXT    NOT NULL CHECK (position IN ('A', 'B', 'C', 'D')),
  court_end   TEXT    NOT NULL CHECK (court_end IN ('near', 'far')),
  balls       INTEGER NOT NULL CHECK (balls BETWEEN 1 AND 8),
  PRIMARY KEY (fixture_id, frame, side, position)
);
