# Disaster recovery: data and databases

- **For:** the two D1 databases behind the Cloudflare Worker, in staging and production.
- **Operator:** the founder, alone, at first launch.
- **Last reviewed:** 2026-10-07 (rewritten for OSE-1503).
- **Not yet practised.** No restore has been run from this page. Its commands were written from Cloudflare's documentation and this repository's settings, and were not run. Do the staging drill in §11 before launch.
- **This page is about data.** If only the code is bad, use [ROLLBACK.md](./ROLLBACK.md).

## 1. What happened, and where to go

| What you see                                                   | Go to                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A deploy broke the site. The data is fine.                     | [ROLLBACK.md](./ROLLBACK.md)                                                    |
| A few rows are wrong or missing, and you know which.           | §4, then [§5](#5-fix-forward-the-normal-repair)                                 |
| A migration or a bad write damaged many rows, or deleted them. | §4, then [§6 break-glass](#6-break-glass-restore-a-database-to-an-earlier-time) |
| You restored a database. Now what?                             | [§7](#7-after-any-restore-retention-and-erasures). Do not skip it.              |
| Every page answers 503 "Schema drift" after a restore.         | [ROLLBACK.md §5](./ROLLBACK.md#5-every-page-answers-503-schema-drift)           |
| A database is missing from the Cloudflare account.             | [§8 break-glass](#8-break-glass-a-database-is-missing-from-the-account)         |
| A secret leaked, or the forms encryption key is lost.          | [§9](#9-keys-and-the-domain)                                                    |
| The domain does not answer at all.                             | [§9](#9-keys-and-the-domain)                                                    |

Words used on this page:

- **D1**: Cloudflare's database. Each environment has two.
- **Time Travel**: D1's built-in way to put a database back to how it was at an earlier minute. It is always on.
- **Bookmark**: Time Travel's name for one point in a database's history. A long code.
- **Restore point**: the time you choose to go back to.
- **Erasure**: deleting one person's data because they asked.
- **Retention**: the nightly job that deletes personal data once it is older than allowed.
- **Break-glass**: a step that skips the normal safeguards. Use it only when the conditions written beside it are all true.

**Every block of commands starts with a line that says what it touches:** `# STAGING`, `# PRODUCTION`, or `# No environment`. A command that touches a production database says `production` twice: in the database name and in `--env production`. If the two do not agree, do not run it. No command here leaves the environment for you to fill in.

## 2. The four databases

| Environment | Database name             | Called in code | Holds                                                                                            |
| ----------- | ------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| staging     | `ocr-db-staging`          | `DB`           | Events, sponsors, short links, scan counts, the admin audit log, email subscribers.              |
| staging     | `ocr-forms-db-staging`    | `FORMS_DB`     | Registrations, check-in counts, surveys, email sign-ups, feature flags, the record of deletions. |
| production  | `ocr-db-production`       | `DB`           | The same as staging `DB`, for real visitors.                                                     |
| production  | `ocr-forms-db-production` | `FORMS_DB`     | The same as staging `FORMS_DB`, for real visitors.                                               |

Both kinds hold personal data. The forms database holds names and encrypted emails. The main database holds encrypted subscriber emails and scan rows keyed by an anonymous id. The names and ids are in `workers/oursharedevents/wrangler.toml`.

## 3. Rules that hold in every section

1. **Never delete a database.** Time Travel puts a database back in place. It cannot copy one into a new database, and Cloudflare's page describes no way to bring a deleted one back. Treat a deleted database as gone for good, history included. No step on this page deletes one, and a test fails if one is ever added (`tests/integration/runbook-dangerous-commands.test.js`).
2. **Never copy rows out.** No export files. No rows pasted into chat, a ticket, an email or a shared drive. Nothing on this page needs an export: a restore happens inside Cloudflare. If you think you need one, stop. That is an owner decision, and today no folder in this repository is set aside for it.
3. **Count, do not read.** Use `SELECT COUNT(*)` and ids. Do not run `SELECT *` on a table of people: it prints their data into your terminal and its history.
4. **Fix forward if you can.** A restore throws away everything written since the restore point.
5. **One database at a time.** Restore only the one that is damaged.

## 4. Look before you change anything

These only read. Run the block for the environment you are working on.

```bash
# STAGING: reads counts, the last migrations, and the current bookmark. Changes nothing.
cd workers/oursharedevents
npx wrangler d1 execute ocr-db-staging --env staging --remote --command "SELECT COUNT(*) AS events FROM events"
npx wrangler d1 execute ocr-db-staging --env staging --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
npx wrangler d1 execute ocr-forms-db-staging --env staging --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
npx wrangler d1 time-travel info ocr-db-staging --env staging
npx wrangler d1 time-travel info ocr-forms-db-staging --env staging
```

```bash
# PRODUCTION: reads counts, the last migrations, and the current bookmark. Changes nothing.
cd workers/oursharedevents
npx wrangler d1 execute ocr-db-production --env production --remote --command "SELECT COUNT(*) AS events FROM events"
npx wrangler d1 execute ocr-db-production --env production --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
npx wrangler d1 execute ocr-forms-db-production --env production --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
npx wrangler d1 time-travel info ocr-db-production --env production
npx wrangler d1 time-travel info ocr-forms-db-production --env production
```

Copy the two bookmarks into your incident note (§12). They are your way back to "now" if a later step goes wrong. A bookmark names no person.

## 5. Fix forward: the normal repair

Use this when you know which rows are wrong and the data to repair them still exists.

1. Write a new migration that repairs the rows. Give it the next number. Raise the matching number in `src/lib/schema-guard.ts`.
2. Open a pull request. Its checks run the migration on a test database.
3. Merge. CI applies it to staging. Check staging with §4.
4. Send it to production with [ROLLBACK.md §4](./ROLLBACK.md#4-send-the-revert-to-production). CI applies the migration, then deploys.

Never edit a migration that production has already applied. Add a new one.

## 6. Break-glass: restore a database to an earlier time

Time Travel overwrites the whole database with how it was at the restore point. Cloudflare calls this a destructive operation. Queries in flight are cancelled. It can be undone, using a bookmark.

**Who may do it:** the founder. Nobody else.

**All of these must be true:**

1. Fixing forward (§5) cannot repair it. The data is gone, or too many rows are wrong.
2. You know when the damage happened, to the minute.
3. That time is inside the Time Travel window. Cloudflare keeps 30 days on the Workers Paid plan and 7 days on the Free plan. Which plan this account is on is **not read from the repo** (§13).
4. You have chosen the one database that is damaged.
5. **If a migration did the damage:** that migration file is already fixed on `main`. If it is not, the next deploy applies it again and repeats the damage. A later migration cannot help here, because CI applies the old file first. This is the one case where an existing migration file is edited: after the restore, production has not applied it. Staging has. Restore staging to before it as well, or plan its repair in the same pull request.
6. For production: you have done this once on staging (§11).

**What you lose:**

- Everything written to that database after the restore point: new events and edits, scan counts, registrations, sign-ups, flag changes, audit log rows.
- Every deletion made since the restore point is undone. People who asked to be erased come back. Personal data that had passed its retention date comes back. §7 puts this right, within limits. Read those limits before you choose the restore point.
- In the forms database, the record of those deletions (`pii_audit_log`) goes back too. Step 3 saves it first.
- If the restore point is before a migration, the database comes back without that migration. The site then answers 503 "Schema drift" until step 8. (This follows from how Time Travel works. It has not been tried here.)

**Steps:**

1. Start an incident note (§12). Write the time now, the database, and the restore point in UTC. Write the restore point both ways: `2026-10-20T14:05:00+00:00` and `2026-10-20 14:05:00`.

2. Do §4 for that environment. Keep the bookmarks.

3. Save the list of erasures made since the restore point. Always ask the **forms** database, whichever one you are restoring. The list holds job ids, times and counts. It names no person, so it may go in the incident note.

   ```bash
   # STAGING: reads the erasure record. Changes nothing.
   cd workers/oursharedevents
   npx wrangler d1 execute ocr-forms-db-staging --env staging --remote --command "SELECT id, executed_at, records_affected, errors, details FROM pii_audit_log WHERE phase = 'data_subject_erase' AND executed_at > '<YYYY-MM-DD HH:MM:SS>' ORDER BY executed_at"
   ```

   ```bash
   # PRODUCTION: reads the erasure record. Changes nothing.
   cd workers/oursharedevents
   npx wrangler d1 execute ocr-forms-db-production --env production --remote --command "SELECT id, executed_at, records_affected, errors, details FROM pii_audit_log WHERE phase = 'data_subject_erase' AND executed_at > '<YYYY-MM-DD HH:MM:SS>' ORDER BY executed_at"
   ```

   No rows means no erasure to repeat. If there are rows, look at §7 part B now. If the damage happened after the last erasure, choose a restore point between the two and nothing needs repeating.

4. Ask Time Travel for the bookmark at the restore point. If it gives an error or no bookmark, stop: the time may be outside the window.

   ```bash
   # STAGING: reads the bookmark for one time. Changes nothing. Use the name of the damaged database.
   cd workers/oursharedevents
   npx wrangler d1 time-travel info ocr-db-staging --env staging --timestamp=<YYYY-MM-DDTHH:MM:SS+00:00>
   ```

   ```bash
   # PRODUCTION: reads the bookmark for one time. Changes nothing. Use the name of the damaged database.
   cd workers/oursharedevents
   npx wrangler d1 time-travel info ocr-db-production --env production --timestamp=<YYYY-MM-DDTHH:MM:SS+00:00>
   ```

5. Read the stop line.

   > **STOP.** Say this aloud before step 6: "I am restoring `<database-name>` in `<environment>` to `<restore point>`. Everything written to it after that time will be gone. I have saved the current bookmark and the erasure list. I will do §7 today."

6. Restore. Run **one** block: the one for the damaged database. Wrangler asks you to confirm.

   ```bash
   # STAGING, main database: overwrites ocr-db-staging.
   cd workers/oursharedevents
   npx wrangler d1 time-travel restore ocr-db-staging --env staging --timestamp=<YYYY-MM-DDTHH:MM:SS+00:00>
   ```

   ```bash
   # STAGING, forms database: overwrites ocr-forms-db-staging.
   cd workers/oursharedevents
   npx wrangler d1 time-travel restore ocr-forms-db-staging --env staging --timestamp=<YYYY-MM-DDTHH:MM:SS+00:00>
   ```

   ```bash
   # PRODUCTION, main database: overwrites ocr-db-production.
   cd workers/oursharedevents
   npx wrangler d1 time-travel restore ocr-db-production --env production --timestamp=<YYYY-MM-DDTHH:MM:SS+00:00>
   ```

   ```bash
   # PRODUCTION, forms database: overwrites ocr-forms-db-production.
   cd workers/oursharedevents
   npx wrangler d1 time-travel restore ocr-forms-db-production --env production --timestamp=<YYYY-MM-DDTHH:MM:SS+00:00>
   ```

7. Wrangler prints "To undo this operation, you can restore to the previous bookmark". Copy that bookmark into the incident note.

8. Do §4 again. Compare the top migration with the numbers in `src/lib/schema-guard.ts`. If the database is lower, run the deploy for that environment ([ROLLBACK.md §5](./ROLLBACK.md#5-every-page-answers-503-schema-drift)). It applies the missing migrations.

9. Check the site ([ROLLBACK.md §7](./ROLLBACK.md#7-check-after-any-rollback)).

10. Do §7 the same day.

**To undo a restore:** run the same block from step 6 again, with `--bookmark=<undo-bookmark>` in place of `--timestamp=...`. The stop line applies again.

## 7. After any restore: retention and erasures

A restore brings back personal data that had been deleted. This section deletes it again. It is part of the restore, not an extra.

### Part A. Retention: nothing to run, one thing to check

The nightly job runs at 03:00 UTC (`src/index.ts`). It decides what to delete from dates stored in the rows, so the next run deletes the restored rows again:

- registrations past their expiry, survey answers not yet scrubbed, and email sign-ups past their retention date (forms database);
- subscribers older than `SUBSCRIBERS_RETENTION_DAYS`, or 365 days if that is not set (main database);
- return counts made under an old pepper, up to 50,000 rows a night (main database).

Forms personal data past its retention date is deleted every night by design. A restore brings it back for one day at most.

**Limits:**

- Until the next 03:00 UTC run, the expired data is back. No command and no admin route runs the job on demand.
- The job does not repeat a deletion somebody made by hand. If one of the hand-run steps in [RUNBOOK-DEPLOYMENT.md](./RUNBOOK-DEPLOYMENT.md) (for example the purge after a pepper rotation) was done after the restore point, do it again.
- Scan rows are kept until `SCAN_RETURNS_RETENTION_DAYS` is set. It is not set in `wrangler.toml` today.

**Check, the morning after.** Each phase should show a row dated after the restore with `errors` at 0.

```bash
# STAGING: reads the record of the nightly job. Changes nothing.
cd workers/oursharedevents
npx wrangler d1 execute ocr-forms-db-staging --env staging --remote --command "SELECT phase, records_affected, errors, executed_at FROM pii_audit_log ORDER BY executed_at DESC LIMIT 6"
```

```bash
# PRODUCTION: reads the record of the nightly job. Changes nothing.
cd workers/oursharedevents
npx wrangler d1 execute ocr-forms-db-production --env production --remote --command "SELECT phase, records_affected, errors, executed_at FROM pii_audit_log ORDER BY executed_at DESC LIMIT 6"
```

### Part B. Erasures: done by hand, and only where you still hold the address

**What the system records about an erasure.** One row in `pii_audit_log` (forms database): a random job id, the time, and how many rows went from each table. The Worker log has a `DATA_SUBJECT_ERASE` line with the same id, and the admin audit log (main database) has a row with the same action name and the time. None of them says who was erased. That is on purpose (`src/handlers/data-subject.ts`, decision of 2026-10-07): anything that named the person would outlive the erasure.

**So the system can tell you that an erasure ran, when, and how much it removed. It cannot repeat one.** To repeat an erasure you need the person's email address, and the only place it can be is the request they sent you. Where those requests arrive and how long they are kept is **not read from the repo** (§13).

**Which jobs matter.** Look at `details` in the list from §6 step 3:

| You restored       | A job needs repeating if `details` shows                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| The forms database | `signupsDeleted` or `registrationsDeleted` above 0                           |
| The main database  | `subscribersDeleted`, `scanReturnsDeleted` or `anonIdReturnsDeleted` above 0 |
| Either             | `errors` above 0. The counts cannot be trusted, so repeat it.                |

**Steps, for each job that matters:**

1. Find the request by its time. Do not copy the address into the incident note, a ticket or chat.

2. Send the erasure again. The route is `POST /api/v2/admin/data-subject/erase` with the JSON body `{"email": "<address>"}`. It answers only to a member of the platform brand `ose-platform` (see "Founder platform-brand membership" in [RUNBOOK-DEPLOYMENT.md](./RUNBOOK-DEPLOYMENT.md)). There is no admin screen for it. One way that fits the Worker's rules for admin writes: sign in to `/admin`, open the browser's developer console on that page, and run the line for that site. It asks for the address in a box, so the address is not kept in the console's history. **This has not been tried while writing this page. Try it on staging in the drill (§11).**

   ```js
   // STAGING: run on a signed-in https://stg.oursharedevents.com/admin page.
   await (
     await fetch('https://stg.oursharedevents.com/api/v2/admin/data-subject/erase', {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({ email: prompt('Address to erase') }),
     })
   ).json();
   ```

   ```js
   // PRODUCTION: run on a signed-in https://oursharedevents.com/admin page.
   await (
     await fetch('https://oursharedevents.com/api/v2/admin/data-subject/erase', {
       method: 'POST',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({ email: prompt('Address to erase') }),
     })
   ).json();
   ```

3. The answer has a new `jobId` and the counts. Write the new id beside the old one in the incident note.

4. Read the new job's row. The answer says `ok: true` even when a step failed (OSE-1458), so check `errors` yourself. It must be 0.

   ```bash
   # STAGING: reads one erasure record. Changes nothing.
   cd workers/oursharedevents
   npx wrangler d1 execute ocr-forms-db-staging --env staging --remote --command "SELECT id, records_affected, errors, details FROM pii_audit_log WHERE id = '<job-id>'"
   ```

   ```bash
   # PRODUCTION: reads one erasure record. Changes nothing.
   cd workers/oursharedevents
   npx wrangler d1 execute ocr-forms-db-production --env production --remote --command "SELECT id, records_affected, errors, details FROM pii_audit_log WHERE id = '<job-id>'"
   ```

**What cannot be repeated. Say so in the incident note; do not paper over it.**

- **No address, no repeat.** If the request is gone, that person's rows are back and nothing in the system can find them. Your choices: undo the restore and pick a restore point later than that erasure, or record the gap and decide what the person is owed. That is an owner decision.
- **Scan rows.** An erasure by email no longer reaches scan rows (`scan_node_returns`, `anon_id_returns`). The link between an email and an anonymous id was removed on purpose (forms migration 0016). If an older job shows `scanReturnsDeleted` or `anonIdReturnsDeleted` above 0 and you restore the main database, those rows come back and a repeat does not remove them. They hold an anonymous id, not a name or an email.
- **A changed pepper.** Erasure finds a person by a keyed hash of their email. If `FORMS_HASH_PEPPER` changed after the restore point, the restored rows carry the old hash. The repeat finds nothing and still says `ok: true` with counts of 0. Counts of 0 where the old job had more means it did not work.
- **A lost list.** If you restored the forms database without step 3, the `pii_audit_log` rows written since are gone. The times can still be read from the admin audit log in the main database (`action = 'DATA_SUBJECT_ERASE'`) and from the Worker log. How long the Worker log is kept is **not read from the repo** (§13). If you restored both databases without step 3, only the Worker log is left.

## 8. Break-glass: a database is missing from the account

Use this only if a database no longer exists at Cloudflare: deleted by mistake in the dashboard, or by someone holding a token.

**Who may do it:** the founder. Nobody else.

**All of these must be true:**

1. The list in step 1 does not show the database's name. A database that is listed is not missing, whatever the error said.
2. You have asked Cloudflare support whether they can bring it back, and have an answer. Their public pages do not say (**not read from the repo**, §13).
3. If a token may have been used: it is revoked ([RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md)).

**What you lose:** every row that was in that database. Time Travel cannot help: there is nothing left to restore into. The nightly BigQuery copy holds listed events only, and no step to load it back has been written.

1. List the databases.

   ```bash
   # No environment: lists every D1 database in the account. Changes nothing.
   cd workers/oursharedevents
   npx wrangler d1 list
   ```

2. Read the stop line.

   > **STOP.** Say this aloud before step 3: "`<database-name>` is not in the list. Cloudflare support has answered. I am making a new, empty database with that name. The old data is not coming back by this step."

3. Make the empty database. Run **one** block: the one for the missing database.

   ```bash
   # STAGING, main database: makes a new empty ocr-db-staging.
   cd workers/oursharedevents
   npx wrangler d1 create ocr-db-staging
   ```

   ```bash
   # STAGING, forms database: makes a new empty ocr-forms-db-staging.
   cd workers/oursharedevents
   npx wrangler d1 create ocr-forms-db-staging
   ```

   ```bash
   # PRODUCTION, main database: makes a new empty ocr-db-production.
   cd workers/oursharedevents
   npx wrangler d1 create ocr-db-production
   ```

   ```bash
   # PRODUCTION, forms database: makes a new empty ocr-forms-db-production.
   cd workers/oursharedevents
   npx wrangler d1 create ocr-forms-db-production
   ```

4. Wrangler prints a new `database_id`. Put it in `workers/oursharedevents/wrangler.toml` for that environment and that database, in a pull request. Merge it.
5. Run the deploy for that environment ([ROLLBACK.md §5](./ROLLBACK.md#5-every-page-answers-503-schema-drift)). CI applies every migration to the empty database, then deploys.
6. For production: repeat the one-time data steps in [RUNBOOK-DEPLOYMENT.md](./RUNBOOK-DEPLOYMENT.md) ("First Production Launch — One-Time Data Steps"). Without them the founder's admin is empty.
7. Check the site ([ROLLBACK.md §7](./ROLLBACK.md#7-check-after-any-rollback)).

## 9. Keys and the domain

- **A secret leaked.** Follow [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md). Do not set `ADMIN_KEY`, `X_OCR_INTERNAL` or `ADMIN_TOKEN` on production: production admin is Cloudflare Access only, and the production deploy refuses to run while one is set.
- **The forms encryption key is lost.** Emails encrypted with it cannot be read again. A restore does not help: the restored rows are encrypted with the same lost key. See "Rotating FORMS_ENCRYPTION_KEY" in [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md). Whether a copy of the key is held outside Cloudflare is **not read from the repo** (§13, OSE-1483).
- **The domain does not answer.** Check <https://www.cloudflarestatus.com/> first. If Cloudflare is up, compare the Worker routes in the dashboard with the `routes` in `workers/oursharedevents/wrangler.toml`, and the DNS records with [INFRA-CHECKLIST.md](../deployment/INFRA-CHECKLIST.md). DNS records live only in the dashboard.

## 10. What holds a copy of what

| Thing                          | Where a copy is                                                                             | How it comes back                          |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Worker code                    | git, and Cloudflare's last 100 versions                                                     | [ROLLBACK.md](./ROLLBACK.md)               |
| Database rows                  | Time Travel only, inside Cloudflare, for 7 or 30 days. There is no copy outside Cloudflare. | §6                                         |
| Database shape                 | The migration files in git                                                                  | A CI deploy applies them                   |
| Listed events                  | A nightly copy in BigQuery (`runBigQueryBackup`)                                            | No step written                            |
| Secrets                        | Cloudflare holds them and never shows them. Any other copy is the founder's own (§13).      | [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md) |
| Uploads (R2), rate limits (KV) | Not covered by Time Travel                                                                  | No step written (OSE-1483)                 |

## 11. Drill on staging

Do this once before launch, and write the date and the times here. It is also the first real test of this page (OSE-1483).

1. Note the time. Register for a staging event with a test address. Note the time again: this is the restore point.
2. Erase the test address (§7 part B, step 2, staging). Read its job row.
3. Restore the staging forms database to the restore point (§6, staging blocks).
4. Confirm the registration is back. Then do §7 part B and confirm it is gone again.
5. Record how long steps 3 and 4 took, and how much was lost.

| Date        | Who | Database | Time to restore | Erased person stayed erased after §7? |
| ----------- | --- | -------- | --------------- | ------------------------------------- |
| not yet run |     |          |                 |                                       |

## 12. Incident note

Keep it outside the databases. It must hold no personal data: no names, no addresses, no rows.

```markdown
## Incident: <title>

- Started (UTC):
- Environment and database:
- What was seen:
- Restore point (UTC), both forms:
- Bookmark before the restore:
- Undo bookmark printed by the restore:
- Erasure jobs since the restore point (id, time, counts):
- Repeated as (old id → new id), or "could not repeat" and why:
- Nightly job checked on (date), errors:
- Site checked at (UTC):
- What was lost:
- What changes so this does not happen again:
```

## 13. Not read from the repo

Only Cloudflare or the founder can answer these. Read them before launch and write the answers here.

| Question                                                               | Where to look                                         | Value                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------- |
| Workers plan: Free (7 days of Time Travel) or Paid (30 days)?          | Cloudflare dashboard: the account's Workers plan      | **not read from the repo** |
| Does Time Travel answer for all four databases?                        | The `time-travel info` lines in §4                    | **not read from the repo** |
| Who can sign in to the Cloudflare account, and who holds an API token? | Cloudflare dashboard: account members, and API tokens | **not read from the repo** |
| Can Cloudflare support bring back a deleted D1 database?               | Ask support. Their Time Travel page does not say.     | **not read from the repo** |
| Where do erasure requests arrive, and how long is each request kept?   | The founder's own records                             | **not read from the repo** |
| How long are Worker logs kept?                                         | Cloudflare dashboard: the Worker's logs               | **not read from the repo** |
| Is a copy of `FORMS_ENCRYPTION_KEY` held outside Cloudflare?           | The founder's own records (OSE-1483)                  | **not read from the repo** |
| How long does a restore take? How much is lost?                        | The drill in §11                                      | **not measured**           |

## Related

- [ROLLBACK.md](./ROLLBACK.md): undo a bad deploy.
- [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md): rotate a secret.
- [RUNBOOK-DEPLOYMENT.md](./RUNBOOK-DEPLOYMENT.md): first production launch steps, hand-run data steps.
- [migrations/ROLLBACK_PLAN.md](../../workers/oursharedevents/migrations/ROLLBACK_PLAN.md): notes on each migration.
- Cloudflare, "Time Travel and backups": <https://developers.cloudflare.com/d1/reference/time-travel/> (read 2026-10-07). Source for: always on; 30 days on Workers Paid, 7 on Free; a restore overwrites in place and cancels queries in flight; it prints an undo bookmark; it cannot yet copy a database into a new one.
- Cloudflare, "Wrangler commands: D1": <https://developers.cloudflare.com/workers/wrangler/commands/d1/> (read 2026-10-07). Source for the `time-travel` and `execute` commands.
