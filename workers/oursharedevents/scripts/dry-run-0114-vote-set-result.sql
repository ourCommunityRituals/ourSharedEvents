-- Dry run for migration 0114 (the night's result on its vote set; OSE-2130,
-- OSE ADR-040 decisions 4, 7 and 8).
--
-- READ ONLY: three SELECTs, counts only. CI runs it on staging BEFORE the
-- migration is applied there (scripts/ci/migration-dry-run.mjs, OSE-2016), and
-- prints the counts in the job summary.

-- 1. Sets already final and not void. The migration gives each of these the
--    result 'too_close'; afterwards none of them reads a null result. Before
--    0114 only a set that never opened could be final without being void, so
--    each holds no vote.
SELECT COUNT(*) AS final_sets_given_too_close
  FROM vote_sets
 WHERE is_final = 1 AND is_void = 0;

-- 2. Sets final and void. They keep no result: a void set publishes nothing.
SELECT COUNT(*) AS final_void_sets_left_without_result
  FROM vote_sets
 WHERE is_final = 1 AND is_void = 1;

-- 3. The two columns must not exist yet. A count above 0 means 0114 already ran.
SELECT COUNT(*) AS result_columns_already_there
  FROM pragma_table_info('vote_sets')
 WHERE name IN ('outcome', 'winner_id');
