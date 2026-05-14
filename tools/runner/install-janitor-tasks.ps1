<#
.SYNOPSIS
  Install (or remove) the two scheduled tasks that make the runner pool
  self-healing: hourly orphan prune + 6-hourly stuck-listener recovery.

.DESCRIPTION
  Before this script, the janitor (tools/runner/janitor.ps1) was a
  tool you had to swing manually. With these two tasks installed:

    - 'Runner Janitor - Hourly Prune' runs every hour and kills orphan
      job children (processes whose CommandLine references a runner
      _work path but whose parent chain doesn't reach a live Worker).
      Safe routine maintenance — pruning orphans never disturbs healthy
      jobs.

    - 'Runner Janitor - Stuck Recovery (Every 6h)' runs every 6 hours
      and selectively bounces only Listeners whose diag log shows
      broker errors for the last 60+ minutes without a successful job
      dispatch. Healthy Listeners keep their broker connection and
      queue position.

  Both tasks:
    - Run as the current user, LogonType Interactive (no UAC, no
      stored password).
    - Tolerate battery (no battery guard) — same as the runners
      themselves.
    - Skip new instances if one is still running (MultipleInstances
      IgnoreNew).
    - Log to <workspace>\actions-runner\_janitor.log (append).
    - 5-min execution time limit (janitor normally completes in
      seconds; this is a safety guardrail).

  Idempotent: re-running this script unregisters and re-registers
  the tasks. Safe to invoke any time.

.PARAMETER WhatIf
  Print what would be installed/removed without acting.

.PARAMETER Uninstall
  Remove both scheduled tasks. Leaves the janitor script and log file
  in place — only deregisters the cron-like wiring.

.PARAMETER WorkspaceRoot
  Path to the workspace root (where actions-runner-* folders live).
  Default: C:\Users\mzdan\dev\ourCommunityRituals

.PARAMETER User
  User account to run the tasks as. Default: current user.

.EXAMPLE
  # Install both tasks (default)
  pwsh -File tools\runner\install-janitor-tasks.ps1

.EXAMPLE
  # Preview without changes
  pwsh -File tools\runner\install-janitor-tasks.ps1 -WhatIf

.EXAMPLE
  # Remove both tasks
  pwsh -File tools\runner\install-janitor-tasks.ps1 -Uninstall

.NOTES
  Runs WITHOUT elevation. Register-ScheduledTask works for the current
  user with LogonType Interactive + RunLevel Limited. The janitor itself
  also doesn't need admin (see janitor.ps1 docstring).

  If you later want fully unattended operation (tasks run even when
  user is not logged in), switch LogonType to Password and re-register
  via Windows Task Scheduler UI with stored credentials.
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$Uninstall,
    [string]$WorkspaceRoot = 'C:\Users\mzdan\dev\ourCommunityRituals',
    [string]$User = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'

$janitorPath = Join-Path $WorkspaceRoot 'ourSharedEvents\tools\runner\janitor.ps1'
$verifyPath  = Join-Path $WorkspaceRoot 'ourSharedEvents\tools\runner\verify-probe-alive.ps1'
$logPath     = Join-Path $WorkspaceRoot 'actions-runner\_janitor.log'

# --- Pre-flight ---------------------------------------------------------------

if (-not (Test-Path $janitorPath)) {
    Write-Error "Janitor script not found at: $janitorPath"
    exit 2
}
if (-not (Test-Path $verifyPath)) {
    Write-Error "Verify-probe-alive script not found at: $verifyPath"
    exit 2
}

# Ensure log directory exists (actions-runner folder must already be there)
$logDir = Split-Path -Parent $logPath
if (-not (Test-Path $logDir)) {
    Write-Error "Log directory does not exist: $logDir (no actions-runner folder?)"
    exit 2
}

# --- Task specs ---------------------------------------------------------------

# Sweep 7: collapsed from two slow tasks (hourly prune + 6h stuck recovery)
# to a single 1-minute readiness probe.
#
# The earlier design had the right machinery but the wrong mandate. The
# runner pool's one job is to be ready for the NEXT run — not to be
# tidied up an hour from now. A 1-min probe in -EnsureReady mode:
#   - prunes orphans every cycle (was hourly)
#   - tightens the stuck-threshold from 30 to 3 minutes
#   - adds Worker-dwell kills (Workers > 15 min mid-job = stuck inside job)
#   - adds GitHub queue-depth correlation (queued runs while local idle)
#   - adds a circuit breaker (3+ bounces in 1h = STOP, emit RUNNER_POOL_DEGRADED)
#
# Net effect: most "lost throughput" failure modes self-heal within 60-90s
# instead of 60+ min.
$readinessTask = @{
    Name        = 'Runner Readiness Probe (1-min)'
    Description = "Runs tools/runner/janitor.ps1 -EnsureReady every 1 minute. Single-pass readiness probe: prunes orphans, kills Workers stuck >15 min, bounces Listeners stuck >3 min, checks GitHub queue-depth vs local idle, circuit-breaker after 3+ bounces/hr. Replaces the prior hourly/6h pair (Sweep 7)."
    Command     = "& '$janitorPath' -EnsureReady *>> '$logPath'"
    Interval    = (New-TimeSpan -Minutes 1)
    IntervalDisplay = '1m'
}

# Sweep 8: watchdog. The readiness probe is itself a single point of
# failure. This second task runs every 5 minutes and verifies the probe
# wrote its heartbeat recently. If the heartbeat is stale (5+ min old)
# the probe is dead and verify-probe-alive.ps1 emits RUNNER_PROBE_DEAD
# + exits non-zero. Output redirected to the same log so all probe
# state lives in one grep-friendly place.
$watchdogTask = @{
    Name        = 'Runner Probe Watchdog (5-min)'
    Description = "Runs tools/runner/verify-probe-alive.ps1 every 5 minutes. Reads the heartbeat file the readiness probe writes each cycle. Fails loud (RUNNER_PROBE_DEAD JSON line + non-zero exit) when the probe stops running. The watchman watching the watchman."
    Command     = "& '$verifyPath' *>> '$logPath'"
    Interval    = (New-TimeSpan -Minutes 5)
    IntervalDisplay = '5m'
}

# Names of legacy tasks to remove on install/uninstall (Sweep 5+6 → Sweep 7
# migration). Leaving them registered alongside the new probe would create
# overlapping bounce attempts and inflate the circuit breaker.
$legacyTaskNames = @(
    'Runner Janitor - Hourly Prune'
    'Runner Janitor - Stuck Recovery (Every 6h)'
)

$tasks = @($readinessTask, $watchdogTask)

# --- Uninstall path -----------------------------------------------------------

if ($Uninstall) {
    foreach ($t in $tasks) {
        $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
        if ($existing) {
            if ($WhatIf) {
                Write-Host "[WhatIf] would unregister: $($t.Name)"
            } else {
                Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
                Write-Host "Unregistered: $($t.Name)"
            }
        } else {
            Write-Host "Not present (skipping): $($t.Name)"
        }
    }
    # Sweep 7: also remove legacy hourly/6h tasks if present
    foreach ($name in $legacyTaskNames) {
        $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($existing) {
            if ($WhatIf) {
                Write-Host "[WhatIf] would unregister legacy: $name"
            } else {
                Unregister-ScheduledTask -TaskName $name -Confirm:$false
                Write-Host "Unregistered (legacy): $name"
            }
        }
    }
    Write-Host ""
    Write-Host "Note: log file ($logPath) and janitor script left in place."
    return
}

# Sweep 7: install path — also remove legacy tasks so we don't double-fire.
foreach ($name in $legacyTaskNames) {
    $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($existing) {
        if ($WhatIf) {
            Write-Host "[WhatIf] would remove legacy task: $name"
        } else {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed legacy task: $name"
        }
    }
}

# --- Install path -------------------------------------------------------------

foreach ($t in $tasks) {
    Write-Host ""
    Write-Host "=== $($t.Name) ==="
    Write-Host "  Command:  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command `"$($t.Command)`""
    Write-Host "  Interval: every $($t.IntervalDisplay), repeats forever"
    Write-Host "  User:     $User (Interactive logon, no admin needed)"

    if ($WhatIf) {
        Write-Host "  [WhatIf] would register / re-register this task"
        continue
    }

    # Use a CIM-side construct to avoid New-ScheduledTaskTrigger's lack of
    # plain 'every N hours, forever' support. We build the trigger from raw
    # XML by leveraging the Repetition property of a one-time trigger.
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$($t.Command)`""

    # Trigger: start 5 minutes from now (small grace period after install),
    # then repeat at the configured interval indefinitely. The 365-day
    # RepetitionDuration is the de-facto "repeat forever" idiom in Windows
    # Task Scheduler (it auto-renews on the next firing).
    $startBoundary = (Get-Date).AddMinutes(5)
    $trigger = New-ScheduledTaskTrigger -Once -At $startBoundary `
        -RepetitionInterval $t.Interval `
        -RepetitionDuration (New-TimeSpan -Days 365)

    $principal = New-ScheduledTaskPrincipal `
        -UserId $User `
        -LogonType Interactive `
        -RunLevel Limited

    # Sweep 7: a 1-minute probe must NOT pile up. If a single run takes
    # longer than 60s (rare but possible during a bounce), the next firing
    # should skip rather than queue. ExecutionTimeLimit is the safety net.
    $settings = New-ScheduledTaskSettingsSet `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable

    # Idempotent — unregister first if already present
    $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
        Write-Host "  (replaced existing task)"
    }

    Register-ScheduledTask `
        -TaskName $t.Name `
        -Description $t.Description `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings | Out-Null

    Write-Host "  Registered."
}

Write-Host ""
Write-Host "=== INSTALL COMPLETE ==="
Write-Host "Log file: $logPath"
Write-Host ""
Write-Host "Verify task is registered:"
Write-Host "  Get-ScheduledTask -TaskName 'Runner Readiness Probe (1-min)' | Format-List TaskName, State"
Write-Host ""
Write-Host "Trigger an immediate readiness check (next firing is within 60s otherwise):"
Write-Host "  Start-ScheduledTask -TaskName 'Runner Readiness Probe (1-min)'"
Write-Host ""
Write-Host "Tail the log in real time:"
Write-Host "  Get-Content '$logPath' -Tail 20 -Wait"
Write-Host ""
Write-Host "Look for these structured signals:"
Write-Host "  RUNNER_JANITOR        - per-runner per-cycle status"
Write-Host "  RUNNER_POOL_READINESS - pool summary per cycle"
Write-Host "  RUNNER_POOL_DEGRADED  - circuit breaker tripped on a runner (human review)"
