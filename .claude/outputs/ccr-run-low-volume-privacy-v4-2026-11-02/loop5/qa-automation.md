# Loop 5 (Recursive): qa-automation (Sr Automation QA lens), epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus by the lead's override.

No score and no gate decision.

- **Subject hash:** re-checked, `dd9b8522...b7f4`, OK.
- **Code read:** at 39a63d67, through `git show 39a63d67:<path>` in `ose-clock-gate`, or in the worktree where `src` equals the baseline.
- **Basis tags:** proven / arithmetic / source-read / inferred.

## 1. High stability table (my lens)

| Row                | Re-checked at (baseline)                                                                                                                                                                                                                                                                                                                               | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Basis                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| R1-07              | Subject C.8 staging steps 3-4 (:251-256). The D1 control rises whether or not a marker is written. The trace step sends no cookie and checks only `n > before` (`trace-scan-staging.sh:45-48, 63-67, 97-105`). `git grep scan:dedup 39a63d67` finds only `QR-AND-SHORTLINKS.md:49`, `qr-scan.ts:21` and `scan-buffer.ts:73`: no test, Bruno or script. | Claim **STABLE**, High **STABLE**. Basis **REVISED**: the register says "proven", but the mechanism is source-read from plan text (the step does not exist yet). Only the half "no other staging detector exists" is proven.                                                                                                                                                                                                                                                             | source-read + proven grep                 |
| R1-09              | `ci.yml:1186-1190`: a `full-pipeline/*` PR deploys staging. Deploy (`:1366`) and T4 freshness (`:2000`) both use `git rev-parse --short HEAD` on the same PR merge ref, so freshness passes and T4 runs before merge. `:157-158`: cancel-in-progress applies to PRs only.                                                                              | Claim **STABLE**, as loop 1 wrote it: the subject's reason (migrations reach shared D1) holds only for S3 and S7, not S2, S4, S6, S15. High **STABLE**. Basis **REVISED**: "proven" covers the route and the cost of a red main T4 (50 h 19 min; 2 h 59 min). Neither window was caused by a subject step. "Worse" in loop 4 is evidence of consequence, not of the defect. That a new step first fails on main is inferred.                                                             | source-read; windows proven               |
| R2-01              | One workflow-level group, `ose-<event>-<PR or ref>` (`ci.yml:150-158`), and no job-level lock. The drill has its own group (`staging-rollback-drill.yml:40-41`) and deploys staging with the same token (`:91, :130`). Freshness is checked once (`ci.yml:2000`). `gh api .../environments` today: `staging` has 0 rules and policy null.              | **STABLE**, High.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | proven (config); race occurrence inferred |
| R1-02 (QA leg)     | S15 AC1/AC2 match phrases (:198-199); the staging step curls for phrases (:203). S15 is in Wave 1, with no edge on OSE-1784 (E.3).                                                                                                                                                                                                                     | **STABLE**: no criterion can detect that the sentence is false. The High rests on DS arithmetic, which I did not re-run.                                                                                                                                                                                                                                                                                                                                                                 | source-read                               |
| R1-06 (QA leg)     | `privacy.ts` has 0 matches for "cookie". `src/lib/admin-settings.ts:179` says "Public pages set no cookies". `never-who.ts:47-48` (`events` body) says "Nothing ... was collected".                                                                                                                                                                    | Main claim **STABLE**, High **STABLE**. The S half is **REVISED**: in the `event` body, the "nothing ... was collected" clause is in the _same sentence_ as "single click" (`never-who.ts:53-55`). S15 replaces that sentence whole, so after S15 this clause on the page a `/q` scan lands on is likely gone. What stays false after S15: the notice (no cookie, in a GDPR Art. 13 page), the admin text, and the `/events` listing body. "S makes it worse" is a judgment, not a fact. | source-read                               |
| R1-10 (my L3 card) | AC2 requires "linked"; the predictor already says linked on main.                                                                                                                                                                                                                                                                                      | **STABLE** (AC2 cannot be falsified).                                                                                                                                                                                                                                                                                                                                                                                                                                                    | source-read                               |
| R1-16 (my L3 card) | Claim stands. Its lowering condition measures the wrong instant (section 3).                                                                                                                                                                                                                                                                           | Claim **STABLE**; condition **REVISED**                                                                                                                                                                                                                                                                                                                                                                                                                                                  | source-read                               |
| R1-23 (my L3 card) | Trigger (b) checked read-only: it has not fired (section 3).                                                                                                                                                                                                                                                                                           | **STABLE**, High                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | proven                                    |

## 2. My own errors across four loops (the main product)

| Loop | Claim                                                                                                                             | What was wrong                                                                                                                                                                                         | Correct statement                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | L1-QA-1 root: "T4 post-merge only; no staging step is ever seen failing before merge".                                            | `full-pipeline/*` PRs run T4 before merge, and freshness passes there (section 1).                                                                                                                     | Pre-merge staging runs are available for S2, S4, S6 and S15. The subject chose not to use them, with a reason that fits only S3 and S7.                                                                                                            |
| 1    | L1-QA-12: "1 hit in each (8 total)".                                                                                              | Imprecise.                                                                                                                                                                                             | 8 of the 10 language-layer goldens hold 1 hit each; 2 hold 0 (re-run).                                                                                                                                                                             |
| 1    | I named "S15 sentence wrapped across template lines ... unless whitespace-normalised" under surviving mutants and never filed it. | Unfiled. The S15 staging step, curling raw HTML, would be **red on a correct implementation** if the new sentence wraps (the bodies are wrapped template literals).                                    | A false-red criterion, the mirror of R1-20. It belongs to root T1 (section 6), not a new row. Inferred.                                                                                                                                            |
| 2    | L2-QA-1 rated High.                                                                                                               | Overstated.                                                                                                                                                                                            | Medium (R2-11) is right: there is no exposure beyond what S7 fixes.                                                                                                                                                                                |
| 2    | L2-QA-2: "no TTL assertion is possible".                                                                                          | Too broad.                                                                                                                                                                                             | Only the hand-rolled stub (`qr-scan.spec.ts:44-53`) drops options. The pool KV records expiry (loop-3 merge).                                                                                                                                      |
| 2    | L2-QA-5: "CODEOWNERS locks only ADR-014 and workflows" (stated as a proven grep).                                                 | Incomplete.                                                                                                                                                                                            | It also locks ADR-020, `ai-sanitization.ts`, two invariant specs and two secret-exposure files. The conclusion (ADR-025 is not locked) is unchanged.                                                                                               |
| 2    | L2-QA-7, and R2-22's evidence: "`never-who.ts:53-54` spans a line break".                                                         | Misleading. The break falls before "single click". The banned phrase is unbroken on `:54`.                                                                                                             | The wrapped-phrase mutant is valid but inferred. The source does not show it.                                                                                                                                                                      |
| 2    | R1-46 re-rate: "the **required** T4 check goes red permanently" when the **literal** hour passes.                                 | T4 is not a required check (R4-11). "Literal" was assumed: the D1 seed SQL could compute the hour at seed time, and the subject does not say.                                                          | The T4 aggregator goes red, which blocks Done and the production tag. Static-literal rot is inferred.                                                                                                                                              |
| 3    | L3-QA-1 / R3-05: "none is seen, so no named check is published", framed as a silent hole.                                         | Overstated. `t4-named-checks.test.js:44-49` runs in root vitest (`tests/unit/**`). The `post` lines the subject says it adds make post count unequal to gate count, so the test is **red at PR time**. | The naming half is a plan defect that an existing gate catches. The residual stands: `post()` maps skipped and cancelled to `neutral` (`ci.yml:2482-2486`), and a step dropped together with its post line keeps the counts equal and green.       |
| 3    | R1-06 card: "`admin-settings.ts:167`"; "the unchanged sentence stays at :55-56 (event body)".                                     | Wrong line and wrong path. The event-body clause is replaced along with its sentence.                                                                                                                  | `src/lib/admin-settings.ts:179`. The `events` body is `:47-48`.                                                                                                                                                                                    |
| 3    | R1-09 basis raised to proven (I agreed).                                                                                          | Too strong (section 1).                                                                                                                                                                                | Route and cost are proven; occurrence is inferred.                                                                                                                                                                                                 |
| 2-4  | `ci.yml` cites past line 884 read in the worktree.                                                                                | The worktree adds one line (`@@ -881,7 +881,8`).                                                                                                                                                       | Baseline = worktree − 1: freshness `:2000`, aggregator `2528-2544`, full-pipeline `1176-1190`.                                                                                                                                                     |
| 4    | "ADR-021 CONFORMS".                                                                                                               | ADR-021 is Proposed (`ADR-021:3`).                                                                                                                                                                     | CONFLICT (merge line 32): the subject cites it as binding.                                                                                                                                                                                         |
| 4    | "S14 AC4 cannot go red on a regression".                                                                                          | Wrong. It goes red if the refactor breaks the trace step.                                                                                                                                              | AC4 states no fault and is first exercised on main: not born red, but it can fail.                                                                                                                                                                 |
| 4    | "My table agrees with that distribution (28 rows over 35 criteria)".                                                              | Never cross-checked.                                                                                                                                                                                   | The 35-criteria table (loop-3 merge :258-292) cites **37** distinct rows. Ten are not on the 28-row list: R1-12, R1-21, R1-29, R1-31, R1-36, R1-40, R2-02, R2-10, R2-20, R3-12. R1-39 is on the list but cited by no table row (proven by `comm`). |
| 4    | The invariant-8 grep (`tests/ui`, `tests/e2e`, `bruno`) skipped the worker tests.                                                 | Narrow.                                                                                                                                                                                                | `/privacy` has mock-layer content and header specs (`security-privacy.spec.ts`, `legal-footer.spec.ts`) but no axe, h1 or 44 px check. R4-06 stands.                                                                                               |

## 3. Conditional rulings

- **R1-16: the condition uses the wrong instrument.**
  - `computed_at` is `nowIso`, fixed at `shared-report.ts:726-728` _before_ the sequential per-bucket loop (`:764-798`), and bound at `:783` and `:894`. The cell snapshot runs after that loop (`:812`).
  - So `computed_at` reads about 03:00:0x every night whatever the loop's length. "Within seconds of 03:00 over 7 nights" would pass on any snapshot delay.
  - The right measure is the `scan_aggregation` phase's `duration_ms` in the `SHARED_REPORT_MATERIALIZE_COMPLETE` log line (`shared-report-materialize.ts:107-119`; the phase runs first, `:51-54`), over 7 nights, plus `computed_at`'s offset from 03:00 for cron jitter.
  - The repo settles the flaw now (source-read). Only the owner can read the duration (Workers Logs). Owner command 3 carries the same flaw.
  - Recommendation: restate the condition. R1-16 stays High until then.
- **R1-23: trigger (b) is unmet on the record.**
  - Dispatch runs 39436555076 and 39459166333, the only ones since 2026-10-20T14:00Z, both **skipped** `T1 Deploy → Production`.
  - The last 400 push runs reach back to 2026-09-15 and contain no `v*` ref, and there are no local `v*` tags.
  - So (b) can fire only on a future production deploy. Only (a) or (c) can settle scope now, and the Tier-1 base item stays unresolved (cap 70). The three triggers are stated correctly.
  - C1's 2.0 should key on (a) or (c), not on (b).
- **R2-02 and R4-01:** outside my lens. One QA fact for R2-02: no subject criterion exercises the map's 0 versus 1-to-4 case. The S4 staging seed has neither (loop-3 table row 10).

## 4. Subject-created versus found on main (my lens)

| Row                               | Split                                                                        | Note for the scorer                                                              |
| --------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R1-07, R1-08, R3-11, R1-20, R1-46 | S                                                                            | Plan criteria                                                                    |
| R1-09                             | S root (plan text) over an M mechanism                                       | Loop 3 listed it under "found on main"; its root is the subject's argument       |
| R2-01                             | M, worsened by S                                                             | Six more shared-state steps; S2's global-prefix diff                             |
| R1-02                             | **S (the in-scope words)** over an M mechanism (OSE-1784, out of scope)      | **Differs from loop 3's list.** The in-scope defect is a new sentence S15 writes |
| R1-06                             | M; after S, partly better (event page), partly left (notice, admin, listing) |                                                                                  |
| R3-05                             | S naming half (caught at PR); M residual (skipped = neutral)                 |                                                                                  |
| T1 rows (section 6)               | S                                                                            |                                                                                  |
| T2 rows (section 6)               | M                                                                            |                                                                                  |
| R2-11                             | S. At the baseline the clock gate is absent, so S7 AC1 has no gate at all    | #1069 adds the gate after the freeze (environment)                               |

## 5. The post-freeze fix (#1073, R1-04's in-scope half)

**Options:**

- (a) Score at the baseline and record #1073 as an environment fact.
- (b) Credit the fix.
- (c) Split the row.

**Recommendation: (a), with a recorded split of evidence.**

- The label leg is fixed on main by #1073 (OSE-1752) and green at 8439ae62 (run 41503990040), not by the subject.
- The scope leg persists in the frozen text: S15's AC1 file set still omits `pages.ts` (now `recap-stat-lines.ts`). That is a criteria-scope defect of the same class as T1 (enumerated, not derived), and #1073 does not touch it.
- Apply the same rule to #1069: R1-19, S3 AC5 and S7 AC5 target a spec absent at 39a63d67. Score them as written and record the drift.
- OSE-1787 stays an out-of-scope record. RC-01 remains the owner's question.

## 6. Systemic promotion and cluster multipliers

**Verdict: neither one root nor a tally. The 31 rows split into two systemic roots and a remainder that must not collapse.**

- **T1. The subject's criterion design (S): one systemic root.**
  - The shared cause is C.0's test doctrine (subject :119-120):
    - born red is "a named fault", not a recorded red run;
    - the staging pre-merge run is "optional, recorded if done";
    - staging steps are ad-hoc bash with no harness;
    - criteria are written as absence, presence, substring or one-row checks over enumerated scope.
  - It is the same defect class with the same fix pattern in at least 3 locations (every retained slice and C.0), so H4 applies.
  - **Collapse candidates:**
    - from the 31: R1-14, R1-15, R1-27, R1-39, R1-46, R2-11, R2-12, R2-13, R2-14, R2-15, R2-22, R2-25, R3-11, R4-12, and R3-05's naming half;
    - from outside the 31: R1-20, R1-21, R1-30, R1-36, R1-40, and the unfiled S15 false-red (section 2).
  - **R1-07** shares the root, but its High comes from consequence (C3: the only staging detector for "scans are not people"). Collapsing it would absorb a High and drop C3 to two members (1.5).
    - Recommendation: keep R1-07 as its own row in C3, and exclude it from T1, stating this.
    - Alternative: collapse it, with T1 at High base, which H4 promotes to Critical.
- **T2. The repo's own gates enumerate by name, presence or convention (M).**
  - Rows: R1-31, R1-41, R2-17, R3-05's skip/neutral half, R3-06, R3-08, R4-06, R4-07.
  - The fix is mostly outside the subject. The subject could close the parts it relies on, for example by adding `/privacy` to the axe suite and the lexicon gate.
  - Promote only if the scorer counts main-side defects the subject relies on. Otherwise keep them as rows.
- **Remainder: product or infra rows where "no criterion goes red" is only evidence of non-closure. Do not collapse.**
  - R1-01, R1-03, R1-06, R1-08, R1-10, R1-16, R1-23, R2-05, R2-18; and from the table, R2-02, R2-10, R1-12, R2-20, R3-12, R1-29.
- **Mechanics. Faithful to the protocol: one root, H3, then H4.**
  - H4's text does not say whether locations collapse.
  - Collapsing about 20 Medium and Low rows into one promoted row _lowers_ the total deduction, which is anti-conservative.
  - The protocol's tool for one finding in N places is H3 breadth, `log₂(N+1)`, with N = locations, applied before H4's promotion (2.6 order). The scorer should state N; I compute nothing.
  - **The membership list must be fixed first.** It is unstable: 28 or 31 rows on the list against 37 cited in the table (section 2).
- **What closes the whole T1 pattern (subject changes):**
  1. C.0: every criterion names its planted fault _and_ a near-miss mutant, and records a red run.
     - S2, S4, S6, S15: one `full-pipeline/*` run before merge, with its run id.
     - S3, S7: a root test per script with stubbed `wrangler` and `curl` (S14's pattern).
  2. Equality or two-sided assertions:
     - an exact key set (S3);
     - exactly one new marker key, with expiry ≤ now+3600 (S2);
     - `expires_at` equal to hour + TTL + 1 h (S7);
     - a fault that must flip the verdict each way, with an asserted baseline (S6);
     - normalised, visible rendered text (S15).
  3. Derived scope: every rendered public route (S15); bare table names outside the inserts (S4 AC3); every FORMS_DB writer and table, from a recorded grep (S7); readers by reader, not by pattern (S5).
  4. An injected clock with rows in the open hour and at −14 and −16 minutes per reader; seeds computed at run time (S4).
  5. A bash-step harness:
     - `T4<x>:` names, each with an `id` and a `post` line;
     - skipped counts red (an analog of `pw-guarded.sh`);
     - diffs scoped to the run's own keys.
  6. Owner gates the merger cannot remove (S16 AC3).
  7. Test env changes named in the slice (the pool pepper, S2).
- **Cluster multipliers:**
  - **C1:** hold 1.5. 2.0 only on trigger (a) or (c).
  - **C2:** lower. H2 needs one finding to enable or amplify another. My loop-3 test found no attacker gain, only a shared cause. A shared cause at 3 locations is H4's case, not H2's.
  - **C3:** hold 2.0, provided R1-07 is not collapsed.
  - **C5:** hold 2.0. The amplification is a regulator reading, which is inferred.
  - **C6:** hold 2.0. R3-06's ancestry link is real. Low exposure belongs to H5, not H2.

## 7. Per-loop score derivation

- **The brief and the merge describe different methods.**
  - The brief: rows _discovered_ in each loop.
  - MERGED-loop4 4.6 and 7.5: rows _open at the end of_ each loop (cumulative to date).
- **Discovery-only is not faithful.**
  - Loop 5 would print near clean (0 or 1 new rows) while re-confirming 16 Highs. The Recursive loop's own result would carry no weight.
- **Cumulative to date satisfies the checker but is not "this loop's own result".**
  - The checker's text at `ccr-worksheet-check.mjs:47` asks for that. With cumulative to date, loop 5 equals the cumulative by construction, and `:453`'s check becomes empty.
  - It does match the protocol's per-pass cumulative scoring (`ccr-protocol.md:1752-1770`), but that assumes fixes between passes.
- **More faithful to the owner's model (one lens per loop; each root counted once):**
  - Loop N's `Score` = the rows loop N's lens tested and found open, discovered or re-confirmed.
  - Each row carries one fixed weight in every loop where it appears.
  - The cumulative is the union, each root once. Union ⊇ each loop's set, so the cumulative is ≤ every loop, and `:453` holds.
  - Rows marked "not re-tested" stay out of that loop's own score. The registers already record this.
- **H1:**
  - The protocol defines 1.0, 1.25 and 1.5 for loops 1 to 3 only (`:463-465`). Its rationale ("Loop 2 failed its job") assumes the same lens each time.
  - Loops 4 and 5 have no constant. The scorer must not invent one silently: either cap at 1.5 or get an owner ruling.
  - Some R4 rows were inside an earlier lens's scope. My loop-1 lens could have found R4-12 and R4-06.
- **3.3:** do not apply it. Its premise (actionable findings fixed between loops) is excluded by the owner's model, and it would re-weight every row at an undefined loop-5 constant.

## 8. Convergence

- **New roots fell loop over loop.** My lens filed 13 ids in loop 1, then 7, then 2, then 2.
- **No High moved tier in four loops.** What moved:
  - bases: R1-07 and R1-09 come down from "proven" to source-read or inferred for the mechanism or occurrence;
  - one framing: R3-05's naming half is caught at PR time;
  - one condition: R1-16's instrument.
- **The register is stable enough to score, with two exceptions:**
  - the systemic membership list must be reconciled with the controls table before H4 is applied;
  - R1-16's lowering condition must be restated.

## 9. New findings

None. The S15 staging false-red is a T1 member that I named in loop 1 and never filed (section 2). The R1-16 instrument flaw is a defect in the run's ruling, not in the subject (section 3).

## 10. Not checked

- **No test was run and no fault planted.** Every "stays green" or "goes red" here is source-read, or a regex run. Reason: read-only.
- **Platform facts not settled:**
  - KV list lag;
  - whether GitHub passes a missing secret as an empty string;
  - Workers Logs content, and the materializer's `duration_ms` on staging;
  - token scope.
- **R2-02, R4-01, R1-04** (the legal and product halves) and the Regulatory readings: outside my lens.
- **Bruno `test()` names:** I did not read a T2 run log, so whether they print is still inferred. The subject adds no Bruno request.

## 11. Commands run (none refused)

- **Read:**
  - the loop-5 brief; `qa-playwright.knowledge.md`;
  - MERGED-loop4 in full; MERGED-loop3 lines 1-400;
  - my loop-1 to loop-4 reports;
  - subject :113-347;
  - `ccr-protocol.md` :334-623, :1199-1228, :1750-1774;
  - `ccr-worksheet-check.mjs` :100-129, :390-479.
- **Bash, read-only:**
  - `ls`, `wc` and `sha256sum` on the scratchpad;
  - `grep` and `sed` on the subject and the merges;
  - `git rev-parse`, `status`, `diff --stat`, `diff` (ci.yml hunk) and `log` in `ose-clock-gate`;
  - `MSYS_NO_PATHCONV=1 git show 39a63d67:<path>` piped to `sed`, `grep` or `cat -n`, for:
    - `oursharedevents-ci.yml`, `t4-named-checks.test.js`, `vitest.config.ts`;
    - `trace-scan-staging.sh`, `staging-rollback-drill.yml`, CODEOWNERS;
    - `never-who.ts`, `privacy.ts`, `infra-consistency.test.js`, `forms-db.ts`, `qr-scan.spec.ts`;
    - `shared-report.ts`, `shared-report-materialize.ts`, `rendered-surface-lexicon.invariant.spec.ts`;
    - the a11y and mobile specs, `security-privacy.spec.ts`, `legal-footer.spec.ts`, `event-page-choices.spec.ts`, and the goldens;
  - `git grep` at 39a63d67 for `scan:dedup`, `kv key list`, `dedup`, `OSE-1459`, `single click`, `no cookies`, `/privacy`, `aggregateScanBuckets` and `durationMs`;
  - `git ls-tree`, `git tag`, `git for-each-ref`;
  - `node -e`: one regex over five strings (no file I/O).
- **`gh` (GET only, names and conclusions):**
  - `gh api repos/:owner/:repo/environments`;
  - `gh run list --workflow "OurSharedEvents CI/CD"` (dispatch since 10-20; 400 push runs);
  - `gh run view 39459166333 / 39436555076 --json jobs`.
- **One stray write, mine:** a command redirected a scratch list of row ids to Git Bash `/tmp/q_table.txt` (`C:\Users\mzdan\AppData\Local\Temp\q_table.txt`, 222 bytes). It is outside the repo and the scratchpad and holds only row ids. I left it rather than run a delete. No other write, branch, commit or stash.

Lead's note (not the agent's text): the stray 222-byte scratch file in Git Bash's temp area is outside the repo and the subject; it does not affect the run.
