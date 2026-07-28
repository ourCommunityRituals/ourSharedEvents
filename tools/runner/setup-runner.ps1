<#
.SYNOPSIS
  One-shot runner setup — run once after config.cmd to fully provision a
  new self-hosted runner and install the readiness probe.

.DESCRIPTION
  Combines provision-runner.ps1 (Git Bash PATH contract, invariant #11)
  and install-janitor-tasks.ps1 (readiness probe + watchdog, invariant #12)
  into a single idempotent call. Running this script after config.cmd
  registration satisfies both partial → live criteria without any manual
  follow-up steps.

  Steps executed:
    1. provision-runner.ps1  — writes canonical Git-Bash-first PATH into
       the runner's .env so `shell: bash` workflows resolve correctly.
    2. install-janitor-tasks.ps1 — registers the 1-min readiness probe
       and 5-min watchdog as scheduled tasks for the current user.
    3. verify-runner-env.ps1 — pre-flight confirms Git Bash won the PATH
       race before the runner is opened for traffic.

  Idempotent: re-running is safe. All three sub-scripts are idempotent.

.PARAMETER RunnerPath
  Absolute path to the actions-runner-* folder containing config.cmd + run.cmd.
  Example: C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-3

.PARAMETER WhatIf
  Dry-run: print the commands that would be invoked without executing them.

.EXAMPLE
  pwsh -File tools/runner/setup-runner.ps1 -RunnerPath C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-3

.NOTES
  Brain reference:
    OCR-docs/ocr-docs-brain/architectural-invariants.yaml
      invariant #11 (self_hosted_runner_bash_resolution)
      invariant #12 (runner_pool_readiness_probe)
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$RunnerPath
)

$ErrorActionPreference = 'Stop'
$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step {
    param([string]$Label, [scriptblock]$Body)
    Write-Host "`n── $Label" -ForegroundColor Cyan
    & $Body
}

Step 'Step 1/3 — Provision runner environment (invariant #11)' {
    if ($WhatIfPreference) {
        Write-Host "  [WhatIf] pwsh $ScriptsDir\provision-runner.ps1 -RunnerPath $RunnerPath"
        return
    }
    & pwsh -File "$ScriptsDir\provision-runner.ps1" -RunnerPath $RunnerPath
}

Step 'Step 2/3 — Install readiness probe + watchdog tasks (invariant #12)' {
    if ($WhatIfPreference) {
        Write-Host "  [WhatIf] pwsh $ScriptsDir\install-janitor-tasks.ps1"
        return
    }
    & pwsh -File "$ScriptsDir\install-janitor-tasks.ps1"
}

Step 'Step 3/3 — Verify runner environment' {
    if ($WhatIfPreference) {
        Write-Host "  [WhatIf] pwsh $ScriptsDir\verify-runner-env.ps1 -RunnerPath $RunnerPath"
        return
    }
    & pwsh -File "$ScriptsDir\verify-runner-env.ps1" -RunnerPath $RunnerPath
}

Write-Host "`n✓ Runner setup complete. Start the runner with:" -ForegroundColor Green
Write-Host "    cd '$RunnerPath' && .\run.cmd" -ForegroundColor Green
Write-Host "  The next PR that targets this runner will trigger runner-env-validation.yml as CI confirmation.`n"
