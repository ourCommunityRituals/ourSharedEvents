# main branch protection — source of truth

`main` protection is codified in [`main-branch-protection.json`](./main-branch-protection.json) and
applied/verified with [`scripts/apply-branch-protection.mjs`](../../scripts/apply-branch-protection.mjs).

**Why this file exists:** protection was originally applied as an ad-hoc API call — un-versioned,
un-reproducible, and silently removable. `main` had in fact shipped with _no_ protection at all.
Codifying it makes the gate reproducible and drift-detectable.

## The rule

Required status checks = the CI jobs that **always run to completion on a `pull_request`**:

| Required check                                                           | Why                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------- |
| `S0 Security`                                                            | Security bookend (Gate 1)                      |
| `S2 Post-Execution Security`                                             | Security bookend (Gate 4)                      |
| `T0 Gate (lint)` / `(typecheck)` / `(tests)` / `(a11y)` / `(invariants)` | Quality + the **invariant constitution** shard |

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

`--check` is safe to wire into CI as a drift detector so silent removal of protection fails a build.

## ⚠ Emergency escape hatch (runner outage only)

`enforce_admins: true` + the single self-hosted runner pool (SPOF, OSE-699) means: if the runners are
down, the required checks never report and **no PR can merge — even by an admin**. A 1-min readiness
probe + 5-min watchdog (`tools/runner/janitor.ps1`, INVARIANT #12) auto-recovers a zombied runner, so
**prefer bouncing the runner** over lifting protection.

If you are genuinely stuck and must merge during an outage you cannot fix quickly:

```bash
gh api -X DELETE repos/ourCommunityRituals/ourSharedEvents/branches/main/protection   # lift
# ... merge the unblocking PR ...
node scripts/apply-branch-protection.mjs --apply                                       # RE-APPLY immediately
```

Re-apply protection the moment the emergency is over. Leaving `main` unprotected is the exact
failure this file exists to prevent.
