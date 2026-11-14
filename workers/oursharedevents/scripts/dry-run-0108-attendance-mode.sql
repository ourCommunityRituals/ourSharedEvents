-- Dry run for migration 0108 (events.attendance_mode, OSE-2012).
--
-- READ ONLY: four SELECTs, no write. It is meant to run against staging data
-- BEFORE the migration is applied there.
--
-- CI runs it: the T1 staging deploy runs the dry-run file of every pending
-- migration before it applies them (scripts/ci/migration-dry-run.mjs, OSE-2016),
-- and prints the counts in the job summary. To read the counts on demand, run
-- the "Migration dry run (staging)" workflow with this file's name.
--
-- 0108 itself was applied on staging on 2026-11-14 before that step existed,
-- so its counts were not taken first. Run now, check 4 reads 1.
--
-- The migration gives every existing event 'in_person' (owner, 2026-11-12:
-- every OSE event so far is a physical one). These counts say what that means
-- for the data that is there.

-- 1. How many events become 'in_person'. After the migration,
--    SELECT attendance_mode, COUNT(*) FROM events GROUP BY 1
--    must show this number under 'in_person' and no other row.
SELECT COUNT(*) AS events_that_become_in_person FROM events;

-- 2. Of those, how many have no place at all (no place name, no address, no
--    coordinates). They stay as they are: the migration writes no row, and the
--    place rule runs only on a create, or on an update that names the mode or
--    the place. The next such update of one of these must add a place, or say
--    'online'.
SELECT status, COUNT(*) AS in_person_with_no_place
  FROM events
 WHERE TRIM(COALESCE(where_address, '')) = ''
   AND TRIM(COALESCE(location, '')) = ''
   AND lat IS NULL AND lon IS NULL
 GROUP BY status
 ORDER BY status;

-- 3. The same, for events on the public list today (root brand, published,
--    active). These keep showing on /events and the landing page, as before.
SELECT COUNT(*) AS listed_with_no_place
  FROM events
 WHERE is_published = 1 AND brand_id = 'root' AND status = 'active'
   AND TRIM(COALESCE(where_address, '')) = ''
   AND TRIM(COALESCE(location, '')) = ''
   AND lat IS NULL AND lon IS NULL;

-- 4. The column must not exist yet. One row here means 0108 already ran.
SELECT COUNT(*) AS column_already_there
  FROM pragma_table_info('events')
 WHERE name = 'attendance_mode';
