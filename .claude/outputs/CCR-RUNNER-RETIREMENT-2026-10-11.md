# CCR: retiring the self-hosted runners (5 loops, extended scrum team)

**Date:** 2026-10-11 · **Asked by:** owner, before any delete · **Result:** NOT cleared. Stable at 50% across loops 3, 4 and 5; gate is 95%.

**Question:** is the course of action correct? The course: (1) move the last self-hosted workflow to GitHub-hosted (ourCommunityRituals/OCR-docs#162), (2) correct `CLAUDE.md` §3 DevOps (ourSharedEvents PR 934), (3) clean up: remove five scheduled tasks (A), deregister three org runners (B), delete four runner folders (C).

**State when this was written:** both pull requests were merged by the owner at 18:05Z and 18:06Z, during loop 1. Nothing in A, B or C has been run.

**Deviation from the protocol, stated:** `CLAUDE.md` is a Tier 2 governance file (5+ loops, human gate every loop). The edit was opened as a pull request before any CCR and merged before this one finished. The owner asked for five loops in one run, so the per-loop human gates are collapsed into the one gate at the end. Loops ran in sequence; evidence gathering inside a loop ran in parallel.

## Loop summary

| Loop           | Score | What it found                                                                                                                                                                                   |
| -------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Surface      | 6%    | The cleanup was proposed on a partial map: 9 of 11 repos, a literal-string search, and a delete command never checked against this machine.                                                     |
| 2 Pressure     | 43%   | Map completed and clean. Stale live guidance found in three places. Delete method changed but not rehearsed.                                                                                    |
| 3 Pressure     | 50%   | Rehearsal: the first delete command fails, the replacement fails too, a two-phase method works. New: a $50 stop-usage Actions budget against $79.61 spent this month.                           |
| 4 Confirmation | 50%   | Attacked the two-phase method: it fails on read-only files (5,407 in the real folders) unless they are cleared first. Corrected and rehearsed. The three runner tasks need an elevated session. |
| 5 Confirmation | 50%   | Re-derived the billing numbers and re-read state for drift. No new finding. Everything still open is an owner decision.                                                                         |

Loop 1 above 95% would have meant the review stopped looking. It did not.

## What is verified (evidence)

- **No workflow in the org needs a self-hosted runner.** All 69 workflow files on the default branch of all 11 repos were read for every `runs-on`: all `ubuntu-latest` or `ubuntu-24.04`. The one variable `runs-on` (hub `security-bracket.yml`, `${{ inputs.runs-on }}`) defaults to `ubuntu-latest`; its only caller passes no override. Org Actions variables: none. Repo-level runners: 0 in every repo. Queued runs: 0 in every repo.
- **The self-test works on GitHub-hosted.** OCR-docs run 38158906880: four jobs, runner label `ubuntu-latest`, log shows each composite action executing against the fixture. OCR-docs `main` is green on merge commit `ed4af017`.
- **The runners were last used on 2026-10-01** (last job log 08:48 local on all three, the self-test run). Before that: 2026-08-30. No runner process is running. Folder 4 was never registered.
- **Nothing else on the machine points at the runner folders.** PATH (user, machine), environment variables, Run keys, Startup folder: no reference. The only scheduled tasks that mention the dev root are the five listed. No other copy of a runner credential file within depth 3 of the dev root. The folders are git-ignored.
- **Every link inside the runner folders points inside them.** Walked 104,494 directories without following links, long-path aware, 0 unreadable: 1,286 directory links, 2 file links, 0 with a target outside.
- **The two probe tasks are dead.** They fire every 1 and 5 minutes at `_run-hidden.vbs`, `_probe-watchdog.ps1`, `_probe-readiness.ps1`; none of the three files exists.

## What was wrong with the first proposal

Command C was `Remove-Item -Recurse -Force` on each folder. Rehearsed on a throwaway fixture in the session scratchpad (a 495-character path, a junction to an outside folder holding a sentinel file, read-only files):

| Method                                                                               | Result on the fixture                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Remove-Item -Recurse -Force` (Windows PowerShell 5.1.26100, `LongPathsEnabled` = 0) | Fails, `DirectoryNotFoundException` on the long path. Tree left in place. |
| `[IO.Directory]::Delete(long-path form, recursive)`                                  | Fails, "Access to the path 'link-out' is denied". Tree left in place.     |
| Two-phase: unlink every link, then recursive delete                                  | Works on links and long paths. Fails on a read-only file.                 |
| Two-phase, clearing read-only first                                                  | Works. Tree gone, both outside files intact.                              |

The real folders hold paths up to 279 characters, 1,288 links and 5,407 read-only entries, so each of the first three methods would have stopped part-way and left a half-deleted tree. The outside sentinel survived in every run.

Not rehearsed: unlinking a file symlink (the fixture could not create one without elevation; the real folders have 2).

Also: the session's command guard refuses `Remove-Item` and `rd /s /q` in several forms, and this session is not elevated while the three `GitHubActionsRunner*` tasks have run level Highest. So part of A cannot be run from this session at all.

## What is not verified: the open items

| #   | Item                                            | Severity        | Why it is open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Hosted CI stays available with no fallback.** | Critical        | The org has an Actions budget of **$50 with "stop usage" on**. October so far: 63,269 Linux minutes, $379.61 gross, **$79.61 net** (the first 50,000 minutes cost nothing; the rest is $0.006 a minute). ourSharedEvents is 60,229 of those minutes. Runs still start today, so either the budget is not counted the way the usage report is, or the stop has not applied yet. This review cannot tell which. September was 41,775 minutes, $0 net. At the pace of the first 11 days October ends near 160,000 to 178,000 minutes, about $650 to $770 net. A stop would halt every workflow in the org; launch is 2026-10-24. The April note that set the "self-hosted only" rule was written after exactly this kind of stop. |
| 2   | Live guidance still says self-hosted.           | High (3 places) | OCR-docs `skills/status-rollup.md:205` ("any CI invocation runs on self-hosted"), copied into every spoke's `.ocr-standards/skills/`; `docs/skills/OCR_SKILL_statusRollup.md:122`; `docs/adr/README.md:39`; `OPERATING_SYSTEM.md:16`. #162 touched none. Editing the skill opens a propagation pull request in seven repos when merged. One memory note carrying the old rule was marked superseded during this review.                                                                                                                                                                                                                                                                                                        |
| 3   | Nothing stops `self-hosted` from coming back.   | Medium          | No check fails on `runs-on: self-hosted`. A job that names it queues and never runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Local runner scripts are not in git.            | Low             | `run-loop.cmd`, `run-named.cmd`, `_configure-task.ps1`, `_install-task.ps1`, the janitor files and `GitHubActionsRunner.task.backup.xml` exist only in the runner folders. Deleting the folders deletes them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | Governance edit merged before review.           | Medium          | Cannot be undone by this review. The sentence's claim ("the last workflow that named a self-hosted runner") was verified afterwards against all 69 files. Its clause "until that merges its jobs queue and do not run" is now history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Scoring worksheet, loop 5

Weights from the protocol. Carried, uncorrected findings take the loop-3 multiplier (× 1.5).

| Item                                                         | Tier     | Severity                   | State           | Evidence                                                                                                                                          | Deduction                |
| ------------------------------------------------------------ | -------- | -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Environmental assumptions verified                           | Base     | 15                         | Verified        | PowerShell 5.1.26100, `LongPathsEnabled` 0, session not elevated, probe scripts absent                                                            | 0                        |
| Full surface mapped                                          | Base     | 15                         | Verified        | 11 repos, 69 workflow files, machine references                                                                                                   | 0                        |
| Partial fix risk assessed                                    | Base     | 10                         | Verified        | Open items 2 and 3 named                                                                                                                          | 0                        |
| Chunk scope correctly defined                                | Base     | 10                         | Verified        | Cleanup A, B, C plus a look back at the two merged changes                                                                                        | 0                        |
| Human gate not bypassed                                      | Base     | 15                         | Verified        | No delete run; open items carried, not assumed                                                                                                    | 0                        |
| No org workflow needs a self-hosted runner                   | Variable | Critical                   | Verified        | 69 of 69 files                                                                                                                                    | 0                        |
| Delete touches nothing outside the four folders              | Variable | Critical                   | Verified        | 1,288 links, 0 outside; sentinel survived every rehearsal                                                                                         | 0                        |
| Delete completes, no half-deleted tree                       | Variable | High                       | Verified        | Two-phase with read-only clear, rehearsed. File-symlink unlink not rehearsed (2 entries), named                                                   | 0                        |
| Nothing else depends on the folders or tasks                 | Variable | High                       | Verified        | PATH, env, Run keys, Startup, tasks                                                                                                               | 0                        |
| Hosted CI stays available without the fallback               | Variable | Critical                   | Unverified      | Open item 1. 15 × 1.5, found in loop 3                                                                                                            | 22.5                     |
| Runner credentials revoked and checked before local files go | Variable | Medium                     | Verified (plan) | Order B then C, with a count check after B. Honest severity: the same disk holds an org-admin `gh` token, so the runner files add little exposure | 0                        |
| Re-provision path known                                      | Variable | Medium                     | Partial         | Open item 4. 2.5 × 1.5                                                                                                                            | 3.75                     |
| Live docs and memories agree with the decision               | Variable | High (promoted, 3+ places) | Partial         | Open item 2. 5 × 1.5 × log2(3)                                                                                                                    | 11.9                     |
| Guard against self-hosted returning                          | Variable | Medium                     | Unverified      | Open item 3. 5 × 1.5                                                                                                                              | 7.5                      |
| Governance edit reviewed before merge                        | Variable | Medium, Tier 2 × 1.25      | Partial         | Open item 5. 3.1 × 1.5                                                                                                                            | 4.7                      |
| **Total deduction**                                          |          |                            |                 |                                                                                                                                                   | **50.35**                |
| **Score**                                                    |          |                            |                 |                                                                                                                                                   | **100 − 50.35 = 49.65%** |

Earlier loops, in short: loop 1 deducted 94.25 (two unverified delete items compounding at × 1.5, six partial or unverified items); loop 2 deducted 57 (delete method unrehearsed, stale guidance promoted to High across three sources).

## By role

| Role                | Finding                                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Owner       | Direction is yours and is consistent with the code. The cost side was not on the table: $79.61 net in 11 days against a $50 stop budget.                                                                                                                                                                        |
| Lead BE Architect   | No Worker, route, migration or schema is touched. Nothing to add.                                                                                                                                                                                                                                               |
| Lead FE Integration | No surface is touched. Nothing to add.                                                                                                                                                                                                                                                                          |
| Sr Design FE        | No surface is touched. Nothing to add.                                                                                                                                                                                                                                                                          |
| Sr Automation QA    | The self-test's Windows path branch is no longer exercised (stated in #162). A rehearsal caught three delete methods that fail; no test guards against `self-hosted` returning.                                                                                                                                 |
| SRE / SDET          | With zero self-hosted runners, the Actions budget is a single point of failure for every gate in the org. No alert was found other than the budget's own email.                                                                                                                                                 |
| DevOps              | Cleanup is sound in direction. A needs an elevated session for three of five tasks. C needs the two-phase method. Export each task's XML before removing it.                                                                                                                                                    |
| Dr of Security      | The three runner tasks ran at logon with run level Highest, registered to the org-wide default runner group: removing them and the registrations reduces standing privilege. Severity of the credential files is Medium, not Critical, for the reason in the worksheet. No credential file was read or printed. |
| Sr SDET / SRE       | ourSharedEvents is 95% of hosted minutes. Each push to an open pull request cancels and restarts the run; the minutes are spent either way.                                                                                                                                                                     |
| DevOps Manager      | Budget, overage and the fallback are one decision, and it is not this review's to make.                                                                                                                                                                                                                         |
| Sr Data Scientist   | No dataset, export or count is touched. The usage report is the only data here: 41,775 minutes in September, 63,269 in the first 11 days of October.                                                                                                                                                            |

## Verdict

- **Moving to GitHub-hosted (already merged):** correct and verified.
- **Cleanup A, B, C:** correct in direction, not cleared to run as first written. C needed three corrections. A is split by privilege.
- **Not cleared at 95%.** 22.5 of the 50 points are open item 1. If the owner confirms hosted CI is funded through launch, the score is 72%; closing items 2 and 3 as well takes it to 92%; items 4 and 5 are the rest.

## Human gate: what the owner decides

1. **Budget.** Look at the org's Billing → Budgets. Either raise the Actions budget (or turn "stop usage" off) so hosted CI cannot be halted before 2026-10-24, or accept the stop and keep the runners as a fallback until after launch.
2. **Cleanup.** After 1: which of A, B, C to run, with the corrected commands below.
3. **Stale guidance.** Whether to open the OCR-docs pull request for open item 2 (it propagates to seven repos on merge).
4. **Guard.** Whether to add a check that fails on `runs-on: self-hosted`.
5. **Local scripts.** Whether anything in open item 4 is worth keeping.

## Corrected commands (none has been run)

**A1. The two dead probe tasks** (run level Limited; no fallback value either way):

```powershell
'Runner Probe Watchdog (5-min)','Runner Readiness Probe (1-min)' | ForEach-Object { Stop-ScheduledTask -TaskName $_; Unregister-ScheduledTask -TaskName $_ -Confirm:$false }
```

**A2. The three runner starters** (run level Highest: needs an elevated PowerShell, so the owner runs it). The first line saves each definition so it can be restored with `Register-ScheduledTask -Xml`:

```powershell
'GitHubActionsRunner','GitHubActionsRunner-2','GitHubActionsRunner-3' | ForEach-Object { Export-ScheduledTask -TaskName $_ | Out-File "$env:USERPROFILE\$_.task.xml" -Encoding utf8; Unregister-ScheduledTask -TaskName $_ -Confirm:$false }
```

**B. Deregister, then check the count is 0:**

```bash
gh api -X DELETE orgs/ourCommunityRituals/actions/runners/9
gh api -X DELETE orgs/ourCommunityRituals/actions/runners/11
gh api -X DELETE orgs/ourCommunityRituals/actions/runners/10
gh api orgs/ourCommunityRituals/actions/runners --jq .total_count
```

**C. Delete the four folders with the rehearsed two-phase method:** walk each folder without following links; clear the read-only flag; unlink every link (link only); then recursive delete on the long-path form; then confirm the folder is gone. About 25.6 GB. No credential file is read.
