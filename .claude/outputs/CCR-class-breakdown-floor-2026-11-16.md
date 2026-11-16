# CCR: SharedReport class breakdown floor (PR #1344, OSE-2089)

Date: 2026-11-16. Reviewer: Claude Code (the author of the change), with four independent role agents in loop 1.

## Verdict

| Item                         | Result                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Classification               | Security fix (count floor): 3 to 4 loops                                                         |
| Loops run                    | 1 of 3. Stopped at the loop 1 gate, as the protocol requires                                     |
| System score, arithmetic     | **58%** (100 − 42)                                                                               |
| System score, with the floor | **0%** if finding F1 is ruled a Security Critical (no partial credit). That ruling is question 1 |
| Score for what the PR added  | 73% (F1 and the other pre-existing findings left out). Shown for information; it is not the gate |
| Assessment confidence        | High on F1, F2, F3 (each proven at runtime). Medium on F4 to F10 (source read)                   |
| Gate                         | **Not passed. Human gate.**                                                                      |

What held: no reviewer found a way to read a count under 5, or a 0, for a class total through any route. The builder arithmetic is unchanged apart from 0 becoming null. Nothing stores or caches a built report. The new tests can fail and are run by named CI jobs.

Status of the change: PR #1344 was merged to `main` as `f6613e2` at 17:02 UTC, while loop 1 was still running. The post-merge staging chain for it has not been read (the newest `main` runs were pending at the time of writing).

## A. Setup

- Discipline: Security, with Engineering, QA and Design lenses. Level: Feature.
- Under review: commit `f4ccddb` (squashed to `f6613e2`): `sponsor_class_breakdown.*.total_displays` is null, with a note, when no (sponsor x surface) row of a class reaches 5; the page prints "Fewer than 5 …".
- Why it matters: AGENTS.md invariant 2. A wrong fix leaves "0" on a report, or gives back a small count through another field.
- In scope: `src/lib/sponsor-class-breakdown.ts`, `src/lib/shared-report-builder.ts`, `src/templates/shared-report.html` (class section), the read route's handling of the class breakdown, and the tests and fixture the PR changed.
- Out of scope: organizer registration, survey and contact lists; admins' own action counts; other report sections.
- Approver: the owner.

## B. Loop 1: surface pass

Team: Dr of Security, Sr Data Scientist, Sr Automation QA, Sr Design FE, run in parallel inside the loop and merged once. Each was given the diff and asked what is wrong, not the author's conclusion. Each listed the commands it ran; none wrote to the repo. The author then proved F1, F2 and F3 with throwaway probes (removed afterwards).

**Critical: the most dangerous assumption.** That "class-level" means "never per-competitor". It does not when a class has two sponsors.

**Conservative: the worst case.** A sponsor opens its own link and learns one named competitor's exact display total. No person's identity and no count under 5 is involved.

**Recursive.** First score, 58% by arithmetic. Below 95%: stop.

### Findings register

All found in loop 1 (× 1.0), one surface each (× 1.0), production surface (× 1.0). No correlation multiplier applied.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Severity                            | From                                     | Evidence                                                                                                                                                                  | Weight |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | A sponsor's own link carries the whole-event class breakdown. With two sponsors in a class, class total minus the reader's own rows is the other sponsor's exact total. `report-depth.ts:25` calls cross-contamination between sponsors a critical bug; `report-depth.ts:43` says the breakdown is "never per-competitor"; the read route scopes `campaign_summary` for this exact reason (`shared-report-read.ts:149-151`) and not the class breakdown. The PR's new spec asserts a sponsor link gets the whole breakdown. No Linear ticket found. | Critical (security), pending ruling | Pre-existing                             | **Runtime:** sponsor A at 7 and sponsor B at 6, both premium; A's link returned rows `[["sp-cf-a",7]]` and `premium: {sponsor_count: 2, total_displays: 13}`. 13 − 7 = 6. | 15     |
| F2  | The page trusts any number on the wire. A class total of 0 to 4 prints as that number, and 0 / 0 draws a bar labelled "Local NaN% vs Paid NaN%" (the PR removed the old divide guard). Reachable only if the builder regresses; nothing caches a report. The page has no floor of its own.                                                                                                                                                                                                                                                          | Medium                              | Trust pre-existing; NaN introduced       | **Runtime (jsdom):** wire 0/3/4 printed `0                                                                                                                                | 3      | 4`, "Paid: 7 displays", "Local 0% vs Paid 100%". Wire 0/0/0 printed "Local NaN% vs Paid NaN%". | 5   |
| F3  | "Paid" is the sum of the published paid classes only. With one paid class withheld, the line and the bar show a partial Paid with nothing saying so. No leak; the figure does not measure what its label says.                                                                                                                                                                                                                                                                                                                                      | Medium                              | Introduced                               | **Runtime (jsdom):** local 10, Anchor withheld, premium 12 printed "Local: 10 displays · Paid: 12 displays" and "Local 45% vs Paid 55%".                                  | 5      |
| F4  | "Sponsors 0" beside "Fewer than 5 for any one sponsor on any one surface". `sponsor_count` counts sponsors with a published row, so three placed sponsors at 3 displays each read "Sponsors 0". `campaign_summary[].sponsor_count` counts sponsors placed. Two meanings for one field name in one report.                                                                                                                                                                                                                                           | Medium                              | Pairing introduced; meaning pre-existing | Source read: `sponsor-class-breakdown.ts`, `campaign-summary.ts`.                                                                                                         | 5      |
| F5  | The drawn bar's attributes are no longer checked. `shared-report-attribute-escaping.spec.ts` now asserts the bar is absent for hostile input; no test checks the attributes of a bar that is drawn. Low because only computed numbers can reach it now.                                                                                                                                                                                                                                                                                             | Low                                 | Introduced                               | Source read.                                                                                                                                                              | 2      |
| F6  | The bar-drawn case has no browser or staging layer. `report-counts-journey` always has Local withheld, so it only asserts the bar is absent. The jsdom guard covers it at the mock layer.                                                                                                                                                                                                                                                                                                                                                           | Low                                 | Introduced                               | Source read.                                                                                                                                                              | 2      |
| F7  | `report-counts-journey` runs on a local worker on PRs and on staging only in the nightly job, not in T1 to T4. The page's staging layer is nightly.                                                                                                                                                                                                                                                                                                                                                                                                 | Low                                 | Pre-existing                             | `playwright.mobile.config.ts:131`, `mobile-workability-audit.yml`.                                                                                                        | 2      |
| F8  | Bruno `test()` names may not print: `run-local-vetting.sh` says `bru run` prints "Tests 0/0" for after-response scripts and only the JUnit file has names. Request 83 is like the other 72 in the folder. Not verified either way.                                                                                                                                                                                                                                                                                                                  | Low                                 | Pre-existing                             | `scripts/ci/run-local-vetting.sh:141`.                                                                                                                                    | 2      |
| F9  | `shared-report-read.spec.ts` shape check went from "is a number" to "null or at least 5". A valid contract, but looser.                                                                                                                                                                                                                                                                                                                                                                                                                             | Low                                 | Introduced                               | Source read.                                                                                                                                                              | 2      |
| F10 | Wording: the type comment says "distinct sponsors of the class" (it is those with a published row); with both sides withheld the line repeats the long tail twice; the suppression note is never shown on the page (acceptable, the words are in the cells).                                                                                                                                                                                                                                                                                        | Low                                 | Introduced                               | Source read.                                                                                                                                                              | 2      |

Arithmetic: 15 + 5 + 5 + 5 + 2 + 2 + 2 + 2 + 2 + 2 = 42. Score 100 − 42 = **58%**.

Checked with no finding: every route that emits the breakdown (single, sponsor, batch); storage and caching (responses are `no-store`, no KV, R2 or D1 copy); differencing class totals against rows and campaign totals (every difference is 0 or at least 5); the note's presence (it follows the nulls and names no class); escaping in the changed block; design tokens; the fixture's idempotency and the renumbered Bruno requests; stale expectations of 0 elsewhere in the repo; CI wiring of each new test.

Not checked by anyone: the Bruno and Playwright runs on staging; a phone-width render of the long phrase in a browser (the blocking mobile job passed on the PR; its report was not opened).

## Loops 2 and 3

Not run. Loop 1 is under 95%, so the protocol stops here and does not retry.

## Human gate

Found in loop 1, Critical layer.

1. **Is one sponsor working out another sponsor's exact display total a Security Critical?** The code's own comments say sponsors must not see each other's numbers, and `campaign_summary` was scoped for that reason. If yes, the system score is 0% until it is fixed. Information that closes it: your ruling, and which repair you want. Options: (a) on a sponsor's link, give the class breakdown without totals for any class with fewer than three sponsors; (b) on a sponsor's link, leave the class breakdown out; (c) accept it as intended competitive intelligence and correct the comments. Recommendation: (a) is not enough on its own (three sponsors still gives a sum of two), so (b) for sponsor links, keeping the breakdown for the organizer.
2. **What should `sponsor_count` in the class breakdown count?** Sponsors placed in the class (as the campaign summary does), or sponsors with a published row (today)? Today an organizer with three placed sponsors under the floor reads "Sponsors 0".
3. **What should "Paid" say when one paid class is withheld?** Options: label it "Paid (classes shown)", or withhold Paid and the bar unless both paid classes are published. Recommendation: the second.

Needing no decision, and proposed as one follow-up PR: a floor on the page itself (a class total under 5, or not a number, reads as withheld, which also removes the NaN bar), and tests for a drawn bar's attributes.

## C. Results

Not filled in: the gate did not pass.

- Must be true before this is called done: questions 1 to 3 answered; F2 repaired; the staging chain green for `f6613e2` or a later `main` SHA containing it.
- Risk carried today: F1 is live on `main` and was before this PR. Production is held closed, so the exposure is staging.

## Owner ruling and follow-up (2026-11-16, after loop 1)

**Question 1 answered by the owner:** F1 is acceptable. The report is data driven: a count at or over 5 is open knowledge for the sponsors of an event, so they can see the open competition. What a sponsor pays for is the level of data and the features. The infrastructure will not remove this competitive view from local or smaller-market sponsors by letting it be bought out of the market.

F1 is therefore a risk accepted by the owner, not a defect. It leaves the register. The comments that said "never per-competitor" were wrong and are corrected.

Follow-up change (second PR, on top of `main` after #1344):

- F1: the ruling is written into `lib/report-depth.ts` and `docs/features/REPORT-DEPTH.md`, and pinned by two tests in `shared-report-class-floor.spec.ts` (a sponsor link reads the same class totals as the organizer; a peer under the floor stays withheld).
- F2: repaired. The page floors a class total itself (not a number, or under 5, reads as withheld), which also removes the NaN bar. Three page tests, seen red on the template before the change (cells read "0", "3", "4", "-1").
- F5: repaired. A page test checks the attributes of a bar that is drawn.

Score after the ruling and the follow-up, still loop 1:

| Open                                                    | Severity | Weight |
| ------------------------------------------------------- | -------- | ------ |
| F3 Paid is a partial sum with no label                  | Medium   | 5      |
| F4 "Sponsors 0" and the two meanings of `sponsor_count` | Medium   | 5      |
| F6 bar-drawn case has no browser layer                  | Low      | 2      |
| F7 page test reaches staging only nightly               | Low      | 2      |
| F8 Bruno test names printing, unverified                | Low      | 2      |
| F10 wording                                             | Low      | 2      |

100 − 18 = **82%**. F9 is withdrawn (the looser check is the correct contract). The gate is still not passed; questions 2 and 3 remain open, and loops 2 and 3 have not been run.

## Owner rulings on questions 2 and 3 (2026-11-16)

- **Question 2 (F4):** `sponsor_count` is a possession of each sponsor participating in the event. Read as: it counts sponsors placed at the event and accepted by both sides (the campaign summary's rule), not sponsors with a published row. Built so.
- **Question 3 (F3):** label Paid as partial. Built as "Paid (classes shown)", in the line and on the bar, when exactly one paid class is withheld.

Evidence for the follow-up change, run by the author in the session container (a test rig, not staging):

- `shared-report-class-floor.spec.ts`: 14 tests went red on the builder that counted published rows, 61 pass with the change.
- Page tests: the partial-label test and the three page-floor tests were each seen red first.
- Bruno folder `18. Campaigns (S14)` on a local worker with the staging fixture: 333 checks, 0 failed. The test names print in the run log, which settles F8.
- `tests/playwright/report-counts-journey.spec.ts` in Chromium on a local worker: 15 passed. It first failed on "Paid: 6 displays" (the page now reads "Paid (classes shown): 6 displays"); the expectation was updated.

Register after the rulings and the follow-up, still loop 1:

| Open                                                        | Severity | Weight |
| ----------------------------------------------------------- | -------- | ------ |
| F6 bar-drawn case has no browser or staging layer           | Low      | 2      |
| F7 page test reaches staging only nightly                   | Low      | 2      |
| F10 with both sides withheld the line repeats the long tail | Low      | 2      |

100 − 6 = **94%**. This is a loop 1 number on a change that has itself not been reviewed. The gate is not passed: loops 2 and 3 have not been run, and they must review the follow-up change, not only the first PR.
