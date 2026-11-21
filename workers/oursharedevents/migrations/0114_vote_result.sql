-- Migration 0114: the night's result, written once when a vote set becomes
-- final (OSE-2130, S5 of OSE-1193; OSE ADR-040 decisions 4, 7 and 8).
--
-- Three columns on vote_sets, all null until the set is final:
--
--   outcome            'winner' or 'too_close'. Too close also covers a night
--                      below the secret voter floor V, with the same words
--                      ("too close to call, the champion retains"), so the
--                      outcome never says which rule decided. A void set, and
--                      a set made final before this migration, has no outcome.
--   winner_object_id   the winning song or stall, on a night played by objects.
--   winner_team_id     the winning team's opaque OSE id (grp_ and hex), on a
--                      night played by teams. OSE holds no team name.
--
-- The result is written in the same D1 batch that sets is_final, nulls T and
-- V and deletes the receipts and markers (src/lib/vote-results.ts,
-- src/lib/vote-sets.ts finalizeVoteSet). It is decided inside SQL, from the
-- tallies, the team markers, the participant markers and T and V, so no count,
-- T or V is ever read into the Worker. No column holds a count, a margin, a
-- voter number or a reason.
--
-- Time: no new time column.
--
-- Gates: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0),
-- workers/oursharedevents/tests/vote-results.spec.ts (workers pool).
--
-- Additive only: three nullable columns. No row is written or rewritten.
--
-- Rollback: revert the Worker and leave the columns. The older Worker reads
-- none of them, and its nightly job makes final only sets that never opened or
-- are void (no vote route exists on it). See ROLLBACK_PLAN.md, 0114.

ALTER TABLE vote_sets ADD COLUMN outcome TEXT
  CHECK (outcome IS NULL OR outcome IN ('winner', 'too_close'));

ALTER TABLE vote_sets ADD COLUMN winner_object_id TEXT;

ALTER TABLE vote_sets ADD COLUMN winner_team_id TEXT
  CHECK (winner_team_id IS NULL OR (winner_team_id GLOB 'grp_*' AND length(winner_team_id) BETWEEN 12 AND 68 AND substr(winner_team_id, 5) NOT GLOB '*[^0-9a-f-]*'));
