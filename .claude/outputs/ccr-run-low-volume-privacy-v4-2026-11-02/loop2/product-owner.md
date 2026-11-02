# Loop 2 (Conservative), Product Owner lens, subject v4 frozen (dd9b8522...)

Worst case assumed: every F answer opposite to the recommendation (D2 no, D4 no, F-10 unset, F-11 and F-12 not approved); OSE-1496, 1784, 1780 slip a quarter; production held, not closed (AGENTS), 0 scans read 2026-10-12 (owner memory), so regulatory exposure starts at the first live event.

## 1. Worst case per High (lens)

- **R1-02.** S15 ships in Wave 1 (E.3), OSE-1784 slips. The first event's report prints `distinct_scanners` summed per event-hour (builder `:330-347`) beside a `/privacy` line promising a 5-per-poster-hour rule. A sponsor reads both. The notice is false the day a data subject exists. Re-rate to Regulatory (conditional on a live event). Basis: source-read.
- **R1-03.** D2 yes, 80 scans in the open hour: the founder's live view (`live-monitor.ts:94-96`) shows held/"Fewer than 5" for a busy night. The one live surface the product has reads wrong at the demo. Stays High.
- **R1-05.** `privacy.ts:58` says "no personal data" while `privacy.ts:61` (same page) claims Art. 6(1)(f) legitimate interest for check-in, so the page contradicts itself. S15 edits the page and keeps both. Regulatory (conditional). Basis: source-read (this run).
- **R1-06.** S15 adds a "QR codes and short links" section and still omits the one-year `ose_anon` cookie that those scans set. Partial disclosure in the section about the activity is worse than silence, and F-12 makes the words owner-approved. Regulatory (conditional). Read together, R1-02, R1-05, R1-06 are one notice with three known defects, approved with knowledge.
- **R1-09.** Worst case: F-10 unset, so S2's refusal turns T1 red on `main`; S3, S4, S7 and every unrelated merge queue behind it. Stays High.
- **R1-10.** S6's likely positive result (12 of 12 on the model) lands as TL-088 with no fix owner; the epic then records, in its own ledger, that rule 6 is false. Stays High.

## 2. New findings

| id      | Sev        | Slice     | Claim                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                  | Basis                         | Root cause                                | Not in R1 because                                                                       |
| ------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| L2-PO-1 | Medium (5) | S4        | S4 reverses a documented product promise (real-time counts at every tier) and the shipped live view; F-4 asks only whether to adopt memo R4. Sponsor-facing docs are not in S4's sync row (G: "live and admin copy").                                                                              | `docs/features/SPONSORS.md:13,209`; `VISION.md:53`; `PLATFORM-FLOW.md:121`; `live-monitor.ts:12-18,94-96`; subject F-4, G | source-read                   | S4 silently reverses live-count promise   | R1-28 asks only whether R4 binds; R1-17 is about taps                                   |
| L2-PO-2 | Medium (5) | S4, H     | With D2 no, H's "Timing: A: S4" is wrong for every actor, and the 30 s poll lets someone watch the figure cross 5 in the minute it happens. B.3's OSE-1780 inheritance list does not name it. No owner.                                                                                            | subject H row "Timing", B.3 list, `live-monitor.ts:199`                                                                   | source-read; leak inferred    | D2-no leaves timing probe ownerless       | R1-17 scopes H to taps and live figures with OSE-1780 as owner; here no ticket names it |
| L2-PO-3 | Medium (5) | S7        | S7's gap premise is false: ADR-001:54 (hour bucket at submission) is already met by `registration_bucket` and `submitted_bucket`. Only `consent_given_at` and `created_at` stay exact, and that is the consent record. S7 fails the owner's re-anchor trace test.                                  | `forms.ts:296,502,579`; ADR-001:54; subject C.11                                                                          | source-read (this run)        | ADR already satisfied; slice untraceable  | R1-22 rates irreversibility and F-8, not the traceability                               |
| L2-PO-4 | Medium (5) | epic, B.4 | The epic keeps the name "low-volume privacy and click integrity" after every low-volume attendee exposure and every click-integrity slice moved out. Done on OSE-1766 will read as delivered. If OSE-1496 slips it cannot close.                                                                   | subject header, B.2, B.4 row OSE-1766, E.3 "Done for the epic"                                                            | source-read                   | epic name outlives moved scope            | R1-29 covers waiting; none covers name versus outcome                                   |
| L2-PO-5 | Medium (5) | S3        | Migration 0105 coarsens `last_clicked_at`, which nothing reads, on a database with no real taps. A code-only `date('now')` buys the same. The migration adds plan pins, the 2026-10-17 freeze exception and one more staging-ahead migration.                                                      | subject C.9 AC4, Grep-proof "no reader"; R1-26 pins                                                                       | source-read                   | migration costs more than benefit         | R1-26 lists pins; R1-34 is about logs; none proposes dropping it                        |
| L2-PO-6 | Medium (5) | S16, S15  | RA-1 is accepted only on four conditions; conditions 1 and 2 sit with OSE-1496 and OSE-1780. If both slip, ADR-025 and S15 record an acceptance whose conditions are unmet, and F-2 says it blocks "nothing". Nothing says RA-1 is not in force.                                                   | subject F-2, F-3, C.1, C.3 item 2                                                                                         | source-read                   | acceptance recorded with conditions unmet | R1-31 is the `test_ref`; R1-29 is scheduling                                            |
| L2-PO-7 | Low (2)    | E.1       | Wave 0's owner list names F-4, F-8, F-10, F-11. F-12 (S15 words), F-9, F-15 and F-18 also block Wave 1 and 2.                                                                                                                                                                                      | E.1 item 3 versus F table                                                                                                 | source-read                   | Wave 0 owner list incomplete              | R1-35 is about one-liners, not the list                                                 |
| L2-PO-8 | Low (2)    | B.4       | Five tickets are re-titled to different designs (OSE-1769 "sticky suppression" to sealed hours; OSE-1773 "staging proof" to a helper). OSE-1767 "relate or Cancel" and OSE-1776 Cancel lose design history, and a Canceled child may count as complete for a parent roll-up (team setting unread). | subject B.4                                                                                                               | source-read; roll-up inferred | re-titling rewrites ticket history        | R1-45 is counts only                                                                    |

## 3. Per-slice verdict, worst case

- S14: merge into S2 (its first consumer); R1-23 says it is no boundary.
- S16: keep, narrowed; paragraph 1 waits for OSE-1784, and RA-1 text says conditions 1-2 unmet.
- S15: defer behind OSE-1784; merge with a `privacy.ts` truth pass (R1-05, R1-06) or do not ship.
- S5: defer into OSE-1784's return-rate rule; D6 has no build slice.
- S6: keep only with a named fix owner; else defer.
- S2: keep (ADR-001 reaches the raw cookie); AC5 only after F-10 is verified by name.
- S3: keep the log trim, merged with S2; cut migration 0105.
- S4: defer; cut if D2 is no.
- S7: cut (L2-PO-3, F-8).

Worst-case epic: about three PRs (S2 with S3 code and S14, S16, perhaps S6) that remove an insider KV pair and log fields. An attendee's identification risk is unchanged; the owner's first goal is not served by this epic under the worst reading. Section A is honest only for S2, S3 and its non-promise paragraph; its first clause stays false (R1-01).

## 4. Re-rate

R1-02, R1-05, R1-06: High to Regulatory 25, conditional on the first live event. R1-26: add the freeze rule to the closed-when. R1-28: weaker, with L2-PO-1. R1-22: merge with L2-PO-3.

## 5. Not checked

Linear (no tool; B.4 roll-up and OSE-1780/1784 text), RA-1 conditions 3 and 4 and the worksheet, platform facts (KV expiry, log content), the current production level and host state, and any run of tests.

## 6. Commands

Read of AGENTS.md (in context), knowledge file, subject (all of A-K), loop-1 register. Bash read-only: `git log`, `sed`, `grep`, `ls`, `cat` over the `ose-clock-gate` worktree (`sponsor-home-render.ts`, `privacy.ts`, `live-monitor.ts`, `pre-event-activity.ts`, `forms.ts`, `forms-db.ts`, `ADR-001`, docs/features, memo) and the docs checkout (`docs/brain`, memory notes). One write: this file (with `mkdir -p`). None refused.
