# CCR (5 loops): CI/CD restructure, T4 legs, TDD red layer, WAF rate-limit tooling

**Date:** 2026-10-04. **Led by:** Sr SDET/SRE and Dr of Security, with the extended team (PO, BE, FE, Sr Design FE, Sr Automation QA, DevOps, Sr Data Scientist) reviewing their own surface.
**Protocol:** `.claude/skills/ccr-protocol.md` v3.0. **Classification:** architecture change touching CI across several workflows, plus a security control. 5 loops. The environment is staging and CI only (modifier 0.75); the WAF script can reach production, so it is scored as a security artifact.
**State of the work:** uncommitted in the worktree `claude/github-actions-workflow-error-040360`. Nothing has run on CI.

## Scored as two artifacts

One score would hide that the two halves are in different states.

- **Artifact A, the change set:** workflow reorder, job timeouts, four blocking fixture steps, T4 as three legs plus an aggregate, nightly rate-limit workflow, the TDD red layer and its map.
- **Artifact B, the WAF rate-limit rule and its apply tooling** (`scripts/ci/cf-waf-rate-limit.mjs`). The rule is **not applied anywhere**. The control it would deliver (a 429 within 3 s) does not exist on staging today. That gap is OSE-1509 and predates this work.

| Loop | Lead                | Focus                               | A                                            | B                           |
| ---- | ------------------- | ----------------------------------- | -------------------------------------------- | --------------------------- |
| 1    | SDET/SRE + Security | Surface                             | 81.3 before fixes, **96.3** after            | same                        |
| 2    | SRE                 | Pressure: concurrency, merge, flake | 82.2 before fixes, **98.1** after            | same                        |
| 3    | Dr of Security      | Adversarial                         | 98.1 (holds)                                 | **86.7 (stop, human gate)** |
| 4    | SDET/SRE            | Operability, rollback, cost         | **97.0**                                     | 86.7                        |
| 5    | Both                | Confirmation, re-run everything     | **97.0, stable across loops 4 and 5: ships** | **86.7: do not apply**      |

Three loop-3 findings against B (F9 to F11) are not fixable inside the script and bring B to 86.7. B stays blocked until the PO decides the shared-venue question (F11) and the clients send the CI header (F1).

## Corrections applied between loops

- **1→2.** F1: `--ci-exempt` (a secret header match), the token redacted from printed output, an expression-injection check, tests. F2: bounded retry on the four now-blocking fixture steps. F3: a green guard that a draft is never named to an anonymous visitor (OSE-1519 leaves that to the PO; the guard turns an accidental leak into a decision).
- **2→3.** F1: `--apply` now refuses without `--ci-exempt` unless `--accept-ci-risk` is given, so the CI risk is an explicit choice. F6: the same bounded retry on the `test-event-001` seed that two legs run at once. F8: the T4b env pins `SMOKE_EVENT_SPONSORED`. **Checked, and it has no effect today** (see F8); the comment now says so.
- **3→4.** Rollback: `--remove` takes out only our rule, tested.

## Scoring worksheet (final: loop 5)

Base items:

| Item                               | State | Evidence                                                                                                                                                                                                                 | Deduction |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Environmental assumptions verified | V     | Job durations read from main run 37172096169; staging list read live (`/api/v2/events`: 3 events, `evt_smoke_sponsored` not listed); `PUBLISH_GRACE_MINUTES=10` in `wrangler.toml`; PR 781's run and head read with `gh` | 0         |
| Full surface mapped                | V     | 14 files referencing the T4 job found by grep and updated or confirmed; 3-way merge with PR 781 run                                                                                                                      | 0         |
| Partial fix risk assessed          | V     | F8 pin shown to be a no-op today and the comment corrected, not left as false assurance                                                                                                                                  | 0         |
| Chunk scope correct                | V     | One artifact per loop focus                                                                                                                                                                                              | 0         |
| Human gate not bypassed            | V     | Nothing applied to Cloudflare; the WAF apply is left to the PO                                                                                                                                                           | 0         |

Variable items (Artifact A):

| ID  | Finding                                                                                                                                                                                                                                                 | Sev | Env  | Loop found | State   | Deduction |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ---------- | ------- | --------- |
| F6  | Two legs run the `test-event-001` upsert at the same time; concurrent behavior unproven until CI. Retry added.                                                                                                                                          | Low | 0.75 | 2 (×1.25)  | Partial | 0.94      |
| F8  | T4b picks `items[0]` from the shared list. Verified: it falls back to `test-event-001`; no forms-leg spec mentions sponsors (grep, exit 1); the surfaces leg does not use `test-event-001`. Residual: T4d's generic page smoke is unproven in parallel. | Low | 0.75 | 2 (×1.25)  | Partial | 0.94      |
| F13 | The nightly rate-limit run stays red until the WAF rule exists. Accurate, but an always-red gate teaches people to ignore it (the repo's own mobile-audit config says so).                                                                              | Low | 0.75 | 4 (×1.5)   | Partial | 1.13      |
|     | **Total**                                                                                                                                                                                                                                               |     |      |            |         | **-3.0**  |
|     | **Score A**                                                                                                                                                                                                                                             |     |      |            |         | **97.0%** |

Findings fixed or verified, no deduction:

| ID  | Finding                                                                                                       | Resolution                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F1  | A WAF rule would rate-limit the pipeline's own T2 to T4 traffic. Only the `/q/*` scan trace sends `X-OCR-CI`. | `--ci-exempt`, redaction, refusal without an explicit `--accept-ci-risk`; tests                                     |
| F2  | Four fixture steps made blocking with no retry.                                                               | Bounded retry, 2 attempts                                                                                           |
| F3  | No privacy guard in the OSE-1519 red tests.                                                                   | Green guard added                                                                                                   |
| F4  | Timeouts could kill a legitimate job.                                                                         | Slowest job 278 s (worker shard) and 349 s (T4) against 15 to 30 min ceilings                                       |
| F5  | PR 781 edits the same workflow, `render-pipeline-board` and gate tests.                                       | `git merge-file` 3-way: **1 conflict, the banner comment above `deploy-staging`**. Take PR 781's job and my banner. |
| F12 | The T4 split adds repeated setup (about 1.5 min on each of 3 legs).                                           | Named; wall time drops, runner minutes rise. Accepted.                                                              |

Artifact B findings (not in A's score):

| ID  | Finding                                                                                                                                                                                                                           | Sev    | Env  | Loop (×) | State   | Deduction |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- | -------- | ------- | --------- |
| F1r | CI clients (Bruno, Playwright) do not yet send `X-OCR-CI`, so `--ci-exempt` alone does not protect CI.                                                                                                                            | High   | 0.75 | 1        | Partial | 3.75      |
| F9  | The rule covers `/api/v2/events*` only. Other public reads (sponsor logo proxy, sponsor card) rely on in-Worker limits that fail open.                                                                                            | Medium | 0.75 | 3 (×1.5) | Partial | 2.81      |
| F10 | `starts_with` and a custom block response are unverified on the zone's plan. The apply fails loudly (exit 1) rather than leaving a bad state.                                                                                     | Low    | 0.75 | 3 (×1.5) | Partial | 1.13      |
| F11 | A per-IP limit of 60 per 10 s on a shared venue network. About 30 patrons scanning one poster, 3 calls each, can exceed it and be refused for 10 s. The PO bar covers one person at 5 per second, not a crowd behind one address. | High   | 0.75 | 3 (×1.5) | Partial | 5.63      |
|     | **Total**                                                                                                                                                                                                                         |        |      |          |         | **-13.3** |
|     | **Score B**                                                                                                                                                                                                                       |        |      |          |         | **86.7%** |

B is below 95 either way and blocked. F1r is only mitigated by the apply refusal, not closed, so it stays in the score.

## Adversarial results (Dr of Security)

| Check                                           | Result              | Evidence                                                                                                                       |
| ----------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Secret never printed (dry run, errors)          | Pass                | `redactRule` test; token only read from the environment                                                                        |
| Expression injection through the token          | Pass                | Test: `x" or true or "` refused                                                                                                |
| `--ci-exempt` on production                     | Pass                | Ran it: refused, exit 2                                                                                                        |
| New workflow interpolates no input into a shell | Pass                | `workflow-injection.invariant` (46 invariant tests pass)                                                                       |
| New workflow uses no secrets                    | Pass                | The nightly file reads only `vars.RED_TEAM_BASE_URL`                                                                           |
| PR secret exposure                              | Pass                | `scripts/check-pr-secret-exposure.mjs`: PASS                                                                                   |
| T4 legs widen secret access                     | No                  | Step `env:` blocks unchanged by the transform; `OCR_CI_EDGE_TOKEN` stays in one leg                                            |
| Header spoofing of the CI exemption             | Mitigated by design | The exemption is a secret value, not the public Access client id; a client id match would have been spoofable and was rejected |
| Path-case bypass of the WAF prefix              | Low                 | Router paths are case-sensitive, so a differently cased path does not reach the handler                                        |
| A red test passing for the wrong reason         | Pass                | `assertRed` requires a story-tagged assertion; 4 self-tests; each red test failed on its own tag when run                      |

## Adversarial testing and PR 781

The PR 781 run you linked failed `T3 security` in the new local-vetting job: `CF_ACCESS_CLIENT_ID/SECRET not set; staging admin API is behind CF Access`.

- That run was on commit `5c8367b5`. The PR head `b8ddf190` passes `T2/T3 Local (PR code)`.
- The fix in the PR's diff adds `!IS_LOCAL` to the guard in `tests/e2e/1-smoke/security-smoke.spec.js`.
- The lesson for adversarial testing: a guard keyed on `CI` instead of the target turns a correct "fail, don't skip" rule into a false red on a local worker. Key such guards on the target host.
- PR 781 moves the adversarial smoke left, to every PR. That complements this change. T5 still runs only after a green push on `main`, and the rate-limit tests now run nightly.

## Scope (confirmed)

- `.github/workflows/oursharedevents-ci.yml`: order by tier, banners, 14 job timeouts, 4 blocking fixture steps with retry, T4 split.
- `.github/workflows/red-team-adversarial.yml`: RL-* excluded from the merge-time run.
- `.github/workflows/red-team-rate-limit-nightly.yml`: new.
- `scripts/ci/cf-waf-rate-limit.mjs` and its test: new, not applied.
- `workers/oursharedevents/tests/`: `helpers/red-story.ts`, `red-story-helper.spec.ts`, `tdd-red-fe-wave.spec.ts`.
- `workers/oursharedevents/docs/ops/TDD-RED-MAP.md` and `tests/unit/tdd-red-map.test.js`.
- Tests re-pointed to the T4 child job: `t4-named-checks`, `post-execution-integrity`, `infra-consistency`.

## Pre-conditions

- [ ] Merge order with PR 781: whichever lands second takes the one-line banner conflict.
- [ ] First CI run on `main` after merge: watch the three T4 legs. If T4b or T4d interfere, fold T4b into the surfaces leg or serialize the legs.
- [ ] The first run also confirms the bounded-retry fixture steps.
- [ ] **B only:** PO decides the shared-venue question (F11): per-IP 60 per 10 s versus a higher limit or a different key.
- [ ] **B only:** T2 to T4 clients send `X-OCR-CI`, or the rule is applied with `--accept-ci-risk` and the next run is watched.
- [ ] **B only:** run the script dry on staging first, read the output, then `--apply`. `--remove --apply` is the rollback.

## Commit sequence

1. Workflow reorder, timeouts and banners (no behavior change).
2. T4 legs, aggregate, and the test updates.
3. Blocking fixture steps with retry.
4. Nightly rate-limit workflow and the merge-time exclusion.
5. TDD red layer: helper, specs, map, guard.
6. WAF script, test, and docs (separate PR, so its apply decision is its own).

## Verification (after merge)

- [ ] `T4 Functional → Staging` is green and its three legs each name their gates as check-runs.
- [ ] No fixture step failed once (look for the `::warning::fixture step failed once` line).
- [ ] The TDD red specs are green in the worker shards.
- [ ] The nightly rate-limit run exists, and is red until the WAF rule is applied (expected).

## Review gates

- Score A is 97.0%, inside the 95 to 97 band the protocol marks for peer review of the worksheet. A second reviewer should confirm F6, F8 and F13.
- The `workflow` and `scripts/ci` changes need Sr SDET/SRE sign-off; the WAF script needs Dr of Security sign-off and the PO's F11 decision before any apply.

## Limits of this assessment

- Nothing here ran on GitHub Actions. The T4 leg structure, the tests that read it, and every YAML parse were checked locally; leg behavior in parallel on staging was not.
- The browser layer of the red tests is not written, so the red layer covers the Worker level only.
- Cloudflare plan support (F10) and the WAF apply were not checked: no token or ruleset tool was available.
