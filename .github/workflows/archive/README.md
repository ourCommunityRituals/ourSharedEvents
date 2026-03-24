# Archived Workflows

**Archived:** 2024-12-17
**Reason:** Story 1 - Validate & Align GitHub Workflows

## Archival Policy

These workflow files have been archived per the CI/CD architecture documentation (`docs/ci-cd-architecture.md`). Only three workflows are active in the main CI/CD pipeline:

| Active Workflow | Purpose |
|-----------------|---------|
| `stage1.yml` | Stage-1: Validate + Deploy (PR, push to main, tags) |
| `stage2.yml` | Stage-2: Environment Tests (after Stage-1 succeeds) |
| `security-scan.yml` | Security scanning (PR, push, weekly schedule) |

## Archived Workflows

### Superseded by stage1.yml

| File | Original Purpose | Status |
|------|------------------|--------|
| `stage1-ci.yml` | Security-first CI pipeline | Superseded - functionality consolidated into `stage1.yml` |

### Superseded by stage2.yml

| File | Original Purpose | Status |
|------|------------------|--------|
| `stage2-smoke.yml` | Post-deploy smoke tests | Superseded - functionality consolidated into `stage2.yml` |
| `stage2-staging.yml` | Staging health gate | Superseded - functionality consolidated into `stage2.yml` |
| `stage2-testing.yml.backup` | Legacy Stage-2 testing | Backup - never active |
| `e2e-staging-stable.yml` | E2E tests after staging deploy | Superseded - functionality consolidated into `stage2.yml` |

### Utility Workflows (Manual Dispatch Only)

These workflows are not part of the main CI/CD pipeline but may be useful for manual operations:

| File | Original Purpose | Notes |
|------|------------------|-------|
| `deploy-worker.yml` | Manual Cloudflare Worker deployment | Use for emergency deploys |
| `rollback.yml` | Manual rollback capability | Use for emergency rollbacks |
| `prod-parity-check.yml` | Production parity verification | Manual check before DNS cutover |

### Scheduled Monitoring (Not Core Pipeline)

| File | Original Purpose | Notes |
|------|------------------|-------|
| `api-version-check.yml` | Nightly API version comparison | Monitoring only |
| `e2e-nightly-production.yml` | Nightly production E2E tests | Monitoring only |

### Disabled/Deprecated

| File | Original Purpose | Status |
|------|------------------|--------|
| `unified-ci.yml.disabled` | Legacy unified CI | Disabled - never runs |
| `fix-gas-permissions.yml.disabled` | GAS permissions fix | Disabled - never runs |

## Restoration

If you need to restore any of these workflows:

1. Move the file back to `.github/workflows/` root
2. Update triggers if needed
3. Test thoroughly before enabling

**Warning:** Moving files back to the root directory will make them active immediately on their configured triggers.

## Why Archive?

Per CI/CD Architecture (`docs/ci-cd-architecture.md`):

> **Rule:** If it's not `stage1.yml`, `stage2.yml`, or `security-scan.yml`, it doesn't run.
>
> All other CI definitions have been archived under `.github/workflows/archive/`.

This ensures:
- No "ghost workflows" accidentally run on triggers
- Clear audit trail of what runs and when
- Reduced confusion about which workflow does what
- Compliance with documented architecture
