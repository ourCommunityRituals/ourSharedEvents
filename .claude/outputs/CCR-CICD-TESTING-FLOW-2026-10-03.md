# CCR (3 loops) — Move S0–T3 to the PR, leave T4 / T5 / closing S0 to Actions

Date: 2026-10-03. Protocol: `.claude/skills/ccr-protocol.md` v3.0. Reviewer role: DevOps/SRE (Infrastructure → Pipeline → Observability).
Artifact assessed: the _approach_ for `.github/workflows/oursharedevents-ci.yml` (+ `red-team-adversarial.yml`, `scripts/assert-gate-execution.mjs`). No workflow was edited.

**User goal (stated 2026-10-03):** clean up the experience so executions are not dropped and the testing flow has a clear order and is easy to understand.

**Approach under review:** On every PR run S0 → T0 → T2 Bruno → T3 Playwright smoke → UI smoke against a PR-local `wrangler dev --local` worker. After merge, Actions runs T1 deploy → T4 → T5 → closing S0 (T6), and no longer runs T2/T3.

**Scope note (protocol §2.2):** touching several workflows plus the Done definition in CLAUDE.md is a 5+ loop, human-gate-per-loop change. The user asked for 3 loops, so this worksheet can _assess the approach_ but cannot license the CLAUDE.md edit or any merge.

## Loop summary

| Loop | Score | Key finding                                                                                                       |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | 17.5% | Removing T2/T3 from the push run breaks T4, production deploy and the reconciler (a skipped job is not `success`) |
| 2    | 48%   | Plan amended on paper; PR-local run unproven; local tests no longer verify the deployed staging surface           |
| 3    | 50.5% | Stable, not inflated. Blocked on two human decisions and one first run                                            |

Gate (≥ 95%) **not met. Do not implement past step 1 until the human gate below is closed.**

## Corrections between loops (plan amendments, not code)

- 1→2: rewire `needs`/`if` on `functional-staging` (`ci.yml:1663-1672`) and `deploy-production` (`:2245-2255`) to stop requiring `smoke-staging`/`contract-staging`; update `expectedGates()` (`assert-gate-execution.mjs:41-65`), its self-test and `tests/unit/ci/gate-execution.test.js:21-36,80-81`; update `tests/integration/infra-consistency.test.js:94-95,165-185,775-843`.
- 1→2: fold the PR-local T2/T3/UI-smoke into one job that shares the local-worker boot with `mobile-workability-audit.yml` `pr-code` (ubuntu-24.04, blocking) instead of booting a second worker; add a path filter.
- 2→3: required checks verified by `gh api repos/:owner/:repo/branches/main/protection/required_status_checks` — only S0, T0 (lint/typecheck/tests/a11y/invariants), Gate-execution reconciler and Invariant #22 are required. T2/T3/T4 are not required checks, so renaming them breaks no merge rule; the **reconciler is the only thing that stops a silently skipped stage from merging**.

## Scoring worksheet

| Item                                                                                                                                                                       | Tier | Sev                   | L1        | L2      | L3             | Evidence                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------- | --------- | ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environmental assumptions verified                                                                                                                                         | Base | —                     | U 15      | P 7.5   | P 7.5          | Recipe runs on ubuntu via `mobile-workability-audit.yml:107-110` (verified); Bruno/T3 specs against a local worker were **not executed** (subagent report). Local Windows run on 2026-10-03 hit a D1 "internal error" at a long path and a stale `@ocr/ui` pin — Windows-local only, not CI evidence |
| Full surface mapped                                                                                                                                                        | Base | —                     | P 7.5     | P 7.5   | V 0 → see note | `full-pipeline/*` PR opt-in (`ci.yml:1003-1019`), mobile-audit overlap, reconciler, nightly path all mapped by L3. Note: kept P 7.5 for the unmeasured local startup                                                                                                                                 |
| Partial-fix risk assessed                                                                                                                                                  | Base | —                     | U 10      | P 5     | P 5            | Removal without rewiring = reconciler red on every merge; rewire is specified, not implemented                                                                                                                                                                                                       |
| Chunk scope correct                                                                                                                                                        | Base | —                     | V 0       | V 0     | V 0            | One workflow family                                                                                                                                                                                                                                                                                  |
| Human gate not bypassed                                                                                                                                                    | Base | —                     | V 0       | V 0     | V 0            | Two user choices recorded; open items below left to the user                                                                                                                                                                                                                                         |
| Dependency chain breaks (T4, prod deploy, reconciler, locked tests — correlated, counted once per severity)                                                                | Var  | Critical 15 + High 10 | 25        | 12.5    | 12.5           | `ci.yml:1671`, `:2245-2255`, `assert-gate-execution.mjs:41-65`, `infra-consistency.test.js`                                                                                                                                                                                                          |
| Staging stops being the verdict for API + smoke (Done level 6 and the "staging is the verdict" rule: CF Access, Bot Management, real bindings, queue, cron absent locally) | Var  | High 10               | 10        | 5       | 5              | `wrangler.toml:204-211` (SCAN_QUEUE staging-only); CLAUDE.md §5 Done = T1–T4 on staging. Open human decision                                                                                                                                                                                         |
| Flaky tests now block PRs                                                                                                                                                  | Var  | Medium 5              | —         | 5       | 5              | Observed 2026-10-03: 1 of 7 local failures is `ECONNRESET` on the 5-second `expect.poll(listed)` at `publish-loop-journey.spec.ts:174`; no matching server log line, no restart (`run-1.log`), consistent with a keep-alive race — cause not proven                                                  |
| Duplicate boot with mobile audit / `full-pipeline/*` opt-in                                                                                                                | Var  | Medium 5              | 5         | 2.5     | 2.5            | `ci.yml:1003-1019`; shared job proposed, not built                                                                                                                                                                                                                                                   |
| Required-check names                                                                                                                                                       | Var  | Medium 5              | 5         | 2.5     | 0              | Verified (`gh api`): not required                                                                                                                                                                                                                                                                    |
| Cost increase                                                                                                                                                              | Var  | Medium 5              | 5         | 2.5     | 2.5            | Measured post-merge T2 ≈130 s + T3 ≈115 s per run; added ≈5–6 min per PR push; local startup unmeasured                                                                                                                                                                                              |
| Local/CI divergence for contributors (Windows)                                                                                                                             | Var  | Low 2                 | —         | 2       | 2              | Local D1 failed under the long worktree path                                                                                                                                                                                                                                                         |
| **Total deduction**                                                                                                                                                        |      |                       | **82.5**  | **52**  | **49.5**       |                                                                                                                                                                                                                                                                                                      |
| **Score**                                                                                                                                                                  |      |                       | **17.5%** | **48%** | **50.5%**      |                                                                                                                                                                                                                                                                                                      |

L3's rise comes from one fact checked (required checks) and the L2 amendments, not from re-rating the same evidence.

## Assessment against the stated goal

**1. Executions not dropped.** These can drop or silently skip today; the approach must close them:

- A skipped job is not `success`: removing T2/T3 without rewiring would skip T4 and production deploy on every push (`ci.yml:1671`, `:2245`). Verified.
- The reconciler is the only required guard against a silently skipped stage; it must be updated in the same change (`assert-gate-execution.mjs:41-65`).
- PR runs are cancelled on every push (`ci.yml:147-153`, `cancel-in-progress` on `pull_request` only). Intended, but the last push's run is the only one that counts.
- T5 starts only after a green push run on `main` (`red-team-adversarial.yml:13-37`). With `cancel-in-progress: false` GitHub still replaces an older _pending_ run when a newer one queues; whether that has dropped red-team runs in this repo is **not verified** (CLAUDE.md §3 already notes a run cancelled by the next merge gets no T5; OSE-1506 proposes a nightly).
- A skipped T2/T3 does not fail the workflow conclusion, so T5 still starts. Verified by the subagent.

**2. Clear order.** The numbers no longer match execution order: T1 (deploy) would run _after_ T2/T3 in a PR (where it does not run) and _before_ T4 on merge. Suggested names that state where each runs: `T2 Contract → Local (Bruno)`, `T3 Smoke → Local (Playwright)`, `T3 UI Smoke → Local`, then `T1 Deploy → Staging`, `T4 Functional → Staging`, `T5 Red Team → Staging`, `T6 Closing Security`. Update the header comment and the Trigger Matrix (`ci.yml:2-90`) to match.

## Human gate (open — I will not assume these)

1. **Staging fidelity.** After merge, does anything still prove the _deployed_ API contract and smoke? Option A (as asked): T4 only, accepting that T4 plus the 6-hourly `cf-access-canary` and the T1 health check cover the deployed surface. Option B: keep T2/T3 post-merge but in parallel with T4 (no added wall time, still a staging verdict). Decide.
2. **First PR-time run.** Approve building step 1 (the PR-local job only, no post-merge changes) so Bruno-on-local, the local startup time and flake rate are measured before the post-merge rewiring.

## Pre-conditions before merge of any workflow change

- [ ] Step 1 job green on ubuntu for three consecutive PR runs (stability, not one pass)
- [ ] Reconciler, its self-test and unit test updated in the _same_ PR as the `needs`/`if` changes
- [ ] `infra-consistency.test.js` expectations updated
- [ ] CLAUDE.md Done definition changed only under a 5+ loop CCR with peer review

## Commit sequence (each independently revertable)

1. PR-local job (T2/T3/UI smoke) + path filter, sharing the mobile audit's worker boot
2. Rewire post-merge `needs`/`if`; reconciler + tests (one commit, must not be split)
3. Rename stages and update header comments / Trigger Matrix
4. CLAUDE.md Done definition (separate CCR, 5+ loops)

## Verification

- [ ] `gh run view` on a merge shows T1 → T4 → T5 → T6 executed, none `skipped` unintentionally; reconciler green
- [ ] A PR run shows S0, T0, T2, T3, UI smoke all executed against the local worker

---

# Re-run — extended Scrum team (2026-10-04)

Scope narrowed on purpose: **step 1 only** (PR-local T2/T3 job, additive). The post-merge chain is untouched, so the dependency-chain and staging-fidelity findings are not triggered by this change; they come back with step 2 and the pending decision.

Team: PO, Lead BE, Lead FE, Sr Design FE, Sr Automation QA, SRE/SDET, DevOps, plus Dr of Security, Sr SDET/SRE, DevOps Mgr, Sr Data Scientist.

## What was done (evidence)

- Ran T3 against a healthy local worker: IAC 21/21, security smoke 10/10, forms 12/12 (after fix). Ran T2: Bruno pages 54/54 requests, 243 checks; Bruno API 73 requests, 390 checks, 0 failed (after fix).
- Two real defects found by running locally, both fixed: `form-endpoints.spec.ts` and the Bruno "GET Check-in Count" check demanded a numeric count, but below the K=5 floor the API correctly returns `{count:null, suppressed:true, floor:5}`; they only passed on staging through accumulated smoke check-ins. Test-data dependence, not a product bug.
- New `scripts/ci/run-local-vetting.sh` + CI job `T2/T3 Local (PR code)` (`oursharedevents-ci.yml`, PRs only, needs S0/T0). Each section is counted from Playwright JSON / Bruno JUnit and **fails if zero tests ran** (the Dr of Security rule: a gate that cannot fail is absent).
- Reconciler now expects `local-vetting` on every pull request. 16 self-test cases pass; removing the rule turns 2 unit cases and the self-test red (born-red verified). Board has the new stage; 150 CI unit/infra tests pass.
- Flaky poll: `publish-loop-journey.spec.ts` retries once on `ECONNRESET`.

## Extended-team findings

| Role                | Finding                                                                                                                                                                                                                                                               | State    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Dr of Security      | No Security Critical open. The job uses no secrets (random local keys), runs the credential scan before upload, and cannot pass vacuously. It does use `OCR_PROPAGATE_TOKEN` to stage the pinned hub, same as the mobile audit                                        | V        |
| Sr SDET/SRE         | Local run found two floor-dependence defects (fixed). Script's own Linux boot path has **not** run in CI yet. A worker started from my Windows shell hung on every request after the first two starts (cause not found), so the script's boot step is unproven off-CI | P        |
| DevOps Mgr          | No new secrets or bindings. 20-minute timeout. No path filter yet, so it runs on every PR                                                                                                                                                                             | P (cost) |
| Sr Data Scientist   | Per-section counts now reach the summary (JUnit/JSON), so cost and flake rate can be measured from runs; none measured yet                                                                                                                                            | P        |
| Lead FE / Design FE | Local vetting covers API and smoke only. The front-end journeys stay in the mobile audit (already blocking); UI smoke is **not** yet in the PR job                                                                                                                    | P        |
| PO                  | Two decisions still open (staging T2/T3 after merge; step 2). Not needed to ship step 1                                                                                                                                                                               | open     |

## Score (step 1)

| Item                                                                | Sev    | State | Deduction |
| ------------------------------------------------------------------- | ------ | ----- | --------- |
| Environmental assumptions (script boot on Linux CI, 3 green runs)   | Base   | P     | 7.5       |
| Full surface mapped                                                 | Base   | V     | 0         |
| Partial-fix risk (additive; post-merge unchanged)                   | Base   | V     | 0         |
| Chunk scope / human gate                                            | Base   | V     | 0         |
| Flake retry unverified over repeated runs                           | Medium | P     | 2.5       |
| Cost: no path filter, boot not shared with mobile audit, unmeasured | Medium | P     | 2.5       |
| Cost increase vs measured baseline                                  | Medium | P     | 2.5       |
| UI smoke not in the PR job                                          | Low    | U     | 2         |
| Local/CI divergence (Windows worker hang unexplained)               | Low    | P     | 1         |
| **Total**                                                           |        |       | **18**    |
| **Score**                                                           |        |       | **82%**   |

**Not at 95.** The gap is evidence, not design: 7.5 points are "the script has not yet run on the Linux runner" and 5 more are cost and flake numbers that only repeated CI runs produce. Closing path: push, three consecutive green runs of `T2/T3 Local (PR code)` (removes 7.5 + 2.5 + 2.5 with the measured duration), then add UI smoke (2) and a path filter. Done in that order the score is 100 − (1 + 2.5) ≈ 96%.
