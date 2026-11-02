# Loop 3 (Adversarial) report: FE integration lens (`fe-integration`), epic OSE-1766, subject v4 frozen

Saved by the lead from the agent's hand-back message (the agent's own rules forbade it writing to disk). Text below is the agent's, verbatim.

No score and no gate decision.

Code was read in `C:\Users\mzdan\dev\ourCommunityRituals\ose-clock-gate` (src equals `origin/main` 39a63d67, per the register). Paths are under `workers/oursharedevents/` unless noted.

Basis key: **proven** (a command result), **arithmetic**, **source-read**, **inferred**.

How the replays work, so "proven" is read correctly:

- Function replays: `oseEventView` was extracted from `src/templates/admin.html` between its `@ose-event-view` markers and run with `node -e`. `count-floor.ts` was run through `module.stripTypeScriptTypes` in memory.
- SQL replays: the Worker's own SQL statements were copied verbatim into an in-memory `node:sqlite` database. These prove the SQL and branch logic, not the deployed Worker.
- Nothing was written to disk, and nothing was run against staging or production.

## 1. Attack cards (Highs in my lens: R1-03, R2-02, R1-04, R1-16)

### R1-03, open-hour words across 8+ surfaces

- **Actor.** Hostile organizer, or a sponsor's lawyer, who holds the admin pages, the sponsor link and a report token. The second reader is the 30-second poller of the live view.
- **Goal.** Document a false statement per surface and measure any timing gained across the seal transition.
- **Steps (post-S4).**
  1. One poster, 80 real scans in UTC hour H, inside an active event. No injection is needed. A hostile organizer can fill it with their own browsers at zero cost.
  2. S4 (D2 yes) excludes hour H from every scan-cell read until H + 1 h + 15 min (subject C.10, Rule). `scansOf` and `floorTotalOfParts` then return `{count:null, suppressed:true, floor:5}` (`src/lib/scan-cells.ts:66-68`, `src/lib/count-floor.ts:53-60`, source-read).
  3. Capture each surface:

| Surface                                | What it prints with the open hour withheld                                                                 | File:line                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Live view tile                         | "Held"; the reason, "Fewer than 5 so far", is a hover `title` only                                         | `src/handlers/live-monitor.ts:124-125`     |
| Live view note                         | "Poster scans under 5 read "Held""                                                                         | `:136-144`                                 |
| Live view day card, today              | "Held"                                                                                                     | `:167-169`                                 |
| Admin event view, step detail          | "Scans fewer than 5 · ..."                                                                                 | `admin.html:8158,8165,8175`                |
| Admin event view, Report step          | "Fills in once people start scanning"                                                                      | `admin.html:8177-8178`                     |
| Admin event view, next step            | "Get the word out: share the link"                                                                         | `admin.html:8189`                          |
| Admin pre-event card                   | "fewer than 5 poster scans in any one hour so far"                                                         | `admin.html:8367`                          |
| Admin pre-event card, tile             | "Held"                                                                                                     | `admin.html:8422`                          |
| Admin pre-event card, chart aria-label | "A day with fewer than 5 scans in every hour at every poster is held"                                      | `admin.html:8447`                          |
| Poster card                            | "Fewer than 5 scans in any hour"                                                                           | `admin.html:6864`                          |
| Poster list                            | "fewer than 5"                                                                                             | `admin.html:8497`                          |
| `/stats` tile (`event-stats.ts:70`)    | "&lt;5"                                                                                                    | `admin.html:5334`, via `:4988`             |
| Sponsor home                           | "fewer than 5 poster scans"                                                                                | `src/lib/sponsor-home-render.ts:117,134`   |
| SharedReport                           | No scan word. Poster rows are absent, and the map note reads "areas with fewer than 5 scans are not shown" | `shared-report-builder.ts:762-779,862-868` |
| Recap (`pages.ts:1737-1763`)           | Prints no scan figure, so S4 changes nothing there. That is the surface R1-04 covers.                      |                                            |

4. **Proven run.** I ran the real `oseEventView` with the input S4 would send:
   - Input: `stats.scans = {count:null, suppressed:true, floor:5}`, `posters:2`, `sponsors:1`, `status:"active"`, `phase:"event"`.
   - Output: step "People scanning" is `state:"now"`, `detail:"Scans fewer than 5 · registered 12 · checked in fewer than 5"`. Step "Report" is `state:"todo"`, `detail:"Fills in once people start scanning"`. `next` is `{"label":"Get the word out: share the link"}`.
   - With `scans = {count:80}` the same function gives "People scanning" `done`, "Report" `now`, and next step "Share the report".
   - The held input differs from the 80 input, so the function cannot tell "held because open" from "held because under 5". The stats response carries no field for that (subject: "no new field").
5. After 11:15 UTC recapture. The tile, day card, report step and next step all change at once.

- **Poller.**
  - On main, the live view refetches `/dashboard` every 30 s (`live-monitor.ts:182,199`). The reader sees the tile cross 5 within one poll, which is the R1-17 timing.
  - After S4 the crossing appears only at about H + 75 min. S4 removes that minute-level gain (source-read for the poll; effect inferred). The poller learns only the seal schedule, which is public.
  - The poller gains no information about when within the hour scans arrived.
  - Check-ins and taps stay live (AC4 says so), so the only timing left on the page is the OSE-1780 family.
- **Success condition.** The attacker holds a dated capture of a false statement on 8 surfaces: the 6 admin surfaces, the live view and the sponsor home.
  - The floor holds, because every figure is still a sum of floored cells.
  - No criterion goes red. AC4 covers one live-view sentence. AC5 covers one admin step's detail. AC2 is a registry check and does not read words. **None goes red.**
  - AC5 does not touch the Report step or the `next` guidance. I ran those and they stay false (step 4).
- **Verdict.** Works after the subject ships. Main prints the open hour today, so main states nothing false. S4 creates the false words.
- **Severity.** Stays High. Harm is a false statement and false guidance, not a leak.

### R2-02, map branch on row presence

- **Actor.** Sponsor holding a report token (sponsor role). The report is "a straight readout, no field-stripping by depth" (`src/handlers/shared-report-read.ts:123`, source-read), so `corridor_map` is not scoped per sponsor.
- **Goal.** Learn "did anyone scan at all" at a one-poster door event.
- **Steps.**
  1. The organizer's poster is geocoded (`h3_res9` set). Poll the report before and after the nightly 03:00 UTC run (cron in all three blocks, `wrangler.toml:105,231,384`, proven by grep).
  2. The materializer writes a row for every cell-hour with at least 1 scan, as a 0 row if it is under 5 (`src/lib/shared-report.ts:865-871,884-907`).
  3. The builder branches on `cellData.length > 0` (`shared-report-builder.ts:862-880`):
     - Rows present, none at or above 5: `source:'suppressed'`. The page shows a "Corridor Scan Map" section with "Map hidden to keep things anonymous" (`shared-report.html:1247,1255-1256`).
     - No rows: `source:'fallback'`. The page shows "Neighborhood Preview", with `cell_count` 7 (centre plus ring 1) against 0 in the other state.
  4. **Proven (SQL replay of the materializer INSERT and the cell query):**
     - 0 scans gives `fallback (Neighborhood Preview)`.
     - 1 scan gives `suppressed (Map hidden)`.
     - 4 scans gives `suppressed (Map hidden)`.
  5. The sponsor home reads "fewer than 5 poster scans" in all three cases (`sponsor-home-render.ts:117,134`). The only discriminator is the report, so the sponsor holding both sees the report's state differ while the sponsor home does not.
- **Success condition.** The attacker holds an event-level bit "at least one scan at a geocoded poster, in a night that ran". At a door poster that is presence. It has night resolution, because rows only exist after the cron. The floor stays intact (no count). Never-who and place-not-person are not broken, but the withheld-state promise is broken.
  - The new words in S15 ("below that it reads 'fewer than 5'") are false for the map.
  - Nothing in S4's ACs reads `corridor_map.source`. The register-pinned `tests/shared-report-read.spec.ts:944-966` pins "suppressed, not fallback", so the bit is pinned on purpose. **No criterion goes red.**
  - S4 changes the bit's timing, not its existence. A row in an open hour is excluded until it seals, and a stored row exists only after the cron.
- **Verdict.** Works on main, and works after the subject ships.
- **Severity.** Stays High. It is a bit and not a count, but it is event-level and needs no injection.

### R1-04, recap label

- **Actor.** Public reader of a post-event page. No account needed.
- **Goal.** Recover the exact number of registered check-ins (a group of 1 to 4).
- **Steps.**
  1. `pages.ts:1756-1763` floors walk-ins as a nested pair with check-ins. When the gap is 1 to 4 and walk-ins are at least 5, it prints "Walked in: held, so a group under 5 cannot be worked out".
  2. **Proven (in-memory run of the real `floorNestedCounts`, check-ins c, walk-ins w):**
     - c=6: the label appears only for w=5. Check-ins 6 minus walk-ins 5 gives exactly 1 registered check-in. w=6 prints "6". w=0..4 reads "Fewer than 5".
     - c=7: the label appears for w=5 or 6, so 1 or 2.
     - c=9: the label appears for w=5..8, so 1 to 4.
     - c=5, w=5 prints "5". c=5 with w=0..4 reads "Fewer than 5".
  3. The line is pinned by `tests/withheld-counts-in-words.spec.ts:329`, a spec in the `npm test` shards at `ci.yml:975-983` (source-read). It is a guard that cannot see the leak.
  4. S15 AC1 (subject C.4) scans `never-who.ts`, `privacy.ts` and `public-claim` blocks, with eight banned phrases. `pages.ts` is not in that file list, and "cannot be worked out" is not a banned phrase.
- **Beside other surfaces.** The recap is public and post-event. Check-ins also appear on the live view and the admin stats, both admin-only, so the recap's reader never holds a second figure. This matches the loop-2 finding that the recap and sponsor home never overlap. The sponsor home and report carry no check-in figure (not re-verified here).
- **Success condition.** The attacker holds an exact group of 1 to 4 registered check-ins on a public page. The floor is broken, on main. S15 AC1 stays green with the label present (source-read). **No criterion goes red.** That makes it the sharpest "AC cannot catch its own failure" case in my lens.
- **Verdict.** Works on main. The exact leak is OSE-1783's (out of scope, recorded once, not rated). In scope: S15's claim that the public words say only what holds sits on a page that keeps this line.
- **Out-of-scope observation, recorded once.** The same card prints "Registered" and "Checked in" each floored alone (`pages.ts:1772-1774`). Registered 9 beside checked-in 5 gives 4 no-shows. That is an OSE-1783 who-side family member.

### R1-16, two derivations in one SharedReport response

- **Actor.** Sponsor or organizer holding a report token and reading the report. A hostile organizer can add 5 cookie-less scans (the OSE-1780 family). An organic busy evening event is also enough.
- **Goal.** Get two published figures for one poster-hour that differ by 1 to 4, which is an exact sub-5 group of people scanning after a snapshot.
- **Steps.**
  1. `poster_attribution` is read from raw rows on every request. The report is `Cache-Control: no-store` and `buildSharedReport` runs per request (`shared-report-builder.ts:722-744`; `shared-report-read.ts:106`; `:211`).
  2. The corridor figure comes from `scan_cell_aggregates`, rebuilt nightly. The materializer's INSERT has no upper bound on `scan_bucket` (`shared-report.ts:895-906`), so hour 03 UTC is stored partial.
  3. The report page puts both in one document:
     - `poster_attribution.scan_count` is rendered at `shared-report.html:1159-1167`, with the poster's `h3_res9` in the response (`shared-report-builder.ts:771`).
     - The hex carries `data-count` and `<title>N scans</title>` (`corridor-map.ts:112`), and the page's SVG mount whitelists `data-count` (`shared-report.html:1407`).
     - A single-poster cell joins to its poster on `h3_res9`.
  4. **Proven (SQL replay):**
     - 5 scans at 03:00, the materializer runs, then 2 more scans: live attribution reads 7, stored cell reads 5.
     - After the next night's rebuild the stored value reads 7, so a published cell moved after its hour had sealed.
     - Stored 3 (kept as a 0 row), then live 7: the map reads "suppressed" while the poster row reads 7.
  5. **After S4.** The read bound is on the stored `bucket_date` and `bucket_hour` (subject C.10, Rule). Hour 03 is sealed by 04:15, so the stale stored 5 passes the bound. The stored row is stale, not unsealed. S4's claim "a cell cannot change after its hour plus the grace" is false for cron-stored cells.
  6. S4's staging step seeds `scan_cell_aggregates` rows directly with "no materializer run" (subject C.10, Tests), so it cannot see this.
- **Reach (arithmetic).** The affected cell is hour 03 UTC only, 1 of 24 hours a night per poster. That is 20:00 PDT, 19:00 PST, 21:00 MDT, 22:00 CDT, 23:00 EDT.
  - The organic case needs 5 or more scans in the seconds before the snapshot.
  - Cron skew across nine jobs widens that window (platform fact 6, unsettled).
  - With injection (RA-1 family) it is trivial. A hostile organizer injects 5 at 03:00, real people add k, and the difference is k exactly (for k from 1 to 4).
- **Success condition.** The attacker holds an exact count of 1 to 4 real scanners at one poster, place-side. The floor is broken for the difference.
  - Under RA-1, the injection variant sits in an accepted exact-count probe. The organic variant does not.
  - No S4 AC goes red. **None goes red.**
- **Verdict.** Works on main, and works after the subject ships.
- **Severity.** Stays High. The reach note above (one hour a night) is a reason for the scorer to weigh breadth.
- **Fix direction (for the lead, not made).** Derive both from one read, or bound both from one `now`. The subject's own staging step must run the materializer.

### Highs left to other lenses

R1-01, R1-02, R1-05, R1-06, R1-07, R1-08, R1-09, R1-10, R1-23, R2-01. The pure-PO and copy reading of R1-02, R1-05 and R1-06 is Design FE's.

## 2. Attacks on the subject's own controls (criteria that cannot catch their own failure)

1. **S4 AC4 and AC5 (R1-03).**
   - Fault: ship every AC4 and AC5 sentence, and leave the other six surfaces, the Report step, the `next` guidance and the day cards unchanged.
   - Result: AC4 and AC5 stay green. The proven run in 1.R1-03 shows the Report step and `next` unchanged by AC5, whose scope is "People scanning" only.
   - A second fault: AC4's sentence is added to the status line (`live-monitor.ts:188`). That line is overwritten by "Could not refresh just now..." on any error (`:192-194`). A jsdom test of the happy path passes, and the sentence vanishes during an outage while the tiles keep "Held". This second fault is **inferred** from the test shape the subject states.
   - Related: `counts || 'No counts yet'` (`admin.html:8176`) cannot fire when stats loaded, because `counts` is always non-empty ("Scans fewer than 5 ..."). That is proven by the run. Any AC5 written as "replace 'No counts yet'" is unreachable.
2. **S4 AC2 (R1-15, R1-46).**
   - Fault: an off-by-hours bound (for example `sealedBefore(now + 6h)`) in one reader.
   - Result: a row in the open (current) hour is never seeded. AC2 seeds a "future" hour. The staging seed is "a future hour", with the offset unspecified.
   - A far-future row stays excluded by a bound that is wrong by hours. AC1 tests only the pure function. The wiring from `now` to each reader is covered only by that far-future row (**inferred**).
   - AC2's registries (the SharedReport field registry at `tests/shared-report-neighbour-floor.spec.ts:707-760`, the dashboard registry) cover numbers. They do not cover `/stats`, the poster list, the pre-event card or the sponsor home, as loop 2 said (R1-15).
3. **S4 staging step and "cell cannot change after its hour plus the grace" (R1-16).**
   - Fault: leave the materializer's open-hour write unchanged.
   - Result: the step stays green by construction. It writes stored cells directly and reads sealed rows, so it never produces a partial hour. My replay gives the 7-versus-5 divergence the step cannot see (proven).
4. **S15 AC1 against the R1-04 label.** The label stays while AC1 is green (source-read: file list and banned list). The spec that pins the label (`withheld-counts-in-words.spec.ts:329`) is not in AC3's pin list (lines 200-201 of the subject).
5. **R2-02 has no AC.** Nothing in v4 pins `corridor_map.source` (a string, absent from the number registries). A change that flips the branch passes everything the subject adds. **Inferred.** The existing pin (`shared-report-read.spec.ts:944-966`) holds the opposite state on purpose.

## 3. Cluster tests

- **C1 (scan order as a join key).**
  - The FE surfaces carry no scan order. `poster_attribution` is sorted `ORDER BY scan_count DESC` (`shared-report-builder.ts:742`). The live-view day list is by day.
  - R1-16 is not a member (the loop-2 ruling stands). My lens adds nothing to R1-01 or R1-10, so combining gives the attacker no more.
- **C2 (withheld vocabulary).**
  - Members R1-03, R1-13 and R2-02. Combination test on one door poster:
    - The vocabulary rows give one word for three states on 7 of 8 named surfaces: nothing, 1 to 4, and "open hour with 80".
    - R2-02 gives the bit.
    - Worked example: a sponsor sees "fewer than 5" on the sponsor home, "Held" nowhere, and "Map hidden" on the report. They conclude someone scanned. Polling the report across 03:00 on consecutive nights gives the first night.
  - R2-02 alone already gives that. R1-03 adds a false statement and no information, so for the attacker the combination equals R2-02. The loop-2 multiplier is the scorer's call.
- **C3 (scans are not people).**
  - FE-visible labels: "People scanning" (`admin.html:8175`) and "poster scans" (sponsor page).
  - Worked example with R1-08 (dedup off, source-read): one visitor reloading 5 times publishes "5" for one poster-hour. I ran `oseEventView` with `scans.count = 5`; the "People scanning" step is `done` and next is "Share the report" (proven for the function; the 5 is inferred from R1-08). So the organizer is told people are scanning, and is prompted to share the report to venue and sponsors, on one person's reloads.
  - That is more than R1-08 or R2-06 alone: the false label plus the prompt turns a miscount into an action.
- **C5 (privacy notice).**
  - The recap line (R1-04) says "so a group under 5 cannot be worked out" on a public page, which S15 leaves, while S15's new sentences say the opposite about posters.
  - Whether the never-who body and the recap render on the same page was **not verified**.
- **C6 (staging evidence).**
  - Not an FE matter. My contribution: the FE vocabulary pins (`withheld-counts-in-words.spec.ts`) run in the worker shards at `ci.yml:975-983` (source-read; pool membership not verified). No spec asserts the S4 flows, because none exist yet.

## 4. New findings

| id      | Severity | Slice | Claim                                                                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                                                                                                 | Basis       | Root cause                                                                                                         | Why not already a row                                                                                                                                    |
| ------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L3-FE-1 | Low      | S4    | One scan-cell read is strict on some callers and silent on others. A throw in S4's new bound (or any D1 error) shows "fewer than 5" with HTTP 200 on the sponsor home, the admin pre-event card, the poster list and the `/stats` tile. It surfaces as "Could not refresh" only on the live view and the brand dashboards. | Non-strict callers: `src/handlers/pre-event-activity.ts:76-77`, `src/handlers/sponsor-home.ts:284`, `src/lib/poster-reach.ts:196-201`, `src/handlers/event-stats.ts:70-72` (failed read reads as `applyCountFloor(0)`). Strict caller: `src/handlers/dashboards.ts:801`. | source-read | "A failed read reads as withheld" is the shared design, so an S4 predicate error is rendered as the withheld word. | R1-15 says four surfaces are in no registry. This is the failure path of the same read, a different root, and none of S4's ACs injects a throwing bound. |

No other new root cause found. Everything else I found maps to an existing row.

## 5. Re-rates with reasons

- **R1-03.** Stay High. Note it is created by S4 (nothing false on main). That affects loop 5's "created versus found" count, not the tier.
- **R2-02.** Stay High. Resolution is night-grain (rows exist only after the cron), event-level, and no count is printed.
- **R1-04.** Stay High (in-scope half). The exact leak is OSE-1783's and is Critical in substance (loop-2 section 2.1). New fact: S15 AC1 and the pin spec both stay green with the leak present.
- **R1-16.** Stay High. Reach is hour 03 UTC only, 1 of 24 hours a night per poster (arithmetic). The injected variant is trivial and sits near RA-1. S4 does not close it (new, proven at SQL level).

## 6. Not checked, and why

- **No staging or production run, no deployed Worker.** The SQL replays use `node:sqlite`, not D1, and replicate the statements, not the Worker. A D1 rowid or materializer-timing difference is not covered.
- **Real cron timing after 03:00:00 UTC** (platform fact 6) and Cloudflare cron skew. Not in the repo.
- **Open platform facts.** None can be settled from repo config:
  - KV listing expiry.
  - Workers Logs for `/q` and retention. `wrangler.toml:95` has a top-level `[observability]` only, with no env-level block. Whether it applies under `env.*` needs the platform documentation.
  - DLQ retention.
  - The staging token's scope and the secret level of `CLOUDFLARE_API_TOKEN_OSE`.
  - Production migration level.
- **Never-who body versus recap on one page** (C5): not rendered.
- **Whether `withheld-counts-in-words.spec.ts` is in the workers or node pool manifest:** not checked. CI invocation was only read.
- **Other check-in surfaces for R1-04** (display, public projection): not grepped.
- **Poster-hour attribution under S4 combined with OSE-1784.** The two touch the same builder file, so ordering is the lead's.
- **Out-of-scope records** (never rated): the exact recovery in R1-04 and the registered/checked-in pair (OSE-1783). The injected presence bit and cookie-less padding (OSE-1780). Forged cookies (OSE-1496).

## 7. Commands run (all read-only; none refused)

- Read: the brief; `.claude/skills/frontend-integration.knowledge.md`; the frozen subject (lines 1-205, then 206-435); the loop-2 register; `src/lib/scan-cells.ts`; `src/lib/shared-report-builder.ts` (700-960); `src/lib/shared-report.ts` (835-915); `src/handlers/live-monitor.ts`; `src/lib/poster-reach.ts`; `src/lib/count-floor.ts`; `src/lib/corridor-map.ts` (60-127); `src/lib/sponsor-home-render.ts` (105-155); `src/lib/pre-event-activity.ts` (95-155); `src/templates/shared-report.html` (1235-1275, 1395-1425); `src/templates/admin.html` (8100-8230); `src/handlers/pages.ts` (1735-1775).
- Grep: `MERGED-loop1.md` for the R1-03/R1-04/R1-16/R2-02 rows; `readEventScanCells|scan_cell_aggregates|FROM scan_placement_events` over `src`; "Fewer than|Held|under 5" over `src`; `oseEventView` in `admin.html`; `poster_attribution|data-count|scan_count` in `shared-report.html`; `buildSharedReport(` over `src`.
- Bash (read-only):
  - `git log --oneline -1` plus `wc -l` on ten source files.
  - `node -e` extracting `oseEventView` from `admin.html` and running it with `new Function` on three inputs. This printed the step, `next` and difference output in 1.R1-03.
  - `sed -n` over `shared-report-read.ts:95-135`; `grep -n` for cache headers and `crons` in `wrangler.toml`.
  - `sed -n` over `event-stats.ts:55-110`, `admin.html:5325-5336` and `:6855-6866`, `admin.html:8340-8372` and `:8436-8462`, `admin.html:4975-4995`, `shared-report.html:1640-1668`, `pages.ts:490-502`.
  - `grep` for callers of the materializer (`materializeSharedReport|...|aggregateScanCells|...`) and `sed -n 140-165 src/index.ts`.
  - `node -v` (v24.14.1) plus `node -e` using `node:module` `stripTypeScriptTypes` on `count-floor.ts` (in memory, `new Function`) to run the recap and nested-count cases and the 7-versus-5 floor totals.
  - `node --no-warnings -e` with `node:sqlite` `:memory:` replaying the materializer INSERT, the corridor cell query and the poster-attribution query: one run failed on double-quoted SQL strings (no data), then the corrected run printed the R2-02 and R1-16 results.
  - `sed -n` and `grep` over `dashboards.ts:255-300,548-600`, `tests/withheld-counts-in-words.spec.ts:1-60`, `grep` for `cannot be worked out|stat-walk-ins` in `tests`, a `grep` over `ci.yml` for the worker test shards, `grep` for `readPosterReach|readPreEventActivity(|strict` over `src`, `grep -n "^\[env|observability|..."` over `wrangler.toml`, a `grep` for earlier rows on failed reads over the two registers, and `ls loop3`.
- Refused: none. No write, no network call, no test run.
