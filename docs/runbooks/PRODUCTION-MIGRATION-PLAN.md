# Production migration plan: main 77 to 104, forms 14 to 18

Written 2026-10-07 for the first production deploy (launch 2026-10-24).

Covers: main 0078–0104, forms 0015–0018.

This is a plan to read, not a script to run. **You do not apply these by hand.** The
`T1 Deploy → Production` job applies them, in order, before it deploys the Worker.

## Where production is

| Database                          | Production is at | This build needs | To apply |
| --------------------------------- | ---------------- | ---------------- | -------- |
| Main (`ocr-db-production`)        | 77               | 104              | 27       |
| Forms (`ocr-forms-db-production`) | 14 (see note)    | 18               | 4        |

- The main level was read on 2026-10-01 and again in the two days before this was written.
- The forms level of 14 is the last one written down (2026-09-21). It may be 15. The
  preflight prints the real number for both databases; trust that, not this table.
- Production has **no events**, and its forms tables are **empty**. Most of what follows
  is safe because of that. "Before you start" has you confirm it.

**Migration freeze: 2026-10-17.** No new migration file after that date until launch.
If one lands before then, the preflight fails with "not in the plan" until the file has
a line in this document.

## Before you start

1. Run the preflight and get `READY`:

   ```bash
   node scripts/prod-preflight.mjs
   ```

   It shows the level of each database, the files the deploy will apply, and which of
   them write or remove rows. See `RUNBOOK-DEPLOYMENT.md`, "Production preflight".

2. Confirm the tables this plan calls empty are empty. Read-only. Run in
   `workers/oursharedevents`:

   ```bash
   npx wrangler d1 execute DB --env production --remote --command "
   SELECT 'events' AS t, COUNT(*) AS n FROM events
   UNION ALL SELECT 'poster_deployments', COUNT(*) FROM poster_deployments
   UNION ALL SELECT 'scan_node_returns', COUNT(*) FROM scan_node_returns
   UNION ALL SELECT 'scan_aggregates', COUNT(*) FROM scan_aggregates
   UNION ALL SELECT 'anon_id_returns', COUNT(*) FROM anon_id_returns
   UNION ALL SELECT 'sponsor_business', COUNT(*) FROM sponsor_business
   UNION ALL SELECT 'sponsor_asset', COUNT(*) FROM sponsor_asset
   UNION ALL SELECT 'admin_audit_log', COUNT(*) FROM admin_audit_log;"

   npx wrangler d1 execute FORMS_DB --env production --remote --command "
   SELECT 'form_registrations' AS t, COUNT(*) AS n FROM form_registrations
   UNION ALL SELECT 'checkin_counts', COUNT(*) FROM checkin_counts
   UNION ALL SELECT 'form_surveys', COUNT(*) FROM form_surveys
   UNION ALL SELECT 'email_signups', COUNT(*) FROM email_signups;"
   ```

   Expected: `events`, `poster_deployments`, `scan_node_returns`, `scan_aggregates`,
   `anon_id_returns` and all four forms tables are `0`. Keep the numbers for
   `sponsor_business`, `sponsor_asset` and `admin_audit_log`; you compare them afterwards.
   **If a table that should be `0` is not, stop** and read "The migrations that write or
   remove rows" for that table before you deploy.

3. Note a restore point for each database. D1 keeps a history you can rewind to
   ("Time Travel"). This prints a bookmark for "now":

   ```bash
   npx wrangler d1 time-travel info ocr-db-production --env production
   npx wrangler d1 time-travel info ocr-forms-db-production --env production
   ```

   Save both bookmarks with the time you took them. How many days back D1 can rewind
   depends on the Cloudflare plan. These two commands were not run while writing this
   plan: check `npx wrangler d1 time-travel --help` and the Cloudflare D1 documentation
   before you rely on them.

## How they are applied

- The deploy job runs `wrangler d1 migrations apply DB` and then `FORMS_DB`, with
  `--env production --remote`. Wrangler applies the files one at a time in number order
  and stops at the first one that fails. Files before it stay applied.
- The job then checks the tables and columns (`verify-d1-canonical-shape.mjs`) and
  refuses to deploy the Worker if any migration is still unapplied on either database
  ("Gate: zero unapplied D1 migrations before deploy").
- So there is a short time when the **old** Worker runs on the **new** tables. Every
  change below adds something or clears something the old Worker does not need, so the
  old Worker keeps working. Nobody has tested the old production build against the new
  tables, because nobody knows which commit that build is.

## Main database, 0078 to 0104

"Rows" answers: does it write or remove rows that already exist?

| File                                                      | What it does                                                                                                                      | Rows |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `0078_events_add_starts_at.sql`                           | Adds `events.starts_at`, the start time in UTC. Old events keep none.                                                             | No   |
| `0079_poster_deployments_add_address.sql`                 | Adds `poster_deployments.address`, the address the organizer typed for a poster.                                                  | No   |
| `0080_shortlinks_add_poster_position.sql`                 | Adds `shortlinks.poster_position`, the order of the codes on a poster.                                                            | No   |
| `0081_sponsor_tier_and_compact_logo.sql`                  | Adds `sponsor_business.tier` and fills it. Rebuilds `sponsor_asset` to allow a second logo format.                                | Yes  |
| `0082_poster_deployments_add_placement_type.sql`          | Adds `poster_deployments.placement_type` (venue or community) and marks venue posters.                                            | Yes  |
| `0083_sponsor_public_card.sql`                            | Adds four optional sponsor columns: display name, location, phone, email.                                                         | No   |
| `0084_corridor_readiness_latch.sql`                       | Creates `corridor_readiness_latch`, which records when an area's map opened.                                                      | No   |
| `0085_events_settings_json.sql`                           | Adds `events.settings_json`, the per-event switches. Default `{}` means everything on.                                            | No   |
| `0086_remove_seed_test_event.sql`                         | Deletes the test event `test-event-001` if nothing points at it.                                                                  | Yes  |
| `0087_scan_cell_aggregates.sql`                           | Creates `scan_cell_aggregates`, scan counts by the poster's own map cell.                                                         | No   |
| `0088_admin_audit_log_brand_id.sql`                       | Adds `admin_audit_log.brand_id` and an index, then fills the new column for old rows.                                             | Yes  |
| `0089_clear_visitor_country.sql`                          | Clears the visitor country from `scan_node_returns` and `scan_aggregates`. Adds an index.                                         | Yes  |
| `0090_anon_id_returns_last_seen_index.sql`                | Adds two indexes on `anon_id_returns`.                                                                                            | No   |
| `0091_anon_id_returns_pepper_epoch.sql`                   | Adds `anon_id_returns.pepper_epoch`. Old rows keep none, and the nightly job later deletes those rows.                            | No   |
| `0092_anon_id_returns_pepper_epoch_index.sql`             | Adds an index on `anon_id_returns.pepper_epoch`.                                                                                  | No   |
| `0093_events_listed_from.sql`                             | Adds `events.listed_from`, the time a published event joins the list and map.                                                     | No   |
| `0094_shortlink_click_daily.sql`                          | Creates `shortlink_click_daily`, one click count per link per day.                                                                | No   |
| `0095_scan_node_returns_clear_raw_anon_id.sql`            | Clears the raw cookie value from `scan_node_returns`. Rows and other columns stay.                                                | Yes  |
| `0096_event_codes.sql`                                    | Creates `event_codes` (one short code per event) and `share_opens_daily` (share opens per day, no identity).                      | No   |
| `0097_event_type_watch_party.sql`                         | Adds the Watch Party event type and maps it to two templates, then refreshes the templates' clearance tier.                       | Yes  |
| `0098_drop_subscribers_from_anonymous_db.sql`             | Removes the email list table `subscribers` from the main database. Forms `0017` creates it there instead.                         | Yes  |
| `0099_event_place_checked_at.sql`                         | Adds `events.place_checked_at`, when the event's place was last looked up on the map. Old events keep none.                       | No   |
| `0100_scan_split_tables_hour_precision.sql`               | Truncates `created_at` on `scan_placement_events` and `scan_node_returns` to the scan's hour. Counts stay.                        | Yes  |
| `0101_scan_node_returns_one_row_per_browser_hour.sql`     | Keeps one `scan_node_returns` row per browser, event and hour, and adds the UNIQUE index that enforces it.                        | Yes  |
| `0102_rename_sponsor_impressions_to_sponsor_displays.sql` | Rebuilds `sponsor_impressions` as `sponsor_displays`, with its indexes; the stored value `impression` becomes `display`.          | Yes  |
| `0103_rename_visit_count_to_return_count.sql`             | Renames `anon_id_returns.visit_count` to `return_count` and its index. No row changes.                                            | No   |
| `0104_event_spine_keys.sql`                               | Adds `events.venue_canonical_id` and `events.event_correlation_id`, each with an index. Writes no row (a nightly job fills them). | No   |

## Forms database, 0015 to 0018

| File                                    | What it does                                                                                                  | Rows |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- |
| `0015_checkin_walk_in_count.sql`        | Adds `checkin_counts.walk_in_count`, a count of walk-in check-ins. Default 0.                                 | No   |
| `0016_scrub_raw_anonymous_id.sql`       | Clears the raw anonymous id from the four form tables. Rows and other columns stay.                           | Yes  |
| `0017_subscribers.sql`                  | Creates `subscribers`, the landing-page email list, in the forms database.                                    | No   |
| `0018_registration_email_encrypted.sql` | Adds `form_registrations.attendee_email_encrypted`, so an organizer can reach a registrant who left an email. | No   |

## The migrations that write or remove rows

Twelve files. Each is listed with what it changes, why it is safe on production as it is
today, and what would be different if production held data.

### `0081_sponsor_tier_and_compact_logo.sql`

- **`UPDATE sponsor_business`**: sets the new `tier` column from each sponsor's latest
  placement. It only touches rows where `tier` is empty, and the column is new, so no
  recorded value is overwritten. With no events there are no placements, so `tier`
  stays empty.
- **`sponsor_asset` is rebuilt through `sponsor_asset_new`**: SQLite cannot change a
  column rule in place. So every row is copied into a new table with the wider rule,
  the old table is removed, and the new one takes its name. Every column of every row
  is copied. Its one index is created again.
- **Safe because** the copy keeps all rows, and nothing else refers to `sponsor_asset`
  by foreign key.
- **Check:** `sponsor_asset` has the same number of rows after as before.

### `0082_poster_deployments_add_placement_type.sql`

- **`UPDATE poster_deployments`**: every poster gets `community`; a poster whose address
  is the event's own address is changed to `venue`. Only the new column is written.
- **Safe because** production has no events, so it has no posters. Nothing to update.

### `0086_remove_seed_test_event.sql`

- **`DELETE FROM events`**: removes one row, `test-event-001`, and only if no poster,
  scan, short link, sponsor placement or return row points at it.
- **Safe because** production has no events. The founder deleted that row by hand on
  2026-09-29, so there is nothing to delete.
- **If it did delete:** the row is a seeded test event. It is not real data.

### `0088_admin_audit_log_brand_id.sql`

- **Five `UPDATE admin_audit_log` statements**: fill the new `brand_id` column for rows
  written before this migration. They write only where `brand_id` is still empty. No
  recorded value changes and no row is removed. The audit log stays append-only.
- **Safe because** it only fills a column that did not exist before.
- **After the deploy, once:** rows the old Worker wrote between the migration and the
  new Worker going live have no brand. Re-run the five statements:
  `RUNBOOK-DEPLOYMENT.md`, "Re-run the 0088 audit brand backfill once after deploy".

### `0089_clear_visitor_country.sql`

- **`UPDATE scan_node_returns`** and **`UPDATE scan_aggregates`**: set the visitor
  country to empty on every row that has one. This is a decision (2026-10-01): the
  product does not keep where a visitor's network appeared to be.
- **Safe because** production has no events, so it has no scans. Nothing to clear.
- **If it did clear:** the cleared values are gone. That is the intent.

### `0095_scan_node_returns_clear_raw_anon_id.sql`

- **`UPDATE scan_node_returns`**: sets `anonymous_id` to empty unless it is already
  the new keyed scan id (`snk1_…`). The scan path stored the raw `ose_anon` cookie
  value there until OSE-1659 (2026-10-09). Rows and every other column stay, so scan
  totals do not change.
- **Safe because** production has no events, so it has no scans (0 rows, read
  2026-10-09). Nothing to clear.
- **If it did clear:** those rows lose their id. Distinct-browser counts for them fall
  back to the user-agent hash, and those browsers cannot be matched as returning
  visitors. That is the stated cost.
- **After the deploy:** the scan write stores only a keyed id, whichever Worker queued
  the scan, so no raw value can come back.

### `0100_scan_split_tables_hour_precision.sql`

- **Four `UPDATE`s**, two each on `scan_placement_events` and `scan_node_returns`: set `created_at` to the scan's hour bucket
  (`scan_bucket`, in `YYYY-MM-DD HH:00:00` shape). A row whose bucket is not in the
  expected shape keeps its stamp's hour. Nothing else changes.
- **Why:** both tables were written in one batch with a second-precision stamp, so a
  join on event and `created_at` linked who to where one scan at a time (OSE-923,
  CCR N-DS-2).
- **Safe because** no reader selects `created_at` from either table; only the
  return-signal retention sweep read it, and it now reads `scan_bucket`. Scan totals
  and reports do not change. Production has no scans (0 rows).
- **If it did truncate:** the seconds are gone. That is the intent.

### `0101_scan_node_returns_one_row_per_browser_hour.sql`

- **`DELETE FROM scan_node_returns`**: removes a repeat row where the same keyed browser
  id appears twice in one event and hour, keeping the earliest by id. Rows with no id are
  never touched. Then `CREATE UNIQUE INDEX idx_snr_event_anon_bucket`.
- **Why:** the table is the source of `scan_aggregates.total_scans`, so a browser that
  scanned two posters in one hour counted twice (OSE-923).
- **What changes on purpose:** `total_scans` counts browser-hours, not
  browser-poster-hours, so it goes down for people who scanned more than one poster in
  an hour. The distinct-scanner count and per-poster scan counts do not change.
- **Safe because** production has no scans (0 rows). Nothing to collapse.
- **If it did collapse:** the repeat rows are gone. That is the intent.

### `0102_rename_sponsor_impressions_to_sponsor_displays.sql`

- **`INSERT OR IGNORE INTO sponsor_displays`** copies every row of `sponsor_impressions`,
  mapping the stored `event_type` value `impression` to `display` (a `click` stays a
  `click`). Then the old table is removed and the three indexes are recreated
  under the new name. The columns and foreign keys are 0067's exactly.
- **Why:** "display" states a render fact; "impression" is the claimed-view word from ad
  tech (PO, 2026-08-20, OSE-931). The report field, depth section and snapshot (3.0.0)
  move in the same change set.
- **Safe because** production has no events, so no sponsor display rows (0 rows).
  Nothing to copy.
- **If it did copy:** every row survives; only the label of the render value changes.

### `0097_event_type_watch_party.sql`

- **`INSERT INTO event_type_registry`**: adds one row, `SOC-WATCHPARTY-001` "Watch
  Party", in Social & Community Dining. `INSERT OR IGNORE`, so a second run adds nothing.
- **Two `INSERT INTO template_event_types`**: map it to `bar_night` and
  `community_gathering`, so a sponsor can reach it.
- **`UPDATE event_templates`**: recomputes `max_clearance_tier` for every template, the
  same statement 0057 and 0063 ran. The new type is tier 1 like every other, so no
  template's value changes.
- **Safe because** it only adds catalog rows. It touches no event, scan or form row.
- **Check:** `SELECT name, category_code FROM event_type_registry WHERE uec_code = 'SOC-WATCHPARTY-001';`
  returns `Watch Party`, `SOC`.

### `0098_drop_subscribers_from_anonymous_db.sql`

- **Removes the table `subscribers`**: takes the landing-page email list out of the main
  database, which is the anonymous side of the two-database wall. Owner decision
  2026-10-11 (OSE-1661). Forms `0017` creates the same table in the forms database,
  and the new Worker reads and writes it there.
- **Safe because** production's `subscribers` held **0 rows** (read 2026-10-11).
  Nothing is lost.
- **If it held rows:** they would be gone. A migration cannot copy rows from one
  database to the other. Staging held 1 test row, which is not carried over.
- **Between the migration and the new Worker:** the old Worker's subscribe and admin
  list would fail on the missing table. A failed subscribe is logged and the visitor
  still sees success, as before. Production is not launched, so no one is subscribing.
- **Check:** `SELECT COUNT(*) FROM sqlite_master WHERE name = 'subscribers';` returns
  `0` on the main database and `1` on the forms database.

### `0016_scrub_raw_anonymous_id.sql` (forms)

- **Four `UPDATE` statements**, one each on `form_registrations`, `checkin_counts`,
  `form_surveys` and `email_signups`: set the raw anonymous id to empty unless it is
  already the new per-event form (`evk1_…`). Rows and every other column stay.
- **Safe because** the four tables are empty on production. Nothing to clear.
- **If it did clear:** the cleared ids are gone. Old rows could then no longer be used
  to find a person's scan rows for an erasure request. That is the stated cost.
- **After the deploy:** a form sent between the migration and the new Worker going
  live would still be written with a raw id. Production has no events, so no form can
  be sent. The check below confirms it.

### One more: `0091_anon_id_returns_pepper_epoch.sql`

The file itself only adds a column. But from then on the **nightly job deletes** every
`anon_id_returns` row whose `pepper_epoch` is empty, up to 50,000 a night. All rows
written before 0091 have it empty. On production the table is empty, so nothing is
deleted. Run the one-time purge anyway so the result is on record:
`RUNBOOK-DEPLOYMENT.md`, "Purge return rows after migration 0091".

## How to check afterwards

The deploy job does the first three itself and goes red if any fails.

1. **Nothing left to apply.** In `workers/oursharedevents`:

   ```bash
   npx wrangler d1 migrations list DB --env production --remote
   npx wrangler d1 migrations list FORMS_DB --env production --remote
   ```

   Both say `No migrations to apply`.

2. **The level.** Expected: `0104_event_spine_keys.sql` and `104`;
   then `0018_registration_email_encrypted.sql` and `18`.

   ```bash
   npx wrangler d1 execute DB --env production --remote --command "SELECT (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS latest, (SELECT COUNT(*) FROM d1_migrations) AS applied;"
   npx wrangler d1 execute FORMS_DB --env production --remote --command "SELECT (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS latest, (SELECT COUNT(*) FROM d1_migrations) AS applied;"
   ```

3. **The site serves.** `https://oursharedevents.com/health` returns `version`
   `prod-<commit>-<date>` and `db: ok`. `/health` answers even when a database is
   behind, so also open `https://oursharedevents.com/events`. If the Worker is ahead of
   a database, every page except `/health` and `/api/status` returns `503` with
   "Schema drift".
   `T2 Smoke → Production` checks both.

4. **Row counts.** Run the two queries from "Before you start" again. `sponsor_asset`
   and `sponsor_business` are unchanged. `admin_audit_log` is the same or higher. The
   tables that were `0` are still `0`.

5. **The clears held.** Expected `0` on each line:

   ```bash
   npx wrangler d1 execute DB --env production --remote --command "
   SELECT COUNT(*) FROM scan_node_returns WHERE country_code IS NOT NULL;
   SELECT COUNT(*) FROM scan_aggregates WHERE top_country IS NOT NULL;
   SELECT COUNT(*) FROM anon_id_returns WHERE pepper_epoch IS NULL;"

   npx wrangler d1 execute FORMS_DB --env production --remote --command "
   SELECT COUNT(*) FROM form_registrations WHERE anonymous_id IS NOT NULL AND substr(anonymous_id, 1, 5) <> 'evk1_';
   SELECT COUNT(*) FROM email_signups WHERE anonymous_id IS NOT NULL AND substr(anonymous_id, 1, 5) <> 'evk1_';"
   ```

6. **The one-time steps** in `RUNBOOK-DEPLOYMENT.md`: the 0088 backfill, the 0091 purge,
   the founder membership rows, the BigQuery tables before 03:00 UTC.

## What cannot be undone

- **An applied migration stays applied.** There are no "down" migrations. A new column
  or table stays; SQLite cannot reliably drop a column. Recovery is a new migration
  that goes forward, never an edit to one already applied.
- **Values cleared by `0089` and forms `0016`** are gone. On production today there are
  none to clear.
- **The row deleted by `0086`**, if it existed. It was test data.
- **The main database's `subscribers` rows, removed by `0098`.** On production there
  were none.
- **Rows the nightly job deletes after `0091`.** On production today there are none.
- **The whole database can be rewound** to the restore point you noted. The command,
  its conditions and its stop line are in
  [DISASTER-RECOVERY.md §6](./DISASTER-RECOVERY.md#6-break-glass-restore-a-database-to-an-earlier-time),
  and nowhere else, on purpose.
  That throws away **everything** written after the bookmark, not only the migration.
  With no events on production that costs nothing before launch. After launch it would
  cost real data. It is a last resort and an owner decision.
- **Rolling the Worker back does not roll the database back.** After these migrations
  the only earlier Worker is today's old build. It should keep working, because the
  changes add or clear things it does not use, but that pairing is untested.

## If a migration fails during the deploy

1. The job stops and goes red. The Worker is **not** deployed, so production keeps
   running the old build.
2. Read the failing step's log. It names the file.
3. Run the two `migrations list` commands above to see how far each database got.
4. Do not edit a migration that has been applied anywhere. Mend it with a new, higher
   numbered migration in a pull request, let it pass staging, then deploy again. The
   job picks up from where it stopped.
