-- Dry run for migration 0113 (the room's own vote code, and a vote set follows
-- its event's status; OSE-2140, OSE-2142, OSE ADR-040).
--
-- READ ONLY: three SELECTs, no write. It is meant to run against staging data
-- BEFORE the migration is applied there.
--
-- CI runs it: the T1 staging deploy runs the dry-run file of every pending
-- migration before it applies them (scripts/ci/migration-dry-run.mjs, OSE-2016),
-- and prints the counts in the job summary.

-- 1. Vote sets open on an event that is not Published. The migration closes
--    exactly these; afterwards the same query must give 0.
SELECT COUNT(*) AS open_sets_on_events_not_published
  FROM vote_sets
 WHERE state = 'open' AND is_final = 0
   AND event_id IN (SELECT id FROM events WHERE status <> 'active');

-- 2. Placements that will read is_vote_code = 0 (the column's default).
SELECT COUNT(*) AS placements_there FROM poster_deployments;

-- 3. The column must not exist yet. One row here means 0113 already ran.
SELECT COUNT(*) AS column_already_there
  FROM pragma_table_info('poster_deployments')
 WHERE name = 'is_vote_code';
