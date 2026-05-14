<#
.SYNOPSIS
  Runner health janitor - detects stuck Listeners, prunes orphan job
  children, and bounces only what needs bouncing.

.DESCRIPTION
  Replaces the ad-hoc `_bounce-all-runners.ps1` script with a precise,
  evidence-based janitor. The earlier script bounced ALL three runners
  unconditionally - fine for total recovery, wasteful when only one
  Listener was actually stuck and bouncing the healthy ones killed
  in-flight jobs as collateral.

  Three concerns this script addresses:

  1. STUCK LISTENERS
     A Listener can be alive-as-a-process but unable to dispatch jobs
     because its broker connection is broken. The diag log shows
     "SocketException (995): The I/O operation has been aborted" with
     a backoff retry loop and no successful "Running job:" line for
     hours. From the operator's perspective the runner is "stuck."
     Detection: scan the most recent N lines of each runner's diag log
     for stuck markers + last successful dispatch timestamp.

  2. ORPHAN JOB CHILDREN
     When a Worker exits (cleanly or otherwise), the child processes it
     spawned (npx/node/vitest/wrangler) should die with it. Sometimes
     they don't. They sit holding RAM and file locks under _work/_temp
     until the host reboots. Detection: walk every node/npx/cmd/wrangler
     process whose CommandLine references an actions-runner-*\_work
     path, then check whether its ParentProcessId is still alive AND
     a known Runner.Worker. If not, it's an orphan.

     NOTE: parent-chain matching by CommandLine path, NOT just
     process-name match. Earlier attempts to do `node.exe + age` would
     have killed the operator's Firebase MCP and other unrelated node
     processes - a real harm.

  3. SELECTIVE BOUNCE
     Only stuck runners get restarted. Healthy ones keep their broker
     connection and their position in the job queue.

.PARAMETER WhatIf
  Report-only mode. Lists what would be done. No process kills,
  no scheduled-task control. Safe to run on any machine at any time.

.PARAMETER PruneOrphans
  If set, kills orphan job children. Defaults to off - orphan detection
  is conservative but parent-chain logic CAN false-positive if a Worker
  PID rolled over. Always run with -WhatIf once to confirm before
  enabling.

.PARAMETER BounceStuck
  If set, restarts (Stop-ScheduledTask + Start-ScheduledTask) any
  Listener flagged as stuck. Defaults to off for the same reason as
  -PruneOrphans.

.PARAMETER StuckThresholdMinutes
  How many minutes of "no successful job dispatch" qualifies as stuck.
  Default 30. Reduce if you want more aggressive recovery; raise if
  your runner sees long idle periods between jobs.

.EXAMPLE
  # Report-only (recommended first run)
  pwsh -File tools\runner\janitor.ps1 -WhatIf

.EXAMPLE
  # Prune orphans only (conservative - safe routine maintenance)
  pwsh -File tools\runner\janitor.ps1 -PruneOrphans

.EXAMPLE
  # Full janitor pass - prune orphans + bounce stuck Listeners
  pwsh -File tools\runner\janitor.ps1 -PruneOrphans -BounceStuck

.OUTPUTS
  One structured JSON line per runner instance for ops grepping:
    {"type":"RUNNER_JANITOR","runner":"actions-runner","listener_pid":...,
     "stuck":false,"orphans_pruned":0,"bounced":false,"timestamp":"..."}

.NOTES
  Designed to be safe to run from a non-elevated PowerShell - uses
  Stop/Start-ScheduledTask which work for the current user's own
  tasks. Stop-Process kills user-owned processes without admin.
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$PruneOrphans,
    [switch]$BounceStuck,
    [int]$StuckThresholdMinutes = 30,

    # -----------------------------------------------------------------------
    # Sweep 7: -EnsureReady mode — the runner pool's one job is to be
    # available for the next run. This mode adds tighter signals that
    # catch "not-ready" *before* a job arrives and waits, not after.
    #
    # Enable with -EnsureReady. Implies -PruneOrphans + -BounceStuck with
    # tighter thresholds and adds:
    #   * Worker-dwell check (kill Workers stuck > WorkerDwellMaxMinutes)
    #   * Queue-depth signal (GitHub-side queued runs while local idle)
    #   * Circuit breaker (don't bounce the same Listener N+ times in 1h)
    #
    # Runs every 1 minute via the scheduled task installed by
    # install-janitor-tasks.ps1. Intended cadence is "before the next
    # job," not "every hour."
    # -----------------------------------------------------------------------
    [switch]$EnsureReady,
    [int]$WorkerDwellMaxMinutes = 15,
    [int]$RecentStuckMinutes = 3,
    [int]$CircuitBreakerMaxBouncesPerHour = 3,
    [string]$Repo = 'ourCommunityRituals/ourSharedEvents'
)

$ErrorActionPreference = 'Stop'

# In -EnsureReady mode, imply prune+bounce with the tighter threshold so
# the readiness probe is a single self-contained pass.
if ($EnsureReady) {
    $PruneOrphans = $true
    $BounceStuck  = $true
    if (-not $PSBoundParameters.ContainsKey('StuckThresholdMinutes')) {
        $StuckThresholdMinutes = $RecentStuckMinutes
    }
}

# -----------------------------------------------------------------------------
# Runner inventory - discover by directory pattern, not by hardcoded list.
# Any actions-runner-* folder next to actions-runner is a sibling runner.
# -----------------------------------------------------------------------------

$workspaceRoot = 'C:\Users\mzdan\dev\ourCommunityRituals'
$runnerDirs = @(Get-ChildItem -Path $workspaceRoot -Directory -Filter 'actions-runner*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'run.cmd') } |
    Sort-Object Name)

if ($runnerDirs.Count -eq 0) {
    Write-Error "No runner folders found under $workspaceRoot (expected actions-runner, actions-runner-2, ...)"
    exit 2
}

# Map runner folder -> scheduled task name. The original Bloodraven uses
# 'GitHubActionsRunner'; siblings append a numeric suffix.
function Get-TaskNameForRunner([string]$RunnerName) {
    if ($RunnerName -eq 'actions-runner') { return 'GitHubActionsRunner' }
    if ($RunnerName -match '^actions-runner-(\d+)$') { return "GitHubActionsRunner-$($Matches[1])" }
    return $null
}

# -----------------------------------------------------------------------------
# Per-runner health: is the Listener stuck on broker errors?
# -----------------------------------------------------------------------------

function Test-ListenerStuck([string]$RunnerDir, [int]$ThresholdMinutes) {
    $diagDir = Join-Path $RunnerDir '_diag'
    if (-not (Test-Path $diagDir)) {
        return [pscustomobject]@{ Stuck = $false; Reason = 'no _diag dir' }
    }
    $log = Get-ChildItem -Path $diagDir -Filter 'Runner_*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $log) {
        return [pscustomobject]@{ Stuck = $false; Reason = 'no diag log' }
    }

    # Read last ~500 lines - enough to see both error patterns and recent
    # successful dispatches without slurping huge files.
    $tail = Get-Content -Path $log.FullName -Tail 500 -ErrorAction SilentlyContinue
    if (-not $tail) { return [pscustomobject]@{ Stuck = $false; Reason = 'empty diag' } }

    $now = Get-Date
    $thresholdAgo = $now.AddMinutes(-$ThresholdMinutes)

    # Markers of healthy job dispatch - last appearance time wins.
    $lastDispatch = $null
    $lastBrokerError = $null
    foreach ($line in $tail) {
        # Diag timestamps are ISO-ish: [2026-05-14 14:01:36Z INFO ...]
        if ($line -match '\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})Z') {
            try {
                $ts = [DateTime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', $null,
                    [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
                    [System.Globalization.DateTimeStyles]::AdjustToUniversal)
            } catch { continue }

            if ($line -match 'Running job:|JobDispatcher.*Send job request') {
                $lastDispatch = $ts
            }
            if ($line -match 'SocketException|TaskAgentJobNotFoundException|BrokerServer.*ERR') {
                $lastBrokerError = $ts
            }
        }
    }

    # Stuck definition: had broker errors recently AND no successful
    # dispatch in the threshold window. Tolerates idle Listeners (no
    # recent dispatches but also no recent errors -> just quiet, not stuck).
    if ($null -ne $lastBrokerError -and $lastBrokerError -gt $thresholdAgo.ToUniversalTime()) {
        if ($null -eq $lastDispatch -or $lastDispatch -lt $thresholdAgo.ToUniversalTime()) {
            return [pscustomobject]@{
                Stuck = $true
                Reason = "broker errors at $lastBrokerError, no dispatch since $($lastDispatch)"
                LastDispatch = $lastDispatch
                LastBrokerError = $lastBrokerError
            }
        }
    }
    return [pscustomobject]@{
        Stuck = $false
        Reason = 'healthy'
        LastDispatch = $lastDispatch
        LastBrokerError = $lastBrokerError
    }
}

# -----------------------------------------------------------------------------
# Sweep 7: Worker-dwell check.
#
# A Runner.Worker process represents an in-flight job. Typical OSE jobs
# finish in 2-10 min; nightly heavy jobs cap out around 12-15 min. A Worker
# alive longer than that is stuck inside the job (vitest hang, network call
# timeout, miniflare not exiting), blocking its parent Listener from picking
# up the *next* job. Killing the Worker frees the Listener; the next job
# starts seconds later.
#
# We can't read Worker.exe's CommandLine without admin (elevated process),
# but Process.Id and StartTime ARE visible. That's enough.
# -----------------------------------------------------------------------------

function Find-StuckWorkers([int]$DwellMaxMinutes) {
    $deadline = (Get-Date).AddMinutes(-$DwellMaxMinutes)
    @(Get-Process Runner.Worker -ErrorAction SilentlyContinue |
        Where-Object { $_.StartTime -and $_.StartTime -lt $deadline })
}

# -----------------------------------------------------------------------------
# Sweep 7: GitHub-side queue-depth signal.
#
# If GitHub has queued workflow runs but our local Listeners report idle
# (no Worker children), the broker connection is broken in a way the diag
# log might not have caught up to yet — a leading indicator of "stuck"
# that the readiness probe acts on immediately.
#
# Uses `gh api` (already authenticated for mzdan) at repo scope, which
# doesn't require admin:org. Returns -1 on auth/network failure so the
# caller can degrade gracefully instead of false-alarming.
# -----------------------------------------------------------------------------

function Get-QueuedRunCount([string]$Repo) {
    try {
        $json = & gh api "repos/$Repo/actions/runs?status=queued&per_page=1" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) { return -1 }
        $obj = $json | ConvertFrom-Json
        return [int]$obj.total_count
    } catch {
        return -1
    }
}

# -----------------------------------------------------------------------------
# Sweep 7: Circuit breaker — refuse to bounce the same runner repeatedly.
#
# Persistent state in actions-runner/_janitor-state.json:
#   { "actions-runner-2": [ "2026-05-14T14:23:11Z", "2026-05-14T14:38:02Z" ] }
#
# If a runner has been bounced N+ times in the last hour, treat it as
# fundamentally broken (machine, network, GitHub-side dereg) — emit
# RUNNER_POOL_DEGRADED for that runner and SKIP the bounce. Healthy
# siblings can absorb the load while a human looks at it.
# -----------------------------------------------------------------------------

function Get-CircuitBreakerStatePath() {
    return Join-Path 'C:\Users\mzdan\dev\ourCommunityRituals\actions-runner' '_janitor-state.json'
}

function Read-CircuitBreakerState() {
    $path = Get-CircuitBreakerStatePath
    if (-not (Test-Path $path)) { return @{} }
    try {
        $raw = Get-Content -Path $path -Raw -ErrorAction Stop
        $obj = $raw | ConvertFrom-Json -ErrorAction Stop
        $h = @{}
        # ConvertFrom-Json returns a PSCustomObject; convert to hashtable
        foreach ($prop in $obj.PSObject.Properties) {
            $h[$prop.Name] = @($prop.Value)
        }
        return $h
    } catch {
        return @{}
    }
}

function Write-CircuitBreakerState([hashtable]$State) {
    $path = Get-CircuitBreakerStatePath
    $obj = [pscustomobject]@{}
    foreach ($k in $State.Keys) { $obj | Add-Member -NotePropertyName $k -NotePropertyValue @($State[$k]) }
    $obj | ConvertTo-Json -Depth 5 | Set-Content -Path $path -Encoding UTF8
}

function Test-CircuitOpen([hashtable]$State, [string]$RunnerName, [int]$MaxPerHour) {
    if (-not $State.ContainsKey($RunnerName)) { return $false }
    $cutoff = (Get-Date).ToUniversalTime().AddHours(-1)
    $recent = @($State[$RunnerName] | Where-Object {
        try { ([DateTime]$_).ToUniversalTime() -gt $cutoff } catch { $false }
    })
    return $recent.Count -ge $MaxPerHour
}

function Add-BounceToCircuitBreaker([hashtable]$State, [string]$RunnerName) {
    $now = (Get-Date).ToUniversalTime().ToString('o')
    $cutoff = (Get-Date).ToUniversalTime().AddHours(-1)
    $existing = if ($State.ContainsKey($RunnerName)) {
        @($State[$RunnerName] | Where-Object {
            try { ([DateTime]$_).ToUniversalTime() -gt $cutoff } catch { $false }
        })
    } else { @() }
    $State[$RunnerName] = $existing + $now
    return $State
}

# -----------------------------------------------------------------------------
# Orphan detection: processes spawned under a runner's _work that no
# longer have a live Runner.Worker ancestor.
# -----------------------------------------------------------------------------

function Find-OrphanJobChildren([string]$RunnerDir) {
    $workPath = Join-Path $RunnerDir '_work'
    $workEsc = [regex]::Escape($workPath)

    # Live Runner.* PIDs across ALL runner instances. Without admin we can't
    # attribute a specific Listener/Worker PID to a specific runner folder
    # (the elevated-process Path/CommandLine fields are hidden), but PIDs
    # themselves and parent-child links via ParentProcessId ARE visible.
    # For orphan detection we don't need per-folder attribution anyway —
    # "is this process a descendant of any Runner.Worker?" is sufficient.
    $liveRunnerPids = @(
        Get-Process Runner.Listener, Runner.Worker -ErrorAction SilentlyContinue |
            ForEach-Object { [int]$_.Id }
    )

    # All processes whose command line references this runner's _work -
    # that's the SAFE filter (Firebase MCP node, Cursor node, Doppler
    # node, etc. all live elsewhere and won't match).
    $candidates = Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $workEsc }

    $orphans = @()
    foreach ($p in $candidates) {
        # Skip the runner processes themselves
        if ($liveRunnerPids -contains [int]$p.ProcessId) { continue }

        # Walk parent chain - orphan if no ancestor in liveRunnerPids
        $hasLiveRunnerAncestor = $false
        $cursor = [int]$p.ParentProcessId
        $hops = 0
        while ($cursor -and $hops -lt 10) {
            if ($liveRunnerPids -contains $cursor) {
                $hasLiveRunnerAncestor = $true
                break
            }
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$cursor" -ErrorAction SilentlyContinue
            if (-not $parent) { break }
            $cursor = [int]$parent.ParentProcessId
            $hops++
        }
        if (-not $hasLiveRunnerAncestor) {
            $orphans += $p
        }
    }
    return $orphans
}

# -----------------------------------------------------------------------------
# Main loop
# -----------------------------------------------------------------------------

# Sweep 7: pre-loop pool-level signals (cheap, single API call).
$queuedCount = -1
if ($EnsureReady) {
    $queuedCount = Get-QueuedRunCount -Repo $Repo
    if ($queuedCount -lt 0) {
        Write-Host "[INFO] GitHub queue depth unavailable (gh auth / network) — degrading to local signals only"
    } else {
        Write-Host ("[INFO] GitHub queued workflow runs: {0}" -f $queuedCount)
    }
}

# Sweep 7: load circuit-breaker state once per run.
$cbState = if ($EnsureReady) { Read-CircuitBreakerState } else { @{} }

# Sweep 7: cross-pool worker dwell scan (one snapshot, used per-runner below
# for the JSON output but the kills happen here so we don't double-process).
$stuckWorkers = if ($EnsureReady) { Find-StuckWorkers -DwellMaxMinutes $WorkerDwellMaxMinutes } else { @() }
$stuckWorkersPruned = 0
if ($EnsureReady -and $stuckWorkers.Count -gt 0) {
    if ($WhatIf) {
        Write-Host "[WhatIf] would kill $($stuckWorkers.Count) stuck Worker(s) (alive > ${WorkerDwellMaxMinutes}m):"
        foreach ($w in $stuckWorkers) {
            Write-Host ("  - PID {0} started {1} (alive {2:N1} min)" -f $w.Id, $w.StartTime, ((Get-Date) - $w.StartTime).TotalMinutes)
        }
    } else {
        foreach ($w in $stuckWorkers) {
            try {
                Stop-Process -Id $w.Id -Force -ErrorAction Stop
                $stuckWorkersPruned++
                Write-Host ("[OK] killed stuck Worker PID $($w.Id) (alive $([math]::Round(((Get-Date) - $w.StartTime).TotalMinutes,1)) min)")
            } catch {
                Write-Host "[WARN] failed to kill Worker PID $($w.Id): $($_.Exception.Message)"
            }
        }
    }
}

$summary = @()
foreach ($dir in $runnerDirs) {
    $runnerName = $dir.Name
    $taskName = Get-TaskNameForRunner $runnerName

    # Task state — the authoritative "is this runner supposed to be up?" signal.
    # Without admin we can't read the Listener's path to attribute it to a
    # folder, but the scheduled task knows.
    $taskState = $null
    if ($taskName) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task) { $taskState = [string]$task.State }
    }
    $health = Test-ListenerStuck -RunnerDir $dir.FullName -ThresholdMinutes $StuckThresholdMinutes
    $orphans = Find-OrphanJobChildren -RunnerDir $dir.FullName

    # Sweep 7: queue-while-idle signal. If GitHub has queued runs AND this
    # runner instance reports no Worker child AND no recent broker error AND
    # task is Running, that's a precise "broker silently broken" indicator
    # that the log-based detection would miss for ~30s.
    $queueIdle = $false
    if ($EnsureReady -and $queuedCount -gt 0 -and -not $health.Stuck -and $taskState -eq 'Running') {
        # If any Workers are running locally somewhere we can't yet say this
        # specific Listener is idle (PID -> folder attribution requires admin).
        # Be conservative: only flag if there are ZERO Workers at all yet a
        # queue exists.
        $anyWorker = @(Get-Process Runner.Worker -ErrorAction SilentlyContinue)
        if ($anyWorker.Count -eq 0) {
            $queueIdle = $true
            $health = [pscustomobject]@{
                Stuck = $true
                Reason = "GitHub queue depth $queuedCount but pool reports zero Workers"
                LastDispatch = $health.LastDispatch
                LastBrokerError = $health.LastBrokerError
            }
        }
    }

    Write-Host ""
    Write-Host "=== $runnerName ==="
    $taskStateDisplay = if ($null -ne $taskState) { $taskState } else { '<task not found>' }
    Write-Host ("  Task state:          {0}" -f $taskStateDisplay)
    Write-Host ("  Stuck:               {0} ({1})" -f $health.Stuck, $health.Reason)
    Write-Host ("  Orphan job children: {0}" -f $orphans.Count)
    if ($orphans.Count -gt 0) {
        foreach ($o in $orphans) {
            Write-Host ("    - PID {0} {1} : {2}" -f $o.ProcessId, $o.Name, ($o.CommandLine -replace '\s+', ' ').Substring(0, [Math]::Min(120, ($o.CommandLine -replace '\s+', ' ').Length)))
        }
    }

    # --- Prune orphans -----------------------------------------------------
    $orphansPruned = 0
    if ($orphans.Count -gt 0) {
        if ($WhatIf) {
            Write-Host "  [WhatIf] would kill $($orphans.Count) orphan(s)"
        } elseif ($PruneOrphans) {
            foreach ($o in $orphans) {
                try {
                    Stop-Process -Id $o.ProcessId -Force -ErrorAction Stop
                    $orphansPruned++
                } catch {
                    Write-Host "  ! failed to kill PID $($o.ProcessId): $($_.Exception.Message)"
                }
            }
            Write-Host "  Pruned $orphansPruned orphan(s)"
        } else {
            Write-Host "  (Skipping prune - pass -PruneOrphans to act)"
        }
    }

    # --- Bounce stuck Listener ---------------------------------------------
    $bounced = $false
    $circuitOpen = $false
    if ($health.Stuck) {
        # Sweep 7: circuit breaker — refuse to bounce the same runner repeatedly.
        if ($EnsureReady -and (Test-CircuitOpen -State $cbState -RunnerName $runnerName -MaxPerHour $CircuitBreakerMaxBouncesPerHour)) {
            $circuitOpen = $true
            $cbHistory = @($cbState[$runnerName])
            Write-Host "  [CIRCUIT OPEN] $runnerName bounced $($cbHistory.Count)+ times in last hour - SKIPPING. Human review required."
            # Emit the dedicated degraded signal so a watcher / scheduled task can alert.
            $degradedLine = @{
                type      = 'RUNNER_POOL_DEGRADED'
                runner    = $runnerName
                task      = $taskName
                bounces_last_hour = $cbHistory.Count
                last_bounce = $cbHistory[-1]
                timestamp = (Get-Date).ToUniversalTime().ToString('o')
            } | ConvertTo-Json -Compress
            Write-Host "  $degradedLine"
        } elseif ($WhatIf) {
            Write-Host "  [WhatIf] would bounce $taskName"
        } elseif ($BounceStuck -and $taskName) {
            try {
                # Capture pre-bounce Listener PID set so we can detect "did the
                # listener restart?" without needing per-folder attribution.
                $preBouncePids = @(Get-Process Runner.Listener -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
                Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
                # Wait for the Listener-count to drop by 1 (one of the prior
                # PIDs should disappear). Max 20s.
                $deadline = (Get-Date).AddSeconds(20)
                do {
                    Start-Sleep 2
                    $postPids = @(Get-Process Runner.Listener -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
                    $dropped = @($preBouncePids | Where-Object { $postPids -notcontains $_ })
                } while ($dropped.Count -eq 0 -and (Get-Date) -lt $deadline)
                Start-ScheduledTask -TaskName $taskName
                $bounced = $true
                # Sweep 7: record the bounce in the circuit-breaker state.
                if ($EnsureReady) {
                    $cbState = Add-BounceToCircuitBreaker -State $cbState -RunnerName $runnerName
                }
                Write-Host "  Bounced $taskName"
            } catch {
                Write-Host "  ! bounce failed: $($_.Exception.Message)"
            }
        } else {
            Write-Host "  (Skipping bounce - pass -BounceStuck to act)"
        }
    }

    # --- Structured log line for ops grepping ------------------------------
    $jsonLine = @{
        type                  = 'RUNNER_JANITOR'
        mode                  = if ($EnsureReady) { 'ensure-ready' } else { 'manual' }
        runner                = $runnerName
        task                  = $taskName
        task_state            = $taskState
        stuck                 = [bool]$health.Stuck
        reason                = $health.Reason
        orphans_found         = $orphans.Count
        orphans_pruned        = $orphansPruned
        bounced               = $bounced
        circuit_open          = $circuitOpen
        queued_count          = $queuedCount
        queue_idle_signal     = $queueIdle
        whatif                = [bool]$WhatIf
        timestamp             = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress
    Write-Host "  $jsonLine"
    $summary += $jsonLine
}

Write-Host ""
Write-Host "=== JANITOR SUMMARY ==="
$summary | ForEach-Object { Write-Host $_ }

# Sweep 7: persist circuit-breaker state for next run
if ($EnsureReady -and -not $WhatIf) {
    try {
        Write-CircuitBreakerState -State $cbState
    } catch {
        Write-Host "[WARN] failed to persist circuit-breaker state: $($_.Exception.Message)"
    }
}

# Sweep 7: pool-level summary line. Single grep-friendly emission of the
# probe's overall verdict — useful for log alerting at the pool level
# rather than per-runner.
if ($EnsureReady) {
    $poolJson = @{
        type              = 'RUNNER_POOL_READINESS'
        runners           = $runnerDirs.Count
        queued_count      = $queuedCount
        stuck_workers     = $stuckWorkers.Count
        workers_killed    = $stuckWorkersPruned
        runners_bounced   = @($summary | ForEach-Object { ($_ | ConvertFrom-Json).bounced } | Where-Object { $_ }).Count
        circuits_open     = @($summary | ForEach-Object { ($_ | ConvertFrom-Json).circuit_open } | Where-Object { $_ }).Count
        whatif            = [bool]$WhatIf
        timestamp         = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress
    Write-Host ""
    Write-Host "=== POOL READINESS ==="
    Write-Host $poolJson
}
