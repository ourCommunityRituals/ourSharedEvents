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
$logPath = Join-Path $WorkspaceRoot 'actions-runner\_janitor.log'

# --- Pre-flight ---------------------------------------------------------------

if (-not (Test-Path $janitorPath)) {
    Write-Error "Janitor script not found at: $janitorPath"
    exit 2
}

# Ensure log directory exists (actions-runner folder must already be there)
$logDir = Split-Path -Parent $logPath
if (-not (Test-Path $logDir)) {
    Write-Error "Log directory does not exist: $logDir (no actions-runner folder?)"
    exit 2
}

# --- Task specs ---------------------------------------------------------------

$hourlyTask = @{
    Name        = 'Runner Janitor - Hourly Prune'
    Description = "Runs tools/runner/janitor.ps1 -PruneOrphans every 60 min. Kills orphan job children (processes referencing runner _work whose parent chain doesn't reach a live Worker). Safe routine maintenance; never disturbs healthy jobs."
    Command     = "& '$janitorPath' -PruneOrphans *>> '$logPath'"
    Interval    = (New-TimeSpan -Hours 1)
    IntervalDisplay = '1h'
}

$stuckRecoveryTask = @{
    Name        = 'Runner Janitor - Stuck Recovery (Every 6h)'
    Description = "Runs tools/runner/janitor.ps1 -BounceStuck -StuckThresholdMinutes 60 every 6 hours. Bounces ONLY Listeners with broker errors for 60+ min and no recent dispatch. Healthy Listeners untouched."
    Command     = "& '$janitorPath' -BounceStuck -StuckThresholdMinutes 60 *>> '$logPath'"
    Interval    = (New-TimeSpan -Hours 6)
    IntervalDisplay = '6h'
}

$tasks = @($hourlyTask, $stuckRecoveryTask)

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
    Write-Host ""
    Write-Host "Note: log file ($logPath) and janitor script left in place."
    return
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

    $settings = New-ScheduledTaskSettingsSet `
        -DontStopIfGoingOnBatteries `
        -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
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
Write-Host "Verify with:"
Write-Host "  Get-ScheduledTask -TaskName 'Runner Janitor*' | Select-Object TaskName, State"
Write-Host ""
Write-Host "To see what each task is about to do without waiting:"
Write-Host "  Start-ScheduledTask -TaskName 'Runner Janitor - Hourly Prune'"
Write-Host "  Start-ScheduledTask -TaskName 'Runner Janitor - Stuck Recovery (Every 6h)'"
Write-Host ""
Write-Host "Tail the log:"
Write-Host "  Get-Content '$logPath' -Tail 20 -Wait"
