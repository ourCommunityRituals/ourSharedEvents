-- Dry run for migration 0109 (event_booths + poster_deployments.booth_id,
-- OSE-1998, OSE ADR-034).
--
-- READ ONLY: three SELECTs, no write. It is meant to run against staging data
-- BEFORE the migration is applied there.
--
-- CI runs it: the T1 staging deploy runs the dry-run file of every pending
-- migration before it applies them (scripts/ci/migration-dry-run.mjs, OSE-2016),
-- and prints the counts in the job summary.
--
-- The migration writes no row. It adds a table and a nullable column, so every
-- existing placement reads booth_id NULL afterwards. These counts say what is
-- there to begin with.

-- 1. Placements that will read booth_id NULL. After the migration,
--    SELECT COUNT(*) FROM poster_deployments WHERE booth_id IS NULL
--    must give this same number.
SELECT COUNT(*) AS placements_without_a_booth FROM poster_deployments;

-- 2. The table must not exist yet. One row here means 0109 already ran.
SELECT COUNT(*) AS table_already_there
  FROM sqlite_master
 WHERE type = 'table' AND name = 'event_booths';

-- 3. The column must not exist yet. One row here means 0109 already ran.
SELECT COUNT(*) AS column_already_there
  FROM pragma_table_info('poster_deployments')
 WHERE name = 'booth_id';
