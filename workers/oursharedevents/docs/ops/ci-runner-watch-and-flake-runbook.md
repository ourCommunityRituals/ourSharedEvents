# CI Watch & Self-Hosted Runner Flake Runbook

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

| Registered name | Scope          | Scheduled task          | Dir                  | Notes                                                                                            |
| --------------- | -------------- | ----------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `BLOODRAVEN-2`  | **org-level**  | `GitHubActionsRunner-2` | `…\actions-runner-2` | The **flaky** one (~1/3 no-log hangs). Not visible via the repo runners API (org endpoint only). |
| `BLOODRAVEN-3`  | **repo-level** | `GitHubActionsRunner-3` | `…\actions-runner-3` | Visible via `repos/.../actions/runners`. Generally healthy.                                      |

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
