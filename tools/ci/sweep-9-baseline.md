# Sweep 9 baseline + measurement plan

**Date:** 2026-05-14
**Baseline PR:** [#160](https://github.com/ourCommunityRituals/ourSharedEvents/pull/160) (OSE-206 pagination, last PR before Sweep 9 lands)
**Sweep 9 PR:** TBD — measure post-merge against the next OSE story PR

## Baseline (PR #160)

Pulled via `gh run list --branch <pr-160-head> --json ...`:

| Workflow                 | Wall-clock                                 | Notes                                                   |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| OurSharedEvents CI/CD    | **6.4 min**                                | Monolithic T0 Gate job (the long pole)                  |
| Security Regression Gate | 2.6 min                                    | No concurrency cancellation                             |
| CodeQL (codeql.yml)      | 2.4 min                                    | Plus duplicate in S0 Security (~2 min in same workflow) |
| Security Human Gate      | 1.5 min                                    |                                                         |
| Dependency Review        | 1.3 min                                    |                                                         |
| Runner Env Validation    | 1.0 min                                    |                                                         |
| Brain contract check     | 0.7 min                                    |                                                         |
| Claude Code Review       | (cancel)                                   | Non-load-bearing                                        |
| **Wall-clock total**     | **~6.4 min** (bounded by longest workflow) |
| **Runner-seconds total** | ~16 min (sum across workflows)             |

## Sweep 9 commits + expected per-fix savings

| Commit    | Fix                                                                                                | Expected wall-clock saving / PR                   |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `3123b0d` | #1+#3: Shard T0 Gate into 4-way matrix (lint/typecheck/tests/a11y); lint shard skips worker npm ci | **~3 min** (6.4 → ~3 min, long pole = gate-tests) |
| `f0d0e9e` | #2: Remove duplicate CodeQL from S0 Security; codeql.yml is canonical                              | **~2.4 min** (one CodeQL invocation, not two)     |
| `dab6666` | #4: Add concurrency groups to codeql.yml, security-scan.yml, security-regression.yml               | **0s steady-state; 2–3× during rapid iteration**  |
| `8e0f643` | #6: Drop `fetch-depth: 0` from claude-review.yml                                                   | **~10–20s** on the Claude review check            |
| `<this>`  | Measurement helper: `tools/ci/measure-rollup.ps1`                                                  | n/a (enables future before/after deltas)          |

**Expected post-Sweep-9 wall-clock:** ~3–3.5 min long pole (vs 6.4 min baseline). **~50% reduction.**

## How to verify

After Sweep 9 PR merges, the next OSE story PR's rollup gives the AFTER snapshot. Compare with:

```powershell
# Baseline (already shipped)
pwsh tools/ci/measure-rollup.ps1 -PrNumber 160 > baseline.txt

# After (run on the first PR post-Sweep-9)
pwsh tools/ci/measure-rollup.ps1 -PrNumber <next-pr> > after.txt

# Diff the per-workflow rollup
diff baseline.txt after.txt
```

The `CI_ROLLUP_MEASUREMENT` JSON line at the bottom of each run is the easiest summary to compare programmatically:

```
{"type":"CI_ROLLUP_MEASUREMENT","wallclock_sec":<n>,"runner_sec_total":<n>,...}
```

## Attribution-by-job-name

The matrix sharding (commit #1) also makes per-shard timing visible in the rollup. Job names become `T0 Gate (lint)`, `T0 Gate (typecheck)`, `T0 Gate (tests)`, `T0 Gate (a11y)`. Each can be tracked individually:

```powershell
pwsh tools/ci/measure-rollup.ps1 -PrNumber <n> | Select-String 'T0 Gate'
```

If `gate-tests` is the bottleneck after Sweep 9 (expected), the next leverage move is to shard the test suite itself — e.g. split worker D1 schema and the root npm test into separate shards. That becomes Sweep 10 fodder once we have empirical evidence.

## What this work does NOT do

- **Paths-filter heavy workflows.** Audit confirmed this would violate the `feedback_security_unconditional.md` doctrine.
- **Cache Playwright + gitleaks binaries.** Only hits push-to-main and smoke workflows, not the PR loop. Deferred — separate story if signal warrants.
- **`_work/_temp` artifact GC.** No empirical evidence of pressure yet. Deferred.
- **Workflow fan-out beyond T0 Gate.** S0 Security could theoretically shard (Semgrep | detect-secrets | gitleaks | npm audit | SBOM) but each is short and the setup overhead would dominate. Stay monolithic.
