# Self-hosted GitHub Actions runner — provisioning

Bloodraven (the self-hosted runner host) runs every CI workflow that uses
`runs-on: self-hosted`. Every runner instance on this host MUST satisfy the
canonical contract before it accepts jobs, or `shell: bash` workflows will
silently fail with corrupted paths.

**Brain reference:**
`OCR-docs/ocr-docs-brain/architectural-invariants.yaml` — invariant id 11
(`self_hosted_runner_bash_resolution`).

---

## The contract

> On Windows self-hosted runners, `bash` MUST resolve to Git Bash
> (`C:\Program Files\Git\usr\bin\bash.exe`), not the WSL/Store shim at
> `C:\Users\<user>\AppData\Local\Microsoft\WindowsApps\bash.EXE`.

WSL bash interprets `\` in Windows paths as an escape character, so the
script-file paths the runner generates (full of backslashes) get corrupted
the moment they're passed to any `shell: bash` step. The failure looks like:

```
/bin/bash: C:UsersmzdandevourCommunityRitualsactions-runner-2_work_tempABCD.sh: No such file or directory
##[error]Process completed with exit code 1.
```

The fix is to write a `.env` file in each runner folder that pins PATH to
put Git Bash first. The runner reads `.env` on `Runner.Listener` startup
and exports it to every job process.

---

## How to add a new runner (canonical procedure)

1. **Get a registration token** — Org Settings → Actions → Runners → New
   self-hosted runner (or repo Settings → Actions → Runners → New). Tokens
   expire in 1 hour and are single-use.

2. **Create a fresh folder** next to the existing runners:

   ```powershell
   New-Item -ItemType Directory `
     -Path C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-N -Force
   ```

3. **Extract** the runner zip into the new folder (re-use the one already
   in `actions-runner\actions-runner-win-x64-<ver>.zip`):

   ```powershell
   Expand-Archive `
     -Path C:\Users\mzdan\dev\ourCommunityRituals\actions-runner\actions-runner-win-x64-*.zip `
     -DestinationPath C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-N -Force
   ```

4. **Register** with a unique name (use the org URL for cross-repo eligibility):

   ```powershell
   cd C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-N
   .\config.cmd `
     --url https://github.com/ourCommunityRituals `
     --token <token-from-step-1> `
     --name BLOODRAVEN-N `
     --labels self-hosted,Windows,X64 `
     --work _work `
     --unattended --replace
   ```

5. **Provision the env** — this is the step every runner needs:

   ```powershell
   pwsh -File C:\Users\mzdan\dev\ourCommunityRituals\ourSharedEvents\tools\runner\provision-runner.ps1 `
     -RunnerPath C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-N
   ```

6. **Register a scheduled task** that starts the runner on user login,
   with no battery guard and 3× restart-on-failure. See
   `_install-task.ps1` in any of the actions-runner-\* folders as a
   template.

7. **Verify** before opening for traffic:
   ```powershell
   pwsh -File C:\Users\mzdan\dev\ourCommunityRituals\ourSharedEvents\tools\runner\verify-runner-env.ps1 `
     -RunnerPath C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-N
   ```
   Exit code 0 = OK. The next PR that runs against the new runner will
   also trigger the CI-side check in `.github/workflows/runner-env-validation.yml`.

---

## Troubleshooting

| Symptom                                                                                                                                   | Likely cause                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `🛑 Security Human Gate` fails in 4s with no security findings                                                                            | New runner missing `.env`; WSL bash won the PATH race                                                                                                                  | Re-run `provision-runner.ps1`, then bounce the scheduled task                                                                                                                                                                                                                  |
| `/bin/bash: <mangled path>.sh: No such file or directory`                                                                                 | Same as above                                                                                                                                                          | Same as above                                                                                                                                                                                                                                                                  |
| `verify-runner-env.ps1` exits 2 with "no .env"                                                                                            | Runner registered but never provisioned                                                                                                                                | Run `provision-runner.ps1`                                                                                                                                                                                                                                                     |
| `verify-runner-env.ps1` exits 3 with "no bash on PATH"                                                                                    | Git Bash not installed at all                                                                                                                                          | Install Git for Windows: https://git-scm.com/download/win                                                                                                                                                                                                                      |
| `Set-ScheduledTask: Access is denied`                                                                                                     | Shell isn't elevated                                                                                                                                                   | Right-click PowerShell → Run as Administrator                                                                                                                                                                                                                                  |
| `S0 Security` fails at `Set up Python` with `'python.exe' because it does not exist`                                                      | First run on a new runner. `actions/setup-python` downloaded the Python installer but its extract+symlink step failed (Windows symlinks need admin or Developer Mode). | Pre-warm the tool cache by mirroring from a known-good runner: `robocopy <good-runner>\_work\_tool\Python\3.11.9\x64 <new-runner>\_work\_tool\Python\3.11.9\x64 /E` and copy the `x64.complete` sentinel file one level up. Future setup-python runs will then hit cache.      |
| CI jobs queue indefinitely; cmd windows show no activity; diag log has `SocketException (995)` retries with no recent `Running job:` line | Listener alive-as-a-process but broker connection broken. From the operator's perspective the runner is "stuck."                                                       | Run `pwsh tools\runner\janitor.ps1 -WhatIf` to confirm which runners are stuck, then `pwsh tools\runner\janitor.ps1 -BounceStuck` to recover only the stuck ones (healthy runners keep their broker connection and their queue position).                                      |
| RAM creeping up on Bloodraven; `_work\_temp` accumulating large files                                                                     | Orphan job children — when a Worker exits, child processes (npx, node, vitest, wrangler) that it spawned can survive and hold RAM + file locks.                        | `pwsh tools\runner\janitor.ps1 -WhatIf` to see what's orphaned, then `pwsh tools\runner\janitor.ps1 -PruneOrphans` to clean up. Parent-chain-based detection (NOT process-name match) so it won't kill Firebase MCP / Cursor / Doppler / other unrelated `node.exe` processes. |

## Routine janitor maintenance

`tools/runner/janitor.ps1` is the canonical health & cleanup script.
Replaces the ad-hoc `_bounce-all-runners.ps1` at the workspace root,
which bounced ALL runners unconditionally (killing in-flight jobs on
healthy Listeners as collateral).

```powershell
# Report-only — safe to run any time, no process kills
pwsh -File tools\runner\janitor.ps1 -WhatIf

# Conservative routine maintenance (prune orphan job children only)
pwsh -File tools\runner\janitor.ps1 -PruneOrphans

# Full janitor pass (prune orphans + bounce only stuck Listeners)
pwsh -File tools\runner\janitor.ps1 -PruneOrphans -BounceStuck
```

Emits one structured JSON line per runner instance for ops grepping
(`{"type":"RUNNER_JANITOR","runner":"...","stuck":...,"orphans_pruned":...}`).
Runs without elevation — uses Stop/Start-ScheduledTask which work for
the current user's own tasks, and parent-chain orphan detection via
Win32_Process which doesn't need admin.

## Make it self-running — `install-janitor-tasks.ps1`

The runner pool's one job is to be **ready for the next run, every time**.
A janitor that runs once an hour can leave you with 60 minutes of lost
throughput per stuck Listener. Sweep 7 collapsed the earlier "hourly
prune + 6h recovery" pair into a single **1-minute readiness probe**
that catches "not-ready" _before_ a job arrives waiting.

```powershell
# Install — registers the readiness probe (no UAC needed)
pwsh -File tools\runner\install-janitor-tasks.ps1

# Preview without changes
pwsh -File tools\runner\install-janitor-tasks.ps1 -WhatIf

# Remove the task (leaves janitor script + log in place)
pwsh -File tools\runner\install-janitor-tasks.ps1 -Uninstall
```

What gets installed:

| Task                             | Cadence     | Action                     | Why this cadence                                                                                                 |
| -------------------------------- | ----------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Runner Readiness Probe (1-min)` | every 1 min | `janitor.ps1 -EnsureReady` | The pool's mandate is "be ready for the next job." Anything slower than a minute leaves throughput on the table. |

The installer also **removes the legacy hourly/6h tasks** if present —
Sweep 5/6 → Sweep 7 migration runs automatically. Re-running the
installer after upgrading the janitor will cleanly transition.

### Four signals the probe acts on (every 60 seconds)

1. **Orphan job children** — processes whose CommandLine references a
   runner `_work` path but whose parent chain doesn't reach a live
   Worker. Killed every cycle. Parent-chain filter (not process-name
   match) so it never touches Firebase MCP / Cursor / Doppler / other
   unrelated `node.exe`.
2. **Worker dwell time** — `Runner.Worker` processes alive longer than
   `WorkerDwellMaxMinutes` (default 15 min) are stuck _inside a job_,
   blocking the parent Listener from picking up the next job. Killed
   immediately; the Listener spawns a fresh Worker within seconds.
3. **Listener stuck on broker errors** — `SocketException (995)` /
   `TaskAgentJobNotFoundException` / `BrokerServer ERR` in the diag
   log within `RecentStuckMinutes` (default 3) AND no successful
   `Running job:` line in the same window. Listener gets bounced.
4. **GitHub queue depth vs local idle** — single `gh api` call per
   cycle. If GitHub has queued workflow runs but the pool reports zero
   `Runner.Worker` processes, a broker is silently broken even when
   the log hasn't caught up. The affected Listener gets bounced.

### Safety: circuit breaker

If the same runner gets bounced 3+ times in 60 minutes, the probe
**stops bouncing it** and emits a `RUNNER_POOL_DEGRADED` line for
human review. Slapping a broken machine never fixes it — and rapid
re-bouncing can mask the underlying problem (dead network, GitHub-side
deregistration, disk full). State persists in
`actions-runner\_janitor-state.json` (a small JSON file of recent
bounce timestamps per runner name).

The task itself: current user, `LogonType Interactive` (no UAC, no
stored password), `MultipleInstances IgnoreNew` (a slow cycle won't
pile up), 2-min `ExecutionTimeLimit` (safety guardrail), tolerates
battery.

Output appends to `actions-runner\_janitor.log`. Three structured
signal types to grep for:

| Signal                  | What it means                       | When to act                                                      |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `RUNNER_JANITOR`        | Per-runner per-cycle status         | Diagnostic; one per runner per minute                            |
| `RUNNER_POOL_READINESS` | Pool summary per cycle              | Diagnostic; one per minute                                       |
| `RUNNER_POOL_DEGRADED`  | Circuit breaker tripped on a runner | **Investigate** — runner won't be bounced again until <1h passes |

```powershell
# Tail in real time
Get-Content 'C:\Users\mzdan\dev\ourCommunityRituals\actions-runner\_janitor.log' -Tail 20 -Wait

# Find every circuit-breaker trip in the last day
Get-Content 'C:\Users\mzdan\dev\ourCommunityRituals\actions-runner\_janitor.log' |
  Select-String 'RUNNER_POOL_DEGRADED'
```

Verify the task is registered and look at its trigger:

```powershell
Get-ScheduledTask -TaskName 'Runner Readiness Probe (1-min)' |
  Select-Object TaskName, State
(Get-ScheduledTask -TaskName 'Runner Readiness Probe (1-min)').Triggers |
  Select-Object StartBoundary, @{n='Interval';e={$_.Repetition.Interval}}
```

Trigger an immediate readiness check (otherwise next firing is within 60s):

```powershell
Start-ScheduledTask -TaskName 'Runner Readiness Probe (1-min)'
```

### What this doesn't cover

- **Re-registering a runner that GitHub deregistered server-side.** Still
  manual — re-run `config.cmd --token <new>` per the "How to add a new
  runner" procedure above.
- **Alerting.** The janitor emits structured `RUNNER_JANITOR` JSON lines
  to the log file. For a single-dev infra that's enough; for a team you'd
  pipe these to Slack/email via a separate watcher.
- **Circuit breaker.** If a Listener keeps getting bounced every recovery
  cycle, that's a deeper problem (bad machine, bad network) that no
  janitor will fix on its own. Today: nothing detects this pattern. Watch
  the log for repeated bounces of the same `runner` name as a manual
  proxy.

## Re-provisioning an existing runner

Safe and idempotent. Re-provisioning only writes to `.env`; no GitHub-side
state changes:

```powershell
pwsh -File tools\runner\provision-runner.ps1 -RunnerPath <folder>
# Then bounce the scheduled task so Listener reloads .env:
Stop-ScheduledTask  -TaskName 'GitHubActionsRunner-<n>'
Start-ScheduledTask -TaskName 'GitHubActionsRunner-<n>'
```

An existing `.env` is automatically backed up to `.env.backup.<timestamp>`
before being overwritten.

## What the CI-side check catches

The `Runner Env Validation` workflow (`.github/workflows/runner-env-validation.yml`)
runs on every PR. It does two things:

1. Resolves `bash` via `pwsh` (won't itself trip on the WSL bug) and fails
   with a clear banner if WSL bash wins.
2. Runs a deliberate `shell: bash` step that writes a probe file to
   `RUNNER_TEMP`. If this step's script-file path itself gets corrupted,
   the workflow fails — proving the runner is unusable for production
   workflows.

Designed to fail in seconds, not minutes, and with an actionable message
instead of confusing path corruption from a downstream security workflow.
