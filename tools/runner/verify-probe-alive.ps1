<#
.SYNOPSIS
  Verify the runner-readiness probe is still running. Watchdog-of-the-watchman.

.DESCRIPTION
  Sweep 8 hardening. The 1-minute readiness probe (janitor.ps1 -EnsureReady)
  is supposed to keep the runner pool ready for the next job. But the probe
  itself is a single point of failure: if its scheduled task is disabled,
  PowerShell breaks, the disk fills, the `gh` CLI loses auth, the probe
  stops running silently and nobody notices.

  This script reads the heartbeat file the probe writes every cycle and
  fails loud if it's missing or stale.

  Designed to run from a separate 5-minute scheduled task installed by
  install-janitor-tasks.ps1. If this script ever exits non-zero, the
  probe is dead - needs human attention.

.PARAMETER WorkspaceRoot
  Path to the workspace root (where actions-runner/ lives). Default:
  C:\Users\mzdan\dev\ourCommunityRituals.

.PARAMETER MaxStaleMinutes
  Heartbeat staleness threshold. Default 5 minutes (probe cadence is 1 min,
  so 5 min = five missed cycles in a row = real problem).

.OUTPUTS
  Structured RUNNER_PROBE_DEAD or RUNNER_PROBE_ALIVE JSON line. Exit code:
    0 - probe alive, heartbeat fresh
    1 - heartbeat stale or missing (probe is dead/disabled)
    2 - script-level error (path missing, etc.)

.EXAMPLE
  pwsh -File tools\runner\verify-probe-alive.ps1
  pwsh -File tools\runner\verify-probe-alive.ps1 -MaxStaleMinutes 10
#>

[CmdletBinding()]
param(
    [string]$WorkspaceRoot = 'C:\Users\mzdan\dev\ourCommunityRituals',
    [int]$MaxStaleMinutes = 5
)

$ErrorActionPreference = 'Stop'

$heartbeatPath = Join-Path $WorkspaceRoot 'actions-runner\_probe-heartbeat.txt'
$now = (Get-Date).ToUniversalTime()
$cutoff = $now.AddMinutes(-$MaxStaleMinutes)

if (-not (Test-Path $heartbeatPath)) {
    $line = @{
        type            = 'RUNNER_PROBE_DEAD'
        reason          = 'heartbeat file does not exist'
        heartbeat_path  = $heartbeatPath
        max_stale_min   = $MaxStaleMinutes
        timestamp       = $now.ToString('o')
    } | ConvertTo-Json -Compress
    Write-Host $line
    Write-Error "Probe heartbeat file is missing at $heartbeatPath - readiness probe is not running."
    exit 1
}

try {
    $raw = Get-Content -Path $heartbeatPath -Raw -ErrorAction Stop
    $stamp = [DateTime]::Parse($raw.Trim(), $null,
        [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
        [System.Globalization.DateTimeStyles]::AdjustToUniversal)
} catch {
    $line = @{
        type            = 'RUNNER_PROBE_DEAD'
        reason          = "heartbeat file unreadable: $($_.Exception.Message)"
        heartbeat_path  = $heartbeatPath
        max_stale_min   = $MaxStaleMinutes
        timestamp       = $now.ToString('o')
    } | ConvertTo-Json -Compress
    Write-Host $line
    Write-Error "Heartbeat file at $heartbeatPath could not be parsed as ISO timestamp."
    exit 1
}

$ageMin = ($now - $stamp).TotalMinutes

if ($stamp -lt $cutoff) {
    $line = @{
        type            = 'RUNNER_PROBE_DEAD'
        reason          = ('heartbeat stale ({0:N1} min old, threshold {1} min)' -f $ageMin, $MaxStaleMinutes)
        heartbeat_path  = $heartbeatPath
        last_heartbeat  = $stamp.ToString('o')
        age_minutes     = [Math]::Round($ageMin, 1)
        max_stale_min   = $MaxStaleMinutes
        timestamp       = $now.ToString('o')
    } | ConvertTo-Json -Compress
    Write-Host $line
    Write-Error ("Probe heartbeat is stale: {0:N1} min old (> {1} min threshold). Probe is not running on schedule." -f $ageMin, $MaxStaleMinutes)
    exit 1
}

$line = @{
    type            = 'RUNNER_PROBE_ALIVE'
    last_heartbeat  = $stamp.ToString('o')
    age_minutes     = [Math]::Round($ageMin, 1)
    max_stale_min   = $MaxStaleMinutes
    timestamp       = $now.ToString('o')
} | ConvertTo-Json -Compress
Write-Host $line
exit 0
