# Workflow Verification Report

**Date:** 2024-12-17 (Updated: Story 1 - Validate & Align GitHub Workflows)
**Purpose:** Verify no "ghost workflows" are running - only canonical active workflows respond to triggers.

## Active Workflows

| Workflow                     | File                       | Triggers                                        |
| ---------------------------- | -------------------------- | ----------------------------------------------- |
| **Stage-1 Validation**       | `stage1.yml`               | PR to main, Push to main, Tag `v*.*.*`          |
| **T5 → T6 → Post-T6**        | `red-team-adversarial.yml` | workflow_run (CI/CD success on a push to main)  |
| **CodeQL Security Analysis** | `security-scan.yml`        | Push to main/claude/**, PR to main, Weekly cron |

The canonical OurSharedEvents pipeline is defined in `oursharedevents-ci.yml`.
T5, T6 and the post-T6 security bookend are three jobs in one workflow run,
chained by `needs:`: T6 starts only after T5 succeeds, and the bookend only
after T6. Every job runs only when the triggering CI/CD run was a push to
`main` from this repo (ADR-012 0.2); pull-request pipeline runs are never
red-teamed with live secrets. They were separate workflow_run workflows until
2026-10-03, but a workflow_run fired by another workflow_run reports
`event == 'workflow_run'`, so T6 and the bookend skipped on every run.

## A pull request whose pipeline never ran (OSE-1212)

**Recognise it.** The PR shows a handful of green checks and none of `S0 Security`, `T0 Gate (<shard>)`,
`Gate-execution reconciler` or `Invariant #22 cross-repo isolation gate`. PR #455 showed four green checks
(Security Regression Gate, QR-0 Contract Verification and two CodeQL checks) while the pipeline had produced
no run at all:

```bash
gh pr checks <number>
gh run list --workflow "OurSharedEvents CI/CD" --branch <branch>   # no rows = the pipeline never started
```

The CodeQL checks with `event: dynamic` come from GitHub's default code-scanning setup. They are not
`pull_request` workflow runs, so their presence says nothing about whether the pipeline started.

**Cause: not established.** The first explanation (GitHub does not fire `pull_request` workflows for events
made with an app token) was disproved on PR #456, which was opened through the same tool by the same actor and
did start the pipeline. Do not rely on it. The one observed difference was that #455's branch had never hosted a
PR before.

**It cannot merge.** The checks above are required on `main`, with `enforce_admins` on
(`tools/ci/main-branch-protection.json`). A required check that never reports stays at "Expected: waiting for
status to be reported", so the merge button stays blocked, admins included. That block does not depend on
knowing the cause. Do not lift protection to get past it.

**Fix it.** Push any commit to the PR branch (`git commit --allow-empty -m "Run the pipeline"`); that fires
`pull_request: synchronize`, which worked for #455 (4 checks became 19).

**What keeps this true.** `tests/unit/ci/pr-pipeline-must-run.test.js` fails if the pipeline's
`pull_request` trigger gains a path, branch or type filter, if the S0, T0 or reconciler jobs gain an `if:` that
can skip them, if any of those names leaves the required list, or if `enforce_admins` goes off.
`.github/workflows/branch-protection-drift.yml` checks nightly that GitHub holds the list the file says.

## Properly Archived/Disabled Files

Files in `archive/` are ignored by GitHub Actions (only root `.github/workflows/*.yml` files execute):

### Superseded Workflows (Consolidated into Main Pipeline)

| File                     | Original Purpose               | Superseded By |
| ------------------------ | ------------------------------ | ------------- |
| `stage1-ci.yml`          | Security-first CI pipeline     | `stage1.yml`  |
| `stage2-smoke.yml`       | Post-deploy smoke tests        | `stage2.yml`  |
| `stage2-staging.yml`     | Staging health gate            | `stage2.yml`  |
| `e2e-staging-stable.yml` | E2E tests after staging deploy | `stage2.yml`  |

### Utility Workflows (Manual Dispatch Only)

| File                    | Original Purpose                    | Notes                           |
| ----------------------- | ----------------------------------- | ------------------------------- |
| `deploy-worker.yml`     | Manual Cloudflare Worker deployment | For emergency deploys           |
| `rollback.yml`          | Manual rollback capability          | For emergency rollbacks         |
| `prod-parity-check.yml` | Production parity verification      | Manual check before DNS cutover |

### Scheduled Monitoring (Not Core Pipeline)

| File                         | Original Purpose               |
| ---------------------------- | ------------------------------ |
| `api-version-check.yml`      | Nightly API version comparison |
| `e2e-nightly-production.yml` | Nightly production E2E tests   |

### Disabled/Deprecated

| File                               | Original Purpose                         |
| ---------------------------------- | ---------------------------------------- |
| `unified-ci.yml.disabled`          | Legacy unified CI (disabled extension)   |
| `fix-gas-permissions.yml.disabled` | GAS permissions fix (disabled extension) |
| `stage2-testing.yml.backup`        | Legacy Stage-2 testing (backup)          |

## Expected Behavior Matrix

### Scenario 1: Non-tag Push to main

**Trigger:** `git push origin main` (without tag)

| Workflow                 | Should Run?                      | Jobs                                       |
| ------------------------ | -------------------------------- | ------------------------------------------ |
| Stage-1 Validation       | **YES**                          | `validate` → `staging-deploy`              |
| Stage-2 Orchestrator     | **YES** (after Stage-1 succeeds) | `api-smoke`, `ui-smoke`, `validation-gate` |
| CodeQL Security Analysis | **YES**                          | `analyze`                                  |

### Scenario 2: Pull Request to main

**Trigger:** Open a PR targeting `main`

| Workflow                 | Should Run? | Jobs                                          |
| ------------------------ | ----------- | --------------------------------------------- |
| Stage-1 Validation       | **YES**     | `validate` only (no deploy)                   |
| T5 → T6 → Post-T6        | **NO**      | (only after CI/CD succeeds on a push to main) |
| CodeQL Security Analysis | **YES**     | `analyze`                                     |

### Scenario 3: Tag Push (vX.Y.Z)

**Trigger:** `git tag v1.0.0 && git push origin v1.0.0`

| Workflow                 | Should Run? | Jobs                                  |
| ------------------------ | ----------- | ------------------------------------- |
| Stage-1 Validation       | **YES**     | `validate` → `production-deploy`      |
| Stage-2 Orchestrator     | **NO**      | (only triggers on `branches: [main]`) |
| CodeQL Security Analysis | **NO**      | (tags not in trigger)                 |

## Verification Checklist

### Pre-verification Checks

- [x] Only 3 `.yml` files in `.github/workflows/` root
- [x] All legacy workflows moved to `archive/` subdirectory
- [x] `unified-ci.yml` properly disabled with `.disabled` extension
- [x] `archive/README.md` documents archival policy

### Manual Verification Steps

#### Test 1: Push to main (non-tag)

1. Push a commit to main
2. Go to **Actions** tab
3. Verify only these workflows appear:
   - [ ] Stage-1 Validation (with Validate + Deploy to Staging jobs)
   - [ ] Stage-2 Orchestrator (after Stage-1 succeeds)
   - [ ] CodeQL Security Analysis
4. Verify NO legacy workflows run

#### Test 2: Open PR to main

1. Create a branch and open PR to main
2. Go to **Actions** tab
3. Verify only these workflows appear:
   - [ ] Stage-1 Validation (Validate job only)
   - [ ] CodeQL Security Analysis
4. Verify Stage-2 does NOT run

#### Test 3: Create tag vX.Y.Z

1. Create and push a semantic version tag
2. Go to **Actions** tab
3. Verify only these workflows appear:
   - [ ] Stage-1 Validation (with Validate + Deploy to Production + Smoke Tests)
4. Verify Stage-2 does NOT run on tags
5. Verify no legacy workflows run

## Acceptance Criteria

| Criterion                                                  | Status            |
| ---------------------------------------------------------- | ----------------- |
| No archived workflows show in Actions UI when triggers hit | **EXPECTED PASS** |
| Only stage1/stage2/security respond to relevant events     | **EXPECTED PASS** |
| No duplicate/conflicting workflow names                    | **VERIFIED**      |
| All legacy workflows properly archived                     | **VERIFIED**      |

## Conclusion

Based on static analysis of the workflow files:

1. **File structure is correct** - Only 3 active workflow files in root, all legacy files in `archive/` subdirectory
2. **Trigger configuration is correct** - Each workflow responds only to its designated events
3. **No ghost workflows possible** - GitHub Actions only executes `.yml`/`.yaml` files in the root of `.github/workflows/`

**Recommendation:** Complete manual verification by running the 3 test scenarios above and confirming expected behavior in the GitHub Actions UI.
