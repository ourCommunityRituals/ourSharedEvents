<#
.SYNOPSIS
  Self-tests for tools/runner/janitor.ps1. The meta-coverage discipline.

.DESCRIPTION
  Sweep 8 closes the "gate without a test" anti-pattern: until now, the
  janitor was the line of defence against stuck runners, but no test
  proved its detection actually works. If we silently changed the
  parser or broke the stuck-threshold logic, we'd never know until a
  real outage went undetected.

  This script runs hand-rolled assertions over pure helper functions
  (no admin, no GitHub API, no scheduled tasks). For functions that
  need a real diag log, we generate a synthetic one in $env:TEMP and
  point the function at it.

  Exit codes:
    0 - all tests pass
    1 - one or more failures (prints details)

.NOTES
  Hand-rolled rather than Pester so it works on any machine without
  installing a module. Adds tiny test framework primitives below.

  Run locally:
    pwsh -File tools\runner\janitor.tests.ps1

  Run from CI (see runner-env-validation.yml etc):
    pwsh -NoProfile -File .\tools\runner\janitor.tests.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:PassCount = 0
$script:FailCount = 0
$script:Failures = @()

function Assert-Equal([string]$Label, $Expected, $Actual) {
    if ($Expected -eq $Actual) {
        $script:PassCount++
        Write-Host "  [PASS] $Label"
    } else {
        $script:FailCount++
        $script:Failures += "$Label : expected '$Expected', got '$Actual'"
        Write-Host "  [FAIL] $Label : expected '$Expected', got '$Actual'"
    }
}

function Assert-True([string]$Label, [bool]$Condition) {
    Assert-Equal $Label $true $Condition
}

function Assert-False([string]$Label, [bool]$Condition) {
    Assert-Equal $Label $false $Condition
}

# --- Dot-source the janitor's parameter block + helper functions ---------
# The script has a [CmdletBinding()] header + param() that hard-exits if
# no actions-runner folder is found. We need just the function defs. The
# cleanest approach for a self-test is to source the file in a child
# scope where its top-level exit gets swallowed if the test runner is
# on a machine without runner folders.
#
# Strategy: read the file, isolate the function blocks via simple text
# extraction, evaluate them. This keeps the test independent of the
# host having runner folders, and means we test the EXACT shipped code
# rather than a duplicated copy.

$janitorPath = Join-Path $PSScriptRoot 'janitor.ps1'
if (-not (Test-Path $janitorPath)) {
    Write-Error "janitor.ps1 not found at $janitorPath"
    exit 1
}
$janitorSource = Get-Content -Path $janitorPath -Raw

# Extract every `function NAME { ... }` block. Brace-aware so nested {}
# inside function bodies parses correctly.
function Extract-PowerShellFunctions([string]$Source) {
    $bodies = @{}
    $pos = 0
    while ($pos -lt $Source.Length) {
        $i = $Source.IndexOf('function ', $pos)
        if ($i -lt 0) { break }
        # Function name follows
        $nameStart = $i + 'function '.Length
        $nameEnd = $nameStart
        while ($nameEnd -lt $Source.Length -and $Source[$nameEnd] -match '[\w\-]') { $nameEnd++ }
        $fname = $Source.Substring($nameStart, $nameEnd - $nameStart)
        # Find opening brace AFTER any param() signature
        $braceStart = $Source.IndexOf('{', $nameEnd)
        if ($braceStart -lt 0) { $pos = $nameEnd; continue }
        # Walk braces
        $depth = 0
        $end = $braceStart
        for (; $end -lt $Source.Length; $end++) {
            if ($Source[$end] -eq '{') { $depth++ }
            elseif ($Source[$end] -eq '}') {
                $depth--
                if ($depth -eq 0) { break }
            }
        }
        if ($depth -ne 0) { break }
        $fullDef = $Source.Substring($i, $end - $i + 1)
        $bodies[$fname] = $fullDef
        $pos = $end + 1
    }
    return $bodies
}

$fns = Extract-PowerShellFunctions $janitorSource

# Evaluate each function definition in the current scope so we can call
# them directly. They depend on script-level vars ($runnerDirs, etc.)
# that we don't need for the unit-style tests we're running below.
foreach ($name in 'ConvertTo-UtcDateTimeSafe', 'Get-TaskNameForRunner', 'typeAffinity', 'Test-CircuitOpen',
                  'Add-BounceToCircuitBreaker', 'Get-WorkerDwellCapMinutes',
                  'Read-CircuitBreakerState', 'Test-ListenerStuck',
                  'Test-QueueIdleCorroborated') {
    if ($fns.ContainsKey($name)) {
        Invoke-Expression $fns[$name]
    }
}

# --- Test data setup ------------------------------------------------------

# WorkflowDwellCapsMinutes is defined as a script-level $hashtable in
# janitor.ps1. The Get-WorkerDwellCapMinutes function references it by
# name. Recreate the relevant subset here for the unit test.
$WorkflowDwellCapsMinutes = @{
    'T0 Gate'                  = 10
    'S0 Security'              = 15
    'T4 Functional -> Staging' = 60
}

# --- TESTS ---------------------------------------------------------------

Write-Host ''
Write-Host '=== Get-TaskNameForRunner ==='
Assert-Equal 'maps actions-runner -> GitHubActionsRunner' `
    'GitHubActionsRunner' (Get-TaskNameForRunner 'actions-runner')
Assert-Equal 'maps actions-runner-2 -> GitHubActionsRunner-2' `
    'GitHubActionsRunner-2' (Get-TaskNameForRunner 'actions-runner-2')
Assert-Equal 'maps actions-runner-42 -> GitHubActionsRunner-42' `
    'GitHubActionsRunner-42' (Get-TaskNameForRunner 'actions-runner-42')
Assert-Equal 'unknown folder name returns null' `
    $null (Get-TaskNameForRunner 'something-else')

Write-Host ''
Write-Host '=== Get-WorkerDwellCapMinutes ==='
Assert-Equal 'known workflow returns its cap' `
    10 (Get-WorkerDwellCapMinutes -JobName 'T0 Gate' -Default 30)
Assert-Equal 'unknown workflow falls back to default' `
    30 (Get-WorkerDwellCapMinutes -JobName 'Unknown Workflow' -Default 30)
Assert-Equal 'null job name returns default' `
    25 (Get-WorkerDwellCapMinutes -JobName $null -Default 25)
Assert-Equal 'long-running workflow uses its longer cap' `
    60 (Get-WorkerDwellCapMinutes -JobName 'T4 Functional -> Staging' -Default 15)

Write-Host ''
Write-Host '=== Test-CircuitOpen ==='
$nowUtc = (Get-Date).ToUniversalTime()
$stateNoHistory = @{}
Assert-False 'closed when no history' `
    (Test-CircuitOpen -State $stateNoHistory -RunnerName 'actions-runner-2' -MaxPerHour 3)

$stateTwoRecent = @{
    'actions-runner-2' = @(
        $nowUtc.AddMinutes(-30).ToString('o'),
        $nowUtc.AddMinutes(-10).ToString('o')
    )
}
Assert-False 'closed at 2 recent bounces with MaxPerHour=3' `
    (Test-CircuitOpen -State $stateTwoRecent -RunnerName 'actions-runner-2' -MaxPerHour 3)

$stateThreeRecent = @{
    'actions-runner-2' = @(
        $nowUtc.AddMinutes(-50).ToString('o'),
        $nowUtc.AddMinutes(-30).ToString('o'),
        $nowUtc.AddMinutes(-5).ToString('o')
    )
}
Assert-True 'open at 3 recent bounces with MaxPerHour=3' `
    (Test-CircuitOpen -State $stateThreeRecent -RunnerName 'actions-runner-2' -MaxPerHour 3)

$stateOldOnly = @{
    'actions-runner-2' = @(
        $nowUtc.AddHours(-2).ToString('o'),
        $nowUtc.AddHours(-3).ToString('o'),
        $nowUtc.AddHours(-4).ToString('o')
    )
}
Assert-False 'closed when all bounces > 1 hour old' `
    (Test-CircuitOpen -State $stateOldOnly -RunnerName 'actions-runner-2' -MaxPerHour 3)

Write-Host ''
Write-Host '=== Add-BounceToCircuitBreaker ==='
$blankState = @{}
$afterOne = Add-BounceToCircuitBreaker -State $blankState -RunnerName 'actions-runner'
Assert-Equal 'adds key on first bounce' 1 $afterOne['actions-runner'].Count
$afterTwo = Add-BounceToCircuitBreaker -State $afterOne -RunnerName 'actions-runner'
Assert-Equal 'appends on second bounce' 2 $afterTwo['actions-runner'].Count

# Synthetic stale state: bounces > 1 hour old should be filtered out when
# adding the next one.
$staleState = @{
    'actions-runner' = @(
        (Get-Date).ToUniversalTime().AddHours(-3).ToString('o'),
        (Get-Date).ToUniversalTime().AddMinutes(-5).ToString('o')
    )
}
$afterStaleAdd = Add-BounceToCircuitBreaker -State $staleState -RunnerName 'actions-runner'
Assert-Equal 'old entries (>1h) dropped on add; new state has 2 (1 recent + 1 just-added)' `
    2 $afterStaleAdd['actions-runner'].Count

Write-Host ''
Write-Host '=== Test-ListenerStuck (synthetic diag log) ==='

# Create a fake runner folder structure with a synthetic diag log that
# has a recent broker error and no recent dispatch.
$tempRoot = Join-Path $env:TEMP "janitor-test-$([guid]::NewGuid().ToString('n'))"
$tempDiag = Join-Path $tempRoot '_diag'
New-Item -ItemType Directory -Path $tempDiag -Force | Out-Null

try {
    # Stuck scenario: broker error 1 min ago, last dispatch 60 min ago
    $stuckLog = Join-Path $tempDiag 'Runner_stuck.log'
    $now = (Get-Date).ToUniversalTime()
    $sixtyMinAgo = $now.AddMinutes(-60).ToString('yyyy-MM-dd HH:mm:ss')
    $oneMinAgo   = $now.AddMinutes(-1).ToString('yyyy-MM-dd HH:mm:ss')
    @(
        "[${sixtyMinAgo}Z INFO JobDispatcher] Send job request message to worker for job 11111"
        "[${sixtyMinAgo}Z INFO Terminal] Running job: T0 Gate"
        "[${oneMinAgo}Z ERR  BrokerServer] System.Net.Sockets.SocketException (995): The I/O operation has been aborted"
    ) | Set-Content -Path $stuckLog -Encoding ASCII

    $result = Test-ListenerStuck -RunnerDir $tempRoot -ThresholdMinutes 3
    Assert-True 'detects stuck when broker error <3 min ago and dispatch 60 min ago' $result.Stuck

    # Healthy scenario: recent dispatch, no recent broker error
    Remove-Item $stuckLog -Force
    $healthyLog = Join-Path $tempDiag 'Runner_healthy.log'
    $thirtySec = $now.AddSeconds(-30).ToString('yyyy-MM-dd HH:mm:ss')
    @(
        "[${thirtySec}Z INFO JobDispatcher] Send job request message to worker for job 22222"
        "[${thirtySec}Z INFO Terminal] Running job: T0 Gate"
    ) | Set-Content -Path $healthyLog -Encoding ASCII

    $result = Test-ListenerStuck -RunnerDir $tempRoot -ThresholdMinutes 3
    Assert-False 'reports healthy when recent dispatch and no broker errors' $result.Stuck

    # Quiet scenario: no recent activity but no broker errors either
    Remove-Item $healthyLog -Force
    $quietLog = Join-Path $tempDiag 'Runner_quiet.log'
    $twoHoursAgo = $now.AddHours(-2).ToString('yyyy-MM-dd HH:mm:ss')
    @(
        "[${twoHoursAgo}Z INFO JobDispatcher] Send job request message to worker for job 33333"
        "[${twoHoursAgo}Z INFO Terminal] Running job: T0 Gate"
    ) | Set-Content -Path $quietLog -Encoding ASCII

    $result = Test-ListenerStuck -RunnerDir $tempRoot -ThresholdMinutes 3
    Assert-False 'quiet runner (idle, no broker errors) is NOT flagged as stuck' $result.Stuck
}
finally {
    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Test-QueueIdleCorroborated (Sweep 8 G regression coverage) ---------

Write-Host ''
Write-Host '=== Test-QueueIdleCorroborated ==='

# This is the regression test for the PR #159 false-positive. Without
# corroboration, ANY upstream queued workflow (CodeQL on ubuntu-latest,
# environment-approval blocks, workflow_run waiters) would bounce healthy
# idle Listeners. Each of the 3 cases below MUST hold or that bug returns.

# Case 1: no broker error at all -> not corroborated -> do not bounce.
$corroborated = Test-QueueIdleCorroborated -LastBrokerError $null -CorroborationWindowMinutes 10
Assert-False 'no broker error -> queue-idle is NOT corroborated (the PR #159 bug case)' $corroborated

# Case 2: fresh broker error -> corroborated -> safe to bounce.
$freshErr = (Get-Date).ToUniversalTime().AddMinutes(-2)
$corroborated = Test-QueueIdleCorroborated -LastBrokerError $freshErr -CorroborationWindowMinutes 10
Assert-True 'broker error 2 min ago -> queue-idle IS corroborated (real stuck case)' $corroborated

# Case 3: stale broker error -> not corroborated -> do not bounce.
$staleErr = (Get-Date).ToUniversalTime().AddMinutes(-30)
$corroborated = Test-QueueIdleCorroborated -LastBrokerError $staleErr -CorroborationWindowMinutes 10
Assert-False 'broker error 30 min ago -> NOT corroborated (broker recovered, idle pool is fine)' $corroborated

# Case 4: future-stamped (clock skew) -> not corroborated -> safe default.
$futureErr = (Get-Date).ToUniversalTime().AddMinutes(5)
$corroborated = Test-QueueIdleCorroborated -LastBrokerError $futureErr -CorroborationWindowMinutes 10
Assert-False 'future-stamped error (clock skew) -> NOT corroborated (safe default)' $corroborated

# --- Summary -------------------------------------------------------------

Write-Host ''
Write-Host '=== TEST SUMMARY ==='
Write-Host "  Passed: $script:PassCount"
Write-Host "  Failed: $script:FailCount"
$summary = @{
    type   = 'JANITOR_TESTS'
    passed = $script:PassCount
    failed = $script:FailCount
    failures = $script:Failures
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Compress
Write-Host $summary

if ($script:FailCount -gt 0) {
    Write-Host ''
    Write-Host 'Failures:'
    $script:Failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
exit 0
