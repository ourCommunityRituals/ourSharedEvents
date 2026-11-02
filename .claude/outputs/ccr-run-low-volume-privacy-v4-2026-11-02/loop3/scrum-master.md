# Loop 3 (Adversarial), lens `scrum-master`, epic OSE-1766, subject v4 frozen (sha256 dd9b8522...b7f4)

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score, no gate decision. Basis tags: proven (a command result), arithmetic, source-read, inferred.

Highs in my lens: R1-09, R2-01. Highs I leave to other lenses: R1-01 to R1-08, R1-10, R1-16, R1-23, R2-02. R1-23 touches me only through C6 and the token/step weakening in 1.3.

Base facts, freshly read today (2026-11-02):

- **F1 (proven).** `origin/main` is `6bdc2f90` (#1071). Four commits sit past the frozen base `39a63d67`: #1068, #1069 (`8e6d19dd`), #1070 (`0ebe2fdd`) and #1071.
- **F2 (proven).** `git diff --stat 39a63d67 origin/main -- workers/oursharedevents/src` changes 3 files: `count-floor.ts` (+25), `shared-report-builder.ts` (+90/-), `shared-report-export.ts`. Subject line cites into the builder (`:364,514,531,735,840`) may have moved. This is an instance of R1-19 and R1-32, not a new row.
- **F3 (proven).** #1069, the Wave 0 clock gate, is MERGED (`2026-11-02T15:09:41Z`, draft=false).
  - Its body still says "Draft until the owner answers the CCR gate. Do not mark ready."
  - `tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts` is now on `origin/main` with 14 `test(` blocks. The PR body says "8 of 8", which is stale.
  - `shortlinks.last_clicked_at` is at `:134`; the forms entries use `PENDING_D4 = 'pending owner ruling D4 (OSE-1766)'` (`:74`).
  - Wave 0 item 1 is therefore met in code. OSE-1778 is not Done: that is a Linear state I cannot read, and the merge SHA's own chain has not finished (F4).
- **F4 (proven).** The latest three main-push runs:
  - `41468851354` (`8e6d19dd`): in_progress. Its `T0 Gate (invariants)` is success.
  - `41468896801` (`0ebe2fdd`, #1070): **completed, cancelled**.
  - `41468952196` (`6bdc2f90`): pending.
  - The last complete chain is `41414877276` (`39a63d67`). `T1 Deploy -> Staging`, `T2 Contract -> Staging (Bruno)`, `T3 E2E Smoke -> Staging (Playwright)`, `T4 Functional -> Staging` and the three T4 legs are all `success`. The same holds for `41414837671`, `41411721564` and `41401623413`.
- **F5 (proven).** The 12 most recent main pushes include 5 failed runs: `41343514358`, `41340489668`, `41277870075`, `41277855661`, `41168387362`.
  - Failed span: `2026-10-31T04:23Z` (`20b45c48`) to the first green at `2026-11-02T06:42Z` (`e9211436`, #1064).
  - By arithmetic that is 50 h 19 min with no SHA able to reach Done on its own chain.
  - Five merged SHAs sat inside it: `20b45c48`, `f7140424`, `588b8e55`, `cd7f6e0d`, `5e0947f5`.
  - These SHAs reach Done only through a later SHA (`e9211436` onward). That is the AGENTS rule working as written, and it is the premise of Attack 1.2.

## 1. Attack cards

### 1.1 R1-09 (High): "Done" claimed when T4 is red or missing on the SHA's own run

**Attack A: the queue replaces a merge's chain (live now).**

- **Actor:** two honest developers merging within seconds. #1069 merged `15:09:41Z`, #1070 `15:09:59Z`, #1071 right after (proven, `gh pr view`).
- **Goal:** a merge SHA with no chain of its own, which then takes Done from a later SHA.
- **Steps:**
  1. The push concurrency group is keyed `ose-${{ github.event_name }}-${{ ref }}` with `cancel-in-progress` false for pushes (`ci.yml:150-158`, source-read).
  2. Run `41468851354` holds the running slot, so the next push's run waits as pending. A third push replaces the pending one (platform behaviour inferred; the outcome is proven): `0ebe2fdd` (#1070, which changed `count-floor.ts` and the builder) shows `completed cancelled` (F4).
  3. AGENTS allows Done on "the merge SHA, or a later main SHA containing it". That is satisfied the moment `6bdc2f90` goes green.
- **Success condition:** `0ebe2fdd` reaches Done with no T1-T4 on its own tree. No criterion in the subject goes red. The AGENTS rule is the whole safety, and the subject restates it at C.0 "Done".
- **Verdict:** works on main. It is proven that a merge SHA lost its chain today. It is not proven that anyone used it to claim Done.

**Attack B: the later SHA "contains" the slice but undoes it.**

- **Actor:** an honest later PR, or a revert.
- **Steps:**
  1. Slice S merges at X and its run is cancelled (as above), or red.
  2. The next push Y reverts or overwrites S's change. Y is a descendant of X, and Y's chain is green.
  3. The rule "a later main SHA containing it" is ancestry only (source-read, AGENTS "Definition of Done"; subject C.0).
  4. The agent moves S to Done. Y's T4 step for S is gone or no longer tests S.
- **Success condition:** a Done slice with no evidence that its fix stands. No criterion is red.
- **Verdict:** works on main.

**Attack C: two slices cannot reach Done by the letter.**

- **S5** is `.claude/research/*.md`. The push trigger filter has no `*.md` and no `.claude/**` (`ci.yml:104-122`, source-read). A merge of S5 starts no run, so its chain exists only through an unrelated later SHA. The subject itself says "None in CI" (C.5), which agrees with R1-30.
- **S16** adds `tests/integration/adr-025.test.js`. `tests/**` is in the filter, so a chain runs, but nothing in T4 tests ADR-025.
- **Verdict:** works on main for S5. This only strengthens R1-30's basis (proven filter); it stays Medium.

### 1.2 R2-01 (High): shared staging has no cross-run lock; false green or false red

**Attack A: a second deploy lands between T4 start and a slice's step.**

- **Actor:** an honest developer on a `full-pipeline/*` PR, or a same-repo PR author. The brief's "CI step on a same-repo PR" applies once the PR is allowed to run.
- **Goal:** main's T4 goes green on a Worker that is not main's code.
- **Steps:**
  1. A main push M deploys SHA X to staging (`deploy-staging`, `ci.yml:~1192`). T4 checks freshness once, at its start (`ci.yml:2001`, `scripts/assert-deploy-freshness.mjs`, per loop 2).
  2. During T4's legs (30 min job ceiling, `ci.yml:1867`), a `full-pipeline/*` PR run P deploys its own build to the same Worker and D1. The opt-in is at `ci.yml:1176-1190`. That job targets an `environment:` (loop 2 (f)).
  3. M's S2/S3/S4 step reads staging, which now runs P's code. A broken marker on main is masked by P's fix. P's keys also pollute S2's K1 minus K0, which gives a false red on M.
  4. `T4 Functional -> Staging` takes the sub-job result only (`ci.yml:2527-2540`).
- **What the attacker needs:** a branch named `full-pipeline/*` and, per my memory notes (not verified in this run), approval at the `staging-pr` reviewer environment. An honest dev supplies both.
- **Success condition:** Done on X's evidence that tested P. No criterion goes red: the subject assumes one serial staging target (C.0, R2-01 "ASSUMED, false by config").
- **Verdict:** works on main by source-read. Not exercised at runtime, and I did not run it.

**Attack B: false red blocks the production tag and the CI rollback.** R1-09 correction 2.7 covers this. Nothing in the subject changes it.

### 1.3 Process attacks

**P1. Close guard passes a declared close on a slice PR.** Loop 2 fact (c), proven.

- **Reading the script (source-read):** `scripts/check-pr-linear-close.mjs:20` calls a declared `Closes OSE-n` "INTENTIONAL", and its own test table lists `completing PR: id in branch + Closes` as pass (`:151`). `WORD_THEN_ID` is at `:65`.
- **Actor:** an agent or author, by error or intent. S4's PR body says `Closes OSE-1769` with an id-free branch.
- **Steps:**
  1. The guard passes.
  2. The Linear GitHub integration closes the slice at merge (inferred; the script header at `:8-13` states it as fact).
  3. The slice is Done before any of T1-T4. The two-stage Done of AGENTS is bypassed.
- **Success condition:** a Done slice with no merge evidence. No AC is red. C.0 "no PR says Closes" is convention only (R2-17).
- **Verdict:** works on main. Severity stays R2-17 Medium. It becomes High if loop 5 finds anything that reads Linear Done as evidence (the epic roll-up in P4).

**P2. No CI/CD testing ticket exists, and nothing checks for one.**

- AGENTS requires "a CI/CD testing ticket is attached to the story". The subject plans 9 such tickets as "new" (B.4); they do not exist yet.
- No workflow, script or test reads them: grep over `scripts/` and `.github/` for a ticket check finds none that I opened. I could not read Linear.
- A slice can be Merged and moved to Done with no testing ticket and nothing red.
- **Verdict:** works on main. Medium.

**P3. How the Wave 0 dependency on #1069 could be skipped.**

- Wave 0 item 1 says S3 and S7 "wait on" the clock gate. That wait is a Linear blocked-by, which nothing enforces.
- The subject also gave an escape hatch: "if the owner keeps it closed, S3 AC5 and S7 AC5 drop" (C.9, C.11, E.1). An author could have merged S3 without the gate by declaring AC5 dropped.
- #1069 was merged while its own body said "Draft until the owner answers the CCR gate. Do not mark ready" (F3, proven). So a "do not merge" note on a PR was not an enforced stop either.
- **Now moot for the order:** the gate is on main. It also reduces R1-19's staleness: S3 and S7 now rebase against main's spec, whose stale-entry test goes red if `shortlinks.last_clicked_at` changes kind without an edit.
- **Verdict:** blocked on main today (gate merged). The Wave 0 dependency was skippable by prose. Not a new row (R1-19, R1-35).

**P4. The epic called Done with 0 of 9 slices verifiable.** R1-29.

- **Actor:** the owner or an agent closing OSE-1766 by hand, or Linear rolling up children (inferred).
- **Steps:**
  1. B.4 moves out, cancels or re-homes about 8 children (OSE-1767, 1770 to 1774, 1776, 1779). A Canceled child may count as complete in a roll-up (R1-45, inferred).
  2. "Done for the epic" (E.3) is a sentence, not a check. Nothing in the repo reads the 9 children's states or OSE-1496's named test.
  3. OSE-1496's E4 test link is checked for presence only (R1-31, `tests/born-red-harness.spec.ts:79-90` per subject), so a renamed or absent E4 passes.
- **Which slices can reach Done today** (counting only proven or stated facts):
  - S14, S16 and S6 need no owner answer.
  - S2 needs F-10, S15 needs F-12, S7 needs F-8 and D4 and the clock gate (now met).
  - S4 needs OSE-1784 (S4 is not startable until then) and D2.
  - S5 cannot reach the letter of Merged (1.1 C).
  - The epic also needs OSE-1496 (external, undated).
- **Success condition:** an epic Done with 0 of 9 slices having a green chain for their own SHA. No criterion goes red.
- **Verdict:** works on main. Severity stays Medium (R1-29). It would move to High only with a confirmed roll-up automation.

### 1.4 Sequencing attacks (a later slice undoing an earlier slice's control)

**Seq-1. S15 first, mechanisms later.** Wave 1 puts S15 first, while S4 (D2 unanswered), OSE-1784 (external) and R2-02's map bit come after.

- The public sentence "below that it reads 'fewer than 5'" and "no more than this" ships before the controls it describes.
- S15's staging step checks wording only.
- **Verdict:** works after the subject ships. This is R1-02/R2-02 as a sequencing instance, not a new row. Proposed order: S15 last.

**Seq-2. S4's SQL-site allowlist has no "bounded" requirement.**

- S4 AC3 requires each `FROM scan_placement_events`/`scan_cell_aggregates` site to be on an allowlist "naming the site and its purpose".
- A later PR (for example OSE-1784, which edits `shared-report-builder.ts` after S4 per E.3, or any PR adding a reader) adds an unbounded reader and an entry with a stated purpose. AC3 is green and the unsealed-hour read returns.
- AC2 walks only fields already in the two registries.
- **Verdict:** works after the subject ships. Filed as L3-SM-3 below.

**Seq-3. `ci.yml` is the heaviest collision file, and each slice's T4 step is unpinned.**

- Seven slices edit it (E.3 collision list). On a rebase, an earlier slice's step can be dropped or turned `continue-on-error`.
- The aggregator only reads the sub-job result (`ci.yml:2527-2540`).
- The subject names no AC pinning the presence of each of the 6 new steps. I did not read whether `infra-consistency.test.js:634/922` pins any step names, and I saw a CI-integrity ratchet for `continue-on-error` at `ci.yml:745`.
- **Verdict:** works after the subject ships. Basis inferred. Filed as L3-SM-2.

**Seq-4. S2's refusal gate before the owner sets the staging pepper.**

- The order "the owner sets `ANON_ID_HASH_PEPPER` on staging before the PR merges" is a human step (F-10); AC5 refuses every staging deploy without it.
- If it is missed, `T1 Deploy -> Staging` goes red for every later SHA and no Done is possible. It also blocks the CI rollback (R1-09 correction 2.7).
- The gate precedes migrate (`ci.yml:1246` before `:1271`, loop 2), so no half state. The revert is open.
- **Verdict:** works after the subject ships. Duplicate of R1-18 (Medium), now interlocked with R1-09. See 5.

**Seq-5 (S0/OSE-1496 against S2).** S2 AC1 pins the marker key to an independently computed value, so a later change in what feeds the marker goes red. Not a silent undo.

## 2. Attacks on the subject's own controls

**Fault 1: C.0 "no PR says `Closes`".**

- The fault: `Closes OSE-1769` in S4's PR body.
- The guard passes (1.3 P1). No AC covers it; Linear shows Done at merge.
- The criterion stays green.

**Fault 2: S16 AC3, the `<!-- owner-has-not-ruled -->` marker (R2-15).**

- The fault: one PR removes the marker and sets `Accepted`.
- The test passes. `.github/CODEOWNERS` covers ADR-014, ADR-020 and `/.github/workflows/`, with `*` set to one owner; ADR-025 has no lock.
- With one reviewer for about 17 PRs (E.3 Cost), the "owner gate" is the same person who merges. The criterion stays green.

**Fault 3: C.0 "A red step turns the aggregator red; stated, not designed away".**

- The fault: a slice PR (or a rebase) adds its T4 bash step with a trailing `|| true`, or drops it while resolving a conflict in `ci.yml`.
- The aggregator is green. S2/S3/S4/S6/S15 staging steps cannot be run on a branch (C.0 "Born red": a branch cannot be born red against staging). So no one sees the step go red once.
- The criterion stays green.

**Fault 4: S5 and S6 "evidence".**

- S5's check is "a reviewer re-running the grep" with no failing check (C.5).
- A reader missing from the inventory still lets the reviewer's comment match the recorded output. S5 stays green with a short list.
- S6's step "records the result in the job log" with no pass/fail (R1-10); S6 passes whatever the order shows.

**Fault 5: "Done for the epic" (E.3).**

- The fault: OSE-1496's E4 test renamed or removed, or never written.
- Presence-only `test_ref` (R1-31) and no check of the epic's children means the epic is Done with no failing check.

## 3. Cluster tests

**C6 (R1-09 plus R2-01): confirmed. Combining them gives more than either alone.**

- Worked example. Slice S2's PR is raised as `full-pipeline/s2` so its staging step runs on a branch (R1-09's cure). Main push M runs T4 at the same time.
  - M's S2 step lists `scan:dedup:` keys. P's scans add keys to K1 minus K0. M goes false red, or P's fix masks M's broken marker (false green).
  - The born-red route is also the only way to see a staging step red before merge, so every slice that uses it creates the race for every main push.
- Worse with the queue (Attack 1.1 A): a cancelled SHA must borrow a later chain that also ran under such a race.
- **Proposed:** add R1-18 to C6 (a missed owner step blocks every chain, Seq-4). Multiplier is the scorer's call.

**C2, C3, C5 (process view only; the mechanism belongs to other lenses).**

- C5 and C2 worsen under Seq-1: S15 words ship before S4's open-hour fix and before R2-02.
- C3: no process link beyond S2's owner prerequisite (Seq-4).
- C1: no process link.

## 4. New findings

| id      | sev        | slice                        | claim                                                                                                                                                             | evidence                                                                                                                                                                               | basis                             | root cause                                                                                      | why not an existing row                                                                                                                         |
| ------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| L3-SM-1 | Medium (5) | C.0 Done rule, all           | "Done on a later main SHA containing it" is ancestry only, so a later revert or overwrite satisfies it                                                            | AGENTS "Definition of Done"; subject C.0 "Done"; F4/F5 show SHAs reaching Done only through later SHAs                                                                                 | source-read; revert case inferred | The rule asks for "contains" in git history, not "the slice's named step ran in that green run" | R1-09 is the omission of `full-pipeline/*` from born-red; R2-01 is the race; R2-17 is the Closes word. None covers the semantics of "later SHA" |
| L3-SM-2 | Medium (5) | S2, S3, S4, S6, S15, S7, S14 | Nothing pins the presence or non-weakening of each slice's own T4 step. A rebase of `ci.yml` (7 slices) can drop or soften an earlier step with every check green | `ci.yml:2527-2540` (aggregator reads the sub-job result only); C.0 collision list (E.3); no AC names such a pin; `infra-consistency.test.js:634,922` read but not opened for step pins | inferred                          | A control that lives only as a step in a shared file with no pin                                | R1-07 is one step passing on a fail-open; R1-23 is token scope; neither is "the step is gone"                                                   |
| L3-SM-3 | Medium (5) | S4                           | AC3's allowlist asks for a site and a purpose, not a bound. A later reader (for example OSE-1784, or any PR) can be listed unbounded and AC3 stays green          | subject C.10 AC3; E.3 puts OSE-1784 before S4 but a Linear blocked-by does not stop a later builder edit                                                                               | source-read                       | The structural spec checks existence of a site, not that it is bounded                          | R1-14 is a migration-made view; R1-15 is AC2's registry reach. This is the allowlist's content check. The lead may fold it into R1-15           |
| L3-SM-4 | Low (2)    | B.4, G                       | The repo's id map has no entry for the epic's tickets, so "Linear matches code" cannot be checked from the repo                                                   | `.claude/sync/LINEAR-MAP.md` is 187 lines, last commit 2026-09-21; grep for OSE-1766/1768/1769/1496/1783/1784 finds none                                                               | proven (grep)                     | Evidence comments are the only record; nothing syncs back                                       | R1-45 is about B.4 consistency, not the map                                                                                                     |

Instances, not rows:

- F2 (main moved 4 commits, 3 `src` files) is R1-19/R1-32.
- The 41468896801 cancellation is R1-09's third-queued-push mechanism, now proven to occur.

## 5. Re-rates

- **R1-09 stays High.** Its basis moves from source-read to proven for the cancelled-chain mechanism (F4) and for the red span (F5). Its closed-when should add a rule that the later SHA must have run the slice's named step (L3-SM-1).
- **R2-01 stays High** (source-read; not exercised).
- **R2-17 stays Medium.** It would be High only if loop 5 finds something that treats Linear Done as evidence (P4).
- **R1-18 stays Medium alone.** I propose joining it to C6 (Seq-4).
- **R1-29 stays Medium** (proven slice facts).
- **R1-30 stays Medium.** The S5 path filter is now proven (`ci.yml:104-122`).
- **R1-19 stays Medium (cap).** #1069 is merged, so the stale premise "#1069 draft" is gone. Its born-red table still covers 8 of 14 tests by its own admission.

## 6. Not checked, and why

- **Linear itself:** the Linear MCP is not available to me. Every slice, epic and testing-ticket state is unread.
- **GitHub environment settings:** `staging-pr` reviewers, and whether `CLOUDFLARE_API_TOKEN_OSE` is overridden per environment. This needs repo-admin API or the settings UI, and I made no call for it.
- **Platform facts I could not settle from the repo:**
  - Whether Linear auto-closes on `Closes` for a squash merge.
  - GitHub's documented rule for a pending run under `cancel-in-progress: false` (I only observed the result).
  - Whether a KV listing returns expiry, Workers Logs content for `/q`, dead-letter retention, the token's real scope, and production's migration level.
- **Runtime checks:** I ran no attack against staging, production or Linear.
- **The finishing status of runs `41468851354` and `41468952196`.** They were in progress or pending when I read them.
- **`infra-consistency.test.js:634,922`:** I did not read whether they pin any T4 step names (L3-SM-2 is inferred).
- **The CI-integrity ratchet at `ci.yml:745`:** I did not open it, so Fault 3 might be partly caught (continue-on-error only).
- **#1071's CCR gate (`scripts/ci/ccr-gate.mjs`):** read to line 40 only. It governs AGENTS.md, CLAUDE.md, STORIES.md and the CCR files, not slice PRs, and runs warn-first.
- **The failing job inside the five failed main runs:** I read only the run conclusions; the T4i detail comes from loop 1 and the subject (I.12).

## 7. Commands run (all read-only; none refused)

- `Read` of: the loop-3 brief; `.claude/skills/scrum-master.knowledge.md`; `subject-v4-frozen.md` (lines 1-205, 206-410, 495-669); `loop2/MERGED-loop2.md`.
- `Grep` of `loop1/MERGED-loop1.md` for R1-09, R1-29, R1-30, R1-19.
- `Grep` of `^## [D-K]\. ` over the subject.
- `gh pr view 1069 --json number,title,state,isDraft,mergeable,headRefName,baseRefName,createdAt,updatedAt,statusCheckRollup,reviewDecision,body`.
- `gh pr list --state open --json number,title,isDraft,headRefName,updatedAt --limit 40`.
- `gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push --limit 12 --json ...`, then again with `--limit 3` and `--limit 4`.
- `gh run view <id> --json jobs --jq ...` for ids `41414877276`, `41414837671`, `41411721564`, `41401623413` (T0 to T4 jobs) and `41468851354`.
- `gh run view 41468896801 --json status,conclusion,jobs`.
- `gh pr view 1069 --json statusCheckRollup --jq ...`.
- `gh pr view 1070 --json title,body,isDraft,statusCheckRollup`, then `--json state,mergedAt,body`.
- `gh pr view 1069 --json state,isDraft,mergedAt,mergeCommit`.
- `grep` of `.claude/sync/LINEAR-MAP.md` for the epic ids; `wc -l` and `git log -1 --format=%cd` on it.
- `grep -n` on `scripts/check-pr-linear-close.mjs`.
- `grep -n -A8 "^concurrency"` and `sed -n` (lines 100-130, 1866-1900, 2527-2548) of `.github/workflows/oursharedevents-ci.yml`.
- `grep -n` for `full-pipeline`, `functional-staging`, `continue-on-error`, `T4_MAX_SKIP` in that workflow.
- `cat .github/CODEOWNERS | head -30`.
- `grep -n` over `.github/workflows/*.yml` for ccr; `sed -n 1,40p scripts/ci/ccr-gate.mjs`.
- `git log --oneline 39a63d67..origin/main`.
- `git diff --stat 39a63d67 origin/main -- workers/oursharedevents/src`.
- `git ls-tree -r --name-only origin/main | grep -i timestamp-precision`.
- `git show origin/main:tests/e2e/0-architecture/timestamp-precision.invariant.spec.ts | grep ...` (Bash; the file path has no colon problem here).
- `git log -1 --format='%h %s' origin/main`.
- `ls` of the two `0-architecture` directories.
- `grep -n` over `tests/integration/infra-consistency.test.js` for T4 step names.
- No write, no network call other than `gh` reads, no test run, no deploy.

Lead's note (not the agent's text): F1 and F3 are new facts for the run. `origin/main` has moved past the frozen code baseline 39a63d67 by four commits (#1068 docs, #1069 the clock gate, #1070 count-floor/builder changes, #1071 the CCR gate workflow), and #1069 is merged. The subject stays frozen; the merge should treat these as environment facts (R1-19/R1-32 instances) and note that the loop-1/loop-2 line cites into `shared-report-builder.ts` and `count-floor.ts` refer to 39a63d67, which the `ose-clock-gate` worktree still holds.
