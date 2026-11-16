---
ccr: 1
class: security fix (count floor, never who) plus an owner decision
requested_loops: 4
loops_run: 4
team: Dr of Security, Sr Data Scientist, Lead Backend Architect, Sr Automation QA, Product Owner
gate: human (owner decision)
system_score: 94.75
assessment_confidence: 85
subject: scripts/ci/map-counts-check.mjs and its wiring on main at 6911a06; the fix in draft PR 1341
---

# CCR: the map count check, and an admin read of share opens (2026-11-16)

Linear OSE-2071, the last item between OSE-1896 and Done.

## Verdict

|                           |                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommendation**        | **Option A: keep the D1 read in CI as the proof for share opens and scans, and reword OSE-1896's line to say so.** Do not build an admin read of share opens for this test.                        |
| **System score**          | **94.75%** (the count check as it stands with PR 1341). Two open rows: the scan number cannot move with this fixture (R4), and the CI token's reach cannot be seen from the repository (R5).       |
| **Security Critical**     | None.                                                                                                                                                                                              |
| **Assessment confidence** | **85%.** Acceptance line (a) is seen in CI logs, and the born-red list is seen in local runs. The share-open and scan reasoning is read from source. The environment-level secrets cannot be seen. |
| **Gate**                  | **Human gate.** The decision is the owner's. A CCR score is a signal, never permission.                                                                                                            |

## What was reviewed

**In scope:**

- `scripts/ci/map-counts-check.mjs`
- `tests/unit/ci/map-counts-check.test.js`
- `bruno/fixtures/map-zoom-area-seed.sql`
- the workflow steps "Seed map zoom area fixture", "Map counts unchanged after the Pages run", T4k-seed, T4k, T4k-check and T4k-reset (`.github/workflows/oursharedevents-ci.yml:1638-1720`, `:2534-2600`)
- `lib/count-floor.ts`, `lib/share-count.ts`, `handlers/event-code.ts`, `handlers/pre-event-activity.ts`, `lib/admin-object-scope.ts`, `lib/scan-buffer.ts`
- the CI runs named below

**Out of scope:**

- The rest of OSE-1896: the mock sweep, the Bruno sweep, the walk and fat-finger. Those were verified in its earlier comments.
- Building option B.
- The environment-level secrets in GitHub and the token's scope in Cloudflare.

## Acceptance lines of OSE-2071 that do not depend on the decision

### (a) The script ran against staging D1 and reported the seeded numbers: verified

- The step runs `node ../../scripts/ci/map-counts-check.mjs` with no flag (workflow `:1707` and `:2583`).
- With no flag, the script reads `--env staging --remote` (`map-counts-check.mjs`, `wranglerArgs`). `tests/unit/ci/map-counts-check.test.js` pins this.
- `wrangler.toml:178-180` binds `DB` to `ocr-db-staging` under `[env.staging]`.

| Run (commit)          | Job                              | Step                                                        | Printed                                                                                                                              |
| --------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 43659648419 (7b6a364) | T4 surfaces 132648698455         | T4k-check, success                                          | `map counts read: {"taps_a":42,"taps_b":8,"tap_days":0,"share_opens":10,"share_open_rows":2,"scans":0}`, then `map counts unchanged` |
| 43784990637 (c2d94e9) | T4 surfaces 133035989636         | T4k-check (step 36), success                                | the same row, then `map counts unchanged`                                                                                            |
| 43784990637 (c2d94e9) | T2 Contract (pages) 133034512295 | Map counts unchanged after the Pages run (step 27), success | the same row, then `map counts unchanged`                                                                                            |

- The read reached staging. A local D1 does not exist in those jobs, and a `--local` read there would have failed. The numbers are the seed's.
- The log does not print the wrangler command, so "remote" rests on the code path, not on a log line. PR 1341 adds that line: `read 6 numbers from staging D1 (--env staging --remote)`.

### (b) Born red: a moved tap, a moved share open, a scan row and an unreadable answer each turn the script red

**Before this CCR (PR 1247), against a local D1:**

- A moved tap (F4, B13, D1) and a moved share open (D2) were seen turning the script red.
- A scan row and an unreadable answer were seen red only in the pure functions `differences()` and `firstRow()`.
- `main()`, which decides the exit code, had no test. Deleting its wrangler exit-code check survived every test.

**Now (PR 1341):** `tests/unit/ci/map-counts-check-script.test.js` runs the script as a process, with a stand-in `npx` first on PATH. All four cases, and a wrangler failure, turn it red. Eight faults were put in one at a time, and every new test failed under at least one:

| Fault                                      | Red                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| F1 `return 0` after the differences        | 5: a moved tap, a moved share open, a scan row, unreadable, text number |
| F2 the `r.status !== 0` branch removed     | 2: both "wrangler failed" tests                                         |
| F3 no flag reads local                     | 3                                                                       |
| F4 the read row printed again              | 1                                                                       |
| F5 wrangler output echoed whole on failure | 1                                                                       |
| F6 the success path returns 1              | 1                                                                       |
| F7 a difference line names the value read  | 4                                                                       |
| F8 no row reads as no difference           | 2                                                                       |

These are local runs. PR 1341's CI is the standing proof.

## The decision

### Option A: keep the D1 read in CI

**What it proves:**

- After the browser walk (T4k) and the Pages run (T2), the fixture's taps, share opens and scans hold the exact seeded numbers. "Unchanged" means exactly unchanged, at every size, including a single open.

**What it does not prove:**

- It is not an HTTP contract. It reads the tables, not what an organizer can see.
- The scan number cannot move with this fixture (R4).

**What it costs:**

- No new credential. The read uses `CLOUDFLARE_API_TOKEN_OSE`, which the seed steps in the same jobs already use (`:1642`, `:2538`).
- That token can write to D1. The script sends one fixed SELECT (`map-counts-check.test.js` pins it as a single read-only statement).
- About a minute of runner time per leg, already spent today.

**Can it leak?**

- Before PR 1341, yes, in a small way. The repository is public, so its Actions logs are too. Every run printed the whole row, including the values 0 and 2. A failure would print a moved value exactly, often under 5.
- The events are synthetic, and no identity column was ever selected.
- With PR 1341 nothing read is printed: only which number moved, or that it could not be read.
- Never who: the SQL holds `SUM` and `COUNT` only.

### Option B: an admin read of share opens

**What it would expose:**

- The first read of share opens anywhere. Today `share_opens_daily` is written (`lib/share-count.ts:52`) and deleted (`handlers/events.ts:2017`), and nothing reads it.
- The table is keyed by event, screen, phase and UTC day.

**How the floor and never who would hold:**

- Only an event total, as `floorTotalOfParts` over the cells (`lib/count-floor.ts:79-86`).
- No by-day or by-screen cells. By day is the most identifying grain (Data Scientist).
- Brand scoping is automatic under `/api/v2/admin/events/:id/**` (`guardAdminObjectScope`; `tests/admin-object-scope.invariant.spec.ts` already reads this route).
- It is a GET, so the write guard does not apply.
- The floor is not tier-gated. A per-day series may be a paid feature, but it must be floored at every tier.
- Public event responses are untouched.
- Care point (Backend Architect): put the field in the organizer-only handler, not in `readPreEventActivity`. That function feeds the sponsor card (`sponsor-home.ts`) and the live view too.

**Re-identification risk:**

- An exact total of 5 or more, read before and after sending a link to one person, shows that person's open (5 to 6). The floor holds per read, not across reads.
- The same gap exists today for tap totals. This is an inference: `handlers/pre-event-activity.ts:9-14` floors taps per code, so a total of 5 or more is exact and can be read twice.
- Rounding (`roundForPublish`) would close it, but would also hide the move the test needs.

**Would B replace the D1 read? No:**

- A new open lands in today's row with `opens = 1`. `floorTotalOfParts` leaves any part under 5 out of the total, so the total stays 5 and the move is invisible.
- The scan number is seeded at 0. It reads "Fewer than 5" before and after, so a move of 1 to 4 is invisible.
- So the D1 read stays under B either way.

**What it costs:**

- About 3 points: the handler, a floor spec at the workers-pool layer, a Bruno request, the router header and Dr of Security review.
- No migration: `share_opens_daily` is migration 0096.

**Product need:**

- None found. No story, ADR, PRODUCT.md line or SharedReport field asks for organizers to see share opens (PO lens).

### Recommendation and reasons

**Option A.**

1. B cannot prove "unchanged" for a single open or a scan, so it would not retire the D1 read. It would add a surface and keep the script.
2. B would publish share opens for the first time, with a new differencing path, to satisfy a test line and not a product need.
3. A adds no credential and, with PR 1341, prints no count.

**What would change it:**

- A product decision that organizers should see share opens. B is then worth building as its own story, with Dr of Security, for its own sake. The D1 check would still stay.
- An owner rule that a staging acceptance line counts only HTTP evidence.
- Evidence that the CI token reaches production D1 and the owner wants CI off direct D1 reads. That would also touch every seed step, not only this check.

## Loops

### Loop 1: surface pass (five lenses in parallel, merged once)

**Critical:**

- Most dangerous assumption: "the check proves no count moved."
- True: it ran against staging and read the seeded numbers.
- Assumed: that it can fail for each count, and that it shows nothing it should not.

**Conservative:**

- It prints counts to a public log (R1, R2).
- Its exit path is untested (R3).
- The scan number cannot move (R4).
- The token's reach is unseen (R5).
- The T2 and T4 legs might overlap, so one leg's re-seed could hide the other's moved count (R6, claimed).

**Recursive:** first loop, score 79.4.

**Corrections to the lenses:**

- The PO lens said the fixture's share opens would read "Fewer than 5". Each is exactly 5, so a floored read shows 5.
- The Backend Architect said a floor hides a move of 1 inside a cell above 5. Under `applyCountFloor` alone it does not: 5 to 6 shows.
- The real blind spot is the one Dr of Security found: a new day row under 5 is dropped from a `floorTotalOfParts` total.

### Loop 2: pressure pass (lead, against code and CI)

**R6 refuted:**

- `functional-staging-sub` needs `smoke-staging`, which needs `contract-staging`, which waits for every T2 leg, Pages included.
- In run 43784990637 the T2 check ran at 01:27:57 and T4k-seed at 01:36:28.
- Across runs, the `ose-staging-chain` lock (workflow `:151-183`) keeps them apart.

**R4 confirmed:**

- A scan row needs a `poster_deployment_id` (`lib/scan-buffer.ts:108`).
- The seed creates no placement.
- Scans also pass through `SCAN_QUEUE` (`wrangler.toml:256-262`, `max_batch_timeout = 5`).
- Mitigation that holds: the walk fails on any request to a tracked path (`tests/e2e/3-flows/map-place-panel.spec.ts:825-829`), and the Bruno and mock sweeps refuse `/q/` in any href.

**Reactive correction:** R1, R2 and R3 fixed on a branch, with tests that were seen failing on eight faults.

**Recursive:** 88.9. The fixes count at half until CI runs them.

### Loop 3: confirmation pass (an independent Dr of Security read of the diff, plus PR CI)

See "Loop 3 result" below.

### Loop 4: the recommendation under attack (lead)

The case for B, at its strongest, and the answer to each point:

| The case for B                                                              | Answer                                                                                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ticket says "through the admin API", so an HTTP read is the honest bar. | The line was written before it was known that share opens have no read. Rewording it to what is proven is the honest course (OSE-2071's own last line asks for this). |
| A D1 read can drift from the schema.                                        | It fails closed. A renamed table or column is "unreadable", and the step goes red.                                                                                    |
| Holding a D1 credential in CI is a risk.                                    | It is already held, by every seed step. A adds nothing.                                                                                                               |
| Organizers may want share opens one day.                                    | Then build B for them, as its own story. It still would not replace the D1 check.                                                                                     |

The recommendation stands. Score unchanged.

## Findings register

Weights: Medium 5, Low 2. All findings sit in CI against staging (×0.75). All were found in loop 1 (×1.0). R1 and R2 are causally linked, so their sum is multiplied by 1.5.

| #   | Finding                                                                                                                                                | Base | Evidence                                                         | Loop 1       | Loop 2                    | Loop 3 (after PR CI) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------- | ------------ | ------------------------- | -------------------- |
| R1  | The script printed every number it read to a public log, and a moved value exactly                                                                     | M 5  | verified: job logs above; `map-counts-check.mjs:117,119` on main | R1+R2: 7.875 | 3.94 (fixed, CI pending)  | 0 if CI green        |
| R2  | On a wrangler failure, its output was echoed whole, even with a result row in it                                                                       | L 2  | verified from code, `:110`                                       | (in R1+R2)   | (in R1+R2)                | 0 if CI green        |
| R3  | `main()` untested: a scan row and an unreadable answer were born red only at the function level; deleting the exit-code check survived                 | M 5  | verified: fault F2 survived before, red after                    | 3.75         | 1.875 (fixed, CI pending) | 0 if CI green        |
| R4  | The scan number cannot move with this fixture (no placement; queue delay). The request watch is what keeps `/q` out                                    | M 5  | verified from code: `scan-buffer.ts:108`, the seed               | 3.75         | 3.75                      | 3.75 (open, owner)   |
| R5  | `CLOUDFLARE_API_TOKEN_OSE` can write to D1, and production deploy uses the same name. Whether production has its own environment secret cannot be seen | L 2  | inferred: workflow `:2770`, `:2844`                              | 1.5          | 1.5                       | 1.5 (open, owner)    |
| R6  | The T2 and T4 legs overlap, so a re-seed hides a moved count                                                                                           | M 5  | refuted in loop 2                                                | 3.75         | 0                         | 0                    |

**Score arithmetic:**

- Loop 1: 100 − (7.875 + 3.75 + 3.75 + 1.5 + 3.75) = **79.4**
- Loop 2: 100 − (3.94 + 1.875 + 3.75 + 1.5) = **88.9**
- Loop 3, with PR 1341 green: 100 − (3.75 + 1.5) = **94.75**. Below 95, so the human gate.

## What must be true before OSE-1896 goes to Done

1. The owner answers A or B.
2. Under A: OSE-1896's line is reworded to the proposed text, and OSE-2071's boxes are ticked by the owner. PR 1341 is merged after review, and its staging run is green.
3. Under B: a new story, with Dr of Security, builds the read. OSE-1896 waits for it.

## Risks accepted under A

- The check is not an HTTP contract.
- The scan number guards nothing on its own with this fixture (R4) until a placement is seeded.

## Questions for the owner

1. **A or B?** Recommended: A.
2. **Under A, is the proposed wording for OSE-1896 right?**
3. **The scan number (R4):** accept it, since the walk's request watch and both sweeps keep `/q` out, or open a ticket to seed a poster placement so the number can move? The queue delay makes that ticket larger than it looks.
4. **Not needed for the decision (R5):** is `CLOUDFLARE_API_TOKEN_OSE` scoped to staging D1, or shared with production? It is a Cloudflare and GitHub settings question.

## Loop 3 result

(Filled after the independent read and PR 1341's CI.)
