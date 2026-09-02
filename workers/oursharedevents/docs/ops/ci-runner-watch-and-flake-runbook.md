# CI Watch & Self-Hosted Runner Flake Runbook

> **RETIRED 2026-09-02 (OSE-1194).** The self-hosted runner fleet (BLOODRAVEN, -2, -3) was
> decommissioned; every OSE workflow runs on GitHub-hosted `ubuntu-latest`. The runner-restart and
> janitor procedures below no longer apply — `tools/runner/` was deleted and brain invariants #11/#12
> are `retired`. Kept as the incident record for the 2026-08-13 worst case (§8); do not follow §1–§7.

**Audience:** whoever (human or Claude) is shepherding a PR through CI to merge.
**Scope:** the OSE `oursharedevents-ci.yml` pipeline on the self-hosted runner fleet.
**Why this exists:** ~1/3 of runs hit a **runner-2 flake** (a job dispatches to
`BLOODRAVEN-2` and hangs with no logs). This runbook is the deterministic decision
flow for watching a PR to green, diagnosing a flake, and restarting a runner
**without collateral damage**. It is written from a real worst-case incident
(2026-08-13, §8) so the whole process is legible and repeatable.

> **Prime directive:** never bypass a required gate and never bounce a runner that
> is doing productive work. A flake is re-run, not merged around. A real failure is
> fixed, not restarted.

---

## 1. The players

**Runners (self-hosted, on the operator's Windows box):**

| Registered name | Scope          | Scheduled task          | Dir                  | Notes                                                                                                                                                                              |
| --------------- | -------------- | ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOODRAVEN`    | **org-level**  | `GitHubActionsRunner`   | `…\actions-runner`   | **Always-on primary** org executor (re-registered 2026-08-16, COST-221). Second org executor means the hub's independent downstream jobs run concurrently instead of serial (§11). |
| `BLOODRAVEN-2`  | **org-level**  | `GitHubActionsRunner-2` | `…\actions-runner-2` | The **flaky** one (~1/3 no-log hangs). Not visible via the repo runners API (org endpoint only).                                                                                   |
| `BLOODRAVEN-3`  | **repo-level** | `GitHubActionsRunner-3` | `…\actions-runner-3` | Visible via `repos/.../actions/runners`. Generally healthy. OSE-only — does **not** serve the org/hub.                                                                             |

> **Org runners are visible only via the org endpoint:**
> `gh api orgs/ourCommunityRituals/actions/runners`. The repo endpoint
> (`repos/…/actions/runners`) shows `BLOODRAVEN-3` only. `runner_name` is `null`
> in completed-run job JSON for self-hosted runners — use **overlapping
> `startedAt`/`completedAt` timestamps** as the proof two jobs ran in parallel.

**Required gates (branch protection — must be green to merge):**
`S0 Security` · `S2 Post-Execution Security` · `T0 Gate (lint | tests | typecheck | invariants | a11y)`.

**Non-required (informational — a red here does NOT block merge):**
`Validate against OCR-docs brain` (chronically red from conformance drift
OSE-663/662/564/560/557 — do not chase it during a merge), `Claude PR Review`.

**Security brackets:** `S0` runs first (pre-execution), `S2` last
(post-execution). Both run on the self-hosted fleet, so both are flake-exposed.

---

## 2. The watch loop

```
gh pr checks <PR> --repo ourCommunityRituals/ourSharedEvents --required
```

Poll until every required check is terminal (`pass`/`fail`). For anything not
`pass`, run the **decision train** (§3). Prefer a background watcher over manual
polling; wake on completion.

Useful lenses:

```
gh run list   --repo <R> --status in_progress          # what's actually running
gh run list   --repo <R> --status queued               # what's waiting for a runner
gh api repos/<R>/actions/runs/<RUN_ID>/jobs --jq '.jobs[] | {name,status,runner:.runner_name,started:.started_at}'
gh api repos/<R>/actions/runners --jq '.runners[] | {name,status,busy}'   # repo runners only
```

---

## 3. The decision train

For each non-passing **required** check, classify and act:

| #   | Signal                                                                                                                        | Meaning                      | Action                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| 1   | `pass`                                                                                                                        | done                         | —                                                        |
| 2   | `pending`/`in_progress`, a runner is **actively executing it** (job `started_at` recent, `*` marker, elapsed ≈ normal)        | healthy, just running        | **WAIT**                                                 |
| 3   | `pending`/`queued` long, **no** runner executing it, others idle/offline                                                      | runner starvation            | **restart candidate** (§4/§5)                            |
| 4   | `in_progress` **far past its normal duration** (e.g. S2 at 30 min vs ~2 min baseline) with no log progress, on `BLOODRAVEN-2` | the runner-2 **no-log hang** | **restart candidate** (§4/§5)                            |
| 5   | `fail` with an **infra signature** (job never started / "runner lost" / no logs)                                              | flake                        | **re-run** (§6); if it can't get a runner, restart first |
| 6   | `fail` with **real** test/lint/type/invariant output                                                                          | genuine failure              | **STOP. Fix the code.** Never restart, never bypass.     |

Baselines to compare against (this pipeline): `S0` ≈ 2 min, `S2` ≈ 2 min,
`T0 typecheck/invariants` < 1 min, `T0 tests` ≈ 5 min, `T0 lint/a11y` ≈ 1–1.5 min.
Anything **>5× its baseline** on `BLOODRAVEN-2` is almost certainly the hang.

---

## 4. The restart **safety gate** (the rule that prevents collateral damage)

The bounce scripts stop/start **both** `GitHubActionsRunner-2` **and** `-3`.
Bouncing a runner **kills whatever job it is currently running.** So:

> **Before any restart, prove that no _productive_ job will die.**
> Check `gh run list --status in_progress` and each in-progress job's
> `runner_name`. A restart is only safe when the runner(s) you bounce are running
> **nothing**, or running **only the hung job you intend to kill**.

Two outcomes:

- **Both runners idle, or the only busy one holds the hung job** → the full
  `_bounce-runners-noelev.ps1` is safe.
- **The healthy runner is running a real job** (e.g. another PR's `T0 tests` on
  `BLOODRAVEN-3`) → **do NOT run the both-runners script.** Bounce **only the
  offending runner** (§5, targeted). This is the common case and the one the
  worked example (§8) hits.

---

## 5. Restart mechanics

**Canonical script (bounces BOTH runners, no elevation):**
`…\ourCommunityRituals\_bounce-runners-noelev.ps1`
Strategy: `Stop-ScheduledTask` per task → fall back to **path-scoped** process
kill (only processes under that runner's dir) → `Start-ScheduledTask`. Use this
**only** when §4 clears both runners.

**Targeted single-runner bounce (spares the other) — the safe default during
contention.** Runner-2 only:

```powershell
$task='GitHubActionsRunner-2'; $path='C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-2'
try { Stop-ScheduledTask -TaskName $task -ErrorAction Stop }
catch { Get-Process Runner.Listener,Runner.Worker -EA SilentlyContinue |
        ? { $_.Path -and $_.Path.StartsWith($path) } | Stop-Process -Force -EA SilentlyContinue }
# wait until runner-2's listener is gone, then:
Start-ScheduledTask -TaskName $task
```

Verify by `StartTime`, not by name (Path may be blank without elevation): the
**older** listener PID is the untouched runner; a **new** listener PID (just now)
is the one you restarted.

> These are `noelev` (no admin) operations — `Stop/Start-ScheduledTask` on the
> operator's own tasks. They have worked in this environment before. If they ever
> require elevation, ask the operator to run the script via `! <path>`.

---

## 6. Recovery — re-running a flaked gate

Killing a runner mid-job marks that job `failure` (`conclusion: failure`, runner
lost). To re-run **only** the failed gate:

```
gh run rerun <RUN_ID> --repo <R> --failed
```

**Gotcha:** a single-job re-run (`--job <ID>`) is often rejected
("cannot be rerun"), and `--failed` is rejected while the run is still open
("This workflow is already running"). A run stays open until its terminal
**`Pipeline Summary`** job runs. So the sequence is:

1. Restart the runner (§5) → the hung job flips to `failure`.
2. Let the run **conclude** (its `Pipeline Summary` picks up the now-free runner).
3. `gh run rerun <RUN_ID> --failed` → the flaked gate (and summary) re-run on a
   healthy runner and go green in ~baseline time.

---

## 7. Merge sequence (stacked PRs)

1. Merge only when **all required** checks are green (non-required red is fine —
   see §1).
2. For a stack, merge **bottom-up**; after each parent lands, **rebase the child
   onto the new `main`** (`git rebase --onto origin/main <old-base> <child>`),
   push, let CI re-run, then merge.
3. **Never** `--delete-branch` a base branch mid-sequence — it closes the child
   PR instead of retargeting. Retarget the child first, then delete.
4. `--admin` merge is **not** available here (branch protection forbids the
   bypass), which is correct: it forces flakes to be re-run, not skipped.

---

## 8. Worked example — 2026-08-13, P0 #323 `S2` hang (real incident)

**Situation.** Two PRs in flight: P0 **#323** (payment ops) and P1 **#322**
(eligibility gate). P0's required gates were all green **except `S2`, pending for
30+ minutes** (baseline ~2 min). P1 was `queued`.

**Diagnosis (§3, row 4).**

```
gh api …/jobs/<S2> → { status: in_progress, runner_name: BLOODRAVEN-2, started_at: 14:12:10Z }
```

`S2` had been _in_progress on `BLOODRAVEN-2` for ~30 min_ — >15× baseline, on the
known-flaky runner, no log progress. **Classification: the runner-2 no-log hang.**

**Safety gate (§4) — this is the crux.** Naively bouncing both runners would have
worked for S2, but:

```
gh api …/runs/<P1_RUN>/jobs → "T0 Gate (tests)": in_progress on BLOODRAVEN-3
```

**`BLOODRAVEN-3` was productively running P1's test gate.** The both-runners script
would have killed it. So the gate said: **bounce runner-2 ONLY.**

**Action (§5, targeted).** `Stop`/`Start-ScheduledTask GitHubActionsRunner-2`.
Verification by `StartTime`:

- `PID 40140` (StartTime 9:12) — untouched = `BLOODRAVEN-3`, **P1 tests kept
  running.** ✓
- `PID 51328` (StartTime 9:40, new) — restarted runner-2; old hung PID gone. ✓

**Result.** `S2` flipped to `conclusion: failure` (runner lost) — exactly as
intended — while `T0 Gate (tests)` on `BLOODRAVEN-3` stayed `in_progress`,
**zero collateral damage.**

**Recovery (§6).** `--job` and `--failed` were both rejected until the run's
`Pipeline Summary` concluded; then `gh run rerun <RUN> --failed` re-ran `S2` on a
healthy runner. → P0 green → merge → rebase/merge P1 (§7).

**Lesson.** The flake itself is trivial (restart + re-run). The thing that makes
this _safe_ is the §4 gate: **always identify what each runner is executing before
you bounce, and prefer the targeted single-runner restart during contention.**

---

## 9. Anti-patterns (never do)

- ❌ Bounce runners without checking in-progress jobs first (§4).
- ❌ Run the both-runners script when the healthy runner has a real job — bounce
  the offending runner only.
- ❌ Treat a `fail` with real test/lint output as a flake. Read the logs; if it's
  a genuine failure, **fix it** (operator feedback: _"do not proceed past a
  failure. Fix the failing step. This is its purpose."_).
- ❌ Chase the non-required `Validate against OCR-docs brain` red during a merge —
  it's pre-existing conformance drift, not your PR.
- ❌ `--admin`/force-merge around a red required gate.

---

## 10. Quick reference

```
# Watch
gh pr checks <PR> --repo <R> --required
gh api repos/<R>/actions/runs/<RUN>/jobs --jq '.jobs[]|{name,status,runner:.runner_name,started:.started_at}'
gh api repos/<R>/actions/runners --jq '.runners[]|{name,status,busy}'

# Targeted runner-2 bounce (spares runner-3)  — PowerShell
Stop-ScheduledTask -TaskName GitHubActionsRunner-2 ; Start-ScheduledTask -TaskName GitHubActionsRunner-2

# Both runners (only when both are clear)
powershell -File C:\Users\mzdan\dev\ourCommunityRituals\_bounce-runners-noelev.ps1

# Re-run the flaked gate (after the run concludes)
gh run rerun <RUN> --repo <R> --failed

# Merge, then rebase the child of a stack
gh pr merge <PR> --repo <R> --squash
git rebase --onto origin/main <old-base> <child-branch>
```

> Root cause of the flake is tracked separately (runner-2 mis-provisioning). Until
> it's fixed, this runbook is the operational workaround — re-run, don't bypass.

---

## 11. Org-executor parallelism (COST-221)

The hub `ci.yml` runs a `gate` job, then three **independent** downstream jobs
that only `needs: [gate]` with no ordering between them —
`Vision invariants`, `Brain parity`, `Shared security_gate.py drift`. They
parallelize **automatically the moment ≥2 org-level executors are online**; there
is **no YAML change that fixes serialization** — matrix concurrency still needs
real executors. With a single online org runner all three sat serial behind it
(the SPOF this ticket named).

**Topology:** keep **two** always-on org executors — `BLOODRAVEN` (primary) and
`BLOODRAVEN-2`. Both scheduled tasks carry the same durable config (logon
trigger, `RestartCount=3` @ 1 min, `StartWhenAvailable=True`), so a transient
outage self-heals. `BLOODRAVEN-3` is repo-level OSE-only and does not count
toward hub parallelism.

**Validation (acceptance).** Re-run a hub `ci.yml` run and confirm the downstream
jobs **overlap**:

```
gh run view <RUN_ID> --repo ourCommunityRituals/ourCommunityRituals \
  --json jobs --jq '.jobs[] | "\(.name)  start=\(.startedAt)  end=\(.completedAt)"'
```

Two of the three should share a start second (2-way parallelism with 2
executors); wall-clock from gate-done → all-downstream-done drops toward the
slowest single job instead of the serial sum (observed 2026-08-16: **133s → 61s**).
Full 3-way concurrency would require a **third** org executor.

### Re-registering a dropped org runner

If an org runner falls out of the org list (stale local creds, a plain
`Start-ScheduledTask` can't reconnect), re-register it from the workspace root in
an **elevated** shell with `gh` authed as an org admin:

```powershell
.\_reregister-bloodraven-org.ps1   # mint org token → clear stale reg → config --replace → start → verify
```

> **⚠️ Prefix-match lesson (2026-08-16).** An early version of that script killed
> stale listeners by `ExecutablePath.StartsWith('…\actions-runner')` — which also
> prefix-matches `actions-runner-2` and `actions-runner-3`, so it took **all three
> runners dark at once**. Always match on the runner dir **plus a trailing
> separator** (`…\actions-runner\`). Recovery is cheap — the sibling runners' config
> is intact, only their listeners were killed, so
> `Start-ScheduledTask GitHubActionsRunner-2` / `-3` brings them back. Two other
> gotchas in the same script: delete `.runner_migrated` alongside
> `.runner`/`.credentials*` (runner ≥ v2.336 treats that marker as "already
> configured" and `config.cmd` refuses), and avoid inline `=="NAME"` jq string
> literals in Windows PowerShell (the inner double-quotes are stripped → jq reads
> the bare name as an undefined function).

---

## 12. Runner window verbosity (COST-222)

By default the runner's `run.cmd` console prints only `Running job:` /
`Job … completed` — opaque about what is executing where. Two levers make it
legible:

1. **Full trace in the runner window.** The canonical runner `.env` (written by
   `tools/runner/provision-runner.ps1`) sets:

   ```
   ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1
   ```

   This mirrors the full listener/job trace to the console window. The verifier
   (`verify-runner-env.ps1`) reads only the `PATH=` line, so this extra var does
   not affect the invariant-#11 bash-resolution check. It applies to **every repo
   this org runner serves** — that's intended (one window, all jobs legible).
   Do **not** put `ACTIONS_STEP_DEBUG` / `ACTIONS_RUNNER_DEBUG` here: in `.env`
   they are org-wide and very noisy — set those as **per-repo Actions Variables**
   when you want a one-off debug run.

   > **Editing `.env` by hand:** the file has no trailing newline, so
   > `Add-Content` glues the new var onto the end of the `PATH=` line. Rewrite it
   > as a clean multi-line file
   > (`[IO.File]::WriteAllText($p, "PATH=…`nACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1", [Text.Encoding]::ASCII)`)
or just re-run the provisioner. Bounce the runner (§5) so the Listener reloads
`.env`.

2. **Repo / PR / Linear "up front."** The runner can't know PR or Linear context —
   that lives in the workflow. The hub composite action
   `.github/actions/context-banner` prints repo / PR # + title / branch / actor /
   SHA / runner + any Linear IDs parsed from the branch and PR title, as the first
   post-checkout step of every hub CI job (and into the job summary). Combined with
   lever 1 it appears in the runner window too. Untrusted values (PR title, branch)
   are passed via `env:`, never interpolated inline — avoids shell injection.
