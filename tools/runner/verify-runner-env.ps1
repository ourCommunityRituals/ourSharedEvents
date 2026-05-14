<#
.SYNOPSIS
  Read-only verification that the current (or named) runner env will resolve
  bash to Git Bash, not WSL bash.

.DESCRIPTION
  Two modes:
    1. No -RunnerPath → checks the currently-active $env:PATH. Used by the
       runner-env-validation.yml workflow once a job is already assigned to a
       runner. If the assigned runner is misconfigured, this fails fast with
       a clear actionable message instead of letting a downstream bash step
       fail with a corrupt-path "No such file or directory."
    2. -RunnerPath <folder> → inspects that runner's .env file's PATH (offline
       check before starting/restarting the Listener).

  Exit codes:
    0 - bash resolves to Git Bash (OK)
    1 - bash resolves to WSL bash (misconfigured)
    2 - runner path / .env not found
    3 - no bash on PATH at all

.PARAMETER RunnerPath
  Optional. Absolute path to an actions-runner-* folder.

.EXAMPLE
  pwsh -File tools/runner/verify-runner-env.ps1
  pwsh -File tools/runner/verify-runner-env.ps1 -RunnerPath C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-2
#>

[CmdletBinding()]
param(
    [string]$RunnerPath
)

$ErrorActionPreference = 'Stop'

function Resolve-FirstBash([string]$Path) {
    $output = & cmd /c "set PATH=$Path&& where bash 2>NUL"
    return ($output -split "`r?`n" | Where-Object { $_ })[0]
}

if ($RunnerPath) {
    if (-not (Test-Path $RunnerPath)) {
        Write-Error "Runner path does not exist: $RunnerPath"; exit 2
    }
    $envFile = Join-Path $RunnerPath '.env'
    if (-not (Test-Path $envFile)) {
        Write-Error @"
No .env file at $envFile - runner has NOT been provisioned.
Run: pwsh -File tools/runner/provision-runner.ps1 -RunnerPath $RunnerPath
"@
        exit 2
    }
    $pathLine = @(Get-Content $envFile | Where-Object { $_ -match '^PATH=' }) | Select-Object -First 1
    if (-not $pathLine) { Write-Error "No PATH= line in $envFile"; exit 2 }
    $probedPath = $pathLine.Substring(5)
    Write-Host "Checking PATH from $envFile"
} else {
    $probedPath = $env:PATH
    Write-Host "Checking active PATH (process env)"
}

$resolved = Resolve-FirstBash -Path $probedPath
if (-not $resolved) {
    Write-Error "No bash.exe found on PATH at all."
    exit 3
}

Write-Host "Resolved bash: $resolved"

if ($resolved -match 'WindowsApps') {
    $banner = @"

================================================================================
 RUNNER MISCONFIGURED -- WSL bash resolves before Git Bash on PATH.
================================================================================

 What's broken:
   - This runner's bash is the WSL shim (or Microsoft Store shim) at:
       $resolved
   - WSL bash interprets backslashes in Windows paths as escape characters,
     so any 'shell: bash' workflow step receives a corrupted script path.
   - Result: every workflow step that uses 'shell: bash' will fail with
     "/bin/bash: <mangled path>: No such file or directory".

 How to fix on the runner host (elevated PowerShell):
   pwsh -File tools/runner/provision-runner.ps1 -RunnerPath <runner-folder>
   Stop-ScheduledTask  -TaskName 'GitHubActionsRunner-<n>'
   Start-ScheduledTask -TaskName 'GitHubActionsRunner-<n>'

 Brain reference: OCR-docs/ocr-docs-brain/architectural-invariants.yaml
                  invariant id 11 (self_hosted_runner_bash_resolution)
================================================================================

"@
    Write-Host $banner
    exit 1
}

if ($resolved -notmatch 'Git[\\/]usr[\\/]bin') {
    Write-Warning "bash is '$resolved' - not WSL but not the expected Git Bash location. Verify it handles Windows paths correctly."
    # Don't fail - this is unusual but not the documented failure mode.
}

Write-Host "[OK] bash resolves to Git Bash."
exit 0
