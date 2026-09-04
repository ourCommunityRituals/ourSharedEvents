# main branch protection — source of truth

`main` protection is codified in [`main-branch-protection.json`](./main-branch-protection.json) and
applied/verified with [`scripts/apply-branch-protection.mjs`](../../scripts/apply-branch-protection.mjs).

**Why this file exists:** protection was originally applied as an ad-hoc API call — un-versioned,
un-reproducible, and silently removable. `main` had in fact shipped with _no_ protection at all.
Codifying it makes the gate reproducible and drift-detectable.

## The rule

Required status checks = the CI jobs that **always run to completion on a `pull_request`**:

| Required check                                                                           | Why                                            |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `S0 Security`                                                                            | Security bookend (Gate 1)                      |
| `T0 Gate (lint)` / `(typecheck)` / `(tests)` / `(a11y)` / `(invariants)` / `(component)` | Quality + the **invariant constitution** shard |

"Always runs to completion" is now a derived property, not a judgement call: a job
qualifies when it has no `if:` **and** none of its transitive `needs:` has one. That
rule is executed by `tests/unit/branch-protection-contract.test.js`, which compares the
JSON against the workflow in both directions on every PR — a required check with no job
behind it, or a newly-added always-run shard nobody required, fails T0.

### `S2 Post-Execution Security` was removed (2026-09-03, OSE-1216)

It was listed as required but **no workflow has posted a check by that name** since
OSE-1056/1057 retired the `security-post` / `security-post-scan` jobs and re-homed the
real tamper check into the tail of `functional-staging` — which `if:`-skips on PRs. A
required check that nothing reports is not a gate: either it silently blocked every PR,
or (the actual state, since PRs have been merging) live protection never matched this
file. Listing it made the security posture read stronger than it was.

**Residual, tracked on OSE-1216:** post-execution integrity is therefore exercised only
on `main` (via `functional-staging`), not per-PR. Restoring a PR-time Gate 4 needs a job
that actually runs on `pull_request`; until that exists, do not re-add the context here.

`enforce_admins: true` — the gate binds admin/agent merges too (makes "green ships" enforced, not convention).
`strict: false` — do **not** force branches up-to-date before merge (the single-runner pool can't afford serial re-runs of every open PR).

**Deliberately NOT required:**

- `Claude PR Review` and `Validate against OCR-docs brain` — known false-reds; excluding them means they neither block nor need per-PR manual override.
- `T1 Deploy`, `T2 Smoke`, `T3 Contract`, `T4 Functional` — these `if:`-skip on PRs; requiring a job that skips would deadlock every PR.

## Commands

```bash
node scripts/apply-branch-protection.mjs --check   # read-only drift check (CI-safe); exit 1 on drift
node scripts/apply-branch-protection.mjs --apply   # PUT the config (requires repo admin)
```

`--check` runs nightly in [`branch-protection-drift.yml`](../../.github/workflows/branch-protection-drift.yml),
so silent removal of protection — or drift between this file and the live settings — fails a
build instead of waiting to be noticed. Reading protection needs repo-admin scope, which the
default `GITHUB_TOKEN` does not have, so that workflow uses the `BRANCH_PROTECTION_TOKEN`
secret and **fails loudly when it is absent**: "cannot verify" is the finding, not a reason
to skip.

## ⚠ Emergency escape hatch (CI outage only)

`enforce_admins: true` means: if the required checks never report (a GitHub Actions or GitHub-hosted
runner outage), **no PR can merge — even by an admin**. The self-hosted runner pool, its readiness
probe and watchdog (`tools/runner/`, INVARIANT #12) were retired in OSE-1194 (2026-09-02); CI runs on
GitHub-hosted `ubuntu-latest`, so there is no runner to bounce — **prefer waiting out the upstream
incident** (https://www.githubstatus.com) over lifting protection.

If you are genuinely stuck and must merge during an outage you cannot fix quickly:

```bash
gh api -X DELETE repos/ourCommunityRituals/ourSharedEvents/branches/main/protection   # lift
# ... merge the unblocking PR ...
node scripts/apply-branch-protection.mjs --apply                                       # RE-APPLY immediately
```

Re-apply protection the moment the emergency is over. Leaving `main` unprotected is the exact
failure this file exists to prevent.
