<#
.SYNOPSIS
  Idempotent provisioning for a Bloodraven self-hosted GitHub Actions runner folder.

.DESCRIPTION
  Enforces the canonical runner contract documented in
  OCR-docs/ocr-docs-brain/architectural-invariants.yaml (invariant 11,
  self_hosted_runner_bash_resolution):

    - Git Bash MUST resolve before WSL bash on PATH so workflows using
      `shell: bash` resolve to `C:\Program Files\Git\usr\bin\bash.exe`
      (Cygwin-compatible) and don't trip on Windows backslash escapes.

  How it works:
    The actions-runner reads a `.env` file from its install folder at
    Runner.Listener startup and exports those vars to every job process.
    This script writes a canonical PATH (plus the ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT
    verbosity flag) into `.env` and verifies bash resolution.

  Run after `config.cmd` registers a new runner, and any time you suspect
  drift (PATH changes, Git for Windows reinstall, WSL upgrade, etc.).

.PARAMETER RunnerPath
  Absolute path to the actions-runner-* folder containing run.cmd + config.cmd.

.EXAMPLE
  pwsh -File tools/runner/provision-runner.ps1 -RunnerPath C:\Users\mzdan\dev\ourCommunityRituals\actions-runner-2

.NOTES
  Writes a backup of any existing .env to .env.backup.<timestamp> before
  modifying. Listener picks up the new env only on restart.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$RunnerPath
)

$ErrorActionPreference = 'Stop'

# ── Pre-flight ────────────────────────────────────────────────────────────────

if (-not (Test-Path $RunnerPath)) {
    Write-Error "Runner path does not exist: $RunnerPath"
    exit 2
}
if (-not (Test-Path (Join-Path $RunnerPath 'run.cmd'))) {
    Write-Error "Path is not a runner folder (no run.cmd): $RunnerPath"
    exit 2
}

$gitBashDir = 'C:\Program Files\Git\usr\bin'
$gitBashExe = Join-Path $gitBashDir 'bash.exe'

if (-not (Test-Path $gitBashExe)) {
    Write-Error @"
Git Bash not found at $gitBashExe.
Install Git for Windows first: https://git-scm.com/download/win
This runner cannot be provisioned without Git Bash. Workflows that use
``shell: bash`` would otherwise resolve to WSL bash and corrupt Windows paths.
"@
    exit 2
}

# ── Build canonical PATH ──────────────────────────────────────────────────────
# Order matters: Git Bash dir FIRST so `where bash` picks bash.exe from there
# before falling through to WSL's bash shim under WindowsApps.

$canonicalPath = @(
    $gitBashDir,                                                       # ← MUST be first
    'C:\Windows\system32',
    'C:\Windows',
    'C:\Windows\System32\Wbem',
    'C:\Windows\System32\WindowsPowerShell\v1.0',
    'C:\Windows\System32\OpenSSH',
    'C:\Program Files\Git\cmd',                                         # git.exe
    'C:\Program Files\nodejs',                                          # node, npm
    'C:\Program Files\GitHub CLI',                                      # gh
    'C:\Program Files\Cloudflare\Cloudflare WARP',
    'C:\Program Files (x86)\cloudflared',
    'C:\Users\mzdan\AppData\Local\Microsoft\WindowsApps',               # WSL bash - AFTER Git Bash
    'C:\Users\mzdan\AppData\Local\Programs\Microsoft VS Code\bin',
    'C:\Users\mzdan\AppData\Local\GitHubDesktop\bin',
    'C:\Users\mzdan\AppData\Local\Microsoft\WinGet\Packages\Doppler.doppler_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'C:\Users\mzdan\AppData\Roaming\npm',
    'C:\Users\mzdan\AppData\Local\Microsoft\WinGet\Links'
) -join ';'

$envFilePath = Join-Path $RunnerPath '.env'

# Canonical .env is multi-line. The runner reads every KEY=VALUE line at
# Listener startup and exports them to job processes:
#   PATH=...                              → invariant #11 (Git Bash resolves
#                                           before WSL bash).
#   ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1  → mirror the full listener/job trace to
#                                           the runner's console window so an
#                                           operator can see WHAT is running
#                                           WHERE, instead of an opaque
#                                           "Running job:" line (COST-222).
# verify-runner-env.ps1 inspects only the `PATH=` line, so additional vars here
# do not affect the bash-resolution check.
$runnerEnvLines = @(
    "PATH=$canonicalPath"
    'ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1'
)
$desiredContent = $runnerEnvLines -join "`n"

# ── Idempotency: skip if already canonical ────────────────────────────────────

$existing = if (Test-Path $envFilePath) {
    (Get-Content $envFilePath -Raw).TrimEnd("`r","`n"," ","`t")
} else { '' }

if ($existing -eq $desiredContent) {
    Write-Host "[ALREADY CANONICAL] $envFilePath"
} else {
    if ($existing) {
        $backup = "$envFilePath.backup.$(Get-Date -Format yyyyMMddHHmmss)"
        Copy-Item $envFilePath $backup
        Write-Host "[BACKUP] $existing -> $backup"
    }
    # ASCII-no-BOM so the runner's parser reads it cleanly
    [System.IO.File]::WriteAllText($envFilePath, $desiredContent, [System.Text.Encoding]::ASCII)
    Write-Host "[WROTE] $envFilePath"
}

# ── Post-check: verify bash resolves under this PATH ─────────────────────────

$probe = & cmd /c "set PATH=$canonicalPath&& where bash 2>NUL"
$firstBash = ($probe -split "`r?`n" | Where-Object { $_ })[0]

if (-not $firstBash) {
    Write-Error "POST-CHECK FAILED: 'bash' not found anywhere on canonical PATH"
    exit 3
}
if ($firstBash -match 'WindowsApps') {
    Write-Error "POST-CHECK FAILED: first bash on canonical PATH is WSL bash ($firstBash). Git Bash dir is misordered or missing."
    exit 3
}
if ($firstBash -notmatch 'Git[\\/]usr[\\/]bin') {
    Write-Warning "first bash is '$firstBash' - not WSL but not the expected Git Bash location either."
}

Write-Host ""
Write-Host "[OK] bash resolves to: $firstBash"
Write-Host ""
Write-Host "Next: bounce the runner's scheduled task so Runner.Listener reloads .env."
Write-Host "  Stop-ScheduledTask  -TaskName 'GitHubActionsRunner-<n>'"
Write-Host "  Start-ScheduledTask -TaskName 'GitHubActionsRunner-<n>'"
