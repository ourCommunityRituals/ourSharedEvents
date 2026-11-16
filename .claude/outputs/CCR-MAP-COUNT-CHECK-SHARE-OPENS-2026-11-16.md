---
ccr: 1
class: security-fix
requested_loops: 3
loops_run: 3
team: base
gate: stop
cumulative_score: 57.1
system_score: 92.5
unresolved: { regulatory: 0, security_critical: 0, critical: 0, high: 0, medium: 1, low: 2 }
pr: 1341
subject_sha: '6911a0624dd6b7576c45fe783377308501366128'
---

# CCR: the map count check, and an admin read of share opens (2026-11-16)

Linear OSE-2071, the last item between OSE-1896 and Done.

**What was asked:** "if a CCR assessment will help with the solution, use it". The brief named this a count-floor and never-who question, with Dr of Security among the lenses. Class: security fix, which needs 3 loops.

**How it ran:**

- Three loops, in order: Critical, Conservative, Recursive.
- The subject is `main` at `6911a06`: the count check script, its tests, its wiring and the fixture. It did not change during the run.
- The solution (draft PR 1341) was written during the run, on a branch.
- There is one cumulative score. It is under 95%, so the solutioning is written below.
- **Departures from the protocol, recorded:**
  - **A breach of the owner's run rule (2026-11-01/02): "nothing is changed between loops".** The lead wrote the first commit of PR 1341 between loops 1 and 2, and loop 2 read it alongside the subject. The subject itself, `main`, did not change. Loop 2's two findings (R7, R8) are findings against that first fix. They are counted in loop 2 and closed in the solutioning.
  - **The lead planned 4 loops; the run has 3.** The worksheet gate showed that two of the planned loops had no role lens: they were the lead's own checks. So they are reported inside the merges of loops 1 and 2, as the lead's checks of what the lenses said. The class minimum is 3.
  - **Loop 3 ran after the gate's first failure on the PR.** Its subject is this worksheet's honesty, as a Recursive loop's subject is.

## Verdict

|                           |                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recommendation**        | **Option A: keep the D1 read in CI as the proof for share opens and scans, and reword OSE-1896's line to say so.** Do not build an admin read of share opens for this test.                                                                                                                       |
| **Cumulative score**      | **57.1%**, the worst loop (loop 2), with every finding open as found.                                                                                                                                                                                                                             |
| **System score**          | **92.5%** after the solutioning. It holds once PR 1341 is merged with its CI green. Three rows stay open: the scan number cannot move with this fixture (R4), the CI token's reach cannot be seen from the repository (R5), and the script's Windows branch is not tested (R15, a risk accepted). |
| **Security Critical**     | None.                                                                                                                                                                                                                                                                                             |
| **Assessment confidence** | **80%.** Acceptance line (a) is seen in CI logs, and the born-red lists are seen in local runs. The share-open and scan reasoning is read from source. The environment-level secrets cannot be seen. Down from 85 after loop 2 showed the first fix was incomplete.                               |
| **Gate**                  | **Stop, human gate.** The decision is the owner's. A CCR score is a signal, never permission.                                                                                                                                                                                                     |

## What was reviewed

**In scope:**

- `scripts/ci/map-counts-check.mjs`
- `tests/unit/ci/map-counts-check.test.js`
- `bruno/fixtures/map-zoom-area-seed.sql`
- the workflow steps "Seed map zoom area fixture", "Map counts unchanged after the Pages run", T4k-seed, T4k, T4k-check and T4k-reset (`.github/workflows/oursharedevents-ci.yml:1638-1720`, `:2534-2600`)
- `lib/count-floor.ts`, `lib/share-count.ts`, `handlers/event-code.ts`, `handlers/pre-event-activity.ts`, `lib/admin-object-scope.ts`, `lib/scan-buffer.ts`
- the CI runs named below
- the decision between options A and B

**Out of scope:**

- The rest of OSE-1896: the mock sweep, the Bruno sweep, the walk and fat-finger. Those were verified in its earlier comments.
- Building option B.
- The environment-level secrets in GitHub and the token's scope in Cloudflare.

### Acceptance line (a): the script ran against staging D1 and reported the seeded numbers. Seen in CI logs; the remote read is inferred from the code path.

- **Seen by the lead** in the job logs (fetched through the GitHub API on 2026-11-16): the lines in the table below. The loop 3 lenses had no network and could not re-check them.
- Both run commits are on `main`. Run 43659648419 is a `push` to `main` at `7b6a364`.
- The step runs `node ../../scripts/ci/map-counts-check.mjs` with no flag (workflow `:1707` and `:2583`).
- With no flag the script reads `--env staging --remote` (`wranglerArgs`). The unit test pins it.
- `wrangler.toml:178-180` binds `DB` to `ocr-db-staging` under `[env.staging]`.

| Run (commit)          | Job                              | Step                                                        | Printed                                                                                                                              |
| --------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 43659648419 (7b6a364) | T4 surfaces 132648698455         | T4k-check, success                                          | `map counts read: {"taps_a":42,"taps_b":8,"tap_days":0,"share_opens":10,"share_open_rows":2,"scans":0}`, then `map counts unchanged` |
| 43784990637 (c2d94e9) | T4 surfaces 133035989636         | T4k-check (step 36), success                                | the same row, then `map counts unchanged`                                                                                            |
| 43784990637 (c2d94e9) | T2 Contract (pages) 133034512295 | Map counts unchanged after the Pages run (step 27), success | the same row, then `map counts unchanged`                                                                                            |

The log does not print the wrangler command, so "remote" rests on the code path, not on a log line. PR 1341 adds that line.

### Acceptance line (b): born red. Half there on `main`; complete in PR 1341.

- **PR 1247**, against a local D1, saw a moved tap (F4, B13, D1) and a moved share open (D2) turn the script red.
- A scan row and an unreadable answer were seen red only in the pure functions `differences()` and `firstRow()`.
- `main()`, which sets the exit code, had no test.
- PR 1341 closes this (see Solutioning).

### The decision: option A, keep the D1 read in CI

**What it proves:** after the browser walk (T4k) and the Pages run (T2), the fixture's taps, share opens and scans hold the exact seeded numbers. Exactly unchanged, down to a single open.

**What it does not prove:**

- It is not an HTTP contract.
- The scan number cannot move with this fixture (R4).

**What it costs:**

- No new credential. The read uses `CLOUDFLARE_API_TOKEN_OSE`, which the seed steps in the same jobs already use (`:1642`, `:2538`).
- That token can write to D1 (R5). The script sends one fixed SELECT.

**Can it leak?**

- On `main`, yes, in a small way (R1, R2). The events are synthetic, and no identity column is ever selected: the SQL holds `SUM` and `COUNT` only.
- With PR 1341 nothing read is printed.

### The decision: option B, an admin read of share opens

**What it would expose:**

- The first read of share opens anywhere. Today `share_opens_daily` is written (`lib/share-count.ts:52`) and deleted (`handlers/events.ts:2017`), and nothing reads it.
- The table is keyed by event, screen, phase and UTC day.

**How the floor and never who would hold:**

- Only an event total, as `floorTotalOfParts` over the cells (`lib/count-floor.ts:79-86`). No by-day or by-screen cells; by day is the most identifying grain (Data Scientist).
- Brand-scoped automatically under `/api/v2/admin/events/:id/**` (`guardAdminObjectScope`).
- It is a GET, so the write guard does not apply.
- The floor is not tier-gated.
- Public event responses are untouched.
- Put it in the organizer-only handler, not in `readPreEventActivity`. That function also feeds the sponsor card (Backend Architect).

**Re-identification:**

- An exact total of 5 or more, read before and after sending a link to one person, shows that person's open (5 to 6).
- The same before-and-after reading is possible today for tap totals. This is an inference: `handlers/pre-event-activity.ts:9-14` floors taps per code.

**Would B replace the D1 read? No:**

- A new open lands in today's row with `opens = 1`. `floorTotalOfParts` leaves a part under 5 out of the total, so the total stays 5.
- Scans seeded at 0 read "Fewer than 5" before and after.

**What it costs:** about 3 points: the handler, a floor spec at the workers-pool layer, a Bruno request, the router header and Dr of Security review. No migration.

**Product need:** none found. No story, ADR, PRODUCT.md line or SharedReport field asks for it (PO lens).

### Recommendation: option A

**Reasons:**

1. B cannot prove "unchanged" for a single open or a scan, so the D1 read stays either way.
2. B would publish share opens for the first time, with a new before-and-after reading, for a test line and not a product need.
3. A adds no credential and, with PR 1341, prints no count.

**What would change it:**

- A product decision that organizers should see share opens. B is then its own story, built for its own sake; the D1 check stays.
- An owner rule that a staging acceptance line counts only HTTP evidence.
- Evidence that the CI token reaches production D1, if the owner then wants CI off direct D1 reads. That would touch every seed step, not only this check.

## Loop 1

Team: dr-of-security, role-data-scientist, role-backend-architect, role-qa-automation, role-product-owner
Critical layer: The most dangerous assumption was "the check proves no count moved". It is true that it ran against staging and read the seeded numbers. It was only assumed that it can fail for each count and shows nothing it should not. The five lenses ran in parallel and were merged once.

The lenses found:

- R1: the script prints every number it read, and a moved value exactly, to a public log (Data Scientist, Dr of Security).
- R2: a wrangler failure is echoed whole (Dr of Security).
- R3: `main()` is untested (QA).
- R4: the scan number cannot move (Dr of Security).
- R5: the token's reach cannot be seen (Dr of Security, Backend Architect).
- R6: the T2 and T4 legs may overlap (Dr of Security).

**The lead's checks in the merge:**

- **R6 refuted.** `functional-staging-sub` needs `smoke-staging`, which needs `contract-staging`, which waits for every T2 leg. In run 43784990637 the T2 check ran at 01:27:57 and T4k-seed at 01:36:28. Across runs, the `ose-staging-chain` lock keeps them apart.
- **R4 confirmed.** A scan row needs a `poster_deployment_id` (`lib/scan-buffer.ts:108`), and the seed creates no placement. What keeps `/q` out is the walk's request watch (`tests/e2e/3-flows/map-place-panel.spec.ts:825-829`) and both href sweeps.
- **Corrections to the lenses.** The PO lens said the fixture's share opens would read "Fewer than 5"; each is exactly 5, so a floored read shows 5. The Backend Architect said a floor hides a move of 1 above 5; under `applyCountFloor` alone, 5 to 6 shows. The real blind spot is Dr of Security's: a new day row under 5 is dropped from a `floorTotalOfParts` total.

Score: 83.1%

## Loop 2

Team: dr-of-security
Conservative layer: Assume the worst, and try to break it. A fresh Dr of Security read the subject and the first commit of PR 1341, without this worksheet, and ran its own faults in a scratch copy.

**On the subject:** no path exits 0 without all six numbers equal to the seed. Wrangler's failure output is echoed whole (R2, confirmed).

**On the first fix:**

- **R7 (High, verified at run time).** A failed read still printed the row in four shapes: truncated JSON, a row followed by text, a row on stderr, and two JSON documents.
- **R8 (Medium, verified).** Mutant M2, `return r.status`, survived every test. It exits 0 when `npx` is missing or is killed by a signal.
- Its faults M1, M3 and M4 were caught.
- A noexec temp dir would fail red, not green (Low, inferred; `ubuntu-24.04` does not mount `/tmp` noexec). Not a register row.

**The lead's check in the merge: the case for B, put at its strongest.**

| The case for B                                                              | Answer                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The ticket says "through the admin API", so an HTTP read is the honest bar. | The line was written before it was known that share opens have no read. OSE-2071 asks for it to be reworded. |
| A D1 read can drift from the schema.                                        | It fails closed: a renamed table or column is "unreadable", and the step goes red.                           |
| Holding a D1 credential in CI is a risk.                                    | It is already held by every seed step. A adds nothing.                                                       |
| Organizers may want share opens one day.                                    | Then build B for them, as its own story. It still would not replace the D1 check.                            |

The recommendation stands.

Score: 57.1%

## Loop 3

Team: role-qa-automation, role-scrum-master
Recursive layer: Was this assessment itself honest? Two fresh lenses read this worksheet against the code. They had no network.

- QA re-ran nine of the thirteen faults in a scratch copy, plus extra mutants of its own.
- The Scrum Master recomputed every score and checked the statuses, the acceptance lines and the owner questions.

**Confirmed:**

- The score arithmetic adds up.
- All 33 tests pass on the unmodified code.
- Every named test fails under some fault.
- The new test file runs in CI's root-vitest leg.
- The owner questions need nothing run on the owner's computer, and nothing the owner decides is shown as done.

**New findings, all about the worksheet's wording or evidence, not the code:**

- **R9 (Medium):** "fixed in PR 1341" did not say the PR is a draft and not merged.
- **R10 (Medium):** the mid-run fix was recorded but not named as a breach of the owner's run rule.
- **R11 (Medium):** acceptance line (a) was headed "Verified", but the remote read rests on the code path, and the lenses could not re-check the logs.
- **R12 (Medium):** the born-red counts were not reproducible from the text. The exact edits were not recorded. QA's own form of F2 (the block deleted) gave 4 red, not 2, and its form of F7 gave 7, not 4.
- **R13 (Low):** the proposed wording for OSE-1896 was not in the worksheet, so question 2 asked about text the reader could not see.
- **R14 (Low):** "the plan was 4 loops" did not say who planned 4.
- **R15 (Low):** the Windows branch of the script (`shell: win`, the quoting of the SQL) is not tested. It was there before this change.
- **R16 (Low, withdrawn):** dropping `"results"` from the line filter survives every test. It is an equivalent mutant: a line that holds only `"results"` carries no count.
- **R17 (Low, withdrawn):** loop 2's noexec temp dir would fail red, not green.

Score: 65.5%

## Findings register

**Weights:** High 10, Medium 5, Low 2.

**Modifiers:**

- Every finding sits in CI against staging (×0.75).
- Loop position: ×1.0 in loop 1, ×1.25 in loop 2, ×1.5 in loop 3.
- R1 and R2 are causally linked (×1.5 on their sum). With R7 they are one family (×2.0 on the sum).

| #   | Finding                                                                                                                                                        | Severity | Found  | Evidence                                                                           | Status                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R1  | The script printed every number it read to a public log, and a moved value exactly                                                                             | Medium   | loop 1 | verified by the lead in the job logs above; `map-counts-check.mjs:117,119` on main | fixed on the branch of draft PR 1341, not merged (a8fa7c8)         |
| R2  | On a wrangler failure, its output was echoed whole, even with a result row in it                                                                               | Low      | loop 1 | verified from code, `:110` on main; loop 2 probes                                  | fixed on the branch of draft PR 1341, not merged (8c7790a)         |
| R3  | `main()` untested: a scan row and an unreadable answer were born red only in pure functions; deleting the exit-code check survived every test                  | Medium   | loop 1 | verified: fault F2 survived on main's tests, red on PR 1341's                      | fixed on the branch of draft PR 1341, not merged (a8fa7c8)         |
| R4  | The scan number cannot move with this fixture (no placement; scans also pass a queue). The request watch and the sweeps are what keep `/q` out                 | Medium   | loop 1 | verified from code: `scan-buffer.ts:108`, the seed                                 | open: owner question 3                                             |
| R5  | `CLOUDFLARE_API_TOKEN_OSE` can write to D1, and the production deploy job uses the same name. Whether production has its own environment secret cannot be seen | Low      | loop 1 | inferred: workflow `:2770`, `:2844`                                                | open: owner question 4                                             |
| R6  | The T2 and T4 legs overlap, so a re-seed hides a moved count                                                                                                   | Medium   | loop 1 | refuted in the loop 1 merge                                                        | withdrawn                                                          |
| R7  | The first fix still printed the row when a failed read's output was truncated, followed by text, on stderr, or two documents                                   | High     | loop 2 | verified at run time (loop 2 probes A, B, C, E)                                    | fixed on the branch of draft PR 1341, not merged (8c7790a)         |
| R8  | The failure exit was not pinned to 1; `return r.status` survived every test and exits 0 when npx is missing or killed                                          | Medium   | loop 2 | verified (mutant M2)                                                               | fixed on the branch of draft PR 1341, not merged (8c7790a)         |
| R9  | The register said "fixed in PR 1341" without saying the PR is a draft and not merged                                                                           | Medium   | loop 3 | Scrum Master                                                                       | fixed in this worksheet                                            |
| R10 | The mid-run fix was recorded but not named as a breach of the owner's run rule                                                                                 | Medium   | loop 3 | Scrum Master                                                                       | fixed in this worksheet                                            |
| R11 | Acceptance line (a) was headed "Verified"; the remote read is inferred, and the lenses could not re-check the logs                                             | Medium   | loop 3 | QA, Scrum Master                                                                   | fixed in this worksheet (relabelled)                               |
| R12 | The born-red counts were not reproducible: the exact edits were not recorded (QA's forms of F2 and F7 gave other counts)                                       | Medium   | loop 3 | QA, run in a scratch copy                                                          | fixed in this worksheet and the test header (exact edits recorded) |
| R13 | The proposed wording for OSE-1896 was not in the worksheet                                                                                                     | Low      | loop 3 | Scrum Master                                                                       | fixed in this worksheet                                            |
| R14 | "The plan was 4 loops" did not say who planned 4                                                                                                               | Low      | loop 3 | Scrum Master                                                                       | fixed in this worksheet                                            |
| R15 | The Windows branch of the script (`shell: win`, the quoting of the SQL) is not tested; it was there before this change                                         | Low      | loop 3 | QA, inferred                                                                       | open: risk accepted (CI runs Linux)                                |
| R16 | Dropping `"results"` from the line filter survives every test                                                                                                  | Low      | loop 3 | QA, run in a scratch copy                                                          | withdrawn (equivalent: such a line carries no count)               |
| R17 | A noexec temp dir could run the real npx                                                                                                                       | Low      | loop 2 | Dr of Security, inferred                                                           | withdrawn (it fails red, not green)                                |

**Score arithmetic:**

- **Loop 1** (R6 withdrawn in the merge): R1 + R2 = (3.75 + 1.5) × 1.5 = 7.875. R3 = 3.75, R4 = 3.75, R5 = 1.5. So 100 − 16.875 = **83.1**.
- **Loop 2:** R7 = 10 × 1.25 × 0.75 = 9.375. R8 = 5 × 1.25 × 0.75 = 4.69. The family R1 + R2 + R7 = (3.75 + 1.5 + 9.375) × 2.0 = 29.25. So 100 − (29.25 + 3.75 + 3.75 + 1.5 + 4.69) = **57.1**.
- **Loop 3:** each new Medium is 5 × 1.5 × 0.75 = 5.625, and each new Low is 2 × 1.5 × 0.75 = 2.25. R9 to R12 come to 22.5; R13, R14 and R15 come to 6.75; R16 and R17 are withdrawn. With R4 and R5 still open: 100 − (22.5 + 6.75 + 3.75 + 1.5) = **65.5**.
- **Cumulative:** the worst loop, **57.1**.
- **System, after the solutioning:** R1, R2, R3, R7 and R8 are fixed on the PR branch; R9 to R14 are fixed in this worksheet. Open: R4, R5 and R15. 100 − (3.75 + 1.5 + 2.25) = **92.5**. Under 95, so the human gate.
- **The system score assumes PR 1341 merges with its CI green.** Until then, R1, R2, R3, R7 and R8 are fixed on a branch only.

## Solutioning

Draft PR 1341, `Part of OSE-2071`. Not merged, not marked ready.

**R1:** the script compares the numbers and prints only which one moved, or that it could not be read. It never prints a value. On a pass it prints `read 6 numbers from staging D1 (--env staging --remote)`.

**R2 and R7:** after a failure, wrangler's stdout and stderr are filtered line by line (`heldBack`). A line that names a count, holds `"results"` or carries a number value is left out.

**R3 and R8:** a new process-level test, `tests/unit/ci/map-counts-check-script.test.js`, runs the script with a stand-in `npx` first on PATH. Twelve tests:

- **Red, by name:** a moved tap, a moved share open, a scan row.
- **Red:** an unreadable answer, and a number given as text or missing.
- **Red, exit 1:** wrangler fails with status 1 or 2, is killed, or is not found.
- **Prints no count:** a failed read in six output shapes.
- **Passes:** the seeded numbers, read with `--env staging --remote`.
- **Refused before any read:** a stray `--persist-to`.

**Born red, one fault at a time, both map-counts test files run after each.**

- F1 to F8 were run on the first commit, `a8fa7c8`, with its tests. G0 to G4 were run on `8c7790a`.
- Each fault is one exact edit to `scripts/ci/map-counts-check.mjs`. A different form of the same fault can redden a different number of tests (R12). For example, QA deleted F2's whole block and saw 4 red.

| Fault | Exact edit                                                                                                    | Tests red |
| ----- | ------------------------------------------------------------------------------------------------------------- | --------- |
| F1    | the `return 1;` after the "Using the map must move no count" line → `return 0;`                               | 5         |
| F2    | `if (r.status !== 0) {` → `if (false) {`                                                                      | 2         |
| F3    | `const local = argv.includes('--local');` in `wranglerArgs` → `const local = true;`                           | 3         |
| F4    | ``console.log(`map counts read: ${JSON.stringify(row)}`);`` added before `if (diffs.length > 0) {`            | 1         |
| F5    | the held-back echo on a failure → `process.stdout.write(r.stdout ?? '');`                                     | 1         |
| F6    | the last `return 0;` (after "map counts unchanged") → `return 1;`                                             | 1         |
| F7    | ``? `${key}: moved from the seeded value` `` → ``? `${key}: moved from the seeded value, read ${row[key]}` `` | 4         |
| F8    | `if (!row) return ['no result row was read'];` → `if (!row) return [];`                                       | 2         |
| G0    | the whole script replaced by its version at `a8fa7c8`                                                         | 1         |
| G1    | in the failure branch, `return 1;` → `return r.status;`                                                       | 1         |
| G2    | `const kept = lines.filter((line) => !COUNT_LINE.test(line));` → `const kept = lines;`                        | 2         |
| G3    | `if (err.kept.trim()) console.error(err.kept);` → `process.stderr.write(r.stderr ?? '');`                     | 1         |
| G4    | the two number-value patterns in `COUNT_LINE` → one pattern that never matches                                | 1         |

Loop 3's QA lens re-ran F1, F3, F4, F8, G1, G2 and G4 in these forms, and the counts matched.

**Local results:**

- Root `npm test` on the first commit: 5099 passed, 0 failed.
- Root `tests/unit` on the final code: 2749 passed, 0 failed.
- CI's lint command exits 0.

**R9 to R14:** fixed in this worksheet. R9 is the statuses, R10 names the rule breach, R11 relabels line (a), R12 records the exact edits, R13 adds the wording below, and R14 says who planned 4.

**R4 and R5** are the owner's (questions 3 and 4). **R15** is a risk accepted. With all three closed, the system score would be 100.

### The proposed wording for OSE-1896's "Staging Playwright" line

**Under A:**

> **Staging Playwright:** tap through every map link and press every Share. No request of the walk goes to /q, /s, /e, /r, /c or check-in. The seeded events' tap totals, read through the admin API before and after, are unchanged. **Staging D1 check:** right after the walk, `T4k-check` reads the seeded events' tap, share-open and scan numbers straight from staging D1 and finds the seeded numbers. Its log names a moved number, never a value. (Share opens have no HTTP read; the admin scan read is floored.)

**Under B:**

> **Staging Playwright:** read the seeded events' tap and share-open totals through the admin API (share opens: new story, floored, never who), tap through every map link and press every Share, then read again. The totals are unchanged, and no request goes to /q, /s, /e, /r, /c or check-in. `T4k-check` still reads exact numbers from staging D1, because a floored read cannot show one new open or scan.

## What must be true before shipping

1. The owner answers A or B.
2. **Under A:** OSE-1896's line is reworded to the proposed text and the owner ticks OSE-2071's boxes. PR 1341 is reviewed and merged, and its staging run is green.
3. **Under B:** a new story, with Dr of Security, builds the read. OSE-1896 waits for it.

## Verification after shipping

- The T2 Pages leg and T4k-check, in the first `main` run after PR 1341 merges:
  - print `read 6 numbers from staging D1 (--env staging --remote)`;
  - print no count.
- Then T1 to T4 green for that SHA.

## Risks accepted under A

- The check is not an HTTP contract.
- The scan number guards nothing on its own with this fixture (R4) until a placement is seeded.
- The script's Windows branch is not tested (R15). CI runs on Linux.

## Human gate

1. A or B? Recommended: A.
2. Under A, is the proposed wording for OSE-1896's line right?
3. The scan number (R4): accept it, since the walk's request watch and both sweeps keep `/q` out, or open a ticket to seed a poster placement so the number can move?
4. Not needed for the decision (R5): is `CLOUDFLARE_API_TOKEN_OSE` scoped to staging D1, or does production use its own environment secret?
