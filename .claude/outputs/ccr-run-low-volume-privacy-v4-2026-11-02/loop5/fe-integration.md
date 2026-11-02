# Loop 5 (Recursive) report: FE Integration lens (`fe-integration`), epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus by the lead's override.

No score, no gate decision, no fixes.

**Checks before I started (proven):**

- The subject hashes to `dd9b8522…b7f4`, which matches.
- `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src` is empty in `ose-clock-gate` (HEAD e7c8297b).
- Paths below are under `workers/oursharedevents/src/` unless stated.

**How to read "proven" in this report:**

- **Function replays:** the code was pulled from the source at run time (`@ose-event-view` markers; `count-floor.ts` through `stripTypeScriptTypes`) and run with `node -` in memory.
- **SQL replays:** this loop pulls the three statements from the baseline source files by code. Loop 3 copied them by hand. They then run in `node:sqlite` `:memory:` (SQLite 3.51.2), on hand-written tables whose columns match `migrations/0087`. The builder's branch is re-coded in JS.
- **What the SQL replays prove:** the SQL text and its branch outcomes on SQLite. They do not prove D1, the deployed Worker, `batch()` semantics or cron timing.

## 1. High stability table

**R1-03: S4 shows the open hour in withheld words. Claim STABLE, severity STABLE (weakest High in my lens), basis REVISED.**

- Re-checked:
  - The `oseEventView` replay reproduces: held gives Report "Fills in once people start scanning" (`admin.html:8178`) and next "Get the word out: share the link" (`:8189`). 80 gives "Share the report".
  - New and proven: `scansOf([])` returns `{count:null,suppressed:true,floor:5}`. That is the same object as under 5, so an open-hour-only event reaches the function exactly as I fed it.
  - **Correction:** S4 AC5 replaces the "People scanning" detail with "Scan counts appear after the first full hour…", which is true. My loop-3 table counted that line as false. It is not.
- False after S4, counted from code:
  - 12 strings in 7 components on 3 pages.
  - Live view: tile `title` (`live-monitor.ts:125`), note (`:143-144`), day card (`:167-168`).
  - Event timeline: Report step and next step.
  - Pre-event card: `:8367`, `:8422`, `:8447`.
  - Poster card `:6864`, poster list `:8497`, stats tile `:5334` (its title says "shown the same on every surface").
  - Sponsor home: `sponsor-home-render.ts:134`.
- Arises only after S4: on main the open hour counts live.
- Severity: High rests on invariant 2's words clause and S15's public "below that it reads 'fewer than 5'". A Medium argument exists under `ccr-protocol.md:41` ("manageable if named"), because the harm is false words and guidance, not a leak.
- Basis: proven (both pure functions) plus source-read (S4 Rule, AC5).

**R2-02: the map tells none from 1 to 4. STABLE.**

- Re-checked with the SQL pulled by code: 0 scans gives fallback; 1 or 4 give suppressed (stored `[0]`). Branch at `shared-report-builder.ts:862-880`; rule at `scan-cells.ts:21`.
- Widened (source-read): with no `event.h3_res7`, 0 cells give a `materialization_pending` entry (`:890-895`), against the suppressed state plus the floor note for 1 to 4. So the bit does not need the fallback map.
- `:859-861` states the very concern ("would tell a poster with no scans from one with 1 to 4"), but the branch still differs.
- Basis: proven (SQL), source-read (branch).

**R1-04, in-scope half: S15 claims "public words say only what holds", and AC1 omits `pages.ts`. STABLE, strengthened.**

- `floorNestedCounts` replay reproduces: c=6 shows the label only at w=5, so exactly 1. c=7 gives 1 or 2.
- New (source-read): `renderPostEventHtml` (`pages.ts:1553-1828`) renders both the label (`:1762`) and the never-who body S15 rewrites (`:1824`). That closes loop 3's "not verified".
- S15 names "Public event page" as its own surface (subject :204).
- Basis: proven (arithmetic), source-read.

**R1-16: two derivations in one response; the seal is a read-time clock. Claim STABLE, basis REVISED, condition REVISED (section 3).**

- Re-checked with the SQL pulled by code:
  - 5 scans, then a snapshot, then 2 more: stored 5, live 7, and the next rebuild stores 7.
  - 3, then a snapshot, then 4 more: stored 0 (map suppressed), live 7.
- The cron is at `wrangler.toml:105, 231, 384`. The INSERT has no upper bound (`shared-report.ts:895-907`).
- "Proven" covers the SQL only. That a snapshot lands after 5 or more hour-03 scans is a timing premise: source-read for the cron and the missing bound; inferred for the actual time.

Highs not in my lens (R1-01, R1-02, R1-05 to R1-10, R1-23, R2-01, R3-03, R4-01): I did not re-open them.

## 2. My own errors across four loops

| Loop  | Claim                                                                                                             | What was wrong                                                                                                             | Correct statement                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1    | Assumption 3: open rows exist "except hour 03"; rated as seed vacuity (L1-FE-4, Medium)                           | I saw R1-16's mechanism and missed the leak. Found in L2, by me and BE                                                     | A late discovery by my own lens, at the loop-2 position                                                                                                                                                                                                                                                                                                                                                                                     |
| L1    | Admin "<5" at `admin.html:4944-4950`                                                                              | That is the renderer. The literal is at `:5334`                                                                            | `:5334`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| L1    | "Invariant 6 … strip position untouched (TRUE)"                                                                   | Stated generally. I checked only the event page. L4 found the report order (R4-08)                                         | TRUE for the event page; the report was not checked in L1                                                                                                                                                                                                                                                                                                                                                                                   |
| L2    | "Proven on main" for the `oseEventView` run                                                                       | The function is main's, but the input is a post-S4 state                                                                   | Proven for the function. The input follows from S4's Rule plus `scansOf([])` (proven in L5)                                                                                                                                                                                                                                                                                                                                                 |
| L2/L3 | "2 of at least 8 surfaces"; "8 surfaces: the 6 admin surfaces, live view, sponsor home"; "the other six surfaces" | Estimates stated as counts, and they disagree with each other. L3's table also counted the AC5 detail line as false        | 12 strings / 7 components / 3 pages. AC5 fixes 1 string; AC4 adds an explanation to the live view only                                                                                                                                                                                                                                                                                                                                      |
| L2    | "6 vs 4" caller count (the lead's term)                                                                           | Not in my saved L2 text: the lead condensed my hand-back. I recounted                                                      | `readEventScanCells` has **4** direct callers (`event-stats.ts:70`, `poster-deployments.ts:298`, `poster-reach.ts:198`, `pre-event-activity.ts:121`). The subject is right. Through wrappers they reach **6** handler call sites (`event-stats:70`, `poster-deployments:298`, `pre-event-activity.ts:76, 77`, `sponsor-home.ts:284`, `dashboards.ts:801`). Both numbers are true under their own definitions; each must name its definition |
| L3    | L3-FE-1 / R3-12: silent on 4 callers, strict on 1                                                                 | Incomplete. The fifth direct path, `poster-deployments.ts:298`, has no catch (it throws; how that renders was not checked) | 4 silent, 1 strict with an error, 1 uncaught                                                                                                                                                                                                                                                                                                                                                                                                |
| L3    | R3-12 classified S (merge, from my card)                                                                          | The silent rendering is on main today for any D1 error (`event-stats.ts:69-73`)                                            | Both: M (design), S (S4's untested new throw source)                                                                                                                                                                                                                                                                                                                                                                                        |
| L3    | SQL "copied verbatim"                                                                                             | The hand copy was unverifiable                                                                                             | Re-run with statements pulled by code: same results. Proves the SQL on SQLite, not D1                                                                                                                                                                                                                                                                                                                                                       |
| L3    | "Under RA-1, the injection variant sits in an accepted exact-count probe"                                         | F-2 accepts the count r. It does not accept the split of r across the snapshot (L4 section 4.3)                            | The injected variant gives sub-hour timing outside RA-1                                                                                                                                                                                                                                                                                                                                                                                     |
| L3    | R2-02 described through "Neighborhood Preview" / `cell_count` 7                                                   | That needs `event.h3_res7`                                                                                                 | The bit also shows without it, through the suppression entries                                                                                                                                                                                                                                                                                                                                                                              |
| L4    | "the subject touches no child-data path"; no COPPA finding; COPPA cite `privacy.ts:124-131`                       | S7 edits the registration path and S15 edits the page that carries the claim. I missed R4-01. The cite is `:118-123`       | R4-01 (High) applies, and S15's own page carries it                                                                                                                                                                                                                                                                                                                                                                                         |
| L4    | R1-05: "arguably true: a keyed id is not raw PII"                                                                 | Too lenient. The product's own ADR-001:52 calls it pseudonymous correlation                                                | The notice contradicts the product's own ADR (legal reading inferred)                                                                                                                                                                                                                                                                                                                                                                       |
| L4    | L4-FE-1 "proven by grep in the worktree, not on origin/main"                                                      | I did not grep at 39a63d67 and missed the CI-run root spec                                                                 | `git grep` at 39a63d67: no `privacy` or `/live` in `tests/e2e/2-pages/a11y-axe-surfaces.spec.ts` (run at `ci.yml:926`), `workers/oursharedevents/tests/a11y-axe.spec.ts`, `tests/playwright/mobile-workability.spec.ts` or `a11y-profile.spec.ts`. R4-06 STABLE, widened                                                                                                                                                                    |
| L4    | R4-08 Medium; "the owner's memory rule suggests it applies"                                                       | Memory is not a repo source. The reach is interpretive                                                                     | Low, as the merge ruled                                                                                                                                                                                                                                                                                                                                                                                                                     |
| L2/L3 | Time zones "8 to 11 pm" / "23:00 EDT"                                                                             | Daylight and standard time mixed                                                                                           | 03:00 UTC is 19:00 PST to 23:00 EDT over the year. After 2026-11-01 it is 19:00 PST to 22:00 EST                                                                                                                                                                                                                                                                                                                                            |

## 3. Conditional rulings

**R1-16. The condition is wrong as written. Settled from the repo:**

- `computed_at` is `nowIso`, taken at `shared-report.ts:726-728` when `aggregateScanBuckets` starts. That is the first phase (`shared-report-materialize.ts:54`).
- It is stamped onto cells inserted after the sequential per-bucket loop (`:764-812`), at `:907`. So it is a **lower bound** on the snapshot time T, and it will sit within moments of cron start whatever T is.
- Loop 3's own 2.3 notes the wait on that loop. Owner read 3 (`SELECT DISTINCT computed_at`) would therefore always trigger the downgrade to Medium, wrongly.
- **Correct read (owner terminal, Workers Logs, 7 nights):** T lies within `[computed_at, computed_at + duration_ms]`, where `duration_ms` is the `scan_aggregation` phase in the `SHARED_REPORT_MATERIALIZE_COMPLETE` line (`shared-report-materialize.ts:107-121`).
- **Correct condition:** Medium only if (a) T's upper bound is within seconds of 03:00 on 7 nights, **and** (b) the owner rules the injected split (section 4.3) out of the scored set or into OSE-1780.
  - (a) answers only the organic route.
  - The rebuild leg (a sealed cell moves 5 to 7 overnight) needs the same 5-before-T, so it is covered by (a).

**R2-02.**

- **Trigger 2 ("a surface shows the bit per hour without injection") is not met (source-read).**
  - The only reader of `scan_cell_aggregates` is `shared-report-builder.ts:840`. It groups by `h3_res9` across all hours, and rows exist only after the nightly cron.
  - The one hour-level variation (S4's bound times a stale hour-03 row, a window of seconds) is BE's loop-3 C2 note. It is already recorded.
- **Trigger 1 is owner-only, and its wording should change.**
  - The repo puts backyard events in build scope (ADR-022:15, Proposed; PO scope 2026-10-03). A backyard poster is at one household, but its scanners are guests.
  - The harm needs the plausible **scanners** of one placement to be one person or household. Proposed wording: "a deployment where a placement's plausible scanners are one person or household exists or is sold".

**R1-23, R4-01:** not my lens. Not re-checked.

## 4. Subject-created versus found-on-main (my lens's rows)

| Row            | M (main at baseline)                       | S (after ship)                               | Note                                            |
| -------------- | ------------------------------------------ | -------------------------------------------- | ----------------------------------------------- |
| R1-03          | no                                         | yes                                          | Main counts the open hour live                  |
| R2-02          | yes                                        | yes                                          | S4 changes timing, not existence                |
| R1-04 in-scope | yes (the false label is on S15's own page) | yes (S15's new promise beside it; AC1 blind) | Both. The leak itself is OSE-1787, out of scope |
| R1-16          | yes                                        | yes (ADR-026 sentence false; seed blind)     | Both                                            |
| R1-13          | yes                                        | worse (R1-03)                                | Both                                            |
| R1-15          | no                                         | yes (plan)                                   | S                                               |
| R2-06          | yes                                        | kept by AC5                                  | Both                                            |
| R2-20          | no                                         | yes                                          | S                                               |
| R3-12          | yes (silent design)                        | yes (new throw source)                       | **Both; the merge says S**                      |
| R4-06          | yes                                        | relied on (S15 AC5)                          | Both                                            |
| R4-07          | yes                                        | S15's lexicon edit unread                    | Both                                            |
| R4-08          | yes                                        | kept                                         | M                                               |
| R4-09          | no                                         | yes (plan)                                   | S                                               |
| R1-12          | yes                                        | the paragraph is swapped, still English      | Both                                            |

## 5. The post-freeze fix (#1073, R1-04, OSE-1787)

Options:

- (a) Score at the baseline and record #1073 as an environment fact.
- (b) Credit #1073 and withdraw or lower the row.
- (c) Score the in-scope half at the baseline, and record OSE-1787's mechanism as remedied on main.

New fact (source-read, `origin/main` 8439ae62, `recap-stat-lines.ts:43-51`):

- Main now prints "Fewer than 5 Walked in" for walk-ins of 5 or more whenever the remainder is 1 to 4. That line is literally false, on the same page.
- S15 AC1 reads neither `pages.ts` nor `recap-stat-lines.ts`.
- So S15's claim would still be false if it shipped on main today. **#1073 does not touch the in-scope defect.**
- It is also an instance of R1-13's root ("Fewer than 5" used for states that are not under 5) on main. That is an environment fact, not rated.

Recommendation:

- (c). R1-04's in-scope half stays High at the baseline, and it survives even option (b).
- OSE-1787's exact recovery is gone on main (record it; RC-01 stays the owner's).
- Apply the same rule to #1069: R1-19 is scored at the baseline, with Wave 0 item 1 recorded as overtaken.

## 6. Systemic promotion and cluster multipliers

**The pattern is a tally of two kinds of row, not one root.**

- **Criterion-rooted:** the only defect is that a check cannot fail. From my lens: R1-15, R4-06, R4-07 (and R1-07, R1-14, R1-27, R1-39, R1-40, R1-46, R2-11, R2-13, R2-14, R3-05, R3-11, R4-12 by their register text).
- **Product-rooted:** an independent harm whose missing check is a symptom. R1-03, R1-04, R1-16, R2-02 and R3-12 are mine, and R1-01, R1-08, R1-10, R1-23 and R2-25 fall the same way.
- **The tally is also incomplete.** My loop 3 named R1-04 (the sharpest case), R2-02 and R3-12 as uncatchable, and none of them is in the 31.

Recommendation:

- Promote one systemic root: "criteria scoped by enumeration (file lists, registries, seeded states, literal strings) and never watched red against the real fault". Collapse only the criterion-rooted rows into it.
- Product-rooted rows keep their own root and tier.
- Collapsing a product High into the pattern would let H4 promote High to Critical for harms whose test gap is incidental.
- Collapse also replaces many deductions with one, so it lowers the total. The scorer should state that effect (arithmetic direction only; no figure computed).

**Multipliers:**

- **C1:** hold. My surfaces carry no scan order.
- **C2: lower 2.0 to 1.5, over R1-03 and R1-13 only.**
  - H2 needs "enables or amplifies" (`ccr-protocol.md:472`).
  - The replay shows the report alone yields R2-02's bit. R1-03 adds no information to it; it only amplifies R1-13 (one word, three states).
  - R2-02 adds independently.
- **C3:** hold 2.0. With count 5, the "People scanning" step completes and the next step becomes "Share the report", so one person's reloads turn into an action. That is proven for the function; the miscount is inferred from R1-08.
- **C5:** hold 2.0 (capped).
  - Loop 2 placed R1-04's in-scope half "in C5", but no member list includes it.
  - `pages.ts:1553-1828` supports membership. The scorer must decide: it changes which deductions compound (+10 base), not the factor.
- **C6:** not my lens.

## 7. Per-loop score derivation

- **Two methods are on the table:**
  - "Rows open at the end of loop N" (loop 4's section 4.6).
  - "Rows discovered in loop N" (the brief).
- **The latter is more faithful.**
  - The checker asks for "exactly one: this loop's own result" (`ccr-worksheet-check.mjs` header).
  - The owner counts a defect once by root cause.
  - Under the run model nothing can be fixed between loops, so open-at-end lines can only fall. They then read as decay (protocol step 4) when they are discovery.
- **Method:**
  - Loop N's line deducts the rows first found in N: final tier, H1 at N, H3 and H5 per row.
  - The cumulative deducts all rows once, with H2 and H4 applied across loops.
  - The cumulative is then no better than any loop line, as the checker requires.
  - Section 3.3's re-weight does not apply: non-correction was the owner's rule, not the reviewers' choice.
- **Protocol gap:** H1 defines only loops 1 to 3 (1.0, 1.25, 1.5; `:463-465`, `:1762`, `:1769`). The scorer must state the factor for loops 4 and 5 (hold 1.5, or extrapolate). That is an owner ruling.

## 8. Convergence

My lens opened 10, 3, 1 and 4 lens ids in loops 1 to 4, then 0 subject roots in loop 5. No High in my lens changed tier in loops 3 to 5. What moved this loop is basis and evidence, not tiers:

- R1-03's basis and count;
- R1-16's basis and its condition;
- R2-02 and R4-06 widened;
- R1-04 strengthened.

The register is stable enough to score in my lens, provided R1-16's condition is corrected first. As written, it would downgrade a High on a stamp that cannot measure the window.

## 9. New findings

No new subject root. One run-conduct candidate for the lead:

- **RC-04 (proposed, Medium):** loop 3's 2.3 condition and owner read 3 key R1-16's downgrade to `computed_at`, which is stamped before the window it is meant to measure.
- Evidence: `shared-report.ts:726-728, 764-812, 907`; `shared-report-materialize.ts:54, 107-121`. Source-read.
- Closed when the condition and the owner read use `computed_at + duration_ms` (section 3).

## 10. Not checked, and why

- **Out of reach for this lens:**
  - D1 runtime, cron skew, Workers Logs content, and the actual T: platform facts, owner only.
  - R1-23, R4-01 and the other Highs outside my lens.
- **Not done this loop:**
  - Withheld words on the brand dashboards (`dashboards.ts:264, 560`): not enumerated.
  - How a throw at `poster-deployments.ts:298` renders.
  - Pool membership of `withheld-counts-in-words.spec.ts`.
  - The original wording of my loop-2 "6 vs 4" (not in the saved text).
- **Out of scope, recorded once:** OSE-1780, OSE-1783/1784/1787, OSE-1496, OSE-1699.

## 11. Commands run (all read-only; none refused; no file written)

- **Read:**
  - the brief; `frontend-integration.knowledge.md`;
  - `loop4/MERGED-loop4.md`; my loop-1 to loop-4 reports;
  - `ccr-protocol.md:30-45, 452-531, 570-609, 1745-1779`.
- **Bash, over the scratchpad:**
  - `ls -la`, `wc -l`, `sha256sum`;
  - `grep -rn` and `sed -n` over the merges (one `sed` failed on an unquoted range and was rerun quoted).
- **Bash, git in `ose-clock-gate`:**
  - `git rev-parse`, `git diff --stat 39a63d67 HEAD -- …/src`, `git status --short`;
  - `git grep -c`/`-n` at 39a63d67 over the a11y specs and workflows; `git ls-tree -r --name-only 39a63d67`;
  - `MSYS_NO_PATHCONV=1 git show origin/main:…/recap-stat-lines.ts | grep`.
- **Bash, source reads:** `sed -n` and `grep -n` over `admin.html`, `live-monitor.ts`, `sponsor-home-render.ts`, `scan-cells.ts`, `pre-event-activity.ts` (lib and handler), `poster-reach.ts`, `event-stats.ts`, `poster-deployments.ts`, `shared-report.ts`, `shared-report-builder.ts`, `shared-report-materialize.ts`, `index.ts`, `pages.ts`, `never-who.ts`, `count-floor.ts`, `wrangler.toml`, `migrations/0087`, ADR-022, `ccr-worksheet-check.mjs`, and docs greps for household or backyard.
- **Node, in memory only:**
  - `node -e`: the `oseEventView` replay (3 inputs) and `sqlite_version()`.
  - `node -` with the script on stdin: the SQL replay (failed twice before the corrected run: a CRLF needle miss, then a finalized statement); `floorNestedCounts` (failed once on a missing constant before the corrected run); `floorTotalOfParts([])`.
- No test run, no network call, no write, no branch, commit or stash.

Lead's note (not the agent's text): on the "6 vs 4" item, the lead confirms the agent's loop-2 hand-back was saved in condensed form by the lead; the agent's recount here (4 direct callers, 6 handler call sites through wrappers) supersedes whatever the lead wrote in loop 2.
