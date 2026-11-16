# CCR: AGENTS.md invariant 2, the "Open gaps" sentence

Date: 2026-11-16 · Story: OSE-2087 · Class: governance file (5+ loops, human gate after every loop) · `main` at `e7d2160`

**Status: loop 1 of 5 done. Stopped at the human gate. Nothing in AGENTS.md has been changed.**

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

## Before shipping (not yet met)

- Loops 2 to 5, each with a gate.
- F7: the unread handlers read.
- `docs/brain/CONSTRAINTS.md:27` updated in the same PR.
- The budget test and `scripts/check-pr-linear-close.mjs` pass on the PR.

## Risks accepted so far

None. Nothing has shipped.
