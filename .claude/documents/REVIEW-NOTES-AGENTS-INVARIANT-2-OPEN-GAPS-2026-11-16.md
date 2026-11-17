# CCR: AGENTS.md invariant 2, the "Open gaps" sentence

Date: 2026-11-16 · Story: OSE-2087 · Class: governance file (5+ loops, human gate after every loop) · `main` at `e7d2160`

**Status: loop 2 of 5 done (2026-11-17). Stopped at the human gate after loop 2. Nothing in AGENTS.md has been changed.**

**These are working notes, not the worksheet.** The repository's worksheet gate (`scripts/ci/ccr-worksheet-check.mjs`) reads `.claude/outputs` and fails a worksheet that has run fewer loops than its class needs, so a five-loop review has no valid worksheet until all five loops exist. The worksheet, with its frontmatter, is written to `.claude/outputs` when loop 5 is done. A first copy of these notes was put there and failed that gate (PR 1372, `T0 Tests (root-vitest)`).

**Loop order, corrected.** The gate records the owner's rulings of 2026-11-01/02: five loops are five lenses on the same subject, in this order: 1 Critical, 2 Conservative, 3 Adversarial, 4 Compliance, 5 Recursive. All five run, nothing is changed between them, and the scores are taken together. So loop 1 below is the Critical lens only; its "Conservative" and "Recursive" paragraphs are early notes for loops 2 and 5, not those loops. AGENTS.md adds a human gate after every loop for a governance file; both rules are followed.

## Verdict

|                                                           |                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| System score (the proposed change: "the gaps are closed") | **29%**                                                                                                      |
| Assessment confidence                                     | about 70%: three findings were read in source by two readers; nothing was run; eleven handlers were not read |
| Gate                                                      | **Fail.** Below 95%. Human gate, questions below                                                             |

## What is under review

The last sentence of invariant 2 in `AGENTS.md:29`:

> Open gaps: OSE-1656 (some counts an admin still reads exactly), OSE-1652.

The proposal that started this review: both tickets are Done, so the sentence should stop naming them.

**In scope:** whether that sentence can truthfully change, and to what. **Out of scope:** fixing the findings; any other line of AGENTS.md.

## Loop 1 (surface pass)

Team: dr-of-security (a read-only sweep) with the main session (it listed its commands; all were `grep`, `sed -n`, `git log`).

### Critical: what is true, and what is assumed

True, with evidence:

- OSE-1656 is Done in Linear. Its work is on `main`: PR #1260 (staging run 43669610456), PR #1330 (run 43884423948), PR #1352 (run 43920974402).
- OSE-1652 is Done in Linear and fixed in code: the venue return rate no longer reads `return_count` (`src/lib/shared-report-builder.ts:531-540`), with a test seen red on `5da1d61` (`tests/shared-report-materialize.spec.ts:337`).
- So the two ids in the sentence are stale.

The dangerous assumption: **"the ids are stale" means "there is no open gap".** The sweep tested that and it does not hold.

### Conservative: assume the worst case

If the sentence is changed to say nothing is open, every later agent reads invariant 2 as fully enforced and stops looking. The findings below would then sit behind a line that says they do not exist.

### Findings

| #   | Finding                                                                                                                                                                                                                                           | Evidence (source read, not run)                                                       | Weight                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| F1  | The brand audit-log read returns operators' actions as rows, filterable by action and date, with no floor. It is the same data `admin_activity_30d` floors (ruling 3, PR #1330).                                                                  | `handlers/audit.ts` has no floor call (grep count 0); filters at `:247-282`           | Critical 15                       |
| F2  | `events.created_30d` on the operations dashboard is exact, beside the floored `admin_activity_30d.created`. For a brand that makes events by hand they are the same number.                                                                       | `handlers/dashboards.ts:465`; contract class `entity`, `lib/dashboard-contract.ts:96` | Medium 5                          |
| F3  | The subscribers list returns people as rows with no floor (platform only).                                                                                                                                                                        | `handlers/subscribers.ts:109-156`, no floor call                                      | High 10                           |
| F4  | **A defect in PR #1330 (mine).** The registrations list withholds rows by the counted total (confirmed, not expired). The export withholds by all rows. With 5 rows of which 3 are counted, the list is withheld and the export hands over all 5. | list: `handlers/forms.ts:633` and `:642`; export: `:883` and `:947`                   | High 10                           |
| F5  | Server logs record exact counts under 5 (check-in total, email sign-ups read). Anyone with Workers Logs access reads them.                                                                                                                        | `handlers/forms.ts:466-475`, `:772`, `:832`                                           | Medium 5                          |
| F6  | Deleting an event answers 409 "at least one scan" or not: tells 0 from 1 to 4.                                                                                                                                                                    | `handlers/events.ts:1969-1985` (sweep's reading; I did not open it)                   | Low 2                             |
| F7  | The sweep did not read: the corridor and event dashboards beyond their contract classes, the SharedReport payloads, sponsor home, the Live view source, `pages.ts`, campaigns, feature flags, and others. "All surfaces scanned" is not met.      | sweep's own "not read" list                                                           | High 10                           |
| F8  | `docs/brain/CONSTRAINTS.md:27` says invariant 2 "says less than is so" about OSE-1656. It must change in the same PR as the sentence, and it is now also partly wrong (F4).                                                                       | file read                                                                             | Low 2                             |
| F9  | AGENTS.md is 12,280 bytes; the limit is 12,288. The new sentence may be at most 8 bytes longer than the old one. All three wordings below are shorter.                                                                                            | `tests/integration/agent-instructions-budget.test.js:62`; measured                    | Low 2, closed by any option below |

Also seen, not scored (judgement calls): `decrypt_failed` on the contacts read is exact; a platform-only rate-limit stats route counts IPs exactly; the data-subject erase answers with exact row counts for one person; counts of things (posters, sponsors as businesses, events by status) are exact by design.

### Recursive: score

- F1 and F2 are causally linked (the same figure by two routes): (15 + 5) × 1.5 = 30
- F3 10 · F4 10 · F5 5 · F6 2 · F7 10 · F8 2 · F9 0 (closed)
- Loop position × 1.0 (loop 1). Environment × 1.0 (production is closed; staging holds test data). Had I applied the protocol's × 1.5 for a governance change, the score would be lower still.
- **100 − (30 + 10 + 10 + 5 + 2 + 10 + 2) = 29%**

No earlier loop to compare with. I did not class F1 as Security Critical (the reader is the brand's own owner reading their own log); if the owner does, the score is 0%.

## Human gate (loop 1, Critical layer)

The sentence cannot say the gaps are closed. Before loop 2 I need:

1. **The audit log (F1).** Does "no exceptions" reach an owner reading their own brand's audit log? This collides with invariant 7 ("audit … the same at every tier"): an audit log that hides its rows until there are 5 is a weaker audit log. My recommendation: the audit log is a named exception, written into `lib/count-floor.ts` with your ruling as the reason, because its job is to show each action. That would also settle F2.
2. **The subscribers list (F3).** Platform only. Floor it, or name it as an exception (the platform holds every address anyway)?
3. **Server logs (F5).** Are exact counts in Workers Logs inside the rule? Today only you and platform staff can read them.
4. **The wording.** Byte change against the old sentence in brackets:
   - A. "No open gap is known (OSE-2087)." (−41). **Not supportable today.**
   - B. "Open gaps: OSE-2087 (audit-log and subscriber rows read exactly)." (−8). True today.
   - C. "Open gaps: OSE-2087 (some rows an admin still reads exactly)." (−12). True today, and stays true as the list shrinks.
   - My recommendation: **C**, with the findings above recorded on OSE-2087.

F4 needs no ruling: it is a bug in my own change and contradicts ruling 2. I will fix it in its own draft PR.

## What happened between loop 1 and loop 2

- The owner merged these notes (PR 1372) and the F4 fix (PR 1373, `f0ccab6`; staging chain green on the later `main` SHA `19499bb`, run 43989506055). The four loop 1 questions were not answered.
- The owner then wrote "Please continue" (2026-11-17). I read that as leave to run loop 2, not as answers to the questions.
- F4 is therefore closed. F6's location is corrected below.

## Loop 2 (Conservative lens: assume the worst case)

Team: dr-of-security, role-data-scientist (both read-only; each listed its commands), with the main session. `main` at `1e2bc84`.

Conservative layer: assume a patient, hostile brand admin who can call every admin route for their own brand as often as they like, and can register, scan and check in as a member of the public. Assume also that loop 1's unread handlers hide something. Does the floor still hold?

It does not. Two readers independently found the same new leak in the code this story shipped, and the data-science lens found two ways the floor is passed without any single figure under 5 being published.

### New findings (first seen in loop 2: weight × 1.25)

| #   | Finding                                                                                                                                                                                                                                                                                                                           | Evidence                                                                    | Weight                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------- |
| F10 | **A second defect in the lists-under-the-floor work (mine).** Once an event has 5 counted registrations, the list, the export and the contacts return every row, the uncounted ones with them (past retention, waiting for the nightly purge). 7 rows of which 5 count: the reader learns that 2 are not counted, and who.        | **Proven by 4 failing tests**; fix in draft PR 1402, not merged             | Critical 15 × 1.25 = 18.75 |
| F11 | **One action at a time.** Every admin count is exact from 5 up. Read 7, wait, read 8: one person's action is seen. The public event page rounds to a multiple of 5 (`roundForPublish`, `lib/public-event-projection.ts:107`); no admin route does. The invariant as written ("a count below 5 is withheld") does not forbid this. | source read; not run                                                        | Medium 5 × 1.25 = 6.25     |
| F12 | **Padding a part.** Totals are sums of parts that each reach 5 (a poster-hour, an event-day, a link). An admin who adds 3 scans of their own to a poster-hour holding a stranger's 2 makes it 5; it enters the sum, and the stranger's 2 is known. Whether scans are deduplicated per person was not traced.                      | source read (`lib/scan-cells.ts`); not run                                  | High 10 × 1.25 = 12.5      |
| F13 | Different windows of the same figure (30 days against all time) may subtract to a group under 5.                                                                                                                                                                                                                                  | **not traced**: named as a risk by the data-science lens, not shown in code | Medium 5 × 1.25 = 6.25     |
| F14 | The public recap's "showed up" share is a plain ratio, not `flooredRatePct`. Both of its inputs are already published exactly, so it adds nothing new.                                                                                                                                                                            | `handlers/pages.ts:2112-2116` (sweep's reading)                             | Low 2 × 1.25 = 2.5         |
| F15 | The data-subject erase answer gives exact per-person row counts for a named email, and logs them. Platform only. It may be a lawful receipt.                                                                                                                                                                                      | `handlers/data-subject.ts:246-298` (sweep's reading)                        | Low 2 × 1.25 = 2.5         |
| F16 | The demo page prints "had only N scans" for a count under 5. Mock data, but it shows the thing the rule forbids. (I noted this on 2026-11-15 and did not act on it.)                                                                                                                                                              | `handlers/demo.ts:579-584` (sweep's reading)                                | Low 2 × 1.25 = 2.5         |

### Loop 1 findings, restated

| #       | State after loop 2                                                                                                                                                                                                                                                                                                                                                                                      | Weight              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| F1 + F2 | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                         | (15 + 5) × 1.5 = 30 |
| F3      | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                         | 10                  |
| F4      | **closed** (PR 1373)                                                                                                                                                                                                                                                                                                                                                                                    | 0                   |
| F5      | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                         | 5                   |
| F6      | open; **location corrected**: the guard is in `handleDeleteEvent`, `handlers/events.ts:2049-2063`, and tells 0 from 1 or more of scans, returns and sponsor displays together                                                                                                                                                                                                                           | 2                   |
| F7      | **partly closed**: the corridor and event dashboards, the SharedReport builder and read, sponsor home render, the Live view, booth counts, the poster list, feature flags and BigQuery were read and are floored. Still unread: campaigns, brand calendar, map areas, poster codes, `sponsors.ts`, the rest of `sponsor-home.ts` and `pages.ts`, `portfolio-rollup.ts` and `event-stats.ts` beyond grep | half: 5             |
| F8      | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                         | 2                   |

### Checked in loop 2 and found sound

- One registrations definition is used by the list total, `/stats`, the dashboard and the gate.
- Rates: `flooredRatePct` withholds when the remainder is 1 to 4, and the SharedReport refuses 100%.
- A failed read and a zero both read as withheld; no route was found that tells 0 from 1 to 4 except F6.
- No `X-Total-Count`-style header exists. No route reads the PII audit log.

Score: 0%

Arithmetic: carried 30 + 10 + 5 + 2 + 5 + 2 = 54; new 18.75 + 6.25 + 12.5 + 6.25 + 2.5 + 2.5 + 2.5 = 51.25; total 105.25, so 100 − 105.25 is below zero and reads as 0%. Loop 1 was 29%. The drop is the second lens finding what the first did not; it is not argued back up.

What is proven and what is not: F10 is proven by tests. Everything else in loop 2 is from reading source. F13 was not traced at all and may not exist.

## Human gate (loop 2, Conservative layer)

The four loop 1 questions stand. Loop 2 adds a larger one.

5. **What does the rule protect: a number, or a person?** As written, invariant 2 stops any count under 5 from being published. It does not stop someone learning about one person by reading 7 and then 8 (F11), or by padding a poster-hour with their own scans (F12). Closing those means admin counts stop being exact: rounded to a multiple of 5 like the public page, or bucketed. Do you want that, or is "no count under 5" the rule and the rest accepted?
6. Is the data-subject erase receipt (F15) a named exception?

My recommendation on 5: keep the rule as written for now, and have the "Open gaps" sentence name F11 and F12 honestly instead of implying the floor is complete. Rounding every admin count is a product change with a cost to organizers, and deserves its own story and your decision, not a side effect of this review.

Loop 3 (Adversarial) runs after your answer or your leave to continue.

## Before shipping (not yet met)

- Loops 2 to 5, each with a gate.
- F7: the unread handlers read.
- `docs/brain/CONSTRAINTS.md:27` updated in the same PR.
- The budget test and `scripts/check-pr-linear-close.mjs` pass on the PR.

## Risks accepted so far

None. Nothing has shipped.
