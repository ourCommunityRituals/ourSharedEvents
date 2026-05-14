<#
.SYNOPSIS
  Pull per-workflow + per-job duration for a given PR or branch. Sweep 9
  measurement helper - quantify the wins from CI efficiency work.

.DESCRIPTION
  GitHub Actions surfaces per-job timings in the workflow_run API. This
  script collects them across every workflow that ran on a branch (or PR),
  sums steady-state wall-clock per workflow + total runner-seconds, and
  prints a sortable table.

  Designed to support attribution-by-comparison: pick a baseline PR (e.g.
  the PR immediately before a CI change landed), then compare against the
  next PR after the change. The per-job rows make per-fix wins visible.

.PARAMETER PrNumber
  Pull request number. The script resolves the head branch automatically.

.PARAMETER Branch
  Branch name. Use this if you want to measure a non-PR run (e.g. a push
  to main). Mutually exclusive with -PrNumber.

.PARAMETER Repo
  GitHub repo slug. Defaults to ourCommunityRituals/ourSharedEvents.

.PARAMETER LimitRuns
  Cap on how many workflow runs to pull (default 30). Increase if you have
  a very chatty CI surface or are scanning a long-lived branch.

.PARAMETER IncludeCancelled
  Include cancelled runs (default: skip). Useful when the same workflow
  was superseded by a concurrency group and you want to see the cancelled
  durations alongside the survivor.

.EXAMPLE
  # Measure PR #161 (the one merging Sweep 9)
  pwsh tools/ci/measure-rollup.ps1 -PrNumber 161

.EXAMPLE
  # Measure the baseline PR #160 (last PR before Sweep 9)
  pwsh tools/ci/measure-rollup.ps1 -PrNumber 160

.EXAMPLE
  # Compare two PRs side-by-side via diff against saved snapshots
  pwsh tools/ci/measure-rollup.ps1 -PrNumber 160 > before.txt
  pwsh tools/ci/measure-rollup.ps1 -PrNumber 161 > after.txt
  Compare-Object (Get-Content before.txt) (Get-Content after.txt)

.NOTES
  Requires `gh` CLI authenticated against the target repo.
  Skipped jobs (paths-filter, conditional `if:`) are reported with
  duration=0 so the rollup distinguishes "ran fast" from "did not run".
#>
[CmdletBinding(DefaultParameterSetName = 'Pr')]
param(
    [Parameter(ParameterSetName = 'Pr', Mandatory = $true)]
    [int]$PrNumber,

    [Parameter(ParameterSetName = 'Branch', Mandatory = $true)]
    [string]$Branch,

    [string]$Repo = 'ourCommunityRituals/ourSharedEvents',
    [int]$LimitRuns = 30,
    [switch]$IncludeCancelled
)

$ErrorActionPreference = 'Stop'

# Resolve branch from PR if needed
if ($PsCmdlet.ParameterSetName -eq 'Pr') {
    Write-Host "Resolving PR #$PrNumber head branch..."
    $Branch = (gh pr view $PrNumber --repo $Repo --json headRefName -q .headRefName 2>$null)
    if (-not $Branch) {
        Write-Error "Could not resolve PR #$PrNumber on $Repo (gh auth? repo slug?)"
        exit 1
    }
    Write-Host "  branch: $Branch"
}

Write-Host "Pulling workflow runs (limit $LimitRuns)..."
$runs = gh run list `
    --repo $Repo `
    --branch $Branch `
    --limit $LimitRuns `
    --json databaseId,name,workflowName,status,conclusion,createdAt,updatedAt,event `
    2>$null | ConvertFrom-Json

if (-not $runs -or $runs.Count -eq 0) {
    Write-Error "No workflow runs found on $Repo branch $Branch"
    exit 1
}

# Keep only completed runs (skip in-progress)
$runs = $runs | Where-Object { $_.status -eq 'completed' }

if (-not $IncludeCancelled) {
    $runs = $runs | Where-Object { $_.conclusion -ne 'cancelled' }
}

Write-Host "  $($runs.Count) completed runs in scope"

# Pull jobs for each run
$rows = @()
foreach ($run in $runs) {
    $jobs = gh run view $run.databaseId --repo $Repo --json jobs 2>$null | ConvertFrom-Json
    if (-not $jobs.jobs) { continue }
    foreach ($job in $jobs.jobs) {
        $duration = 0
        if ($job.startedAt -and $job.completedAt) {
            try {
                $duration = [int]((New-TimeSpan -Start $job.startedAt -End $job.completedAt).TotalSeconds)
                if ($duration -lt 0) { $duration = 0 }
            } catch { $duration = 0 }
        }
        $rows += [PSCustomObject]@{
            workflow   = $run.workflowName
            job        = $job.name
            seconds    = $duration
            minutes    = [Math]::Round($duration / 60.0, 1)
            conclusion = $job.conclusion
        }
    }
}

if ($rows.Count -eq 0) {
    Write-Error "No jobs returned by any run"
    exit 1
}

Write-Host ""
Write-Host "=== Per-job duration (success/skipped only, sorted longest first) ==="
$rows |
    Where-Object { $_.conclusion -in @('success', 'skipped', 'neutral') } |
    Sort-Object seconds -Descending |
    Format-Table -AutoSize

Write-Host ""
Write-Host "=== Per-workflow wall-clock (max-of-jobs, the actual user-felt latency) ==="
$wfRollup = $rows |
    Where-Object { $_.conclusion -in @('success', 'skipped', 'neutral') } |
    Group-Object workflow |
    ForEach-Object {
        [PSCustomObject]@{
            workflow  = $_.Name
            jobs      = $_.Count
            max_sec   = ($_.Group | Measure-Object -Property seconds -Maximum).Maximum
            sum_sec   = ($_.Group | Measure-Object -Property seconds -Sum).Sum
            max_min   = [Math]::Round((($_.Group | Measure-Object -Property seconds -Maximum).Maximum) / 60.0, 1)
        }
    } |
    Sort-Object max_sec -Descending
$wfRollup | Format-Table -AutoSize

$totalWall = ($wfRollup | Measure-Object -Property max_sec -Sum).Sum
$totalRunner = ($rows | Where-Object { $_.conclusion -in @('success', 'skipped', 'neutral') } |
    Measure-Object -Property seconds -Sum).Sum

Write-Host ""
Write-Host ("=== Totals ===")
Write-Host ("Wall-clock (sum of per-workflow max): {0}s ({1}m)" -f $totalWall, [Math]::Round($totalWall / 60.0, 1))
Write-Host ("Runner-seconds (sum of all jobs):     {0}s ({1}m)" -f $totalRunner, [Math]::Round($totalRunner / 60.0, 1))

# Emit a single structured JSON line for programmatic comparison
$summary = @{
    type             = 'CI_ROLLUP_MEASUREMENT'
    repo             = $Repo
    branch           = $Branch
    pr_number        = if ($PrNumber) { $PrNumber } else { $null }
    runs_in_scope    = $runs.Count
    jobs_in_scope    = $rows.Count
    wallclock_sec    = $totalWall
    runner_sec_total = $totalRunner
    timestamp        = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Compress
Write-Host ""
Write-Host $summary
