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

| Symptom                                                        | Likely cause                                          | Fix                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `🛑 Security Human Gate` fails in 4s with no security findings | New runner missing `.env`; WSL bash won the PATH race | Re-run `provision-runner.ps1`, then bounce the scheduled task |
| `/bin/bash: <mangled path>.sh: No such file or directory`      | Same as above                                         | Same as above                                                 |
| `verify-runner-env.ps1` exits 2 with "no .env"                 | Runner registered but never provisioned               | Run `provision-runner.ps1`                                    |
| `verify-runner-env.ps1` exits 3 with "no bash on PATH"         | Git Bash not installed at all                         | Install Git for Windows: https://git-scm.com/download/win     |
| `Set-ScheduledTask: Access is denied`                          | Shell isn't elevated                                  | Right-click PowerShell → Run as Administrator                 |

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
