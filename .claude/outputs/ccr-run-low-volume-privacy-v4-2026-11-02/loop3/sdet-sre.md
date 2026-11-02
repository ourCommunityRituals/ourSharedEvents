# Loop 3 (Adversarial), Sr SDET/SRE lens, epic OSE-1766, subject v4 frozen (sha256 dd9b8522...b7f4)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score and no gate decision. Basis tags: proven (a command's result this run), arithmetic, source-read, inferred. Paths are under `workers/oursharedevents/` unless they start with `.github/`, `docs/`, `scripts/`, `tests/` or `tools/`. `ci.yml` is `.github/workflows/oursharedevents-ci.yml`, line numbers as read in the `ose-clock-gate` worktree. The worktree's `ci.yml` differs from `origin/main` by 3 lines (`git diff --stat 39a63d67 HEAD -- .github`, proven).

Not my lens (left to others): R1-02 to R1-08, R1-10 (BE and DS lenses; I use R1-10 only inside C1) and R2-02.

**Drift since the freeze (proven, `gh run list/view`; recorded, not rated).** `origin/main` has moved past 39a63d67. Three push runs are newer.

- 41468851354 is `8e6d19dd`, "test: gate clocks finer than the hour on scan and identity rows (#1069)", in progress. The clock gate that subject E.1 item 1 calls "to re-raise" is therefore merging now, so R1-19 and Wave 0 are stale.
- 41468896801 is `0ebe2fdd`, "feat: the report's corridor baseline is one chain...", cancelled.
- 41468952196 is `6bdc2f90` (the CCR gate commit), pending.

## 1. Attack cards

### R1-09, a red T4 blocking Done, the production tag and the CI rollback

- **Actor:** an honest or hostile developer, or a saboteur who wants a persistent red on the staging chain.
- **Goal:** keep T4 red so no SHA reaches Done and the production tag and the CI rollback stay shut.
- **Steps**
  1. A red `T4 Functional → Staging` blocks every later Done. `deploy-production` has `needs: [... functional-staging]` (`ci.yml:2549-2570`), and Done is the T1 to T4 chain (AGENTS.md).
  2. T4 is not a merge gate, so a red does not stop merges and the damage accumulates. `required_status_checks` has 10 contexts (S0, T0 x6, reconciler, Inv #22, mobile), none of T1 to T4 (`gh api .../branches/main/protection/required_status_checks`, proven; `tools/ci/main-branch-protection.json` says so on purpose).
  3. The history shows it. Last 10 main push runs, newest first (`gh run list`, proven; durations are `updatedAt - startedAt`):

     | Run         | SHA      | Result  | Duration |
     | ----------- | -------- | ------- | -------- |
     | 41414877276 | 39a63d67 | success | 46 min   |
     | 41414837671 | 4320b2e1 | success | 22 min   |
     | 41411721564 | d0b42d7f | success | 24 min   |
     | 41401623413 | e9211436 | success | 22 min   |
     | 41343514358 | 5e0947f5 | failure | 5 min    |
     | 41340489668 | cd7f6e0d | failure | 21 min   |
     | 41277870075 | 588b8e55 | failure | 46 min   |
     | 41277855661 | f7140424 | failure | 22 min   |
     | 41168387362 | 20b45c48 | failure | 25 min   |
     | 40887461797 | adc0f8ba | success | not read |

     `classify-ci-failure.mjs --run-id` on all five failures gives the same root, `T4 ... > T4i: Language Path Prefix` (proven). `T4 Functional → Staging` is red only as a consequence. Between the last green (2026-10-29 14:01 start) and the next green (2026-11-02 06:42 start, about 22 min long), no merge SHA could reach Done: about 88 h 39 m (arithmetic). Four of the five red SHAs were unrelated merges (conformance, dependency bump) that landed on a red chain. The cause was an edge condition on staging (Bot Fight Mode, #1063/#1064), not a product defect.

  4. The CI rollback is ROLLBACK.md §3 (revert PR) then §4, `gh workflow run ... -f deploy_production=PRODUCTION` (`docs/runbooks/ROLLBACK.md` §4). That dispatch run goes through T1, T2, T3 and T4 first. A red T4 closes it.
  5. The only exit is §6 break-glass (`ROLLBACK.md`, founder only, "No test runs"). Its conditions name this case: "a staging test blocks the run and running it again did not help" (source-read).
  6. The subject adds 6 to 7 serial bash steps, S2 to S7 (S4 lives in the surfaces leg, S7 in the forms leg), to a leg that already runs longest. The surfaces leg took 08:58:59 to 09:02:29 in run 41414837671 (proven). S2 alone budgets up to 90 s + 60 s + two KV lists. Each step dies on the first transient wrangler error (`set -euo pipefail`, `trace-scan-staging.sh:28,76-83`, R1-33), and none has Playwright retries (C.0). Arithmetic: serial additions of roughly 5 to 8 min against the 30 min job ceiling (`ci.yml:1868`). Nothing in the subject measures the flake rate.
  7. Queued pushes (proven live). The push group serialises: `group: ose-<event>-<pr or ref>`, `cancel-in-progress` only for PRs (`ci.yml:150-158`). Two pushes 20 s apart give a second run that waits (run 41414877276 shows 46 min against 22 min; the same pattern in 41277870075). Right now, `8e6d19dd` is running, `0ebe2fdd` (15:10:02Z) was cancelled when `6bdc2f90` (15:10:21Z) queued behind it. So one merge SHA got no chain at all. AGENTS.md allows "a later main SHA containing it", and `git merge-base --is-ancestor 0ebe2fdd 6bdc2f90` is yes (proven), so that case is covered, but only while the later chain is green. A red later chain strands every cancelled SHA behind it.
- **Success:** the attacker holds a blocked Done and a blocked CI route to production for as long as one step stays red. The floor and never-who are not broken.
- **Does any criterion go red?** Yes. T4 itself goes red, which is the harm. Nothing in the subject goes red about the ceiling or the flake rate. The "no vacuous pass" rule (C.0) pushes toward more red, not less.
- **Verdict:** works on main (proven by the five-run window) and works after the subject ships (more steps, same dependency). The rollback leg is mitigated by §6 break-glass, which exists and names the case. Severity: see section 5.

### R2-01, staging evidence (no cross-run lock)

- **Actor:** a CI step on a same-repo `full-pipeline/*` PR, or two honest developers.
- **Goal:** main's T4 goes green on a build it did not test, or falsely red.
- **Steps**
  1. Nothing locks staging across workflows. The concurrency key is per event and ref (`ci.yml:150-158`); `staging-rollback-drill.yml:40-41` has its own group; `deploy-staging` takes `environment: staging`, which has no protection rules (`gh api .../environments`: `staging` has `rules: []`, `deployment_branch_policy: null`, proven). Staging is one Worker, `oursharedevents-stg` (`wrangler.toml:153`), and one pair of D1 databases.
  2. Timeline from main run 41414837671 (proven): T1 deploy 08:54:05 to 08:55:31 (86 s); T2 08:55:43 to 08:57:32; T3 08:57:35 to 08:58:57; T4 08:58:59 to 09:02:42.
  3. Freshness is checked once, at T4 start (`ci.yml:2001` is the only call; T2 and T3 have none). A PR deploy that lands before that check gives a false red. One that lands after it, for about 3 to 4 min of T4 plus the poll windows of S2 and S4, gives a T4 that tests build X while claiming main's SHA. It is undetected, because the stamp is read once.
  4. Opening the PR costs one push. `deploy-staging` runs for any `full-pipeline/*` head, with `if:` at `ci.yml:1191`. No reviewer is needed: `staging` has no rules. Production has `required_reviewers`; staging does not.
  5. S2's step diffs the global `scan:dedup:` prefix (K1 minus K0). Any concurrent `/q` scan on staging (a second run's trace step, a PR T4) lands in K1 minus K0. Keys with the poster name from another run fail the assertion falsely; the step also reads D1 for a counter that another run moves (control satisfied by the wrong run).
  6. Opposite risk: a schema-ahead PR. `checkSchema` refuses only when the DB is lower than the code (`schema-guard.ts:80,82`), so a PR's higher migration on staging does not 503 main's Worker. Shape-changing migrations in a PR would, though, fail main's next canonical-shape check (ROLLBACK.md §3 step 4). The epic's two migrations (0105 and forms 0019) are data-only (`UPDATE`) and cannot trip it.
- **Success:** main's SHA gets green T4 evidence for a different build (the PR must also pass), or a red it did not earn. Exposure today is low: the last 40 workflow runs show zero `full-pipeline/*` heads, and the only open PR is `chore/conformance-refresh` (`gh run list`, `gh pr list`, proven). The subject's own born-red advice ("PR author may run the script once against staging", C.0) invites the race.
- **Does any criterion go red?** None goes red when the race is lost.
- **Verdict:** works on main (config only, not run); works after the subject ships. Not blocked by any AC.

### R1-23, the T4 job holding the production deploy credential (attack as a CI step on a same-repo `full-pipeline/*` PR)

The register's root cause (T4 has no `environment:`) is wrong, and adding `environment:` to T4 changes nothing. These facts are proven by `gh`:

- `CLOUDFLARE_API_TOKEN_OSE` is a **repository** secret (`gh secret list`, updated 2026-10-20T14:07:30Z). `CLOUDFLARE_ACCOUNT_ID` too, plus `ADMIN_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `OCR_CI_EDGE_TOKEN` and `X_OCR_INTERNAL`.
- `gh secret list --env staging` and `--env production` both return nothing. Neither environment holds a secret, so the production job reads the same repo-level token as everything else.
- Environment settings: `production` has `required_reviewers` and `branch_policy` (branches `main` and tags `v*`); `staging` has no rules and no branch policy; `copilot` has none; `main-automation` has a branch policy. The `staging-pr` reviewer environment in the owner's hardening decision (2026-10-12, memory) does not exist (the environment list shows 4 names).
- `docs/security/PR_SECRET_EXPOSURE_GUARD.md` records the same gap as "verified 2026-09-26" (all sensitive secrets repo-level; environments unprotected). The production protections have been added since; the token level has not changed.

- **Actor:** a CI step on a same-repo PR. The only collaborator with push is `bereasonable13` (admin; `gh api .../collaborators`, proven). The real route is an agent. The guard doc says Claude Code PRs commit as the human and "auto-run CI with no approval gate" (source-read). A prompt-injected agent PR is the attacker; Copilot PRs are held (ADR-020).
- **Goal:** read or use the deploy token, beyond the SELECT-only S14 wrapper the subject relies on (C.2 "Threat review: limits what a compromised T4 step can do ... to reads").
- **Steps**
  1. On `pull_request` from the same repo, GitHub runs the PR head's workflow files with repo secrets. CODEOWNERS says so itself: workflow files "are protected only at MERGE time ... not at RUN time" (`.github/CODEOWNERS` comment; guard doc). The `if: startsWith(github.head_ref, 'full-pipeline/')` at `ci.yml:1191` is inside the PR-controlled file, so it is not a boundary. A step in any job of any workflow can read `secrets.CLOUDFLARE_API_TOKEN_OSE` with no `environment:`.
  2. No workflow edit is needed to reach it. T4 passes the token to steps that run PR-controlled code: `node ../../scripts/ci/d1-seed-staging.mjs` (`ci.yml:2010-2019`), `trace-scan-staging.sh` (`:2036-2048`), and whatever S14, S2, S3, S4, S6, S7 add (`staging-d1-read.mjs`, `check-*-staging.sh`). A PR that edits any of those scripts (or the SQL fixtures they apply) executes with the token in its env.
  3. The runner has outbound network and nothing here restricts egress (grep for `harden-runner` and `egress`: none, proven; `actions` allowed `all`, `sha_pinning_required: false`). GitHub log masking hides the exact value in logs only. Sending the value in an HTTP request, or encoding it, defeats masking (inferred platform behaviour, no run).
  4. What the token can do:
     - **Proven:** the production job uses the same name for `wrangler d1 migrations apply ... --env production --remote`, `wrangler secret list --env production` and the deploy (`ci.yml:2656-2712`, 2729, 2739, 2774). ROLLBACK.md says the last production deploy by this route was run 35679613677 on 2026-09-22 (source-read), so that token reached production then. The secret was re-set on 2026-10-20; its scopes today are **not** known. Same account for staging and production (`wrangler.toml:40`); both production D1 ids sit in the repo (`:316-330`).
     - **Inferred:** a PR step with the token can run `wrangler d1 execute ocr-forms-db-production --remote ...`, `wrangler deploy --env production`, and `wrangler secret list/put --env production`, without ever naming the `production` environment (reviewers and branch policy apply only to jobs that name it). Not run.
     - After S2, the subject asks the owner to add KV read to this token (C.2 "Owner actions"). For an account-scoped token that includes production's `RATE_LIMIT_KV`, so R1-01's KV half would sit one step away from any PR step.
  5. `GITHUB_TOKEN` in T4 is `contents: read, checks: write` (`ci.yml:1902-1904`); a workflow edit can declare more. See L3-SDET-1.
- **What the subject's criterion shows while this runs:** nothing is red. S14's AC1 to AC3 test a wrapper that the attacker also edits in the same PR; those tests run on PR head content in the same workflow. `check-pr-secret-exposure.mjs` is best-effort on PR-head content ("a PR that edits the workflow to neuter it runs before anyone sees it", guard doc); and the exposure has already happened at run time, before any merge-time review. T4 is green or red on its own tests either way.
- **Success:** the attacker holds the repo-level deploy token, usable against production's Worker, both D1 databases and secrets to the extent the token's scope allows (unknown). The floor and never-who are not broken by the attack itself; it is a bypass of the production approval gate and the root of R1-01 at the KV and D1 level.
- **Verdict:** works on main. The subject does not block it (S14 narrows the helper, not the token). The real fix is outside the epic: separate tokens as environment secrets, production in the `production` environment (its branch policy already refuses PR refs), staging's token resource-scoped, and reviewers on `staging`. Severity: keep High; see section 5.

### R1-01, A's at-rest promise (my part: logs, queue timestamps, KV expiry)

Platform facts I could settle from the repo:

- **KV listing returns expiry.** `KVNamespaceListKey` has `expiration?: number` (`node_modules/@cloudflare/workers-types/index.d.ts:2245-2248`, source-read). `tests/impression-dedup-hour.spec.ts:106` reads `k.expiration` from the real workers-pool KV list (source-read; emulator only). The live service behaviour is inferred from the type. The marker is written with `expirationTtl: 3600` (`src/handlers/qr-scan.ts:185`), so `expiration - 3600` is the scan second (arithmetic).
- **Queue timestamp.** `Message.timestamp: Date` exists on every queued message (`index.d.ts:2455-2462`, source-read). Its resolution, and that the dead-letter copy keeps it, are inferred.
- **Workers Logs.** On: `[observability] enabled = true` (`wrangler.toml:95-96`, top level only, none in the env blocks). Whether it is inherited into `env.staging` and `env.production` is inferred (I did not run `wrangler deploy --dry-run`, which writes `.wrangler/tmp` into the tree). Retention and whether the platform invocation line carries `/q/<token>` and its time are inferred and not stated as true; no repo file sets `head_sampling_rate` or `invocation_logs`. `docs/security/LOGGING_STANDARD.md:371` says "Worker console logs: Session only", which contradicts `wrangler.toml:95` and the repo's own spec header (`tests/e2e/0-architecture/log-redaction.invariant.spec.ts:3-5`: "retained by a third-party log store"). See L3-SDET-3.
- **Cron.** `0 3 * * *` in all three blocks (`wrangler.toml:105,231,384`, proven by read). `scheduled()` starts nine jobs together (`src/index.ts:~150-158`, `Promise.all`).

- **Actor:** an outsider holding a D1 and KV export, or a platform operator.
- **Goal:** (browser, poster, second) for a scan.
- **Steps, on main**
  1. List `RATE_LIMIT_KV` with prefix `scan:dedup:`: names are `scan:dedup:{snk1_...|raw cookie}:{pd_...}:{hour}` (`scan-buffer.ts:72-74`; the raw cookie when the pepper is unset, `qr-scan.ts:179`). That is the browser, poster and hour with no join.
  2. `expiration - 3600` gives the second.
  3. D1 rank join adds the row id (R1-10).
- **After S2** (marker is a peppered hash, AC1):
  - A holder of KV and D1 without `RATE_LIMIT_KEY_PEPPER` gets an opaque name unique per (poster, hour, person), plus the second, and nothing that identifies the person. Blocked.
  - A pepper holder tries that hour's candidate `snk1_` ids (from the same D1) against the hash and reverses it. That is an insider holding secrets, and S2's threat review says so.
  - S2 leaves the second readable: the TTL stays 3600 from the put. A cheap closing pointer (not in the subject): an absolute expiry at the hour's end.
  - D1 alone (R1-10): who-side rows (`snk1_` plus node) rank-align with placement rows, which S6 only measures.
  - Dead letters (staging only) hold keyed id, placement and hour in one message, plus the queue timestamp (`scan-buffer.ts:33-56`).
- **Does any criterion go red?** No for the DLQ pairing (accepted for the retention value, F-9), D1 rank (S6 has no pass/fail) or the readable second. m1 to m4 and AC2 to AC4 are red only on the key shape.
- **Verdict:** works on main. After the subject ships: blocked for a KV holder without the pepper; works for a pepper holder, for a D1-export holder (R1-10), and for the second via expiry.
- **Open facts:**
  - Dead-letter retention is not in the repo. The queues were created by the owner, out of band (`docs/superpowers/specs/2026-09-16-scan-write-buffer-design.md:57`), and `wrangler.toml:216-221` has no retention setting. The platform default is not stated here (inferred and unverified; the owner can read it with `wrangler queues info ose-scans-dlq` or in the dashboard).
  - Workers Logs retention is not in the repo either.

### R1-16, seal is a read-time clock (cron and queue timestamps)

- **Actor:** an organizer at a busy evening event, or an injector under RA-1.
- **Goal:** two published figures for one poster-hour that differ by 1 to 4.
- **Steps**
  1. The 03:00 job deletes and rebuilds all cells in one D1 batch (`src/lib/shared-report.ts:~880-905`): `DELETE ... WHERE event_id IN (events start_date >= ?)` then `INSERT ... SUM(CASE WHEN scans >= 5 THEN scans ELSE 0 END), computed_at = nowIso`. The INSERT has no upper bound on `scan_bucket`, so the hour that contains 03:00 UTC is stored partial (a single `computed_at` per run). A batch is one transaction, so no gap appears between delete and insert.
  2. The corridor map reads stored cells; the poster list reads raw rows live (R2 (e): `shared-report-builder.ts:722-743` vs `:835-845`). So for the hour 03:00 to 04:00 UTC, stored S (a few seconds' worth) and live L differ for about 24 h, until the next rebuild.
  3. 03:00 UTC is 22:00 EST in November (21:00 CST, 19:00 PST, 23:00 EDT in summer): a plausible late event slot (arithmetic, not data).
  4. Attacker route A, an injector: add 5 own scans in the first seconds after 03:00:00, read S = 5 + r0 and later L = 5 + r0 + r1. The difference r1 is exact for any r1. RA-1 already accepts exact recovery by padding to 5 (F-2), so route A adds nothing beyond RA-1.
  5. Attacker route B, no injection, needs at least 5 real scans at one poster inside the start-to-INSERT window (a synchronised "everyone scan now" at 22:00 EST). The window's length is a platform fact I could not read (cron start jitter and the nine concurrent jobs). Settle it cheaply: `SELECT DISTINCT computed_at FROM scan_cell_aggregates` on staging through S14's reader. `computed_at` is that run's single timestamp (`migrations/0087_scan_cell_aggregates.sql:35`; `shared-report.ts` sets one `nowIso`).
- **Does any criterion go red?** None goes red. S4's staging step seeds stored cells directly with no materializer run (C.10 "no materializer run"), and AC2 walks readers of cells, not the partial that the cron wrote.
- **Verdict:** works on main for an injector (subsumed by RA-1) and for a synchronised crowd (reach inferred). After the subject ships: not blocked. S4's bound only makes the read-time clock look like a seal. Severity: see section 5.

## 2. Attacks on the subject's own controls (faults that leave the criterion green)

1. **S2 AC1, the m1 to m4 faults, and the staging step: the marker without a TTL, or never written.**
   - The faults: drop `{ expirationTtl: 3600 }`, or never call `put`, or write the marker after the D1 write inside a swallowed `try`.
   - AC1's spy asserts the key equals an independently computed value; it asserts no put option. With no TTL the key still equals the spec's value, so m1 to m4 stay green. The staging step asserts only absence of the poster name and cookie string in K1 minus K0 (`C.8` steps 1 to 4), so a missing key set passes vacuously, and the D1 control rises either way.
   - Result: markers live forever (a permanent peppered trace per person, poster, hour; unbounded KV growth), or dedup is gone. Green. R2-12's "TTL untestable in mock" is wrong for the real miniflare KV: `tests/impression-dedup-hour.spec.ts:100-106` already asserts seconds-to-expiry through `tenv().RATE_LIMIT_KV.list()`. Only `tests/qr-scan.spec.ts`'s hand-rolled stub ignores options. S2 can assert TTL using that real binding.
2. **S3 AC1: the regex names exact keys.**
   - The fault: `console.log(JSON.stringify({ type: 'SCAN_ENQUEUED', deploymentId, eventId }))` (camelCase), or a key such as `p`, or `request.url` (the `/q/<token>` path).
   - AC1 searches for `deployment_id`, `event_id`, `scan_bucket`, `is_new_anon`, `snk1_`, `anon_`. The camelCase and path forms are not in the list. The platform still stamps the line with a time, so the poster and second are logged again. AC1 and the clock gate stay green. The staging layer for logs is "the owner reads one line after merge" (C.9), with no evidence kept (retention unknown).
3. **S4 AC2 plus the staging step: the stale partial passes as sealed.** The fault: leave the materializer as is (R1-16). A cell stored at 03:00:0x with 5 and live 7, hour long past 04:15, is "sealed" by the clock. AC2 seeds rows in an unsealed future hour and compares; the staging step seeds cell rows and raw rows and reads them (C.10 "no materializer run"). Both green; the published pair differs by 2.
4. **S14 AC1 to AC3: a SELECT that prints identity.** The fault: S7's step runs `SELECT email_encrypted, anon_key FROM form_registrations LIMIT 5` through the reader (R2-25). AC1 refuses non-SELECT, AC2 token, AC3 binding; this passes all three and writes ciphertext and keyed ids into the job log. Green. The allowlist is on statement shape, not output.
5. **C.0 "a red step turns the aggregator red": the step can be added with no `id:`.** The named-check poster reads `steps.<id>.outcome` (`ci.yml:2475-2520`); the summary and post lists are hand-maintained (C.0 says "added to the T4 summary list and the post list"). I found no test that every T4 bash step is in them (not checked exhaustively, see section 6). A step missing from the post list shows no named check; the leg still goes red on its own failure, so the aggregator stays honest. This is a gap in naming, not in truth.

## 3. Cluster tests

- **C1, scan order as a join key.**
  - Worked example. Five people scan one poster in one hour at seconds 12, 47, 130, 133, 900. The KV list gives five names with expiry = scan second + 3600. D1 `rowid` order of `scan_placement_events` gives their rank. On the queue path the consumer batch (up to 100, 5 s) can swap the 130 and 133 scans; the second clock (KV expiry, or queue `timestamp`, or a log line) restores the order. Two clocks give redundancy, not new facts.
  - What combining adds: on main KV names already pair browser and poster, so the D1 rank adds nothing for who; it adds robustness against a rank break. After S2 the KV name is opaque, so the attacker's new route is who-side rank alignment (R1-10), not KV. R1-23 widens who can read KV, but not what is in it.
  - Verdict: combining adds something only for the D1 holder after S2, through R1-10, which S6 only measures.
- **C2, withheld vocabulary.** Not my lens. One CI point: S15's staging step curls two pages (R2-05), so a surface that says "Fewer than 5" and one that shows a held bar pass together.
- **C3, scans are not people (R1-07, R1-08, R2-03).** The combination does give more than any one. R2-03's arithmetic (3 people x 2 = 6 publishes at a rotation or S2's own mid-hour deploy) needs no misconfiguration, and R1-07 means CI proves nothing about it: the staging control is green whether the marker works or not. Worked example: S2 merges at 14:30; the 14:00 hour's three people scan again after the deploy and publish 6, with every S2 criterion green.
- **C5, privacy notice.** Not my lens. One CI point: `public-claims.test.js` (S15 AC1) scans three files plus `public-claim` blocks, so the claim can be true in those and false elsewhere.
- **C6, staging evidence (R1-09 + R2-01).** Combining gives the attacker more than either. Time line from run 41414837671: a `full-pipeline/x` PR push at 09:00:30 starts a deploy that finishes about 09:01:56 (86 s, as in T1), inside the platform leg (08:58:59 to 09:02:42), after main's single freshness check. Main's T4 then tests build X: a false red (blocks Done and the production tag for main's SHA, R1-09), or a false green if X also passes. Cost to the attacker: one push on a branch with the right prefix. Detection: none; no AC watches the build stamp after T4 starts. The subject's own cure for R1-09 (born red through a dispatch or PR route) is what opens the race.

## 4. New findings

| ID        | Sev        | Slice                 | Claim                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                     | Basis                                                                                         | Root cause                                                                                                                                     | Why not already a row                                                            |
| --------- | ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| L3-SDET-1 | Medium (5) | all (CI integrity)    | A step with `checks: write` can post a check-run that satisfies a required check. The 10 required contexts are matched with `app_id` 15368 (GitHub Actions), and T4 already posts check-runs by name with `GITHUB_TOKEN` (`ci.yml:2475-2520`, `gh api -X POST .../check-runs`, `permissions: checks: write` at `:1902-1904`)                                     | `gh api .../required_status_checks`: all 10 `app=15368` (proven); `ci.yml:2488` (source-read)                                                                                                                                | Whether GitHub accepts the later forged run over a red real run of the same name is not shown | Required contexts are not bound to one workflow or job, and the T4 job holds `checks: write`                                                   | R2-15/R2-17 are about owner markers and close words; none is about forged checks |
| L3-SDET-2 | Medium (5) | S16 (and R2-15's fix) | CODEOWNERS locks are not enforced. `required_pull_request_reviews` is `null` in live protection and in `tools/ci/main-branch-protection.json` (on purpose), so the "protected at MERGE time (here)" statement in `.github/CODEOWNERS` and ADR-020 holds only if the owner reads the PR. R2-15's closed-when ("CODEOWNERS covers ADR-025") would be advisory only | `gh api .../branches/main/protection` (`rpr: null`, `enforce_admins: true`, proven); `.github/CODEOWNERS` comments (source-read); `gh api .../rulesets`: only a disabled Copilot-review rule and an active tag lock (proven) | Protection has no code-owner enforcement, and the only writer is also the only owner          | Extends R2-15 to a different root: the setting, not the AC                                                                                     |
| L3-SDET-3 | Low (2)    | S3 AC6                | `docs/security/LOGGING_STANDARD.md:371` says "Worker console logs: Session only", while Workers Logs are on and the repo's own spec header treats them as retained by a third party                                                                                                                                                                              | `LOGGING_STANDARD.md:371`; `wrangler.toml:95-96`; `log-redaction.invariant.spec.ts:3-5`                                                                                                                                      | source-read                                                                                   | A security document states a retention that the config contradicts; S3 AC6 edits that file and would add its new sentence beside the wrong row | R1-34 is about trimming a log, not this document's retention table               |

The re-rooting of R1-23 and the "staging-pr environment does not exist" fact belong to R1-23's row; they are not new rows.

Corrections to loop-2 facts (not findings):

- R2-12, "the KV stub ignores `put` options": true of `tests/qr-scan.spec.ts:47-49`'s stub only. The real workers-pool KV records expiry (`tests/impression-dedup-hour.spec.ts:100-106`).
- Subject C.2's threat review ("limits what a compromised T4 step can do with the deploy token to reads"): false by `gh secret list` and the guard doc.

Out of scope, recorded once and not rated: OSE-1780 (padding, forged cookies, the presence bit, noise), OSE-1783/1784/1787 (who-side count publication), OSE-1496 (signing). The injector variant of R1-16 is inside RA-1's accepted probe.

## 5. Re-rates with reasons

- **R1-23:** keep High. Re-root it to "the deploy token is a repository secret, reachable by any PR step; `environment:` on T4 would change nothing". If the owner confirms the token's scope covers production's D1 and secrets (not readable from the repo: `gh secret list` shows names and dates only), treat it as Critical (15): a production gate bypass reaching `FORMS_DB`. Today the scope is unknown, so it stays at the register's base tier.
- **R1-09:** keep High for "Done and the production tag blocked" (the 88 h 39 m window is the evidence). The "closes the CI rollback" part is Medium on its own: ROLLBACK.md §6 names this case ("a staging test blocks the run") as a break-glass condition, and production is closed.
- **R2-01:** keep High on config, with the note that the observed exposure today is low (zero `full-pipeline/*` runs in the last 40) and that the race window is about 3 to 4 min per T4 plus S2's poll windows.
- **R1-16:** propose Medium (a judgment for the lead). The injector route is inside RA-1's accepted exact-count probe. The no-injection route needs at least 5 real scans in the seconds after 03:00:00 UTC, and the window's length is unread. What stays real is an accuracy defect: the hour containing 03:00 UTC is published partial on the map for up to 24 h. If the owner rules the `computed_at` window is minutes (readable from staging), return to High.
- **R1-01:** keep High. After S2, a KV and D1 holder without the pepper is blocked; the pepper holder and the D1-only rank join (R1-10) are not.

## 6. Not checked, and why

- The token's real scopes, and whether production holds data: needs the Cloudflare API with the token (a credential use, out of bounds). `gh` shows names and dates only.
- Production migration level (77 vs 104): needs a production D1 read; `scripts/prod-preflight.mjs` is in no workflow.
- DLQ retention, Queues default retry delay, Workers Logs retention and invocation-line content, cron start latency: dashboard or token reads, or a run against staging. I give the one-line way to read each above.
- Whether GitHub counts a forged check-run over a red real one (L3-SDET-1): needs a PR.
- Whether `observability` is inherited into the env blocks: `wrangler deploy --dry-run` writes into the tree.
- Whether any test enforces that every T4 bash step is in the summary and post lists (section 2, item 5): not searched exhaustively.
- Cross-run staging collision, token exfiltration and check-run forgery were not run. Nothing was run against staging or production.
- R2-02 and R1-02 to R1-08, R1-10: other lenses.

## 7. Commands run (all read-only; none refused)

- Read tool: the loop-3 brief, `.claude/skills/sdet-sre.knowledge.md`, the frozen subject (lines 1 to 669), the loop-2 register.
- In the `ose-clock-gate` worktree:
  - `git log --oneline -1`; `git diff --stat 39a63d67 HEAD -- .github`; `git cat-file -t 0ebe2fdd`; `git cat-file -t 6bdc2f90`; `git merge-base --is-ancestor 0ebe2fdd 6bdc2f90`.
  - `gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 10` (and `--limit 12` with timings); `gh run list ... --limit 40` (counted by event and head branch); `gh run view <id> --json jobs/...` (41414837671, 41468951196 family: 41468952196, 41468896801, 41468851354).
  - `node scripts/ci/classify-ci-failure.mjs --run-id 41343514358`, then 41340489668, 41277870075, 41277855661, 41168387362.
  - `gh repo view`; `gh secret list`; `gh secret list --env production|staging|main-automation`; `gh variable list` (and `--env`); `gh api repos/ourCommunityRituals/ourSharedEvents/environments`; `.../environments/production/deployment-branch-policies`; `.../actions/permissions`, `.../actions/permissions/workflow`, `.../actions/permissions/fork-pr-workflows-private-repos`; `.../branches/main/protection`; `.../branches/main/protection/required_status_checks`; `.../rulesets`; `.../collaborators`; `gh pr list --state open`.
  - `sed -n` over `ci.yml` (1-160, 1105-1300, 1840-2110, 2425-2548, 2549-2600, 2640-2720), `.github/workflows/staging-rollback-drill.yml` 1-60, `wrangler.toml` (90-110, 204-232, 306-332), `src/index.ts` 120-200, `src/lib/shared-report.ts` 860-910, `src/lib/scan-buffer.ts` 25-100, `src/handlers/qr-scan.ts` 160-200, `scripts/ci/d1-seed-staging.mjs` 1-80, `scripts/ci/trace-scan-staging.sh` 20-60, `scripts/assert-deploy-freshness.mjs` 1-60, `docs/runbooks/ROLLBACK.md` (36-70, 100-160, 188-240), `docs/security/PR_SECRET_EXPOSURE_GUARD.md` 1-80, `docs/adr/ADR-020...` 1-25, `.github/CODEOWNERS` 1-30, `tools/ci/main-branch-protection.json` 1-50, `docs/security/LOGGING_STANDARD.md` 360-380, `tests/e2e/0-architecture/log-redaction.invariant.spec.ts` 1-40, `tests/impression-dedup-hour.spec.ts` 95-110.
  - `grep -n` over `ci.yml` (`environment:`, `CLOUDFLARE_API_TOKEN_OSE`, `full-pipeline`, `permissions:`, `check-runs`, job names, `assert-deploy-freshness`); over `wrangler.toml`; `grep -rn` for retention, Workers Logs, `invocation_logs`, `head_sampling`, `harden-runner`, `kv key list`, `.expiration`, `check-pr-secret-exposure`, `staging-pr`, `computed_at`, `MATERIALIZE_ERROR`; `head -c` of `scripts/check-pr-secret-exposure.allowlist.json`.
  - In `ourSharedEvents/workers/oursharedevents/node_modules/@cloudflare/workers-types/index.d.ts`: `grep -n` for `KVNamespaceListKey`, `interface Message<`, `QueueSendOptions`, `QueueRetryOptions`.
  - Small `node -e` one-liners to tally the `gh` JSON (no file writes).
- No write, test run, install, deploy, branch, commit or stash.
