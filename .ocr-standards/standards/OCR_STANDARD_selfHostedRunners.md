# OCR_STANDARD_selfHostedRunners

**Status:** RETIRED (2026-09-02, OSE-1194) · **Owner:** infra · **Last updated:** 2026-09-02

> **RETIRED.** The self-hosted runner fleet (BLOODRAVEN, -2, -3) was decommissioned on 2026-09-02.
> Every OCR workflow now runs on GitHub-hosted `ubuntu-latest`. Brain invariants #11
> (`self_hosted_runner_bash_resolution`) and #12 (`runner_pool_readiness_probe`) are `retired`, and
> the OSE tooling this standard described (`tools/runner/`, `runner-env-validation.yml`) was deleted.
> The text below is preserved as the historical record of the topology and is **not** to be followed.

Canonical architecture for OCR's self-hosted GitHub Actions runners. Every OCR workflow runs here. No billed GitHub-hosted minutes are consumed — see `feedback_self_hosted_only.md` in Claude memory for the durable stance.

---

## 1. Why self-hosted

- **Cost.** Pre-launch OCR explicitly excludes billed hosted-runner minutes.
- **Privacy.** All OCR repos are private until public launch. Keeping execution on user-controlled infrastructure reinforces the posture.
- **Control.** Secrets, tokens, and build artifacts stay on the self-hosted machine.

## 2. Topology

**One org-level runner group, multiple runner processes on the same physical machine.**

- **Group name:** `ocr-default` — created at `https://github.com/organizations/ourCommunityRituals/settings/actions/runner-groups`. Every OCR repo has access (no repo allowlist restriction — matches how `self-hosted` works today).
- **Runner count:** start at 3 (BLOODRAVEN, BLOODRAVEN-2, BLOODRAVEN-3). Scales vertically on one machine until CPU or disk I/O saturates. Add more as needed.
- **Runner OS:** Windows (the user's primary machine). Linux-native or macOS-native runners can join later with appropriate labels.

Rationale: one shared pool avoids per-repo fragmentation, mirrors how `ocr-docs-brain` is the org brain, and matches how `@ocr/flags` is a shared package — **infrastructure follows the same "shared at org level" pattern as code.**

## 3. Naming convention

`BLOODRAVEN-<N>` where `<N>` starts at 2 for each additional runner on the same machine. The unnumbered `BLOODRAVEN` is the original. If runners are added on a second machine in the future, use `<HOSTNAME>-<N>` — the machine name is the primary scoping key.

## 4. Install-dir convention

Each runner gets its own directory, siblings under the OCR root:

```
C:\Users\mzdan\dev\ourCommunityRituals\
├── actions-runner\         ← BLOODRAVEN (original)
├── actions-runner-2\       ← BLOODRAVEN-2
├── actions-runner-3\       ← BLOODRAVEN-3
├── OCR-docs\
├── ourSharedEvents\
└── ...
```

**Never** place a runner under `OneDrive\`, under a user profile sync dir, or inside any app repo. The root `.gitignore` already excludes `actions-runner*/` from the workspace repo.

## 5. Label taxonomy

Each runner registers with these labels:

| Label         | Meaning                                          | Applied to          |
| ------------- | ------------------------------------------------ | ------------------- |
| `self-hosted` | Always present on self-hosted runners (implicit) | All                 |
| `windows`     | OS pin                                           | All current runners |
| `ocr-default` | Part of the default runner group                 | All                 |

Workflow `runs-on:` should prefer the label-set form for fleet portability:

```yaml
runs-on: [self-hosted, windows]
```

Bare `runs-on: self-hosted` still works (matches any self-hosted runner) — used by existing workflows. New workflows SHOULD use the label-set form so a future Linux runner doesn't accidentally pick up Windows-pinned jobs.

## 6. Lifecycle

Each runner is registered as a **Windows service** named `actions.runner.ourCommunityRituals.BLOODRAVEN-<N>`. This is GitHub's standard service-name format. Benefits:

- Survives machine reboots without manual start
- Runs under a dedicated service account (not the interactive user)
- Can be started/stopped/queried via `Get-Service`, `Start-Service`, `Stop-Service`

Check runner health:

```powershell
Get-Service "actions.runner.ourCommunityRituals.*" | Format-Table Name, Status
```

## 7. Security expectations

- **Registration tokens are short-lived** (~1 hour). The install script accepts one as a parameter; generate it fresh per runner via `gh api orgs/ourCommunityRituals/actions/runners/registration-token -X POST` or the web UI. Never commit tokens.
- **Rotate the runner app** quarterly or on security advisory. The install script can upgrade in-place.
- **Least privilege**: the service account only needs to read the runner dir and write to `_work/`. It must NOT have access to user profile files, OneDrive, or unrelated development folders.
- **Audit expectation**: when a runner is retired, remove it from the org (`gh api orgs/ourCommunityRituals/actions/runners/<id> -X DELETE`) AND delete the service AND delete the install directory. Do not leave orphaned runner dirs on disk.

## 8. Operational runbook — `runner.ps1`

All runner lifecycle operations flow through a single tool at
`OCR-docs/shared/runner.ps1`. It is non-interactive, idempotent where
correctness permits, admin-elevation-aware, and safe for scripted
automation. Every subcommand returns a proper exit code.

| Subcommand | Purpose                                                        | Required args                               | Notes                                                                                         |
| ---------- | -------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `install`  | Fresh install — download + register + service + start          | `-Number <N>`, `-RegistrationToken <token>` | Creates `actions-runner-<N>/`. N must be ≥ 2 (original BLOODRAVEN not managed here).          |
| `convert`  | Retrofit interactive runner to Windows service                 | `-Name <runner>`                            | Idempotent — safe re-run. Use to upgrade the original BLOODRAVEN from interactive to service. |
| `start`    | Start an existing service                                      | `-Name <runner>`                            | No-op if already Running.                                                                     |
| `stop`     | Stop an existing service                                       | `-Name <runner>`                            | No-op if already Stopped.                                                                     |
| `restart`  | Stop + Start                                                   | `-Name <runner>`                            |                                                                                               |
| `status`   | List all OCR runners + state (read-only)                       | none                                        | Covers both services and orphaned interactive runners. `-Json` for machine-readable output.   |
| `retire`   | Stop + uninstall service + deregister from GitHub + delete dir | `-Name <runner>`, `-RemovalToken <token>`   | Prompts for confirmation. Use `-Force` for automation. Destructive — no undo.                 |

Minting short-lived tokens for `install` / `retire`:

```powershell
# Requires gh with admin:org scope
$regToken   = gh api orgs/ourCommunityRituals/actions/runners/registration-token -X POST --jq .token
$rmToken    = gh api orgs/ourCommunityRituals/actions/runners/remove-token       -X POST --jq .token
```

Install a new runner:

```powershell
.\runner.ps1 install -Number 2 -RegistrationToken $regToken
```

Retrofit the interactive BLOODRAVEN to a service:

```powershell
.\runner.ps1 convert -Name BLOODRAVEN
# (Stop the interactive run.cmd process in its terminal first.)
```

Check fleet health:

```powershell
.\runner.ps1 status
```

Retire a runner safely:

```powershell
.\runner.ps1 retire -Name BLOODRAVEN-3 -RemovalToken $rmToken
```

**Automation pattern.** All subcommands are exit-code-clean and
non-interactive (except `retire` without `-Force`). Pipe into CI, call
from a dashboard script, or schedule via Task Scheduler — the tool is
the automation surface, not ad-hoc terminal clicking.

## 9. Monitoring

No external monitoring today. Future: surface runner health into the dashboard (`OCR-docs/docs/dashboard/`). Minimum viable signal:

- Service status (`Get-Service` output)
- Queue depth across the fleet (`gh run list --status queued --limit 100`)
- Per-runner last job timestamp

## 10. Why this is the hygienic long-term answer

- **Single source of truth.** One runner group serves every OCR repo. Matches how Brain serves every OCR product.
- **Parallelism without per-repo complexity.** Scale the pool, not the workflows.
- **Reproducible.** The install script + this standard mean any future operator (or Claude session) can bring a machine online consistently.
- **Portable.** Label taxonomy means adding a Linux or second-machine runner later doesn't require workflow rewrites — just label additions.
- **Cost-coupled to zero.** Every workflow runs on infrastructure owned by the user; no billed minutes possible by design.
