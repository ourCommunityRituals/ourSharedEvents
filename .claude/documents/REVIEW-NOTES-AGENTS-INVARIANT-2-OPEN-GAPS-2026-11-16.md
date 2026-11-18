# CCR: AGENTS.md invariant 2, the "Open gaps" sentence

Date: 2026-11-16 · Story: OSE-2087 · Class: governance file (5+ loops, human gate after every loop) · `main` at `e7d2160`

**Status: loop 4 of 5 done (2026-11-18). Stopped at the human gate after loop 4. Nothing in AGENTS.md has been changed.**

**These are working notes, not the worksheet.** The repository's worksheet gate (`scripts/ci/ccr-worksheet-check.mjs`) reads `.claude/outputs` and fails a worksheet that has run fewer loops than its class needs, so a five-loop review has no valid worksheet until all five loops exist. The worksheet, with its frontmatter, is written to `.claude/outputs` when loop 5 is done. A first copy of these notes was put there and failed that gate (PR 1372, `T0 Tests (root-vitest)`).

**Loop order, corrected.** The gate records the owner's rulings of 2026-11-01/02: five loops are five lenses on the same subject, in this order: 1 Critical, 2 Conservative, 3 Adversarial, 4 Compliance, 5 Recursive. All five run, nothing is changed between them, and the scores are taken together. So loop 1 below is the Critical lens only; its "Conservative" and "Recursive" paragraphs are early notes for loops 2 and 5, not those loops. AGENTS.md adds a human gate after every loop for a governance file; both rules are followed.

## Verdict

|                                                           |                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| System score (the proposed change: "the gaps are closed") | loop 1: **29%** · loop 2: **0%** · loop 3: **0%** · loop 4: **0%**                                           |
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

## What happened between loop 2 and loop 3

- The owner merged the loop 2 notes (PR 1403) and the F10 fix (PR 1402, `6aa6cc9`; staging chain green on that SHA, run 44146765597). The six questions were not answered.
- The owner then wrote "please continue" (2026-11-18). I read that as leave to run loop 3, not as answers.
- F10 is therefore closed.

## Loop 3 (Adversarial lens: attack it)

Team: dr-of-security (read-only; it listed its commands), with the main session, which ran four attacks against the worker in the workers test pool. `main` at `273cbdd`. The probe file was a scratch spec, deleted after the run and never committed.

Adversarial layer: stop reading and try it. Take the two loop 2 findings that were only read, and the oldest loop 1 finding, and attack the running code. Separately, attack the boundaries nobody had looked at: another brand, another role, the public routes, errors, identifiers, caches.

### Attacks run (the main session; runtime, not source reading)

| Probe                          | What was done                                                                                                                               | What came back                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 padding (F12)               | An event with one poster. Two cookie-less scans through the real `/q/` route, then read `/stats`. Three more cookie-less scans, read again. | `{count: null, suppressed: true}`, then `{count: 5, suppressed: false}`. **The attack works.** Someone who made the last three scans knows the first two were strangers. |
| P1b the same browser repeating | Five scans carrying one `ose_anon` cookie.                                                                                                  | 1 row; the count stays withheld. Repeats by one browser are deduplicated per poster-hour. That does not stop P1: a private window has no cookie.                         |
| P2 audit log (F1)              | Create an event, then `GET /api/v2/admin/audit-log?scope=brand&action=CREATE_EVENT`.                                                        | 200, with one row per action (`action`, `actor`, `resource_id`, `created_at`, …). **Proven.** The dashboard withholds the same count.                                    |
| P3 one action at a time (F11)  | Five registrations, read the count; a sixth, read again.                                                                                    | 5, then 6. **Proven.**                                                                                                                                                   |

### New findings (first seen in loop 3: weight × 1.5)

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                      | Evidence                                                                                                            | Weight                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| F17 | **The public email sign-up tells anyone whether a named email already signed up for an event.** No login. `{ok, id, duplicate: true}` for an email that has signed up; the form page shows "You're already signed up!". That is who, not how many (invariant 1), about one named person. A probe of an email that has not signed up signs that person up. Filed as OSE-2136. | source read by two readers (`handlers/forms.ts` `handleFormEmailSignup`; `handlers/form-pages.ts:747`); **not run** | Security Critical 15 × 1.5 = 22.5; no partial credit |
| F18 | AGENTS.md invariant 3 says "no `CF-IP*` header is read". `CF-Connecting-IP` is read in five places as a rate-limit key (`lib/public-read-limit.ts:67` says so). Not a count leak. The sentence in the governance file says other than what the code does.                                                                                                                    | grep, read                                                                                                          | Medium 5 × 1.5 = 7.5                                 |

F17 is outside the sentence under review (it is invariant 1, not 2) and is scored because the review found it and it is open. Production is closed and staging holds test data, so no real person is exposed today.

### Earlier findings, restated

| #             | State after loop 3                                                                                                                                                                                                                                                                                                                                                                                                    | Weight |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1 + F2       | open; F1 **now proven at runtime** (P2)                                                                                                                                                                                                                                                                                                                                                                               | 30     |
| F3            | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                                       | 10     |
| F5            | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                                       | 5      |
| F6            | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                                       | 2      |
| F7            | **nearly closed**: campaigns, brand calendar, map areas, poster codes, portfolio rollup, event stats, `sponsors.ts`, `sponsor-home.ts`, `pages.ts`, the report export and `lib/shared-report.ts` were read and hold no exact count of people. Unread: `lib/admin-settings.ts`, and handlers that serve no counts by their names (`privacy`, `geocode`, `upload`, `venue-image`, `uec-resolve`, `sponsor-asset-route`) | 2      |
| F8            | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                                       | 2      |
| F10           | **closed** (PR 1402)                                                                                                                                                                                                                                                                                                                                                                                                  | 0      |
| F11           | open; **now proven at runtime** (P3)                                                                                                                                                                                                                                                                                                                                                                                  | 6.25   |
| F12           | open; **now proven at runtime** (P1)                                                                                                                                                                                                                                                                                                                                                                                  | 12.5   |
| F13           | **withdrawn**: scans have no time window on any route, and report views have only the 30-day one. There are no two windows to subtract.                                                                                                                                                                                                                                                                               | 0      |
| F14, F15, F16 | open; unchanged                                                                                                                                                                                                                                                                                                                                                                                                       | 7.5    |

### Attacked and held

- **Another brand.** Events, posters and campaigns are scoped by one guard; sponsors, home links and sponsor requests scope inside their handlers and answer 404; the audit log's brand view is limited to brands the caller owns; a forged brand on the portfolio route is refused. Not traced: event-series ids and the batch report endpoint.
- **Another role.** A sponsor's report token sees only its own rows; depth removes sections and does not change a floor.
- **Public routes.** The public event answer has no count field; the check-in answer is `{ok: true}`; the display config, booth pages, poster bundle and calendars carry no count.
- **Identifiers and caches.** Ids are random; no ordinal is returned. Admin, report and sponsor answers are `no-store`.
- Registration and subscribe answer the same for a known and an unknown email.

All of "attacked and held" is from reading source. Timing was not measured anywhere.

Score: 0%

Arithmetic: carried 30 + 10 + 5 + 2 + 2 + 2 + 6.25 + 12.5 + 7.5 = 77.25; new 22.5 + 7.5 = 30; total 107.25, so the score reads 0%. An unresolved Security Critical finding floors it at 0 in any case.

## Human gate (loop 3, Adversarial layer)

The six earlier questions stand. Loop 3 sharpens the fifth and adds one.

5 (sharper). Padding is now proven, not theory: an organizer who scans their own poster three times from private windows turns a withheld "2 strangers scanned" into a published 5. Do you accept that, or should a figure need 5 **different** contributors that the reader cannot supply themselves? I do not see a cheap fix: scans are anonymous by design, so the system cannot tell the organizer's scans from a stranger's. 7. OSE-2136: may the email sign-up page stop saying "You're already signed up!" so that it answers the same for everyone?

Loop 4 (Compliance) runs after your answer or your leave to continue.

## What happened between loop 3 and loop 4

- The owner merged the loop 3 notes (PR 1427). The questions were not answered.
- The owner then wrote "Please continue" (2026-11-18). I read that as leave to run loop 4, not as answers.

## Loop 4 (Compliance lens: against the written promises and rules)

Team: dr-of-security (read-only; it listed its commands), with the main session. `main` at `c3906c1`.

Compliance layer: set the findings beside every written promise and rule that governs them: what the product tells the public, the owner's recorded rulings, the ADRs, the security baselines and threat ledger, the dashboard contract, and the repository's own rule for changing AGENTS.md. Where the text and the code differ, which one is wrong?

### The two questions that decide the sentence

- **Does any written rule exempt the audit log (F1)? No, and one says the reverse.** `docs/ops/DASHBOARD-CONTRACT-2026-10-02.md:134` records the owner's ruling of 2026-11-16: "operators' own actions are under the floor". The org rule on audit (as quoted in `docs/security/CONFORMANCE.md:396`) requires an audit trail; it does not say who may read it row by row. So today F1 is against a recorded ruling, and my recommendation to make it an exception needs a new ruling, not just a note.
- **Does any written rule allow exact admin counts from 5 up (F11)? Two rules, and they disagree.** `lib/count-floor.ts:10-11` (decision of 2026-08-08): a count at or over the floor "shows the exact number". `lib/count-floor.ts:149-153` (PO decision of 2026-10-01): "Every published count is rounded down to a multiple of" 5, because "an exact count would show a one-person change". Invariant 2 treats an admin as a reader of published counts. The code rounds only the public event answer.

### New findings (first seen in loop 4: weight × 1.5)

| #   | Finding                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                       | Weight                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| F19 | Two recorded decisions disagree on whether a count at 5 or more is exact or rounded, and neither says whether rounding reaches an admin. F11 lives in that gap.                                                                                                                                                                                           | `lib/count-floor.ts:10-11` and `:149-153`, read by me                                          | High 10 × 1.5 = 15                                     |
| F20 | **The privacy page says email addresses are "automatically deleted after 30 days" and cites GDPR Art. 13.** The landing page's email list is kept 90 days (owner decision 2026-10-11). The per-event sign-up is 30. The page does not tell them apart. Outside invariant 2.                                                                               | `handlers/privacy.ts:69`; `lib/retention-windows.ts:56-61`, read by me                         | Regulatory 25; no partial credit; caps the score at 60 |
| F21 | The landing sign-up stores a peppered hash of the caller's IP; the privacy page lists only the email address.                                                                                                                                                                                                                                             | sweep's reading (`handlers/pages.ts:2926-2941`, ADR-001:60); not opened by me                  | Medium 5 × 1.5 = 7.5                                   |
| F22 | The threat ledger marks "sub-floor export without suppression" (TL-022) as `tested`. Its test only checks that the floor constant is 5 or more. It could not catch F1, F2, F10, F11 or F12. A gate that cannot fail counts as absent.                                                                                                                     | sweep's reading (`threat-ledger.yaml:252`, `anti-logging-proof.spec.ts:554`); not opened by me | High 10 × 1.5 = 15                                     |
| F23 | **A stale line of mine.** PR 1330 updated the dashboard contract to 3.0.0 and left a line saying the organizer's lists are "not changed" and that a floor on them "protects no one". Corrected in this PR.                                                                                                                                                | `docs/ops/DASHBOARD-CONTRACT-2026-10-02.md:145`, read by me                                    | Low 2 × 1.5 = 3, closed when this PR merges            |
| F24 | The admin briefing page calls the design "a HIPAA/COPPA asset"; ADR-018 declines those regimes. Internal page.                                                                                                                                                                                                                                            | sweep's reading (`handlers/briefing.ts:93`)                                                    | Low 2 × 1.5 = 3                                        |
| F25 | **This review is not yet tied to a commit.** The repository's rule for a governed file (`scripts/ci/ccr-gate.mjs`) wants a worksheet whose `subject_sha` is a commit on the pull request that changes AGENTS.md: "the review saw what will merge". Loops 1 to 4 reviewed the question and three candidate wordings; no commit of the new sentence exists. | `scripts/ci/ccr-gate.mjs:8-14`, read by me                                                     | Medium 5 × 1.5 = 7.5                                   |
| F26 | ADR-034 drops a placement under 5 from a list; the invariant says a withheld count "reads in words". The ADR notes the difference itself.                                                                                                                                                                                                                 | sweep's reading (`ADR-034:16`)                                                                 | Low 2 × 1.5 = 3                                        |

Already known and listed in `docs/brain/CONSTRAINTS.md:34`, so not counted again: the privacy page says registration data is "deleted automatically when the event ends"; the code keeps it up to 90 days.

### Earlier findings against the written rules

| #            | What the written rules say                                                                                                                                                                                      | Weight        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| F1 + F2      | against the owner's ruling of 2026-11-16 (see above); the dashboard contract classes the same figure once as `entity` and once as `floored`                                                                     | 30            |
| F3           | no rule found either way; the catalog's "Event hosts and sponsors see corridors and venues, not people" is about hosts, and this list is platform only                                                          | 10            |
| F5           | **the documented design produces it**: `docs/features/PRIVACY.md:165-175` specifies one JSON log line per form event with the event id and a millisecond time                                                   | 5             |
| F6, F15, F16 | no written rule found                                                                                                                                                                                           | 2 + 2.5 + 2.5 |
| F7, F8       | unchanged                                                                                                                                                                                                       | 2 + 2         |
| F11, F12     | F11 sits in the conflict F19 names; no rule speaks to F12                                                                                                                                                       | 6.25 + 12.5   |
| F14          | unchanged                                                                                                                                                                                                       | 2.5           |
| F17          | strains the privacy page's "We do not … share your personal data" and the catalog's "Never who, only how many"                                                                                                  | 22.5          |
| F18          | `docs/security/LOGGING_STANDARD.md:44` and ADR-001:60 both sanction reading the IP; `docs/brain/CONSTRAINTS.md:37` already says it is read as a rate-limit key. AGENTS.md invariant 3 is the text that is wrong | 7.5           |

Not found on disk, so not read: the org's `architectural-invariants.yaml` (only the copies of its claims in `CONFORMANCE.md` were read). The threat ledger has no entry, open or accepted, for any of F1, F2, F5, F6, F11, F12, F15, F16 or F17.

Score: 0%

Arithmetic: carried 107.25; new 15 + 25 + 7.5 + 15 + 3 + 3 + 7.5 + 3 = 79; total 186.25, so the score reads 0%. An open Regulatory item caps it at 60 and an open Security Critical floors it at 0 in any case.

## Human gate (loop 4, Compliance layer)

Loop 4 changes two of my earlier recommendations and adds three questions.

- **Question 1, corrected.** I recommended naming the audit log as an exception. That is against your own ruling of 2026-11-16 as the contract records it. If you want the exception, it has to be a new ruling. Which is it: the audit log is under the floor, or it is an exception by your decision?
- **Question 5, with the rule in hand.** Your PO decision of 2026-10-01 already says every published count is rounded to a multiple of 5, for exactly the reason F11 shows. Does that decision reach what an admin reads?
- 8. The privacy page promises 30 days for email addresses; the landing list is kept 90 by your decision of 2026-10-11. Which changes: the page or the window?
- 9. May I commit the chosen wording to a draft pull request now, so that loop 5 reviews the exact commit, as the repository's gate requires? It would not be merged without you.
- 10. Which wording? With loop 4 in hand I would no longer offer "(some rows an admin still reads exactly)" alone. It should also own the two gaps that are not rows: "Open gaps: OSE-2087 (rows and exact counts an admin still reads)." That is 8 bytes shorter than today's sentence.

Loop 5 (Recursive: was this review itself honest?) runs after your answer or your leave to continue.

## Before shipping (not yet met)

- Loops 2 to 5, each with a gate.
- F7: the unread handlers read.
- `docs/brain/CONSTRAINTS.md:27` updated in the same PR.
- The budget test and `scripts/check-pr-linear-close.mjs` pass on the PR.

## Risks accepted so far

None. Nothing has shipped.
