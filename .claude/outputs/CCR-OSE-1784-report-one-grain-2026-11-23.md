# CCR: OSE-1784, the SharedReport counts people in one grain (2026-11-23)

| Item                  | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| Classification        | Security fix (count floor): 3 loops                            |
| System score          | **70%** (100 − 10 − 10 − 5 − 5)                                |
| Assessment confidence | 85%: source reads plus local runs; nothing seen on staging yet |
| Gate                  | **Human gate.** Below 95%; questions at the end                |

## What was reviewed

**In scope:** the uncommitted change on local branch `wip-report-one-grain` (from `main` at `50e93d4`).

- `src/lib/shared-report-builder.ts`
- `src/lib/shared-report.ts` (a comment only)
- `docs/features/SHARED-REPORT-READ-API.md`
- the new spec `tests/shared-report-one-grain.spec.ts` and helper `tests/helpers/seed-poster-hours.ts`
- 13 updated worker specs
- `bruno/fixtures/campaigns-seed.sql` and Bruno request S14 82

The owner decided on 2026-11-23 ("one number, from the posters") that these figures are the sum of the published `poster_attribution` rows:

- `distinct_scanners`
- `corridor_density.this_event_count`, and with it the density ratios
- each `headcount_trend` instance

`return_rate.sample_size` is always null. Return rates stay.

**Out of scope:** the corridor map grain, the scan path's dedup, and the corridor baseline's grain. They are recorded as findings below.

## Loop 1 (surface; Critical, Conservative, Recursive). Team: author

**Critical.** The assumption is that the poster sum is a safe people figure. It is a `floorTotalOfParts` sum of rows that are each floored per hour and rounded to a multiple of 5.

**Conservative.** Every surface that read the old grains was found by grep:

- `sample_size`: template, Bruno 86/88, Playwright fixture. They read null or a mock, so none breaks.
- `distinct_scanners`: the corridor map fallback, the `_event` note.

**Findings:**

- L1-01: 32 worker tests seeded `scan_aggregates` as people. Resolved by seeding poster-hours (`tests/helpers/seed-poster-hours.ts`).
- L1-02: a stale comment on corridor rates. Resolved.

**Score:** 100 after resolution.

## Loop 2 (pressure). Team: Dr of Security and Sr Data Scientist, independent reads

| ID    | Finding                                                                                                                                                                                                                                                                                                                                                                                       | Weight   | Status                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| S2-01 | The corridor baseline is still distinct anon people (`shared-report.ts:380-396`). An event alone in its slot publishes its own anon count, rounded, beside the poster sum. A published rate also implies at least 10 people. Either can show that someone exists outside the published poster-hours. The range is 1 to 9, so it tells "none" from "some", though not a group under 5 exactly. | High 10  | **Open:** owner question 1                                                          |
| S2-02 | The people figure counts scan rows. `/q` dedup is a KV get-then-put that fails open (`qr-scan.ts:216-238`). During a KV fault, 2 to 4 people scanning repeatedly could reach a published 5. Before this change, only the poster rows depended on it.                                                                                                                                          | High 10  | **Open:** owner question 2                                                          |
| D2-01 | The density ratio divides poster scans by a baseline of distinct people, which mixes units.                                                                                                                                                                                                                                                                                                   | Medium 5 | Documented (`SHARED-REPORT-READ-API.md`). Closed fully only by question 1. Counted. |
| D2-02 | The label "Distinct Scanners" (owner lexicon, 2026-10-11) now names a sum of poster scans.                                                                                                                                                                                                                                                                                                    | Medium 5 | **Open:** owner question 3                                                          |
| D2-03 | Events with no poster, or no poster-hour reaching 5, show no head count.                                                                                                                                                                                                                                                                                                                      | Medium   | Accepted: the consequence of the owner's choice. Not counted.                       |
| D2-04 | A null `distinct_scanners` gave no reason, so the card showed a bare dash.                                                                                                                                                                                                                                                                                                                    | Low      | **Resolved:** a reason in words, the same at 0 and at 1 to 4                        |
| D2-05 | The trend reads poster rows once per instance.                                                                                                                                                                                                                                                                                                                                                | Low      | Accepted. The old code also made one query per instance.                            |
| S2-03 | The corridor map's cell rollup does not exclude the vote code. The poster rows do.                                                                                                                                                                                                                                                                                                            | (Medium) | Pre-existing and out of this diff. To be filed as its own story. Not counted.       |
| S2-04 | Map cells and poster rows round differently, which leaks rounding residues but no group under 5.                                                                                                                                                                                                                                                                                              | (Low)    | Pre-existing. Not counted.                                                          |
| S2-05 | Bruno 82's trend check passed with nothing checked, because the fixture has no series.                                                                                                                                                                                                                                                                                                        | Low      | **Resolved:** replaced by a `this_event_count` check                                |

**Recursive.** The score fell from 100 to 70. That is the protocol working: the pressure pass found grains outside the diff that still meet the new figure.

## Loop 3 (confirmation). Team: author

- **Born red:** with `main`'s builder in place, the new spec and the neighbour harness fail with 7 failures. One example: `1+4: this_event_count = 5, poster sum = null` (5 published for 1 and 4 people). With the change, they pass.
- **Worker suite:** 15,494 of 15,496 passed. The 2 failures were `event-series.spec.ts` seeding the old grain. They were fixed and rerun: 69 of 69.
- **Report specs and event-series after the loop 2 fixes:** 653 of 653.
- **Root `npm test`:** 5,710 passed, 322 skipped, 0 failed.
- **Other checks:** `tsc` clean, the pool manifest `--check` up to date, Prettier clean on the changed files.
- **Not run:** staging. Bruno 82 and the fixture run only after a merge.

**Score:** 70. Unchanged, because loop 2's open findings need the owner.

## Score arithmetic

100 − S2-01 (10) − S2-02 (10) − D2-01 (5) − D2-02 (5) = **70%**.

## Before shipping

1. PR #1523 merges first, because the branch is shared. Then this branch is restarted from `main` and pushed as its own PR (`Part of OSE-1784`).
2. The owner answers questions 1 to 3. Each answer either becomes a follow-up story or is folded in before merge.
3. After merge, T1 to T4 must be green on the merge commit. T2 runs Bruno 82 against the new fixture.

## Risks accepted (by the owner's choice)

- D2-03: no head count for an event without posters.
- The `sample_size` key stays, always null, for old readers.

## Human-gate questions

1. **Baseline grain (S2-01, D2-01; found in loop 2, Critical layer).** Should the corridor baseline also be the sum of published poster figures? Every density number would then be one grain. The nightly snapshot archive would change meaning from that day. Recommended: yes, as the next story.
2. **Dedup (S2-02; loop 2, Conservative layer).** When the `/q` dedup cannot read KV, should a scan be stored but not counted? That under-counts during a fault instead of over-counting. Recommended: yes. It is a small change in `qr-scan.ts`, next to PR #1523's poster-hour cap.
3. **Label (D2-02; loop 2, Critical layer).** Keep "Distinct Scanners", or name it for what it now counts, for example "Poster scans"? Recommended: keep it until question 1 is settled, then decide once.
