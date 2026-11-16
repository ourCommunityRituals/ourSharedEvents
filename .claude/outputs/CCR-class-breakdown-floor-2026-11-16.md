---
ccr: 1
class: security-fix
requested_loops: 3
loops_run: 3
team: base
gate: stop
cumulative_score: 33
system_score: 82
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 1, medium: 0, low: 4 }
pr: 1344
---

# CCR: SharedReport class breakdown floor (PR #1344, OSE-2089)

Date: 2026-11-16. The owner asked: "run a CCR on the PR". Run by Claude Code, which also wrote the change under review. Every loop's lenses were independent role agents, each given the diff and asked what is wrong.

## Verdict

| Item                               | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| Classification                     | Security fix (count floor): 3 loops, base team              |
| Loops run                          | 3 of 3: Critical, Conservative, Recursive                   |
| Loop results                       | 58%, 49%, 33%                                               |
| Cumulative, before any solutioning | **33%**                                                     |
| System, after solutioning          | **82%**: one High and four Low still open                   |
| Assessment confidence              | **55%** (the loop 3 auditor's figure; reasons under Loop 3) |
| Gate                               | **Stop. Human gate.**                                       |

What held through all three loops: nobody found a route that returns a 0 or a count under 5 for a class total. The builder arithmetic is unchanged apart from 0 becoming null. Nothing stores or caches a built report. Reading a report twice over time gives nothing under 5.

The "after solutioning" figure counts six findings as fixed by PR #1358, which carries this worksheet and is **not merged**. Until it merges, those six are open on `main` and the figure on `main` is 61%.

## What was reviewed

- Subject: commit `f4ccddb`, squash-merged to `main` as `f6613e2` (PR #1344). `sponsor_class_breakdown.*.total_displays` is null, with one note, when no (sponsor x surface) row of a class reaches 5; the report page prints "Fewer than 5 …".
- In scope: `src/lib/sponsor-class-breakdown.ts`, `src/lib/shared-report-builder.ts`, the class section of `src/templates/shared-report.html`, the read and batch routes' handling of the breakdown, and the tests and fixture the PR changed.
- Out of scope: organizer registration, survey and contact lists; admins' own action counts; other report sections, except where a loop found a floor breach in the same report (N1).
- Why it matters: AGENTS.md invariant 2. A wrong fix leaves "0" on a report or gives a small count back through another field.

### How the run departed from the rules

Said plainly, because loop 3 asked:

- The author stopped after loop 1 (58%) and reported a human gate, following the stop-below-95% text in `.claude/skills/ccr/SKILL.md`. The worksheet gate (`scripts/ci/ccr-worksheet-check.mjs`, owner rulings 2026-11-01/02) says every loop runs first and a low score is solved afterwards. Loops 2 and 3 were run after CI failed on the first worksheet.
- Between loop 1 and loop 2 the owner ruled on three questions and the author built a follow-up change (PR #1358). The subject commit itself did not change, and loops 2 and 3 read it at `f6613e2`, not from the working tree.
- PR #1344 was merged by the owner while loop 1 was still running.
- The author wrote the code and ran the review.

## Loop 1

Team: dr-of-security, role-data-scientist, role-qa-automation, role-design-fe

Critical layer: what is true against what is assumed. The dangerous assumption was that "class-level" means "never per-competitor". In a class of two sponsors it does not: the class total minus the reader's own rows is the other sponsor's total. The author proved F1, F2 and F3 at runtime with throwaway probes.

Findings F1 to F10. Arithmetic: 15 + 5 + 5 + 5 + six Lows at 2 = 42.

Score: 58%

## Loop 2

Team: dr-of-security, role-backend-architect

Conservative layer: assume loop 1 is incomplete and the worst case is true. Both lenses read the subject at `f6613e2` and tried to break it. They could not break: two reads over time (a row moving 3 to 4 changes nothing; at 5 it appears as 5); consistency inside one response (rows, class totals and campaign totals come from one array); other emitters (no export, dashboard or seed publishes display totals without the floor); the depth filter and the batch route (the null and its note always travel together); failure modes (a failed query is a 500, never a 0); consumers of the changed type (nothing does arithmetic on it); rollback.

New findings: N1 (in the same report, outside the class view) and B1. One candidate was withdrawn: a sponsor cannot have two placements at one event (`UNIQUE(sponsor_business_id, event_id)`, migration 0067).

Arithmetic: loop 1's 42, plus new findings at × 1.25: 5 × 1.25 + 2 × 1.25 = 8.75. 100 − 50.75, rounded down.

Score: 49%

## Loop 3

Team: role-qa-automation

Recursive layer: was the assessment itself honest. One independent auditor reviewed the register, not the code.

Its corrections, all accepted:

- N1 is a floor breach on a published surface and rates High, not Medium.
- The author's withdrawal of F9 was not defensible: the loosened test never exercises a published class. F9 was reopened, then fixed with a new test.
- The author's closure of F8 on a local log was not defensible: a local run is not CI, and CI counts JUnit cases without printing names. F8 is open.
- The PR's born-red claims ("four planted faults each seen red", "3 Bruno assertions red on main") were never reproduced by any reviewer. They are the author's own runs.
- Confidence should be lowered because the author wrote the code, ran the review, and proposed closures himself.

Its two new candidates were checked by the author and withdrawn with evidence, which the auditor did not see: the Playwright journey is named in `playwright.mobile.config.ts:131`, which `mobile-workability-audit.yml` runs, and the job passed on PR #1344; the report page has no translation hooks at all (`grep -c i18n shared-report.html` is 0), so no catalog carries its words.

The auditor also said the owner's ruling on F1 needs AGENTS.md invariant 2 amended. Not accepted: invariant 2 is about counts under 5, and the ruling is about counts at or over 5.

Arithmetic, the auditor's own: subject findings 44, its two candidates at × 1.5 = 10.5, N1 at High × 1.25 = 12.5. 100 − 67.

Score: 33%

## Findings register

Weights: Critical 15, High 10, Medium 5, Low 2. "Fixed" means fixed in PR #1358, which is not merged.

| #   | Finding                                                                                                                                                                                                                                  | Severity | From                               | Evidence                                                                                           | Status                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| F1  | A sponsor's own link carries the whole-event class breakdown. In a class of two, class total minus own rows is the other sponsor's exact total.                                                                                          | Critical | Pre-existing                       | Runtime: own row 7; link returned `premium: {sponsor_count: 2, total_displays: 13}`.               | closed: accepted by the owner, 2026-11-16          |
| F2  | The page trusts any number on the wire: 0 to 4 prints as that number, and 0 / 0 draws "Local NaN% vs Paid NaN%". Reachable only if the builder regresses.                                                                                | Medium   | Trust pre-existing; NaN introduced | Runtime (jsdom): wire 0/3/4 printed `0`, `3`, `4`; wire 0/0/0 printed the NaN bar.                 | fixed: the page floors a class total itself        |
| F3  | "Paid" is the sum of the published paid classes only, with nothing saying so.                                                                                                                                                            | Medium   | Introduced                         | Runtime (jsdom): local 10, Anchor withheld, premium 12 printed "Paid: 12 displays", 45% / 55%.     | fixed: reads "Paid (classes shown)" (owner ruling) |
| F4  | "Sponsors 0" beside "Fewer than 5 for any one sponsor": `sponsor_count` counted sponsors with a published row, unlike the campaign summary.                                                                                              | Medium   | Pairing introduced                 | Source read.                                                                                       | fixed: counts sponsors taking part (owner ruling)  |
| F5  | No test checked the attributes of a bar that is drawn.                                                                                                                                                                                   | Low      | Introduced                         | Source read.                                                                                       | fixed: page test added                             |
| F6  | The bar-drawn case has no browser or staging layer; the journey only ever asserts the bar absent.                                                                                                                                        | Low      | Introduced                         | Source read.                                                                                       | open                                               |
| F7  | `report-counts-journey` runs on a local worker on PRs and on staging only nightly, not in T1 to T4.                                                                                                                                      | Low      | Pre-existing                       | `playwright.mobile.config.ts:131`, `mobile-workability-audit.yml`.                                 | open                                               |
| F8  | Bruno `test()` names: CI counts JUnit cases and does not print names (AGENTS.md: a Bruno run counts only if its names print).                                                                                                            | Low      | Pre-existing                       | `scripts/ci/run-local-vetting.sh:141-165`. Names did print in the author's local `bru run` log.    | open                                               |
| F9  | The batch-route shape test never exercises a published class.                                                                                                                                                                            | Low      | Introduced                         | `shared-report-read.spec.ts` at `f6613e2`, lines 761-790.                                          | fixed: batch-route test with a published class     |
| F10 | Wording: with both sides withheld the line repeats the long tail twice; the note is never shown on the page (acceptable, the words are in the cells).                                                                                    | Low      | Introduced                         | Source read.                                                                                       | open                                               |
| B1  | The schema snapshot (invariant 21) did not list `sponsor_class_breakdown`, so its removal would go unnoticed.                                                                                                                            | Low      | Pre-existing                       | `api-schema-snapshots/shared-report.snapshot.json` at `f6613e2`.                                   | fixed: the field is listed                         |
| N1  | In the same report: the `_event` / `materialization_pending` note is pushed only when the raw attendee count is exactly 0, so its presence tells 0 from 1 to 4. A floor breach for every reader. Not in the class view. Ticket OSE-2093. | High     | Pre-existing                       | Source read by two readers, `shared-report-builder.ts` "Surface materialization pending". Not run. | open                                               |
| B2  | A sponsor with placements in two classes could show a total beside a count of 0.                                                                                                                                                         | Low      | Pre-existing                       | Cannot occur: `UNIQUE(sponsor_business_id, event_id)`, migration 0067.                             | withdrawn                                          |
| N2  | No workflow names the changed Playwright journey.                                                                                                                                                                                        | Low      | Loop 3 candidate                   | It is named: `playwright.mobile.config.ts:131`, run by `mobile-workability-audit.yml`.             | withdrawn                                          |
| N3  | Translations of the page's words were never checked.                                                                                                                                                                                     | Medium   | Loop 3 candidate                   | The page has no translation hooks (`grep -c i18n` is 0); `withheld-words.ts` says English only.    | withdrawn                                          |

Open after solutioning: one High (N1) and four Low (F6, F7, F8, F10). 100 − 10 − 8 = 82.

Out of scope, noted only: the event delete guard tells a brand admin 0 versus at least 1 display or scan. Recorded on OSE-2093 for an owner decision.

## Solutioning

How the team gets from 33% to 95%.

Done, by owner ruling on 2026-11-16:

1. **F1 accepted.** The owner: the report is data driven; a count over 5 is open knowledge for the sponsors to understand the open competition; what they pay for is the level of data and feature availability; the infrastructure will not remove this capability from local or smaller-market competitors by being bought out of the market. The comments that said "never per-competitor" are corrected, and two tests pin the ruling.
2. **F4:** `sponsor_count` is "a possession for each sponsor participating in the event". Built as: sponsors placed and accepted by both sides, plus any other with a published row. This reading is the author's and is put back to the owner below.
3. **F3:** "Labeled as partial". Built as "Paid (classes shown)".

Done, needing no decision, in PR #1358: F2 (the page floors a class total itself), F5, F9 and B1.

Evidence for PR #1358, all the author's own runs in the session container (a test rig, not staging): 14 worker tests red on the old `sponsor_count`, 62 pass; four page tests each red first; Bruno folder `18. Campaigns (S14)` on a local worker, 333 checks, 0 failed; `report-counts-journey` in Chromium on a local worker, 15 passed after one stale expectation was updated.

Still to do:

- **N1 (10 points):** OSE-2093. Use the floored count in the note's condition, with a failing neighbour test first. This alone takes the figure to 92%.
- **F6 (2):** give the journey a second, local sponsor past the floor so the bar is drawn in a browser.
- **F7 and F8 (4):** pipeline changes: name `report-counts-journey` in a staging job of the T1 to T4 chain, and print Bruno test names in the T2 step. With N1 and F6 these reach 98%.
- **F10 (2):** print the long tail once under the table; a wording choice for the owner.
- An independent reviewer should reproduce the born-red claims of both PRs.

## What must be true before shipping

- [ ] PR #1358 merged, or F2, F3, F4, F5, F9 and B1 are open on `main` again.
- [ ] The post-merge staging chain (T1 to T4) green for `f6613e2` or a later `main` SHA containing it. Not read at the time of writing.
- [ ] OSE-2093 (N1) fixed, or accepted by the owner in writing.
- [ ] The owner confirms the reading of ruling 2 (`sponsor_count`).

## Verification

After PR #1358 merges and deploys to staging:

- [ ] Bruno request 83 in `18. Campaigns (S14)` passes in `T2 Contract → Staging (Bruno)`: local and mid `total_displays` null; sponsors 1, 0 and 6; premium 26.
- [ ] The nightly staging run of `report-counts-journey` passes.
- [ ] On a staging report with one paid class withheld, the page reads "Paid (classes shown)".

## Risks accepted

- **F1, accepted by the owner on 2026-11-16:** a sponsor can work out another sponsor's display total, at or over 5, from the class view. This is the intended open competition view, at every depth.
- Production is held closed, so everything above is exposed on staging only.

## Human gate

The gap appeared in loop 1 (Critical layer) and widened in loops 2 and 3.

1. N1 (OSE-2093) is a floor breach in the same report and is not fixed. Should it be fixed next, before OSE-2089 is called done?
2. Ruling 2 was built as "count every sponsor placed at the event and accepted by both sides, shown or not". Is that what "a possession for each sponsor participating in the event" means?
3. `.claude/skills/ccr/SKILL.md` says stop below 95%; the worksheet gate says run every loop first. Both are governed files. Which one should be corrected, in its own 5-loop CCR?
4. Should the long withheld phrase be printed once under the class table instead of in each cell and twice in the line (F10)?
