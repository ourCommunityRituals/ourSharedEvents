---
ccr: 1
class: security-fix
requested_loops: 3
loops_run: 3
team: base
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 1, critical: 0, high: 2, medium: 3, low: 3 }
---

# CCR: OSE-1784, the SharedReport counts people in one grain (2026-11-23)

Run by Claude Code, which also wrote the change. Every loop's lenses were independent role agents, each given the diff and asked what is wrong; none was given the author's conclusions.

## Verdict

| Item                  | Value                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification        | Security fix (count floor): 3 loops                                                                                                                                                                                         |
| Cumulative score      | **0%**: loop 1 raised a Security Critical finding, which takes no partial credit. Loops 2 and 3 are scored from the open register with that finding weighed at 15, so they show change; the system score stays floored at 0 |
| System score          | **0%** after solutioning: that finding is still open (pre-existing on `main`, see L1-S1)                                                                                                                                    |
| Assessment confidence | 80%: source reads, local test runs and a local Bruno run; nothing seen on staging yet                                                                                                                                       |
| Gate                  | **Stop. Human gate.** The change itself holds; the open items are the owner's to decide (questions end)                                                                                                                     |

**Deviation, stated so it can be judged.** The protocol runs every loop on one subject and changes nothing between loops. This run did not: loop 1 reviewed `b3b0722` (on `main` at `50e93d4`); its in-diff fixes were made and the branch was replayed onto `main` at `aa12ac3` before loop 2 reviewed `51464bf`; loop 2's fixes landed in `5ac68a4`, which loop 3 audited. Every finding below names the loop and subject that raised it.

## What was reviewed

**In scope:** branch `claude/project-thread-j3beh9` from `main` at `aa12ac3`, commits `7d84f8b`, `e18d81e`, `51464bf`, `5ac68a4` (Part of OSE-1784).

- `src/lib/shared-report-builder.ts`: `distinct_scanners`, `corridor_density.this_event_count` (and its ratios) and each `headcount_trend` instance are the sum of the event's published poster rows; `return_rate.sample_size` is always null.
- `src/lib/shared-report.ts`: `refreshCorridorBaselines` adds up those same published poster figures per (res7 cell, weekday, hour) bucket (owner, 2026-11-23, "posters too"); `PUBLISHED_EVENT_IDS_SQL` is removed.
- `src/handlers/qr-scan.ts`: when the KV dedup get or put throws, the scan is not written, takes no place under the poster-hour cap and carries no vote pass (owner, 2026-11-23, "skip counting it"). An unbound KV still writes.
- Comments in `count-floor.ts` and `shared-report-export.ts`; docs `SHARED-REPORT-READ-API.md`, `SHARED-REPORT-BIGQUERY-EXPORT.md`, `SHARED-REPORT-DATA-PIPELINE.md`; threat-ledger TL-097.
- Tests: new `tests/shared-report-one-grain.spec.ts` and `tests/helpers/seed-poster-hours.ts`; 16 updated worker specs; `bruno/fixtures/campaigns-seed.sql` and Bruno S14 82.

The owner decided on 2026-11-23 ("one number, from the posters") that the people figures are the published poster sum and that return rates stay.

**Out of scope:** the corridor map's rounding and its vote-code rule, the BigQuery returns export, and how `/q` mints an id for a request with no cookie. Each is in the register because a lens raised it.

## Loop 1

Team: dr-of-security, role-data-scientist

Critical layer: what is true against what is assumed. Subject `b3b0722`. The dangerous assumption is that a poster-hour of 5 scans is 5 people; the change makes that grain the report's only people figure. Both lenses proved by source reading that the baseline SQL equals the builder's poster figure (same poster join with the scan's event matching the poster's, vote code excluded, same hour truncation, same per-hour floor and rounding, UTC on both sides). The security lens ran nothing; the data lens ran four specs (84 passed).

Findings: L1-S1 to L1-S7 and L1-D1 to L1-D5 in the register.

Score: 0%

## Loop 2

Team: role-backend-architect, role-qa-automation

Conservative layer: assume loop 1 missed things and the worst case is true. Subject `51464bf`. The backend lens built a scratch SQLite from the migrations and read the query plans: the baseline read scanned every scan ever stored before the window filter (L2-B1). It found no missing migration and no path where a failed query becomes a 0 or a 500. The QA lens found the staging layer weak: the one Bruno case was not seen failing, and nothing on staging reads a baseline value.

Findings: L2-Q1 to L2-Q6 and L2-B1 to L2-B5 in the register.

Score: 47%

## Loop 3

Team: role-scrum-master

Recursive layer: was the assessment itself honest. The register statuses match the diff: `PUBLISHED_EVENT_IDS_SQL` is gone, the baseline is built from the poster-hour and event-people steps driven from the window's events, and the `dedupUnavailable` guard sits on both the cap and the write in `qr-scan.ts`. The open rows are open for the reasons given; the export still counts distinct visitors per event (`shared-report-export.ts:506`), so L1-S2 stays open. Three honesty fixes were made. Loop scores for loops 2 and 3 weigh the Security Critical at 15 while the system score is floored at 0, which the Verdict now says. The full-suite figures were taken at `51464bf`, one commit before the head, so they are relabelled and L3-01 stays open until the PR's checks pass on the head. L2-Q2 is proven on a local worker only; staging T2 is still to be seen. Loops 1 and 2 also missed that the baseline windows and buckets events by start time while poster-hours follow scan time (L3-02).

Score: 39%

## Findings register

Weights: Security Critical 15 (no partial credit), High 10, Medium 5, Low 2.

| #     | Finding                                                                                                                                                                                                                                                      | Severity          | From                           | Evidence                                                                                                 | Status                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| L1-S1 | A request with no cookie gets a new id each time, so one person can send 4 scans to a poster in an hour; a published row of 5 then says one other person scanned there. Every count on `main` shares this, the old grain too.                                | Security Critical | Pre-existing, now load-bearing | `qr-scan.ts` id mint and dedup key; `public-read-limit.ts:53,246` (source read)                          | open: owner chose "once per poster per hour" (2026-11-23), story OSE-2212                                               |
| L1-S2 | The BigQuery returns export still admits an event by its distinct people. With 7 and 3 at one poster the report shows 5 while a group of that event alone can export 10.                                                                                     | High              | This change                    | `shared-report-export.ts:495-503` (source read); latent, the dataset has no reader yet                   | open: owner chose "yes, same poster number" (2026-11-23), story OSE-2213                                                |
| L1-S3 | Return rates stay on the people grain, so a published rate bounds a count the report no longer shows.                                                                                                                                                        | Medium            | Owner's choice                 | `shared-report-builder.ts` return-rate queries (source read)                                             | closed: accepted by the owner, 2026-11-23 ("return rates stay")                                                         |
| L1-S4 | The corridor map rounds once per cell-hour after adding poster-hours, and its rollup does not leave out the vote code; poster rows round each poster-hour first. Two posters of 7 and 8 read 10 in the rows and 15 on the map.                               | Medium            | Pre-existing                   | `shared-report.ts` cell rollup, `shared-report-builder.ts` map read (source read)                        | open: its own story                                                                                                     |
| L1-S5 | The baseline is refreshed nightly and the report is built on demand, so a late queued scan or an erasure can make them differ for a while, always by a multiple of 5.                                                                                        | Low               | This change                    | `refreshCorridorBaselines` cron vs `buildSharedReport` (source read)                                     | open                                                                                                                    |
| L1-S6 | Feature docs and threat-ledger TL-097 still named `PUBLISHED_EVENT_IDS_SQL` as the baseline's gate.                                                                                                                                                          | Low               | This change                    | grep of `docs/` and `threat-ledger.ts`                                                                   | fixed: `51464bf`; the brain files follow at merge (Before shipping)                                                     |
| L1-S7 | A KV fault now also stops vote passes: the vote code's scan is not stored, so no pass is issued.                                                                                                                                                             | Medium            | This change                    | `qr-scan.ts` `scanStored` and the pass branch (source read); voting is off everywhere (`VOTING_ENABLED`) | fixed: owner chose "keep voting working" (2026-11-23); the vote code skips the check, `vote-pass.spec.ts` test born red |
| L1-D1 | The baseline's suppression note, `count-floor.ts`, the export comment and two docs still called the baseline distinct people.                                                                                                                                | Medium            | This change                    | `shared-report-builder.ts:186`, `count-floor.ts:304`, `shared-report-export.ts:758`                      | fixed: `51464bf`                                                                                                        |
| L1-D2 | The snapshot archive and the BigQuery baseline export keep their columns but change meaning from the first nightly run after deploy, with no marker in the data.                                                                                             | Medium            | This change                    | `corridor_density_snapshots` `INSERT OR IGNORE` by date; export columns unchanged (source read)          | open: documented in `SHARED-REPORT-READ-API.md`; a marker would be a migration                                          |
| L1-D3 | No test proved the baseline equals the report's figure beyond one event alone in its slot.                                                                                                                                                                   | Medium            | This change                    | `shared-report-one-grain.spec.ts` at `b3b0722`                                                           | fixed: `51464bf`, two events, three posters, an hour under 5, the vote code, stray scans; born red                      |
| L1-D4 | KV fault stops vote passes (same as L1-S7).                                                                                                                                                                                                                  | Low               | This change                    | as L1-S7                                                                                                 | withdrawn: duplicate of L1-S7                                                                                           |
| L1-D5 | The doc called the ratio a density against a rolling baseline; it is this event's share of its slot.                                                                                                                                                         | Low               | This change                    | `SHARED-REPORT-READ-API.md` section 3                                                                    | fixed: `5ac68a4`                                                                                                        |
| L2-Q1 | Nothing on staging reads a baseline value, so a revert to counting people would pass T2 to T4.                                                                                                                                                               | High              | This change                    | grep of `bruno/` and `tests/e2e/` (source read); no route runs the nightly job on demand                 | open: its own story (a staging read after the nightly run)                                                              |
| L2-Q2 | The Bruno case S14 82 and its fixture were not seen failing first.                                                                                                                                                                                           | High              | This change                    | one commit holds both                                                                                    | fixed locally: main's builder 70 passed and 1 failed (that case), the branch 71 passed; staging T2 not yet seen         |
| L2-Q3 | Removing `!dedupUnavailable` from the cap condition survived every test, and would burn real visitors' places.                                                                                                                                               | Medium            | This change                    | `qr-scan.spec.ts` asserted only rows written                                                             | fixed: `5ac68a4`, a test reads `scan_poster_hour_tally`; born red on that mutant                                        |
| L2-Q4 | The unbound-KV path that still writes had only an old, indirect test.                                                                                                                                                                                        | Medium            | This change                    | `qr-scan.spec.ts:326`                                                                                    | fixed: `5ac68a4`                                                                                                        |
| L2-Q5 | Exact `sample_size` assertions became `toBeNull()`, and the neighbour harness's rate rule is weaker (a rate in 0 to 100, not a rate that cannot rebuild a group under 5).                                                                                    | Medium            | This change                    | diffs of four specs                                                                                      | open                                                                                                                    |
| L2-Q6 | The pending-note check now discriminates by the rate note, not a number.                                                                                                                                                                                     | Low               | This change                    | `shared-report-pending-note-floor.spec.ts`                                                               | withdrawn: the lens judged it still a real check                                                                        |
| L2-B1 | The baseline's poster-hour read scanned all of `scan_placement_events` before the 90-day filter.                                                                                                                                                             | Medium            | This change                    | scratch-DB `EXPLAIN QUERY PLAN`: `SCAN s USING INDEX idx_spe_event_poster`                               | fixed: `5ac68a4`, driven from the window's events; plan `SCAN w`, `SEARCH s USING INDEX ... (event_id=?)`               |
| L2-B2 | KV fault stops vote passes (same as L1-S7).                                                                                                                                                                                                                  | Medium            | This change                    | as L1-S7                                                                                                 | withdrawn: duplicate of L1-S7                                                                                           |
| L2-B3 | Deploy day mixes units until the nightly run, and a snapshot written earlier that day keeps the old meaning.                                                                                                                                                 | Low               | This change                    | upsert vs `INSERT OR IGNORE` (source read)                                                               | withdrawn: folded into L1-D2                                                                                            |
| L2-B4 | The trend reads poster rows once per instance.                                                                                                                                                                                                               | Low               | This change                    | `readPosterAttribution` per instance, `shared-report-builder.ts:622,1084` (source read, no run)          | closed: one query per instance, as on `main`                                                                            |
| L3-01 | No full worker or root suite has run at the head `5ac68a4`; the suite figures are from `51464bf`, and `5ac68a4` changed the baseline query and the `/q` specs.                                                                                               | Low               | Loop 3                         | Verification section                                                                                     | open: closes when the PR's checks are green on its head                                                                 |
| L3-02 | The baseline windows and buckets an event by its start time, but sums its poster-hours by scan time, so scans far from the start hour still count under the event's slot. Equality with the report holds per event; the slot is the event's, not the scan's. | Low               | Loop 3                         | `shared-report.ts` `refreshCorridorBaselines` (source read, no run)                                      | open                                                                                                                    |
| L2-B5 | The dedup change reaches only `/q`; the queue consumer and the cap behave.                                                                                                                                                                                   | Low               | This change                    | `scan-buffer.ts`, `poster-hour-cap.ts` (source read)                                                     | withdrawn: no defect                                                                                                    |

## Solutioning

What closed during the run: L1-S6, L1-D1, L1-D3 in `51464bf`; L1-D5, L2-Q2, L2-Q3, L2-Q4, L2-B1 in `5ac68a4` and the local Bruno run.

How the rest reaches 95%:

- **L1-S1 (Security Critical).** Not fixable inside this change, and not widened by it: the old grain counted the same minted ids. Options for the owner: count a scan only from a visitor whose cookie was set before that hour; or require a published poster-hour to hold scans from at least 5 ids first seen on different days. Both raise the cost of the attack; neither ends it, since any count floor can be met by 4 real phones. A story either way.
- **L1-S2 (High).** The returns export needs the same answer the baseline got: either gate it on the event's published poster figure and stop exporting people counts beside it, or accept the mismatch while the dataset has no reader. Owner question 2.
- **L1-S7 (Medium).** Either let the vote code's scans skip the dedup check (they publish no figure, OSE-2140), or accept that voting pauses during a KV fault. Owner question 3.
- **L2-Q1 (High).** A staging check that reads a baseline after the nightly run (the nightly phone audit runs then). Its own story.
- **L1-S4, L1-D2, L2-Q5, L1-S5.** L1-S4 becomes its own story with the vote-code exclusion. L1-D2 needs a marker column if the owner wants one. L2-Q5: restate the harness rule against published numbers only. L1-S5 is accepted or closed by a story that rebuilds the baseline on demand.

With L1-S1 settled and the other open items closed or accepted, the score reaches 100 − 0; with only L1-S1 settled, 100 − 20 − 20 − 2 = 58.

## What must be true before shipping

1. The owner answers questions 1 to 3, and each answer becomes a story or is folded in (done 2026-11-23: OSE-2212, OSE-2213, and the vote code in this PR). The owner answers question 4.
2. The PR's checks are green on its head, and the worksheet gate passes.
3. After merge, `docs/brain/ROLE-STATE.md` and `docs/brain/CONSTRAINTS.md` stop naming `PUBLISHED_EVENT_IDS_SQL` as the baseline's gate.

## Verification

- Born red: on `main`'s builder the one-grain spec and the neighbour harness fail 7 tests (`1+4: this_event_count = 5, poster sum = null`); the two-event baseline test fails on a baseline query without the vote-code and event-match conditions (30 against 20); the new `/q` tests fail on the code before the change and on the cap mutant.
- Not re-run at the head `5ac68a4` (L3-01). Worker suite at `51464bf`: 15,573 passed (workers 9,001 and 2 skipped; node 6,572). Root `npm test`: 5,817 passed, 1 failed, the worksheet gate on the earlier version of this file.
- Bruno S14 folder on a local worker: 71 passed at `5ac68a4`; on `main`'s builder, 70 passed and S14 82 failed.
- After merge: T1 to T4 green on the merge commit; T2 runs S14 82 on staging.

## Risks accepted

- Return rates stay on the people grain (owner, 2026-11-23), L1-S3.
- No head count for an event without posters (owner's choice of grain).
- The `sample_size` key stays, always null, for old readers.

## Human gate

1. **Free ids (L1-S1, loop 1, Critical layer).** A visitor with no cookie counts as new each time, so 4 scans by one person plus one real visitor publish a 5. This is true of every count today, not only the report. Should a scan count only once its visitor's cookie has been seen before?
   What would close it: the owner's choice of rule, then a story.
   Answered 2026-11-23: "once per poster per hour", story OSE-2212.
2. **The returns export (L1-S2, loop 1, Critical layer).** Should the BigQuery returns export be gated on the same published poster figure, or accepted as is while it has no reader?
   What would close it: the owner's choice.
   Answered 2026-11-23: "yes, same poster number", story OSE-2213.
3. **Voting during a storage fault (L1-S7, loop 1, Critical layer).** Should the room's vote code skip the double-scan check, since its scans are never a published count, or should voting pause?
   What would close it: the owner's choice.
   Answered 2026-11-23: "keep voting working", built in this PR.
4. **Merging with L1-S1 open (loop 3, Recursive layer).** The Security Critical finding is pre-existing and now tracked in OSE-2212, so the system score stays at 0 until that story ships. Does the owner accept merging this PR before OSE-2212?
   What would close it: the owner's merge, or a wait for OSE-2212.
