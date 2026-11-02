# Loop 5 (Recursive): sdet-sre lens, epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus by the lead's override.

- Subject hash re-checked: `dd9b8522...b7f4` (sha256sum, proven).
- Code read in `ose-clock-gate` at e7c8297b. `git diff --stat 39a63d67 HEAD` shows only `ci.yml`, 3 lines; `src` is unchanged.
- No score, no gate decision, nothing fixed.
- Basis tags: proven (a command this loop), arithmetic, source-read, inferred.
- Loops 1 to 4 of this lens ran on Sonnet (merge 0 j). This loop ran on Opus. That bears on RC-02: two of the corrections below are errors that a read at the line where the value is set would have caught in loop 3.

## 0. Current state of R1-09's windows (one read: `gh run list ... --limit 16`)

- **Main is green now.** The newest push run is 41503990040 for 8439ae62 (#1076). It succeeded, and `T4 Functional → Staging` completed at 19:08:46Z.
  - No push run is newer. `gh api .../commits/main` gives 8439ae62.
  - No merged SHA is stranded right now (proven).
- **Every post-baseline SHA reaches Done:**
  - On its own green chain: 8e6d19dd (#1069), 6bdc2f90 (#1071), 23ba4d6c (#1072), 8439ae62 (#1076).
  - By ancestry only:
    - 206c91ed (#1068), which has no push run because the `paths:` filter skips docs-only commits. The merges missed this one.
    - 0ebe2fdd (#1070), via 6bdc2f90.
    - 77e5d912 (#1073), 9134ab9f (#1074) and 08703cd7 (#1075), via 8439ae62.
  - So R3-06 has five live instances, not four (proven).
- **Both red windows were R1-09's own mechanism.** In each, a merge added a staging check that ran for the first time on main.
  - **Window 1.** 20b45c48 (#1057) added `tests/e2e/3-flows/language-path-prefix.spec.ts` and wired it into `ci.yml` (+23 lines), per `git show --stat 20b45c48`. All five red runs have that spec (T4i) as their root (loop 3, classify script).
  - **Window 2.** #1073 added `tests/e2e/3-flows/recap-walk-in-wording.spec.ts`.
    - At 08703cd7, `classify-ci-failure.mjs` names T4f as the root.
    - `--log-failed` shows `recap-walk-in-wording.spec.ts:23` failing after 2 retries.
    - #1076 changed only that spec.
  - No PR used the `full-pipeline/*` route: 0 such heads in the 200 PR runs since 2026-10-12.
  - All of this is proven.

## 1. High stability (Highs this lens touched)

| Row   | Claim re-checked at                                                                                                                                                                                                                                                                                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                            | Basis                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| R1-09 | Subject C.0 `:120` ("cannot be born red against a branch") against `ci.yml:1177-1191` (the `full-pipeline/*` PR route deploys and runs T1 to T4) and `:2001` (freshness compares HEAD, so a PR run passes it). Both red windows began with a new staging check first run on main (section 0).                             | **STABLE, High; evidence stronger.** The loop-3 and loop-4 registers treated window 1 as an edge-setting accident ("not a product defect", my wording in loop 3), so they took it as consequence only. Window 1 is also the root mechanism. "Worse" in loop 4 holds, for this reason.                                                                                              | proven                               |
| R2-01 | `ci.yml:157` groups runs by event and ref. So main push (`ose-push-refs/heads/main`) and main dispatch (`ose-workflow_dispatch-refs/heads/main`) can deploy staging at the same time, as can a PR, and the drill (`staging-rollback-drill.yml:40-42`, its own group). `staging` has no rules (`gh api .../environments`). | **STABLE, High. Basis tag REVISED.** The loop-4 register says "proven (L3)". Only the configuration is proven. The collision is inferred and has never been seen: 0 `full-pipeline/*` runs in 200 PR runs; the drill has never run (`gh run list` is empty); the two dispatches on 10-20 overlapped no push run. Subject `:120` adds a fifth writer: the PR author's own terminal. | config proven; collision inferred    |
| R1-23 | Repository secret updated 2026-10-20T14:07:30Z; both environment secret lists are empty (proven). Since the re-set: two dispatches (39436555076, 39459166333), both with `T1 Deploy → Production` skipped, and 0 tag runs in 300 push runs back to 2026-09-30 (proven). Subject `:167` "limits ... to reads" is false.    | **STABLE, High.** Trigger (b) has not fired, and it can fire only through a production deploy the owner starts (section 3).                                                                                                                                                                                                                                                        | reach proven; scope inferred         |
| R1-01 | `qr-scan.ts:185` `expirationTtl: 3600`; `KVNamespaceListKey.expiration?` (`index.d.ts:2247`); emulator `impression-dedup-hour.spec.ts:100-106`.                                                                                                                                                                           | **STABLE, High.** One wording fix in the loop-4 row: "a deploy-token holder, who **reads** both KV and the pepper". A Worker secret's value is not returned by the API (`secret list` gives names). The holder can obtain it by deploying code that reads it. That is inferred, so the row should say "can obtain", not "reads".                                                   | source-read; runtime expiry inferred |
| R1-16 | `shared-report.ts:874-907`: DELETE, then an INSERT with no upper bound on `scan_bucket`; cron `0 3 * * *`; `index.ts:150-160` uses `Promise.all`.                                                                                                                                                                         | **STABLE, High. The condition is WRONG (section 3).**                                                                                                                                                                                                                                                                                                                              | source-read; loop-3 FE replay proven |
| R1-07 | Subject C.8 step 3 (`:254`, "a counted, non-duplicate scan always sets a marker first") against S2 AC2 and AC3 (`:245-246`, scan counted, no marker).                                                                                                                                                                     | **STABLE, High (S).** The register says "proven". It is a contradiction inside the subject text, so the basis is source-read.                                                                                                                                                                                                                                                      | source-read                          |
| R1-08 | `public-read-limit.ts:53` (360 per minute); `edge-rate-limit.ts:45-47` (60 per 10 s).                                                                                                                                                                                                                                     | **STABLE, High (S).**                                                                                                                                                                                                                                                                                                                                                              | source-read                          |
| R4-01 | `privacy.ts:111-123` (re-read). The `src` grep for any age mechanism finds only the unreachable `form-pages.ts:150` and admin `briefing.ts:124`.                                                                                                                                                                          | **STABLE, High.** `briefing.ts:124` (an admin-gated page, `router.ts:2197-2208`) plans "Phase 5 Youth Events (Year 2)" under COPPA. That is a second artefact never reconciled with ADR-018; it belongs inside R4-01, not as a new row.                                                                                                                                            | source-read                          |

## 2. My own errors across four loops (the main product)

| Loop | My claim                                                                                                  | What was wrong                                                                                                                                                                                                                                                                                                              | Correct statement                                                                                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | "About 88 h 39 m" with no Done                                                                            | Two errors. It measures from the last green start to the next green start, which includes about 38 h with no push run. The arithmetic was also off: adc0f8ba was created 2026-10-29T14:01:53Z and e9211436 at 2026-11-02T06:42:33Z, which is 88 h 40 min 40 s.                                                              | Pick one convention: from the first stranded push to the green T4 completion. Window 1: 20b45c48 at 04:23:38Z to T4 at 2026-11-02T07:04:31Z = **50 h 40 min 53 s** (arithmetic).                                                                                                 |
| 3/4  | Window figures in general                                                                                 | My 2 h 38 min (loop 4) runs from the first stranded push to the next run's creation. That matches the merge's 50 h 19 min (also start to start). The loop-4 merge then compared 50 h 19 min with 2 h 59 min, which is push to T4 completion. Those are two measures of the same facts.                                      | Push to T4 completion: **50 h 41 min and 2 h 59 min** (16:09:18Z to 19:08:46Z). Start to start: 50 h 19 min and 2 h 39 min. The merge's "77e5d912 cancelled at 16:09:18Z" is its creation time; it was cancelled at 16:09:54Z.                                                   |
| 3    | The window-1 cause was "an edge condition (Bot Fight Mode), not a product defect"                         | That was half the cause. The failing spec was new in 20b45c48 and never ran on staging before the merge.                                                                                                                                                                                                                    | Window 1 is R1-09's mechanism (section 0).                                                                                                                                                                                                                                       |
| 3    | 5e0947f5 "failure, 5 min"                                                                                 | I measured only attempt 2, a manual re-run that started 20:33:55Z. Attempt 1 failed at 20:12:57Z.                                                                                                                                                                                                                           | 19:47:34Z to 20:39:15Z over two attempts. The re-run did not help, which is the ROLLBACK §6 condition.                                                                                                                                                                           |
| 3/4  | Durations taken as `updatedAt − startedAt` (46 min; 50 m 50 s)                                            | For attempt 1, `startedAt` equals `createdAt`, so these figures include the wait in the concurrency queue. In loop 3 I inferred the wait; in loop 4 I printed the figures as run times.                                                                                                                                     | 41414877276: queued 21 min 57 s (first job 09:03:14Z, 2 s after 41414837671 ended), then ran 24 min 29 s. 6bdc2f90: queued about 25 min (first job 15:35:29Z). Proven.                                                                                                           |
| 3    | C6 example: "a `full-pipeline/x` push at 09:00:30 deploys by 09:01:56"                                    | I read the push time as the T1 start. T1 needs `security, gate, gate-tests` (`ci.yml:1176`). In the observed runs T1 starts 11 to 14 min after the run is created (13 min 08 s, 13 min 46 s, 11 min 08 s).                                                                                                                  | The push has to come about 11 to 14 min before the target window, and S0/T0 timing varies. Honest overlap still loses the race; a deliberate attacker cannot time it to the second. The race stands; the "deterministic" reading does not. Loop-3 merge C6 inherited this error. |
| 3    | "T4 08:58:59 to 09:02:42"; "freshness checked once"                                                       | 09:02:42 is when the platform leg ended. The aggregator ended 09:02:58Z. The S2 to S7 steps are in the surfaces leg (ended 09:02:29Z) and the forms leg (09:01:03Z). `:2001` runs once in each of the three legs, all at the same instant.                                                                                  | Substance unchanged.                                                                                                                                                                                                                                                             |
| 3    | R1-16: "Settle it cheaply: `SELECT DISTINCT computed_at`... `computed_at` is that run's single timestamp" | `computed_at` is bound from `nowIso`, which is captured at the start of `aggregateScanBuckets` (`shared-report.ts:726-728`). That is before the sequential per-bucket loop (`:760-805`). The value is passed at `:812` and bound at `:907`. That function is phase -1, the first phase (`shared-report-materialize.ts:54`). | `computed_at` sits near the cron start however long the loop runs. My condition, adopted by loops 3 and 4, cannot fail on the part it was meant to measure. Proven by source read. See section 3.                                                                                |
| 4    | Rule R1-23 Security Critical "against the written evidence"                                               | `AGENT-WORKSTATION-HARDENING.md:91` was last changed 2026-10-12 (git blame) and `CF_API_TOKENS_POLICY.md` 2026-10-02. Both predate the 2026-10-20 re-set. I treated an inferred platform fact as enough for a floor of 0.                                                                                                   | I withdraw the proposal (section 3).                                                                                                                                                                                                                                             |
| 1    | "Reds the **required** aggregator (`ci.yml:2530-2541`)"                                                   | T1 to T4 are not required contexts. I repeated the very comment I flagged in loop 4 (R4-11).                                                                                                                                                                                                                                | "Reds the Done aggregator after merge, which is not a merge gate."                                                                                                                                                                                                               |
| 1    | Hour 02 "materialized at 03:00 with zero grace" as the stale case                                         | Hour 02 goes stale only through late queue writes.                                                                                                                                                                                                                                                                          | The worse case is the hour that contains 03:00: stored partial and published for about 24 h (BE and FE, loop 2).                                                                                                                                                                 |
| 2    | L2-SRE-2: "3 retries are spent in seconds"                                                                | I stated it as fact in the claim column.                                                                                                                                                                                                                                                                                    | The code sets no delay (`scan-buffer.ts:194` `message.retry()`; no `retry_delay` in `wrangler.toml:216-221`). The platform default is inferred.                                                                                                                                  |
| 4    | Invariant 3 "VIOLATES the literal text" while also "NOT ADDRESSED in intent"                              | My report contradicted itself, and the ruling went the other way (merge 2.7).                                                                                                                                                                                                                                               | It CONFORMS to the `CF-IP*` clause. The wording gap is R4-14.                                                                                                                                                                                                                    |
| 4    | ADR-020: "rule 4 not applied"                                                                             | The ADR carries a reconciliation note at `:205-212`.                                                                                                                                                                                                                                                                        | Merge correction accepted.                                                                                                                                                                                                                                                       |
| 2/3  | R1-16 "Stays Medium", then a Medium proposal resting on a fact nobody had read                            | The proposal rested on the invalid condition above.                                                                                                                                                                                                                                                                         | I accept High.                                                                                                                                                                                                                                                                   |

## 3. Conditional rulings

- **R1-23. I accept the merge's structure and the three triggers.**
  - What can be settled read-only now:
    - Trigger (b) has not fired (proven, section 1). It can fire only when the owner starts a production deploy.
    - Triggers (a) and (c) are owner-only.
  - Two notes for the scorer:
    - The Tier-1 base item carries a **15-point deduction** as well as the cap of 70 (`ccr-protocol.md:368-372`). The merge cites only the cap.
    - That base item fails on more than the token scope. KV expiry, the materializer window, DLQ retention and Workers Logs are also unverified (merge section 6, items 1 to 5). So a scope read alone does not lift the cap.
  - The triggers only escalate. If a read shows no production scope, R1-23 stays High, but that one assumption becomes verified.
- **R1-16. High stands. The condition is wrong and needs replacing.** It cannot go red on the delay that grows with the bucket count (section 2).
  - Proposed condition: Medium only if, over 7 nights, (`computed_at` minus 03:00:00) plus `phases[scan_aggregation].duration_ms` from `SHARED_REPORT_MATERIALIZE_COMPLETE` (`shared-report-materialize.ts:107-121`) stays within seconds.
    - The duration is an upper bound on how late the INSERT runs.
    - It is a Workers Logs read for the owner, and log retention is unknown.
    - State the bucket count N, because staging and production differ.
  - Even if the window is seconds, the accuracy half stays at least Medium (loop 3, 2.3).
- **R4-01 (COPPA extension).** The condition is quoted correctly (`ccr-protocol.md:1432`).
  - Settled from the repo: no verified prevention mechanism exists (grep, proven).
  - Owner-only: whether collection from under-13s is "reasonably possible", meaning whether general events take children's forms. That is a deployment fact plus a legal reading, both inferred.
- **R2-02.** Not my lens. I did not test it in any loop.

## 4. Subject-created versus found on main (this lens's rows)

| Row                                             | Class                   | Note                                                                                                                                 |
| ----------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| R1-01, R1-16, R1-23, R2-03                      | Both                    | R2-03 on main: a rotation of `ANON_ID_HASH_PEPPER` renames markers. S2 adds the `RATE_LIMIT_KEY_PEPPER` leg and its own deploy hour. |
| R1-09, R2-01, R2-27                             | Both, practice on main  | R1-09's practice is now proven on main twice (section 0). C.0 writes it into the plan and adds six more steps.                       |
| R1-07, R1-08                                    | S (created by shipping) | Confirmed.                                                                                                                           |
| R1-19, R1-33, R1-34, R1-46, R4-17 (partly)      | S plan or criteria      |                                                                                                                                      |
| R2-18, R2-19, R3-07, R3-08, R3-10, R4-01, R4-11 | M                       |                                                                                                                                      |

## 5. The post-freeze fix

Options for R1-04's in-scope half:

- (a) Score it at the baseline in `cumulative_score` and record #1073 as an environment fact.
- (b) Credit the fix in `cumulative_score`.
- (c) Do (a), and let `system_score`, which the checker allows to be at or above cumulative (`:457`), credit only what a lens verifies as closed.

**My recommendation is (c),** applied the same way to #1069 (R1-19's Wave 0 item 1) and #1076.

- #1073's own body concedes that its wording is not literally true in the old held case, so it does not close the in-scope half on its face.
- OSE-1787 stays out of scope pending RC-01.
- An environment fact from this lens: the post-freeze fix itself reproduced R1-09. It turned T4f red at 08703cd7, and #1076 repaired it (proven).

## 6. Systemic promotion and cluster multipliers

H4 promotes "the same finding in 3+ locations" by one tier (`ccr-protocol.md:497-509`). The 31 rows are **three roots, not one:**

- **(i) The subject's test design.** Faults chosen by the author; staging steps that cannot be born red; controls that do not tell the cases apart. These rows would collapse into it: R1-07, R1-14, R1-15, R1-27, R1-39, R1-46, R2-11, R2-12, R2-13, R2-14, R2-22, R3-05, R3-11, R4-12.
- **(ii) Main's controls are advisory or narrow in scope.** R1-41, R2-15, R2-17, R3-06, R3-08, R4-06, R4-07. This is a found-on-main pattern, not test design.
- **(iii) Product defects with an attached test gap.** R1-01, R1-03, R1-06, R1-08, R1-10, R1-16, R1-23, R2-05, R2-18, R2-25. They keep their own deductions; collapsing them would erase product harm.
- Promoting (i) as one finding at High would make it **Critical 15, not Security Critical**.

Multipliers:

- **C3 2.0:** hold. R1-07 removes the only detector for R1-08 and R2-03, so one enables the others.
- **C6 2.0:** hold.
  - R1-09 is now proven in mechanism, and R3-06 has five live instances.
  - R2-01's link is structural, not observed.
  - My timing error weakens the deliberate route only.
- **C1 1.5:** hold. Scope is not confirmed, and trigger (b) has not fired.
- **C2:** outside my evidence. H2's text requires that "one enables or amplifies the other". The loop-3 attacker-gain test failed, so shared vocabulary alone looks short of 2.0.
- **C5:** not my lens.

## 7. Per-loop score derivation

- **The brief describes loop 4's proposal wrongly.**
  - The brief says rows "discovered in that loop".
  - Loop-4 section 4.6 and section 7 item 5 say rows **open at each loop's end**: 46, 75, 87, 104.
- **Cumulative-at-loop-end is the more faithful method.**
  - The checker wants each loop's own result, with cumulative no better than the worst loop (`:426, :453`).
  - Nothing was fixed between loops. Under this method the scores never rise, and loop 5 equals the cumulative, which matches "one cumulative score".
  - Scoring only the rows discovered in each loop measures how productive each lens was, not the subject.
- **Apply H1 once, at the discovery loop.**
  - Do not apply 3.3 (the penalty for non-correction). It penalises choosing not to fix, and the run model forbids fixing between loops.
  - H1 has no constant for loops 4 and 5 (`:463-466`). The scorer must state one. Capping at 1.5, the highest the text defines, is the reading that adds nothing.
  - Use each loop's tiers as they stood then (R1-16 and R1-23 at Medium in loop 1; R3-01 Low from loop 4).

## 8. Convergence (this lens)

- **New roots per loop:** 10 rows in loop 1, then 5, then 3, then 3, then 0 now. The rate is falling.
- **No High moved tier through this lens.** What changed:
  - R1-16's condition was invalid, and a replacement is proposed above.
  - R1-23's trigger (b) is now settled as not fired.
  - R1-09's evidence moved from consequence to root.
  - R2-01's basis tag was overstated.
- **The register is stable enough to score,** once three things are done:
  - the R1-16 condition is replaced;
  - one window convention is adopted;
  - the R3-06 instance list is corrected.

## 9. New findings

None. Section 0's facts strengthen R1-09 and R3-06, and the `briefing.ts:124` instance belongs inside R4-01.

## 10. Not checked

- **Owner-only reads:** token dashboard; `duration_ms` in Workers Logs and their retention; KV expiry at runtime; DLQ settings; production levels.
- **Not re-read:**
  - the cause of 9134ab9f's T2 (pages) red;
  - whether docs-only merges landed inside window 1;
  - R2-02, R3-03, R1-02 to R1-06 and R1-10 (other lenses).
- **Subject read partly:** lines 114-169, the C.8 block and greps, not the whole file.
- No tests run.

## 11. Commands run (all read-only; none refused)

- **Read tool:**
  - BRIEF-loop5, `sdet-sre.knowledge.md`, MERGED-loop4 (in full);
  - my loop 1 to 4 reports;
  - loop-3 merge (lines 14-53 and 186-255);
  - subject lines 114-169;
  - `ccr-protocol.md` (lines 452-531, 586-605, 1748-1775).
- **Bash, scratchpad:** `ls`, `wc`, `sha256sum`, `grep` over the subject and merges, `awk` over subject C.8.
- **gh:**
  - `run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 16 --json ...` (the one read the brief asked for);
  - `run list` for workflow_dispatch (100), push for tags (300), pull_request (200), and `staging-rollback-drill.yml`;
  - one more `run list` (push, main, 300) filtered to 2026-10-20 13:30-17:30Z;
  - `run view --json` for 41401623413, 41503990040, 41343514358 (and `--attempt 1`), 41414877276, 41468952196, 41414837671, 41168387362, 40887461797, 39459166333, 39436555076;
  - `run view 41496750244 --log-failed | grep`;
  - `pr view 1076` and `pr view 1073` (files);
  - `api .../commits/main`; `api .../environments`;
  - `secret list` (names, counts and dates only; `--env production` and `--env staging`).
- **node:** `scripts/ci/classify-ci-failure.mjs --run-id 41496750244`.
- **git:** `log -1`; `diff --stat 39a63d67 HEAD`; `log 39a63d67..origin/main`; `rev-parse`; `blame -L 91,91`; `log -1` on `CF_API_TOKENS_POLICY.md`; `show --stat 20b45c48`; `log --diff-filter=A`.
- **sed and grep** over:
  - `ci.yml`, `staging-rollback-drill.yml`, `wrangler.toml`;
  - `shared-report.ts`, `shared-report-materialize.ts`, `index.ts`, `scan-buffer.ts`, `qr-scan.ts`;
  - `public-read-limit.ts`, `edge-rate-limit.ts`, `privacy.ts`, `briefing.ts`, `router.ts`;
  - `impression-dedup-hour.spec.ts`, `workers-types/index.d.ts`;
  - `AGENT-WORKSTATION-HARDENING.md`, `CF_API_TOKENS_POLICY.md`, `ccr-worksheet-check.mjs`, and the `src` age-gate grep.
- One jq parse error, which ran nothing; I re-ran the command with a simpler filter.
- No writes, fetches, branches, commits or stashes.
