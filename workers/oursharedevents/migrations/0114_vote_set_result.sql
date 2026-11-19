-- Migration 0114: the night's result on its vote set (OSE-2130, S5 of OSE-1193;
-- OSE ADR-040 decisions 4, 7 and 8, owner decisions Q7, Q8, Q13 to Q17 of
-- 2026-11-18).
--
-- A set reports exactly one result, once it is final, and nothing before:
--   outcome     'winner' or 'too_close' ("too close to call, the champion
--               retains"). NULL until the set is final, and NULL for a void set,
--               which publishes nothing.
--   winner_id   the winning song's object id, or on a team night the winning
--               team's group_id. Set only when outcome is 'winner'.
-- There is no column for a count, a runner-up, a margin, a voter total or which
-- rule decided. The result is computed inside the statement that makes the set
-- final, in the same D1 batch that nulls T and V and deletes the receipts and
-- markers (src/lib/vote-sets.ts, finalizeVoteSet), so T and V are read by SQL
-- only and never leave the database.
--
-- The CHECK on outcome holds the pairing: no result before final, none on a
-- void set, a winner always names one, too_close never does. It is on the
-- second column because a column CHECK may name only columns that already
-- exist; it is checked whenever any column it names is written.
--
-- One-off fill: a set already final and not void gets 'too_close'. Before this
-- migration only two kinds of set could become final (S3): one that never
-- opened, so it holds no vote, and a void one, left NULL. On staging these are
-- the synthetic nights the S3 runs finalized. Production has no vote sets.
--
-- Gates: tests/e2e/0-architecture/votes-never-who.invariant.spec.ts (T0),
-- workers/oursharedevents/tests/vote-result.spec.ts (workers pool).
--
-- Rollback: revert the Worker and leave the columns. The older Worker reads
-- neither. See ROLLBACK_PLAN.md, 0114.

ALTER TABLE vote_sets ADD COLUMN winner_id TEXT;

ALTER TABLE vote_sets ADD COLUMN outcome TEXT CHECK (
  (outcome IS NULL AND winner_id IS NULL)
  OR (outcome = 'too_close' AND winner_id IS NULL AND is_final = 1 AND is_void = 0)
  OR (outcome = 'winner' AND winner_id IS NOT NULL AND length(winner_id) BETWEEN 1 AND 80
      AND is_final = 1 AND is_void = 0)
);

UPDATE vote_sets
   SET outcome = 'too_close'
 WHERE is_final = 1 AND is_void = 0 AND outcome IS NULL;
