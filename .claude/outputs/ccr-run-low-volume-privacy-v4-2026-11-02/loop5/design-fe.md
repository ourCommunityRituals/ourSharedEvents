# Loop 5 (Recursive), Sr Design FE lens (`design-fe`), epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim. This lens ran on Opus by the lead's override.

It gives no score and no gate decision.

**Basis tags:** proven, arithmetic, source-read, inferred. Every legal reading is inferred.

**Setup checks:**

- Subject hash: `dd9b8522…7f4`, matches.
- Code: `ose-clock-gate` at e7c8297b. `git diff --stat 39a63d67 HEAD -- workers/oursharedevents/src` is empty.
- Main is at 8439ae62, nine commits past the baseline.

**Model.** This loop ran on Opus. Loops 1 to 4 of this lens ran on Sonnet (merge 0 j, RC-02). Some of the errors in section 2 may come from that; I do not claim they do.

## 1. High stability table

| Row   | Claim re-checked at the baseline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Basis                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| R1-02 | S15's `/privacy` sentence ("at least 5 scans at one poster in one hour") would be false when it ships. `distinct_scanners` sums event-level `scan_aggregates` buckets (`shared-report-builder.ts:321-347`). S15 is blocked only by "Wave 0; the owner's approval of the words" (subject :196), with no OSE-1784 edge.                                                                                                                                                                                                                                                                                    | STABLE: High; NOT REGULATORY (section 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | source-read; DS arithmetic not re-run by me |
| R1-03 | S4 drops the open hour. An event whose scans are all in the open hour sums zero parts, and `applyCountFloor` then returns suppressed (`count-floor.ts:36-41, 53-60`). That renders as: "Held" with the title "Fewer than 5 so far" (`live-monitor.ts:124-125`); "Fewer than 5 scans in any hour" (`admin.html:6864`); "fewer than 5 poster scans in any one hour" (`:8367`); "fewer than 5 poster scans" (`sponsor-home-render.ts:116, 133`); and "Fills in once people start scanning" (`admin.html:8176`). AC4 and AC5 cover two surfaces.                                                             | STABLE claim and tier. **Basis REVISED:** "proven" covers only the rendering of a suppressed value (FE ran `oseEventView` on main). That S4 produces a suppressed value for 80 open-hour scans is source-read of the plan plus arithmetic.                                                                                                                                                                                                                                                                                                      | proven (render) + source-read + arithmetic  |
| R1-04 | `pages.ts:1756-1763`: the label prints only when the walk-ins are withheld while they clear the floor, i.e. a gap of 1 to 4. `git grep -c "cannot be worked out" 39a63d67` gives 1. On origin/main the line is `recap-stat-lines.ts:48-51` and the label is gone. S15 AC1 scans only `never-who.ts`, `privacy.ts` and `docs/` (subject :198).                                                                                                                                                                                                                                                            | STABLE at the baseline. See section 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | proven (L2 run), source-read, git grep      |
| R1-05 | `privacy.ts:58` says "no personal data is stored", but `forms.ts:441-448` writes `last_anonymous_id`, a per-event keyed id. The second copy is at **`form-pages.ts:114`**, not `:104` as I cited in loop 4 (the loop-4 merge carried `:104`).                                                                                                                                                                                                                                                                                                                                                            | STABLE: High; NOT REGULATORY under the protocol's text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | source-read; legal inferred                 |
| R1-06 | `privacy.ts` has 0 "cookie" hits. `/q` sets a one-year cookie on its 302 (`qr-scan.ts:261`; `anonymous-id.ts:44-49`), and the forms set it on POST responses (`forms.ts:325, 468, 518, 573, 603`). **But** two cited texts are literally true. (1) The event body's "nothing ... was collected to display this page" (`never-who.ts:54-55`): the event page reads no cookie (`pages.ts:1961`, grep). (2) `admin-settings.ts:178-179`, "Public pages set no cookies", renders only on the **admin** settings screen (its sole importer is `admin-screens.ts:25`), and no GET page response sets a cookie. | **REVISED (claim).** The row says "cookie text false". The defect is really an undisclosed cookie. The false sentence is `privacy.ts:55` ("only what is needed for the specific form you submit"); it turns the omission into a misstatement. S15 adds a scan section that omits the identifier the scan sets, and AC1's scope is narrower than its goal. The only literally false public sentence near the cookie is "counted as a single click", which S15 already replaces. The tier holds at High, at its lower edge; Medium is defensible. | source-read                                 |
| R2-02 | `shared-report-builder.ts:860-891`: if some cells exist but none has 5 or more, the source is `'suppressed'` with `cell_count: 0`; with no cells it falls back with 7 cells (`:817`). The heading and body differ (`shared-report.html:1246-1260`). The suppression strings differ (`:822-826` against `:865`).                                                                                                                                                                                                                                                                                          | STABLE: High; four channels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | source-read (FE's L3 replay was proven)     |
| R4-01 | `privacy.ts:111-123`: the HIPAA and COPPA addenda are static and render on every view. `:126` is dated 2026-04-23. No age mechanism exists; `pii.ts:12` names "COPPA age-gating" as a future extension.                                                                                                                                                                                                                                                                                                                                                                                                  | STABLE: High over BA's Medium. The sentence "For events open to children under 13" applies to tier-1 events, and the parental-submission rule it states has no mechanism. Regulatory stays open on the extension trigger (section 3).                                                                                                                                                                                                                                                                                                           | source-read; legal inferred                 |

**Non-High rows this recursion corrects:**

- **R4-06's inline-link clause is withdrawn.** It said "Inline links on `/privacy` carry no 44 px rule (inv 8, by its letter)". AGENTS invariant 8 maps to brain #14, and #14's standard exempts inline text-flow links in writing (`OCR-docs/docs/standards/OCR_STANDARD_mobileWorkability.md:19-30`, refined 2026-05-16 by OCR-42). The `/privacy` links are inline inside `<p>` or `<li>` (`privacy.ts:51, 77, 90, 96, 98, 123`).
- So conformance line 8 changes from "VIOLATES by letter" to "CONFORMS: tokens, one h1 and inline links; coverage NOT ADDRESSED (R4-06, line 21)". The VIOLATES count drops from 24 to 23.
- R4-06 stays Medium on its coverage half. `a11y-axe.spec.ts` has 17 `scanPage` calls and none is `/privacy`. `event-page-choices.spec.ts:146` uses `/privacy` only as a referrer.

## 2. My own errors across four loops

| Loop | Claim                                                                                                                                                  | What was wrong                                                                                                                                                                                           | Correct statement                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4    | R1-05, R2-04 and R1-06(b) are REGULATORY; R1-02 is conditionally Regulatory                                                                            | Given under the lead's gloss. I did not read `ccr-protocol.md`.                                                                                                                                          | Under `:37`, `:386` and `:1281` ("Federal legal obligation (HIPAA, COPPA)"), plus section 10 (HIPAA and COPPA only), all four are **NOT REGULATORY**. GDPR is not a federal obligation and the protocol has no GDPR extension. |
| 4    | "The product took Art. 13 on in writing"; ADR-018 "CONFORMS ... so Art. 13 stays a duty taken on"                                                      | A legal conclusion stated as fact and as a conformance verdict. Citing an article in headings is not a duty. GDPR's territorial scope (Art. 3) for a US hyperlocal product was never tested by any loop. | Source-read: the page cites Art. 13 and 6. Whether any duty follows is inferred and untested.                                                                                                                                  |
| 4    | "WCAG 2.5.8's inline exception is an inferred mitigation"; inline links "VIOLATE by letter"                                                            | The exemption is written in the org standard (above).                                                                                                                                                    | CONFORMS for inline links.                                                                                                                                                                                                     |
| 4    | Second "no personal data" line at `form-pages.ts:104`                                                                                                  | Wrong line                                                                                                                                                                                               | `form-pages.ts:114`                                                                                                                                                                                                            |
| 4    | `admin-settings.ts:179` "where it renders is inferred"                                                                                                 | Settleable read-only, and I did not settle it                                                                                                                                                            | It renders on the admin settings screen only (`admin-screens.ts:25`). It is organizer-facing, not public.                                                                                                                      |
| 1, 2 | `admin-settings.ts:178` given as evidence of public cookie text, including in the Spanish attendee's path (L2 section 1)                               | That attendee never sees the admin screen                                                                                                                                                                | Remove it from the attendee path. It is an organizer-facing omission.                                                                                                                                                          |
| 1    | Assumption 3: "nothing about your device ... was collected" is FALSE beside the `/q` cookie                                                            | Too strong. "To display this page" is literally true; the event page reads no cookie.                                                                                                                    | The sentence misleads in context. It is not literally false.                                                                                                                                                                   |
| 1    | L1-DES-4: "Regulatory 25 if counsel treats a keyed id as personal data"                                                                                | Wrong bar: a GDPR reading cannot make the protocol's Regulatory tier                                                                                                                                     | NOT REGULATORY. The FTC Act s.5 route was never tested (section 3).                                                                                                                                                            |
| 1    | "S15 is blocked only by Wave 0"                                                                                                                        | It left out the owner's word approval (subject :196)                                                                                                                                                     | Wave 0 plus F-12. Neither is OSE-1784.                                                                                                                                                                                         |
| 1    | "TRUE: design rules held ... 44 px targets (`.back`)"                                                                                                  | `.back` is 44 px but likely dead (R2-29). The inline links were not examined.                                                                                                                            | 44 px holds for the summary and live nav. The `.back` effect is inferred. Inline links are exempt.                                                                                                                             |
| 2    | R1-13: the hover `title` "now also hits **S4's new** 'Fewer than N so far'"; repeated in L3 C2 as "S4's hover title"                                   | The title is on main (`live-monitor.ts:125` at the baseline). S4 does not add it.                                                                                                                        | The existing title becomes false under S4 (R1-03). It is not new text.                                                                                                                                                         |
| 2    | R1-02: the `/privacy` sentence "is false on main"                                                                                                      | S15's sentence is a draft, not on main                                                                                                                                                                   | It would be false if shipped against main's figures.                                                                                                                                                                           |
| 2    | "Checked and clean: ... layout at 320 px, no overflow"                                                                                                 | Read from CSS only, so not checked                                                                                                                                                                       | 320 px is inferred from the CSS. Not rendered.                                                                                                                                                                                 |
| 2    | R1-12 "raise to Medium-high"                                                                                                                           | Not a tier (the merge corrected it)                                                                                                                                                                      | Medium                                                                                                                                                                                                                         |
| 3    | `never-who.ts:62` (font-size) and `:73-81` (the `<details>`)                                                                                           | Wrong lines                                                                                                                                                                                              | `<details>` at `:68-73`; CSS at `:84` (0.95rem, `--text-muted`) and `:85` (44 px summary)                                                                                                                                      |
| 3    | Spark bar: "its only 'held' label is an SVG `<title>`"; `role=img` plus `aria-label` "hides" it; the total is "an understatement presented as a total" | Partly wrong. The `aria-label` (`admin.html:8447`) speaks today's held state and defines "held". Summing only published days is the code's own drop-before-sum rule (OSE-683).                           | Past held days show only through a hover `title`, a 1.2 px bar at 0.3 opacity (arithmetic). The invariant-2 defect is the all-held case, which reads "0 on the days shown". R1-13 stays Medium.                                |
| 3    | C5: "a notice false in four ways reads as bad faith"                                                                                                   | An inference stated as fact                                                                                                                                                                              | A reader effect, inferred. It is weak support for 2.0 (section 6).                                                                                                                                                             |
| 3    | C5 example: "10 − 7 = 3"                                                                                                                               | Borrowed DS arithmetic, not re-derived. `distinct_scanners` counts distinct people per bucket, against scans per poster.                                                                                 | Inferred from DS. Exact only when no person scans both posters in the hour.                                                                                                                                                    |
| 3    | C2: "combining R1-03 and R2-02 gives more" (the sponsor's prior)                                                                                       | Fails H2's "one enables or amplifies the other". R2-02 alone gives the bit (merge 3).                                                                                                                    | Withdrawn as support for C2 at 2.0 (section 6).                                                                                                                                                                                |
| 3    | "I did not recount the '3 hits in each' Design FE counted in loop 3"                                                                                   | Misattributed. The count is in the subject (C.4 AC3). I counted 1 per file myself in loop 1 (merge D2).                                                                                                  | The subject's AC3 premise is false (R1-46).                                                                                                                                                                                    |
| 3, 4 | R2-21 accepted as "created by shipping" (merge 3 list)                                                                                                 | `var(--warning,…)` is at the baseline (`live-monitor.ts:59`)                                                                                                                                             | Found on main (section 4).                                                                                                                                                                                                     |

## 3. Conditional rulings

**R2-02. The condition is stated correctly, but it is incomplete.**

- **Trigger (a), door equals person:** only the owner can settle it.
- **Trigger (b), a per-hour surface without injection:** not met in what I re-read.
  - Live tiles, day cards, the spark bar and poster cards read 0 and 1 to 4 the same.
  - Empty days floor to suppressed (`scan-cells.ts:118-121`).
  - The map reads nightly-materialized cells, so there is no hourly flip.
  - That rests on the surfaces I re-read; I did not re-read all 13.
- **A refinement:** loop 3's "mid-tier token only" argument against Critical understates who reads it. The report exists to be shared ("Ready to share with the venue and sponsors", `admin.html:8176`). The tier stays where it is; the actor set should be named as "everyone the organizer shares it with".

**R4-01. The condition is the right one, and repo facts lean toward it being met** (inferred).

- The extension's trigger (`:1432`) is the protocol's own rule, not a legal finding. The run can settle it from facts.
- Facts found:
  - No age determination exists (grep; `pii.ts:12`).
  - The forms collect a name and email at general events. The forms routes set a one-year persistent identifier on submit (`forms.ts:325` and others).
  - The UEC code set includes a `School` vertical, and the CHECK-IN code lists it (`uec/uec-codes.ts:81, 251`). Whether an organizer can tag an event School today was not traced.
  - S7 edits the forms writers, so this review "touches" the collection system.
- The only way the trigger fails is if collection is "not reasonably possible". That is a deployment judgment for the owner.
- If it applies: three Regulatory base items open, the ceiling is 60, and the gate cannot pass. R4-01's text is then evidence that the base item "COPPA-compliant notice" is unmet.
- The protocol's sentence "Actual knowledge is not a defense" may overstate the statute (inferred). The protocol's trigger governs the tier either way.

**A tier test the run never ran (not a row).** Every Regulatory test (mine and the merges') read "federal" as HIPAA, COPPA or nothing. FTC Act s.5 (deceptive practices) is federal, and loop 1's merge named it for R1-02. Under the protocol's literal "Federal legal obligation", the candidates would be the literal false statements R1-05 and R4-01, not R2-04 or R1-06 (structure and omission). This is a legal reading, inferred; it is the owner's to rule.

**R1-23 and R1-16:** not my lens. No design evidence bears on either.

## 4. Subject-created versus found on main (my lens's rows)

| Row          | L3/L4 class       | My check                                                                        | Correct class                                                |
| ------------ | ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| R1-02        | M                 | Plan sentence plus the main figures                                             | Both: the falsity arises only when S15 ships before OSE-1784 |
| R1-03        | S (S4)            | Confirmed                                                                       | S                                                            |
| R1-04        | M                 | Label at the baseline; S15 omission                                             | Both: label M, scope miss S (plan)                           |
| R1-05        | M, S              | `privacy.ts:58`, `form-pages.ts:114`                                            | M (S keeps it)                                               |
| R1-06        | M, S worse        | Narrowed (section 1)                                                            | Both: omission M; S15's new section adds it in S             |
| R1-11        | S                 | Plan sentence                                                                   | S                                                            |
| R1-12        | M                 | `pages.ts:1067`; S15 AC4 keeps it                                               | M                                                            |
| R1-13        | M                 | Confirmed; #1073 adds a meaning on main (section 5)                             | M                                                            |
| R1-39, R1-44 | S (plan)          | Confirmed                                                                       | S                                                            |
| R2-02        | M, S              | S4 edits the read; S15's sentence false for the map                             | Both                                                         |
| R2-04        | **S (L3 list)**   | `:55`, `:62`, `:66`, `:126` contradict the code and `form-pages.ts:139` on main | **Both** (correction)                                        |
| R2-05        | M                 | Confirmed                                                                       | M                                                            |
| R2-06        | M                 | `admin.html:8172`; S4 AC5 keeps it                                              | M                                                            |
| R2-20        | S                 | Confirmed                                                                       | S                                                            |
| R2-21        | **S (L3 list)**   | `live-monitor.ts:59` at the baseline                                            | **M** (correction)                                           |
| R2-22        | S (plan)          | Confirmed                                                                       | S                                                            |
| R2-29        | M                 | `privacy.ts:46`, `:135`                                                         | M                                                            |
| R4-01        | M                 | Confirmed                                                                       | M (S15 leaves it)                                            |
| R4-06        | M; S relies on it | Confirmed                                                                       | M                                                            |

## 5. The post-freeze fix (R1-04, OSE-1787)

**Facts:**

- At the baseline the label exists (count 1).
- On main, #1073 removed it.
- Main's text now reads "Fewer than 5" for a walk-in count of **5 or more** when the remainder is 1 to 4 (`recap-stat-lines.ts:43-46`, the code's own comment). The leak became a false withheld word, which is the R1-13/C2 class.
- S15 AC1 still does not scan the recap file on main.

**Options:**

- **(a)** Score R1-04 at the baseline (High) and record #1073 as an environment fact.
- **(b)** Credit the fix and drop the in-scope half.
- **(c)** Split it: credit the label, and score the AC1 scope miss alone.

**Recommendation: (a).**

- The subject did nothing to make S15's "public words say only what holds" true. Crediting main's drift would let the environment score the subject.
- The same rule must apply symmetrically. #1069's merge should not have counted toward R1-19 being "worse", nor main's nine commits toward R1-25 or R1-32. No tier moved on those, so the score is unaffected.
- Record #1073's new wording as an environment fact under R1-13, not scored.

**OSE-1787:**

- It stays an out-of-scope record. #1073 cites OSE-1752, not OSE-1787. I could not read Linear.
- Fixing the mechanism on main does not settle RC-01: the scorer still set the scope boundary. The owner must confirm OSE-1787's scope in writing, and its state.

## 6. Systemic promotion and cluster multipliers

**H4 is not one root.**

- H4 (`:497-508`) promotes "the same finding" seen in 3 or more locations. The 31 rows are distinct roots that share a property.
- Collapsing them into one promoted finding would cut the deduction, which runs against H4's intent. Many of them (R1-03, R1-06, R1-07, R1-08, R1-10, R1-16, R1-23) carry harm of their own.
- My lens shows **two mechanisms**, each in 3 or more places:
  - **(A) A source-text substring is the oracle:** S15 AC1, S15 AC2, the S15 staging curl, S16 AC1/AC2, and the lexicon gate (R4-07).
  - **(B) Surfaces are listed by name:** S15 AC5's a11y suite, S4 AC4/AC5 (2 of 13 surfaces), AC1's three files, and S4 AC2's registries.
- **Recommendation:** promote per mechanism, and only for rows whose root _is_ the criterion.
  - Under A: R2-22, R4-07, R2-10 (the substring leg) and R2-05 (the DOM-presence leg, from L3-FE-1).
  - Under B: R4-06, R1-15 and R1-39.
  - Highs with their own harm stay separate rows.
  - The other lenses own the remaining mechanisms (seeds, name-only gates).

**Clusters:**

- **C2: LOWER from 2.0 to 1.5.** R1-13 enables R1-03, because the open hour falls into an already overloaded word. R2-02 is a different mechanism: two states where one is required, needing no vocabulary. It is related, not a member. My loop-3 combination argument is withdrawn.
- **C5: HOLD 2.0 on three members:** R1-05, R2-04 and R1-06. One document and one reader. `:55` (R2-04) turns R1-06's omission into a misstatement, which is causal. R1-02 leaves: it is a code-grain mechanism and conditional on wave order. It becomes related. Not Regulatory under the protocol's text.
- **C1, C3, C6: no design evidence; hold.** R2-06's "People scanning" stays related to C3, not a member.

## 7. Per-loop score derivation

- **Faithful to the owner's model:** each loop's score is computed over the rows **open at the end of that loop** (cumulative). Each row carries **one** H1 multiplier, fixed by its discovery loop, and the same final H2 to H5 set and caps apply to every loop's set.
  - Rows count once, by root cause.
  - Scores cannot rise between loops, since nothing was fixed.
  - The loop-5 figure equals the cumulative, which meets the checker's "no better than the worst loop".
- **Less faithful:** scoring only the rows discovered in each loop. That measures each loop's yield, not the subject's state after the loop.
- **Two gaps both proposals miss:**
  - **(1)** H1 defines constants only for loops 1 to 3 (`:462-466`). Loops 4 and 5 need a stated rule, such as capping at 1.5; it must not be invented silently.
  - **(2)** Section 3.3's non-correction penalty assumes fixes were possible. The owner's model forbade them, so discovery-loop multipliers are faithful and 3.3 is not. The owner rules on the CONFLICT (merge 4.5).
- The Tier-1 cap of 70 for token scope applies to every loop where R1-23's scope was unverified, which is all of them.
- I computed no score. Loop 1 alone carried 12 Highs, so the method changes the reasoning more than the position against 95.

## 8. Convergence

My lens's new roots fell from about 7 (L1) to about 4 (L2), then 0 (L3: both ids merged into existing rows), then 1 shared (L4: R4-06), then 0 (L5). No High in my lens changed tier in five loops. Loop 5 does three things:

- narrows R1-06's claim, keeping the tier;
- revises R1-03's basis label;
- withdraws R4-06's inline-link clause, which drops one VIOLATES line.

The open items are owner facts: R4-01's COPPA trigger, R2-02's door question, RC-01. The register in my lens is stable enough to score once the scorer records the corrections in sections 1, 2 and 4.

## 9. New findings

None filed. Three observations, not rated:

1. The `/privacy` h1 is the wordmark and the page title is a `<p>` (`privacy.ts:42-43`). This is on main, Low, and discovery is over.
2. The yaml #14 summary says "text font-size ≥ 16 px" (`architectural-invariants.yaml:1236`), but the standard's contract 3 says input font-size. This is org-brain drift, R4-15's class.
3. #1073's main wording (section 5) is an environment fact.

## 10. Not checked

- **Nothing was run:** no browser, axe, 320 px, tablet or TV render, theme check or contrast measurement. Every layout claim is read from CSS.
- **Not re-read this loop:** the other 13-surface sites beyond the six above, and `form-pages.ts` beyond lines 102-140.
- **Not traced:**
  - whether an organizer can tag an event `School`;
  - Linear's OSE-1787 state;
  - GDPR's Art. 3 applicability;
  - FTC s.5 materiality.
    Each is a platform or legal fact, inferred or owner-only.
- **Other lenses' Highs:** R1-01, R1-07 to R1-10, R1-16, R1-23, R2-01, R3-03.

## 11. Commands run

All read-only. None was refused. No writes, no tests, no branch, commit, stash or network call.

- **Read:** BRIEF-loop5; MERGED-loop4 and MERGED-loop3 (full); my loop-1 to loop-4 reports (full); spine `HANDOFF.md` (full) and `README.md` (lines 1-120); subject C.4 and C.10.
- **Bash, scratchpad:**
  - `ls`, `wc -l`, `sha256sum` on the subject;
  - `grep` of MERGED-loop1 and MERGED-loop2 for my lens's rows;
  - `grep` and `sed` of the subject.
- **Bash, `ourSharedEvents`:**
  - `sed -n` and `grep` on `.claude/skills/ccr-protocol.md` (`:30-45`, `:380-392`, `:452-530`, `:591-605`, `:1276-1285`, `:1425-1475`);
  - `git rev-parse origin/main`, `git log 39a63d67..origin/main`;
  - `git grep` on origin/main and 39a63d67 for the recap label and `recap-stat-lines.ts`.
- **Bash, `ose-clock-gate`:**
  - `git rev-parse`, `git diff --stat`, `git status`;
  - `sed -n` and `grep` over `live-monitor.ts`, `scan-cells.ts`, `count-floor.ts`, `sponsor-home-render.ts`, `admin.html`, `pages.ts`, `privacy.ts`, `form-pages.ts`, `forms.ts`, `never-who.ts`, `admin-settings.ts`, `qr-scan.ts`, `anonymous-id.ts`, `shared-report-builder.ts`, `shared-report.html`, `uec-codes.ts`, `router.ts`, `briefing.ts`, `pii.ts`;
  - tests: `a11y-axe.spec.ts`, `event-page-choices.spec.ts`; the workflows grep.
- **Bash, elsewhere:** `grep` of `packages/ui/src/tokens.ts`; `grep` and `sed` of `OCR-docs/ocr-docs-brain/architectural-invariants.yaml` and `OCR-docs/docs/standards/OCR_STANDARD_mobileWorkability.md`, plus `git log -1` on that file.
