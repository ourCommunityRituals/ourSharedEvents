# Loop 5 (Recursive), Sr Data Scientist lens (`data-scientist`), epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus by the lead's override.

I give no score, no gate decision and no fixes.

- **Subject hash:** sha256 dd9b8522...b7f4 matches (proven).
- **Code baseline:** worktree `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate` at e7c8297b. `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src` is empty (proven). Main is at 8439ae62.
- **Paths:** paths below are under `workers/oursharedevents/src/` unless they start otherwise.

**Three things loop 5 found that the four loops got wrong**

1. **R1-16's lowering condition cannot work.**
   - `computed_at` is stamped when the nightly job starts, before the per-bucket write loop runs. The cell snapshot is inserted after that loop.
   - So the owner's read 3 would show `computed_at` within seconds of 03:00 every night, by construction. That would lower R1-16 without measuring anything (proven by reading the source).
2. **One reason given for keeping R2-02 below Critical is false.**
   - Loop 3 (2.1) and loop 4 (2.4) say only a mid-tier report token can read the map bit.
   - In fact `_meta` reaches every depth, and it carries the bit twice. The severity stays the same, but more readers can reach it.
3. **R1-10's "exact, not candidates" (loop 3, 2.4) overstates.**
   - The pairing of rows is exact. But a target known only by (poster, hour) still sits among the n keys of that cell.

## 1. Stability of each High in my lens

| Row                  | Evidence I re-checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verdict                                                          | Basis                                                | What the loops got wrong                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-02                | **Code.** D: `lib/shared-report-builder.ts:321-347` reads `scan_aggregates` per event-hour, dropping parts under 5 before summing. S: `:712-778` sums poster-hours of 5 or more and drops poster rows under 5. **Subject.** S15's sentence (:193). E.2 puts S15 in Wave 1; OSE-1784 blocks only S4. **Arithmetic re-run.** Single hour: (7,3) gives 3; (7,1) gives 1; (7,0) gives 0; (5,4) gives 4; (7,3) with one person at both gives 2; (3,3) gives 6 with both posters withheld. Two hours (7,3)+(3,3) give 9, which cannot be split.                                                                                                                                       | STABLE, High                                                     | arithmetic, source-read                              | My loop-2 example was stated without its conditions. D is a 03:00 stored snapshot (`lib/shared-report.ts:739-790`) and S is live (`builder:720-737`). So exact recovery needs a read after a snapshot that covers every event hour, and only one hour with D_h − S_h > 0. The M/S label is also off (see section 4).                                                                     |
| R1-04, in-scope half | **Code.** `handlers/pages.ts:1756-1762`. `lib/count-floor.ts:98-120`. Check-ins print exactly, with no rounding (`pages.ts:496-502`). **Arithmetic re-run.** c=6 gives exactly 1; c=7 gives 1 or 2; c=8 gives 1 to 3; c of 9 or more gives 1 to 4; c=5 never shows the label.                                                                                                                                                                                                                                                                                                                                                                                                   | STABLE at the baseline, High                                     | arithmetic, source-read                              | #1073 changed this on main: `lib/recap-stat-lines.ts:43-51`, read with PowerShell `git show origin/main:`. The walk-in line now reads "Fewer than 5 Walked in" even when walk-ins are 5 or more (false but safe). So S15's claim "public words say only what holds" is still false on main, in a narrower form. No loop said this.                                                       |
| R1-16                | **Code.** `lib/shared-report.ts:878-905`: DELETE then INSERT, with no upper bound on the hour. The map reads stored cells (`builder:835-845`); poster rows read live (`:720-737`). **Arithmetic re-run.** 22 pairs (stored a, live n ≤ 12) give a difference of 1 to 4, and every one needs a ≥ 5. 03:00 UTC is 19:00 PST to 23:00 EDT in the contiguous US (17:00 HST, 19:00 AKDT).                                                                                                                                                                                                                                                                                            | STABLE at High. The condition is REVISED (section 3).            | source-read, arithmetic. Reach is inferred.          | The `computed_at` condition is unsound. **Widening:** `scan_aggregates` is snapshotted with the same open-hour partial (`:739-790`, `INSERT OR REPLACE`, no upper bound). So `distinct_scanners` can also move by 1 to 4 between snapshots. Same root. The who-side half is OSE-1784's (loop-1 record 4); recorded once, not rated.                                                      |
| R2-02                | **Code.** `builder:854-881`: the branch turns on `cellData.length > 0`, and the corridor-map suppression entry is pushed only when a row exists. Zero rows are kept (`lib/shared-report.ts:872-905`). **Re-run.** 0 scans gives fallback; 1 and 4 give suppressed; 5 gives live. **New this loop:** `lib/report-depth.ts:48` puts `_meta` in the local list, and `filterReportByDepth` (`:161-196`) copies `_meta` whole. `builder:1031-1033` puts `suppression_reasons` and `materialized_at` in `_meta`. `materialized_at` is null exactly when the event has no `scan_aggregates` row (`builder:326-342`). The page fetches this JSON (`templates/shared-report.html:1053`). | STABLE at High. Reach REVISED.                                   | source-read, not run                                 | The decline's "mid-tier token only" is false. A local token reads the bit, and legacy sponsor tokens default to local (`report-depth.ts:15, :138-143`). It is still event grain, nightly, with no count.                                                                                                                                                                                 |
| R1-08                | `handlers/qr-scan.ts:177-187`: at the baseline the marker is written in every pepper state. `lib/rate-limit.ts:118-135`: the helper warns once, then falls back. Subject :245-246.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | STABLE at High. Subject-created only.                            | source-read                                          | My loop-2 leg ("S2 AC2 turns off a dedup that works today") is close to unreachable. Production refuses a missing ANON pepper at deploy, and S2 AC5 makes staging refuse it. R1-08 rests on AC3 alone: a short `RATE_LIMIT_KEY_PEPPER` set by a direct `wrangler secret put`. "Silent" is inferred: AC3 asks for no log, and the only existing warning sits in the fallback AC3 forbids. |
| R1-03                | S4 AC4 and AC5 (subject :309-310). Loop-3 information test: no small group leaks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | STABLE at High, as a false statement only. Subject-created only. | source-read                                          | Nothing new. AGENTS invariant 2 fixes "Fewer than 5" as the withheld words, so anything withheld for a reason other than size reads false by rule. That covers the open hour and #1073's nested case. This is the root of R1-13 and C2, not a new row.                                                                                                                                   |
| R1-10                | **Code.** `lib/scan-buffer.ts:101-137` writes placement then WHO in one batch. Migration 0101 has a UNIQUE index with `INSERT OR IGNORE`. **Arithmetic re-run** (closed form plus a seeded simulation, 20,000 trials). Mean candidate size after 1/2/3 events, then P(only the target): R=10, n=4: 4.00/1.90/1.27, 0/28/74%. R=30, n=4: 4.00/1.30/1.03, 0/71/96%. R=200, n=4: 4.00/1.04/1.00, 0/96/100%. R=10, n=2: 2.00/1.10/1.01. **New rows:** n=12, R=30: 12.00/5.03/2.48, 0/0/15%. n=12, R=200: 12.00/1.60/1.03, 0/54/98%.                                                                                                                                                 | STABLE at High. Wording REVISED.                                 | arithmetic, source-read. D1 rowid order is inferred. | One event names the target exactly only when n=1, or with an order clue inside the hour: the forms second on main until S7, or the KV expiry (C1). Otherwise it takes the cross-event intersection above. Loop 2's "at most 4" was not order-blind; it was right for withheld cells. My loop-3 "at most d+1" was wrong. S7 narrows main's name leg.                                      |

## 2. My own errors across four loops

| Loop | My claim                                                              | What was wrong                                                                        | Correct statement                                                                           |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | Assumption 2 and L1-DS-7: "3+3 → event-hour 6 published"              | It left out that D is snapshotted and S is live                                       | It holds for a read after a snapshot that covers the hours.                                 |
| 1    | L1-DS-10: the subject "misread" `rate-limit.ts:77,122-132`            | Likely my misreading: the subject's parenthesis names the fallback that AC3 forbids   | Withdraw the "misread" claim, wherever it is still carried.                                 |
| 1    | Assumption 3: a rank join on 12 of 12 browsers "recovered the poster" | True on the SQLite model, but recovering the poster is not identifying a named target | A target known by (poster, hour) has n candidates per event (section 1).                    |
| 2    | R1-02 worked example                                                  | Stated without conditions                                                             | Needs a single hour with a residual, read after the snapshot.                               |
| 2    | R1-04 High → Critical                                                 | Declined (loop-2 merge, 2.1)                                                          | I now agree (see after this table).                                                         |
| 2    | "Score C1 Critical via the correlation modifier"                      | The correlation multiplier scales the deduction; it does not change the tier          | Merge corrected it. I agree.                                                                |
| 2    | R1-16 as a C1 member                                                  | Its link is the snapshot, not row order                                               | Rejected by the merge. I agree.                                                             |
| 2    | R1-08: "S2 AC2 turns off a working dedup"                             | Close to unreachable (see section 1)                                                  | It rests on AC3 alone.                                                                      |
| 2    | R1-10: "a second point narrows to about 1"                            | Depends on pool size                                                                  | R=10 gives 1.90 after two events, R=200 gives 1.04.                                         |
| 3    | R2-02 Critical                                                        | Declined (loop-3 merge, 2.1)                                                          | I now agree on the record (see after this table), but the "mid-tier" reason must be struck. |
| 3    | R1-10 card, step 3: "candidates at most d+1"                          | Mixed up which row pairs with which and who the target is                             | The candidates are the n keys of the target's cell.                                         |
| 3    | R1-10 Monte Carlo used only cells of 1 to 4                           | An export holder sees raw counts at any n                                             | I added n=12 rows.                                                                          |
| 3    | R1-16 reach "first seconds after 03:00:00"                            | Assumed a short window                                                                | The window is the cron start plus the per-bucket loop, length unknown (section 3).          |
| 3    | R1-02 and R1-04: "the leak itself is Critical"                        | Stated as fact about out-of-scope rows                                                | It is an inferred judgement, with no rating here.                                           |
| 4    | `scan-cells.ts:22`                                                    | Wrong line                                                                            | `:21` (checked again).                                                                      |
| 4    | "22:00 CDT/23:00 EDT in summer-or-winter pairs"                       | Garbled; left out HST and AKDT                                                        | 19:00 PST to 23:00 EDT in the contiguous US; 17:00 HST.                                     |
| 4    | "R1-16 stays conditional on staging `computed_at`"                    | I endorsed a read that cannot settle it                                               | Section 3.                                                                                  |
| 4    | Invariant-7 row: "a mid token can difference where a local cannot"    | Right for R1-02. I did not check `_meta`, so I missed that R2-02 reaches local        | Section 1.                                                                                  |

**Do I now agree with the two declined proposals?**

- **R1-04 (loop 2, High to Critical): yes, I agree with the decline.** My proposal mixed up how severe the leak is with what the subject does wrong. The subject neither creates nor is chartered to fix the exact recovery; OSE-1787 holds it. Its own defect is S15's false claim and its narrow scope, and High fits that. One caveat: the lead set this boundary (RC-01). If the owner does not confirm it in writing, the exact half comes back at the baseline as Critical 15.
- **R2-02 (loop 3, High to Critical): yes, on the record.** The remaining reasons hold:
  - one bit per event, nightly, with no count;
  - a finer bit is already OPEN in OSE-1780;
  - "door equals person" is an inferred deployment fact.
    The "mid-tier token only" reason is false and should be removed from the decline.

## 3. Conditional rulings

- **R1-16: the condition is stated wrongly.**
  - **Evidence:**
    - `nowIso` is set at the start of `aggregateScanBuckets` (`lib/shared-report.ts:726-728`).
    - It is written into every `scan_aggregates` row (`:770-783`) and passed to `aggregateScanCells` at `:812`.
    - That call comes after the awaited per-bucket loop (`:764-797`).
    - The function runs as phase −1, first in the job (`handlers/shared-report-materialize.ts:50-58`).
    - The job's result, including `durationMs`, is thrown away (`index.ts:183-190`).
  - So `computed_at` sits near 03:00:00 every night whatever the loop's length. Seven nights of it would lower R1-16 without measuring the window.
  - **The right condition:** the time from 03:00:00 to the cells INSERT, at production-scale bucket counts. Staging has fewer buckets, so its loop is shorter.
  - **How to read it:**
    - the cron invocation's wall duration in Workers observability (a platform fact, inferred to be available; owner only); or
    - a staging comparison of stored hour-03 cells against a recount of `scan_placement_events` for hour 03, which needs traffic in that hour.
  - **Settled from the repo:** `computed_at` cannot measure the window.
  - **Unchanged:** the accuracy half stays at least Medium either way (loop 3, 2.3).
- **R2-02: the condition is right in substance.**
  - (a) Whether one placement equals one person: only the owner can settle this.
  - (b) A surface that shows the bit per hour without injection: I grepped the four `readEventScanCells` callers and the admin timeline. `admin.html:8164-8184` ticks `anyScans` only on a published count, and I found no per-hour branch that tells none from small. The grep was not exhaustive, so this is inferred.
  - A note, not a trigger: for a placement that stays up for many nights, the night the map state flips dates the first scan. That is a day-grain bit and stays below condition (b).
  - Strike "mid-tier only" from the decline.
- **R1-23:** in my lens it matters only as C1's third member, which raises C1 to 2.0 on triggers (a) to (c). Scope cannot be settled from the repo.
- **R4-01:** outside my lens. The split is stated correctly:
  - the repo settles that no age-prevention mechanism exists (merge-verified grep);
  - only "collection reasonably possible" is the owner's to answer.

## 4. Subject-created versus found on main (my lens)

| Row            | Main at 39a63d67                                                        | After the subject ships                                                                                  | Correction to loops 3 and 4                                           |
| -------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| R1-02          | The mechanism (D − S, OSE-1784's) and `admin-settings.ts:171`'s promise | The rated half: S15's public sentence (:193), with no wave edge to OSE-1784                              | Both. The rated sentence is created by S15, not only "found on main". |
| R1-03          | Absent                                                                  | Created by S4                                                                                            | None                                                                  |
| R1-04 in-scope | The label, at the baseline                                              | S15 leaves it, and AC1 does not scan `pages.ts` (:198)                                                   | Both                                                                  |
| R1-08          | Blocked (`qr-scan.ts:179`)                                              | Created by S2 AC3                                                                                        | None                                                                  |
| R1-10          | Rank join, plus the forms second as an order clue                       | S6 only measures it. S7 removes the forms second, so the name leg moves to the cross-event intersection. | Both. S7 narrows it.                                                  |
| R1-16          | The stored partial hour beside live poster rows                         | S4 labels the stale cell as sealed, and ADR-026 is false                                                 | Both                                                                  |
| R2-02          | Four channels, plus two `_meta` copies at every depth                   | S15's "below that it reads 'fewer than 5'" is false for the map. S4 edits this read without fixing it.   | Both                                                                  |

## 5. The post-freeze fix (R1-04 and OSE-1787)

**The options:**

- (A) Score the in-scope half at the baseline (High), and record #1073 as an environment fact.
- (B) Credit #1073 and drop or lower the row.
- (C) Score as in A, and add #1073 to the follow-up's closure evidence.

**I recommend A, with C's note.** Four reasons:

- The run model freezes both the subject and the baseline.
- The rated defect is S15's scope: the recap source is not in AC1's file list. #1073 does not touch that.
- On main, #1073's line still reads "Fewer than 5" for walk-ins of 5 or more. That is false but safe, so the claim fails on main too.
- Crediting merges made during the run would let changes made outside the run shape what gets scored. That is the same independence worry as RC-01.

**Apply the same rule to every post-freeze change:**

- #1069 makes Wave 0 item 1 stale, so R1-19 is worse. Record it; give no credit.
- #1076 is a test fix, also recorded only.

**OSE-1787:** out of scope, recorded once. #1073 is its fix on main, and its Done evidence is Linear's business. If RC-01 is not confirmed, the exact half is scored at the baseline, and #1073 is again recorded, not credited.

## 6. Systemic promotion and cluster multipliers

**The 31 rows are two roots plus noise, not one.**

- **Root A, the subject's born-red method.** Faults are injected into the criterion's own assertion, not into the regression the criterion should catch (subject C.0, :120).
  - **Rows that are only this defect (collapse them into one systemic row):** R1-14, R1-15, R1-27, R1-39, R2-11, R2-12, R2-13, R2-14, R2-22, R3-05, R3-11, R4-12.
  - **R1-46 is doubtful:** it is a criterion that fails for the wrong reason, not one that cannot fail.
  - **Keep R1-07 as its own row.** It is C3's enabling link: without it, nothing detects R1-08 or R2-03.
  - **Rows with a real defect plus a criterion leg:** R1-01, R1-03, R1-06, R1-08, R1-10, R1-16, R1-23, R1-41, R2-05, R2-18, R2-25. These keep their tiers. Their criterion leg is covered by the systemic row, with no second deduction.
- **Root B, controls on main that are advisory or scoped by a name list:** R2-15 (its cure), R2-17, R3-06, R3-08, R4-06, R4-07. This is a separate candidate, outside my lens, and should not be merged with A.

**How to promote faithfully.** The protocol treats one finding seen in N places as one row: breadth scalar log₂(N+1) (H3) plus a one-tier promotion (H4).

- Collapsing the members keeps their weight roughly equal to counting each one separately.
- Keeping the members and also adding a systemic row would count the same root twice.

**Cluster multipliers:**

| Cluster | Call                                                   | Reason                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1      | **Hold 1.5**; 2.0 only on an R1-23 trigger             | Combining gives (browser, poster, second) and then a name. After S7 the KV-expiry leg survives, because S2 does not touch the TTL.                                                                                                                                                                                                      |
| C2      | **Lower to no multiplier**                             | Loop 3's test of whether combining helps an attacker failed (DS, FE and QA). The members share a cause, but they are different mechanisms that neither enable nor amplify each other (H2), and they are not the same finding (H4). Weight for "false statements to a regulator" belongs to C5; counting it here too would double-count. |
| C3      | **Hold 2.0**                                           | R1-07 removes the only detector for R1-08 and R2-03. Loop 3's worked case stands.                                                                                                                                                                                                                                                       |
| C5      | **Hold 2.0** (capped)                                  | R1-02's member is S15's sentence. R4-01 is related, not a member; the multiplier is capped either way.                                                                                                                                                                                                                                  |
| C6      | **Outside my lens; hold** on the SDET and OPS evidence | My loop-3 test found an evidence-integrity gain, not a data-exposure gain.                                                                                                                                                                                                                                                              |

## 7. Deriving a score for each loop

Loop 4's method is mostly faithful. Points to add:

- **Loop position by discovery loop is the faithful reading.** Section 3.3's re-weighting (`ccr-protocol.md:593-604`) rests on "choosing not to fix", and the owner's model forbids fixing between loops.
- **There is no loop-position constant past loop 3.** H1 defines only 1.0, 1.25 and 1.5 (`:461-465`, `:1762`, `:1769`). R4 rows, and any loop-5 row, have none.
  - I recommend capping at 1.5 and saying so. Inventing a larger constant is a protocol change: 5 or more loops, with a human gate.
- **What each loop counts:** the rows present at that loop, at their final tier, so each root costs the same everywhere and is counted once. Clusters count only the members present at that loop. Systemic promotion uses the final register's structure.
- **The cap of 70** (environmental assumptions not verified) applies from loop 2 on, the loop that first named the unverified token scope (loop-2 merge, 2.4).
- **Disclose in the worksheet** that no loop ran its gate. Step 4's stop rule (`:42`) never fired, and the checker cannot see that.
- **The checker's ordering rule holds.** Rows are only ever added, so the derived scores never rise. The cumulative score equals the loop-5 figure and is no better than the worst loop.

## 8. Convergence

- **New roots in my lens by loop:** 13 ids in loop 1; 4 in loop 2 (one High, R2-02); 0 in loop 3; 3 Low in loop 4; 0 in loop 5.
- **Tiers:** none has moved since loop 2 raised R1-16 to High.
- **What loop 5 moved:**
  - R1-16's planned way to Medium does not hold, so it stays High until a valid read.
  - R2-02 reaches more readers, at the same tier.
  - R1-10's wording is narrowed.
- **Ready to score?** My rows can be scored, provided the scorer adopts the restated R1-16 condition and strikes "mid-tier only" from R2-02's decline.

## 9. New findings

**None.** Two existing roots got wider, both recorded in section 1:

- R1-16 now also covers `scan_aggregates`. Its who-side half is OSE-1784's, recorded once.
- R2-02 now also reaches readers through `_meta`.

One more fact, recorded as evidence for section 3 and not as a row: `computed_at` stamps the job start, not the snapshot moment (`lib/shared-report.ts:728, 812`). For cells it is an internal column; the cell reader never publishes it.

## 10. Not checked, and why

- **Platform facts** (no platform access): KV expiry listing, Workers Logs, the cron's wall duration, D1 rowid order on the live platform, production migration levels.
- **No spec run and no real function called.** The arithmetic re-implements `floorTotalOfParts`, `floorNestedCounts` and the map branch in memory.
- **BigQuery grain and H3 limited to res 7 and 9:** carried from loops 2 and 4, not re-run.
- **Other lenses' Highs:** R1-05, R1-06, R1-07, R1-09, R1-23, R2-01, R3-03, R4-01.
- **Whether a local token receives `_meta` at runtime:** source-read only.
- **The search for a per-hour none-versus-small surface:** grep only, not exhaustive.
- **Linear and ROLE-STATE:** not read.
- **Where L1-DS-10 is carried now:** not traced.

## 11. Commands run (all read-only; none refused)

- **Read tool:**
  - the brief;
  - `loop4/MERGED-loop4.md` in full;
  - my four reports (loops 1 to 4) in full.
- **Bash:**
  - `ls`, `wc -l` and `sha256sum` on the scratchpad folders and the subject;
  - `grep -n` and `sed -n` over `loop2/MERGED-loop2.md` and `loop3/MERGED-loop3.md`;
  - `grep -n` and `sed -n` over the subject (lines 186-200, 500-530, 593-600, plus greps);
  - `grep` across the loop reports for `scan_aggregates`.
- **In `ose-clock-gate` (Bash):**
  - `git rev-parse HEAD` and `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src`;
  - `sed -n` over `scan-cells.ts` 1-25 and 40-110;
  - `sed -n` over `shared-report-builder.ts` 266-278, 318-350, 384-408, 712-780 and 828-900;
  - `sed -n` over `shared-report.ts` 694-760, 760-838 and 840-915;
  - `sed -n` over `pages.ts` 490-512 and 1745-1776;
  - `sed -n` over `count-floor.ts` 25-175;
  - `sed -n` over `qr-scan.ts` 160-200 and `rate-limit.ts` 70-135;
  - `sed -n` over `report-depth.ts` 25-70 and `filterReportByDepth`;
  - `sed -n` over `shared-report-materialize.ts` 35-100 and the `index.ts` caller;
  - `grep` for `readEventScanCells`, `scan_cell_aggregates`, `suppression`, `materialized_at`, `fetch(`, `durationMs` and line numbers.
- **In `ourSharedEvents` (Bash):**
  - `sed -n` over `.claude/skills/ccr-protocol.md` (30-48, 360-375, 452-560, 586-606, 1428-1470, 1750-1775);
  - `git log origin/main`;
  - `powershell.exe git show origin/main:workers/oursharedevents/src/lib/recap-stat-lines.ts`.
- **`node -e`:** one run, in memory only, with no file or network access. It covered the recap enumeration, D − S, the R1-10 closed form plus a seeded simulation, the 03:00 UTC zone offsets with the R1-16 reach pairs, and the R2-02 branch.
- **Nothing written:** no repo writes, no branch, commit or stash, no test run, nothing against staging or production.
