# Rollback: undo a bad deploy

- **For:** the Cloudflare Worker and its two D1 databases.
- **Operator:** the founder, alone, at first launch.
- **Last reviewed:** 2026-10-07 (rewritten for OSE-1503).
- **Not yet practised.** The steps were written from the CI workflow and Cloudflare's documentation, and were not run. Do the staging practice at the end of §6 before launch.
- **This page is about code.** If data is wrong or missing, use [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md).

## 1. What happened, and where to go

| What you see                                                              | Go to                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Staging broke after a merge. Production is fine.                          | [§3](#3-roll-back-code-revert-through-ci)                          |
| Production broke after a deploy. Some of the site still works.            | [§3](#3-roll-back-code-revert-through-ci), then §4                 |
| Production is down for every visitor, and §3 and §4 cannot bring it back. | [§6 break-glass](#6-break-glass-switch-production-back-outside-ci) |
| Every page answers 503 "Schema drift — refusing to serve".                | [§5](#5-every-page-answers-503-schema-drift)                       |
| A migration or a bad write damaged data.                                  | [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md)                     |
| A secret leaked or was lost.                                              | [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md)                         |

Words used on this page:

- **Worker**: the program Cloudflare runs to serve the site.
- **Deploy**: put a new build of the Worker live.
- **CI**: the GitHub Actions workflow `OurSharedEvents CI/CD`. It tests the code, deploys staging, tests staging, then deploys production.
- **Migration**: a numbered SQL file that changes a database. Migrations only go forward.
- **Break-glass**: a step that skips the normal safeguards. Use it only when the conditions written beside it are all true.

**Every block of commands starts with a line that says what it touches:** `# STAGING`, `# PRODUCTION`, or `# No environment` (git only). A command that changes production also has the word `production` in it. No command here leaves the environment for you to fill in.

## 2. Read first: what a rollback does not undo

A rollback changes which code runs. It changes nothing else.

- **Migrations stay applied.** CI applies migrations before it deploys the Worker, and there is no step that reverses one. After a rollback the old code runs against the new database.
- **Data stays as the bad code left it.** Rows it wrote, changed or deleted are not put back.
- **Nightly deletions are not undone.** The 03:00 UTC job deletes expired personal data for good.
- **Secrets, the uploads bucket (R2) and the rate-limit store (KV) are not touched.**

Old code usually runs fine on a newer database, because most migrations only add things. The Worker's start-up check (`src/lib/schema-guard.ts`) accepts a database that is ahead of the code. It does not help if a migration **removed or renamed** something the old code reads. Then going back is not possible: fix forward with new code.

## 3. Roll back code: revert through CI

This is the normal path. The revert is tested and deployed exactly like any other change.

1. Find the change that broke it.

   ```bash
   # No environment: this only reads git.
   git fetch origin
   git log --oneline -10 origin/main
   ```

2. Check whether that change added a migration.

   ```bash
   # No environment: this only reads git. Put the commit id in place of <sha>.
   git show --stat <sha> -- workers/oursharedevents/migrations workers/oursharedevents/migrations-forms
   ```

3. Make the revert on a branch. Do not push to `main`: branch protection refuses it (`tools/ci/main-branch-protection.json`).

   ```bash
   # No environment: this only changes git.
   git switch -c revert-bad-change origin/main
   git revert --no-commit <sha>
   ```

4. **If step 2 listed a migration, keep it.** The databases have already applied it. A checkout without the file fails the deploy, because CI compares the live tables and columns with the migration files and stops on anything extra (`workers/oursharedevents/scripts/verify-d1-canonical-shape.mjs`). Put these back before you commit:

   ```bash
   # No environment: this only changes git.
   git restore --staged --worktree --source=HEAD -- \
     workers/oursharedevents/migrations \
     workers/oursharedevents/migrations-forms \
     workers/oursharedevents/src/lib/schema-guard.ts \
     workers/oursharedevents/tests/migration-smoke.spec.ts \
     workers/oursharedevents/tests/constraints.spec.ts
   ```

5. Commit, push, open the pull request, and merge it when its checks are green. If a check fails on a table or column list, it names another file that belongs to the migration: put that one back too.

   ```bash
   # No environment: this only changes git.
   git commit -m "Revert the change that broke <what>"
   git push -u origin revert-bad-change
   gh pr create --fill
   ```

6. The merge deploys **staging** by itself. Watch it, then run the checks in [§7](#7-check-after-any-rollback).

   ```bash
   # STAGING: reads the runs that deploy staging.
   gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 3
   ```

If production was never given the bad code, stop here.

## 4. Send the revert to production

Production deploys only from CI, and only after the staging tests pass for the same commit.

1. Start the run.

   ```bash
   # PRODUCTION: deploys main to production if the staging tests pass.
   gh workflow run "OurSharedEvents CI/CD" --ref main -f deploy_production=PRODUCTION
   ```

2. Watch it.

   ```bash
   # PRODUCTION: reads the run you just started.
   gh run list --workflow "OurSharedEvents CI/CD" --event workflow_dispatch --limit 1
   ```

3. When `T1 Deploy → Production` and `T2 Smoke → Production` are green, run the checks in [§7](#7-check-after-any-rollback).

Things to know:

- **How long.** The last production deploy by this route took 24 minutes from start to the end of the production smoke test (run 35679613677, 2026-09-22). Add about 10 minutes for the pull request's own checks. Plan on 35 minutes or more.
- **The run refuses to deploy production while `ADMIN_KEY`, `X_OCR_INTERNAL` or `ADMIN_TOKEN` is set on the production Worker** (the "ADR-012 gate R2" step in `deploy-production`). Do not set one of them "to get in" during an incident. It blocks the way out.
- **A red staging test blocks production.** If it failed for a reason that has nothing to do with the bug, run the failed jobs again from the run's page. If production is down and this still blocks you, go to §6.
- **A release tag does the same thing.** Pushing a tag named `vX.Y.Z` starts the same run. There is no earlier tag to go back to: on 2026-10-07 the repository had no `v` tags at all.

## 5. Every page answers 503 "Schema drift"

**What it means.** The Worker needs a higher migration than the database has. `/health` still answers; every other page is refused on purpose, so nobody writes to a database the code does not match.

**How it happens.** A database was restored to an earlier time, or a Worker was deployed outside CI.

**Fix.** Run the deploy for that environment. It applies the missing migrations first.

```bash
# STAGING: applies migrations to the staging databases, then deploys staging.
gh workflow run "OurSharedEvents CI/CD" --ref main -f deploy_staging=true
```

```bash
# PRODUCTION: applies migrations to the production databases, then deploys production.
gh workflow run "OurSharedEvents CI/CD" --ref main -f deploy_production=PRODUCTION
```

Do not apply migrations to production from a laptop.

## 6. Break-glass: switch production back, outside CI

Cloudflare can make any of a Worker's last 100 versions live again, at once. This skips CI, so it is break-glass.

**Who may do it:** the founder. Nobody else.

**All of these must be true:**

1. Production is failing for visitors now. The production check in §7 fails.
2. The failure began with a Worker deploy.
3. §3 and §4 cannot bring it back in time: CI is down, or a staging test blocks the run and running it again did not help.
4. No migration that removes or renames anything landed between the version you are going back to and the one that is live. Check with the command in §3 step 2.

**What you give up:**

- No test runs. The static-admin-credential check and the Cloudflare Access check do not run either.
- Production stops matching `main`. The next production deploy ships `main` again, bad code included, until §3 is merged.
- An older version brings back the bindings it was built with. Cloudflare's rollback page does not say whether secret values go back too; its secrets page says that setting or deleting a secret makes a new version. Treat it as possible and check in step 4.
- The databases are not changed.

> **STOP.** Say this aloud before step 2: "I am switching the **production** Worker back to version `<version-id>`. CI will not test it. I will open the revert pull request today."

1. List the versions. Write down the id of the last good one and the id that is live now.

   ```bash
   # PRODUCTION: reads the version list. Changes nothing.
   cd workers/oursharedevents
   npx wrangler deployments list --env production
   ```

2. Switch back.

   ```bash
   # PRODUCTION: makes an older version of the Worker live.
   cd workers/oursharedevents
   npx wrangler rollback <version-id> --env production --message "<why, in a few words>"
   ```

   The same thing from the dashboard: Workers & Pages → `oursharedevents-prod` → Deployments → the three dots beside the version → Rollback.

3. Run the production check in §7.

4. Read the secret names. The values are never shown.

   ```bash
   # PRODUCTION: lists secret names only.
   cd workers/oursharedevents
   npx wrangler secret list --env production
   ```

   `ADMIN_KEY`, `X_OCR_INTERNAL` and `ADMIN_TOKEN` must not be in the list. `SHARED_REPORT_SIGNING_SECRET`, `FORMS_ENCRYPTION_KEY`, `FORMS_HASH_PEPPER`, `RATE_LIMIT_KEY_PEPPER` and `ANON_ID_HASH_PEPPER` must be.

5. The same day: do §3, then §4, so `main` and production match again. Merge nothing else until then.

To practise, do steps 1 to 3 on staging. Staging needs no break-glass conditions.

```bash
# STAGING: makes the previous version of the staging Worker live.
cd workers/oursharedevents
npx wrangler deployments list --env staging
npx wrangler rollback <version-id> --env staging --message "rollback drill"
```

## 7. Check after any rollback

```bash
# STAGING
curl -s https://stg.oursharedevents.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://stg.oursharedevents.com/events
```

```bash
# PRODUCTION
curl -s https://oursharedevents.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://oursharedevents.com/events
```

Good looks like this:

- `/health` shows `"ok": true`, `"db": "ok"`, and the right `"env"`.
- `"version"` names the commit you expect (`stg-<sha>-<date>` or `prod-<sha>-<date>`).
- `/events` answers `200`.
- Sign in to `/admin` in a browser and open one event.

Do not test admin with a key in a `curl` command. Production has no admin key, and a key typed into a terminal stays in its history.

## 8. Which rollback tools are real

Read from the repository on 2026-10-07.

| Tool                                                                         | Real? | Notes                                                                                                           |
| ---------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| Revert pull request, then a production run (§3, §4)                          | Yes   | The only path CI tests.                                                                                         |
| Deploy an older tag                                                          | No    | There are no `v` tags. An older commit also fails the deploy if any migration has landed since (see §3 step 4). |
| `wrangler rollback`, or Rollback in the dashboard (§6)                       | Yes   | A Cloudflare feature. No workflow in this repository runs it. Break-glass only on production.                   |
| `npm run rollback:staging`, `rollback:prod`, `rollback:all`, `rollback:list` | No    | `scripts/rollback-worker.mjs` runs from a folder named `cloudflare-proxy/`, which no longer exists.             |
| `npm run deploy:rollback`                                                    | No    | It prints steps for the old Apps Script system.                                                                 |
| Reversing a migration                                                        | No    | Forward-only. See [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md).                                               |

## 9. Not read from the repo

These decide how a rollback goes, and only GitHub or Cloudflare can show them. Read them before launch and write the answer here.

| Question                                                                               | Where to look                                                      | Value                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| Does the `production` GitHub environment wait for an approval? From which branches?    | GitHub: the repository's settings for the `production` environment | **not read from the repo** |
| Is the founder's laptop signed in to Cloudflare with rights on `oursharedevents-prod`? | `npx wrangler whoami` on that laptop                               | **not read from the repo** |
| Who else can sign in to the Cloudflare account?                                        | Cloudflare dashboard: account members                              | **not read from the repo** |
| Does a rolled-back Worker version bring its old secret values with it?                 | Not stated on Cloudflare's rollback page. Try it on staging.       | **not read from the repo** |
| Is live branch protection the same as `tools/ci/main-branch-protection.json`?          | The nightly `branch-protection-drift.yml` run                      | **not read from the repo** |

## Related

- [DISASTER-RECOVERY.md](./DISASTER-RECOVERY.md): data loss, restoring a database, what to do after a restore.
- [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md): rotating a secret.
- [RUNBOOK-DEPLOYMENT.md](./RUNBOOK-DEPLOYMENT.md): first production launch steps.
- Cloudflare, "Rollbacks": <https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/> (read 2026-10-07).
- Cloudflare, "Secrets": <https://developers.cloudflare.com/workers/configuration/secrets/> (read 2026-10-07).
