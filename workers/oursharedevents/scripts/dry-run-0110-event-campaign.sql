-- Dry run for migration 0110 (events.campaign_id, OSE-1552 scope 1,
-- OSE ADR-030).
--
-- READ ONLY: three SELECTs, no write. It is meant to run against staging data
-- BEFORE the migration is applied there.
--
-- CI runs it: the T1 staging deploy runs the dry-run file of every pending
-- migration before it applies them (scripts/ci/migration-dry-run.mjs, OSE-2016),
-- and prints the counts in the job summary.
--
-- The migration writes no row. It adds a nullable column, so every existing
-- event reads campaign_id NULL afterwards. These counts say what is there to
-- begin with.

-- 1. Events that will read campaign_id NULL. After the migration,
--    SELECT COUNT(*) FROM events WHERE campaign_id IS NULL
--    must give this same number.
SELECT COUNT(*) AS events_without_a_campaign FROM events;

-- 2. Campaigns an event could be put in afterwards. Not changed by the migration.
SELECT COUNT(*) AS campaigns_there FROM campaigns;

-- 3. The column must not exist yet. One row here means 0110 already ran.
SELECT COUNT(*) AS column_already_there
  FROM pragma_table_info('events')
 WHERE name = 'campaign_id';
