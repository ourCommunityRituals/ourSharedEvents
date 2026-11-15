---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: extended
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 0, critical: 1, high: 10, medium: 24, low: 9 }
subject_commit: 79647f2d (on main; the full SHA is in the Verdict table)
---

# CCR rerun: will the street map work for the application (2026-11-15)

**Owner's request, word for word:** "Please rerun the full 5 loop CCR assessment using the extended scrum team contrating on the security, functionality through the BE, database, and FE, performance, CICD, test pyramid, and test reporting as it loops back to the shared brain." Then: "Jump to a new session when you need to".

**How it ran:**

- Five loops in the owner's order: Critical, Conservative, Adversarial, Compliance, Recursive. The nine role lenses of the extended scrum team ran in every loop. The scrum master lens joined loops 4 and 5.
- The subject was frozen at `main` commit `79647f2d`. Nothing was changed between loops and no correction was made during the run.
- Every loop's merge carries the six areas the owner asked to be weighed: security; functionality through backend, database and front end; performance; CI/CD; the test pyramid; test reporting to the shared brain.
- **The lead's reading of "test reporting as it loops back to the shared brain"** (a reading, not the owner's definition): how a test result travels from a CI run to the records people and agents steer by (ROLE-STATE, CONSTRAINTS, the conformance report, the threat ledger, Linear, the runbook, the org brain), and whether those records are true today.
- **Two sessions.** The first session ran loops 1 to 4 and started loop 5. It passed the owner's 600,000-token session cap during loop 5: the ten lens hand-backs were received and never merged or saved. A second session re-ran loop 5 in full with ten fresh lenses and wrote this worksheet. Nothing from the interrupted loop 5 is used here except as claims the re-run was told to test.
- **Departures from the read-only brief, recorded:**
  - Loop 2: the DevOps lens made one read more than allowed (Protomaps' public build list).
  - Loop 3: the FE integration lens made three staging GETs where one was allowed.
  - Loop 3: the security lens ran the repository's agent guard on the workstation with crafted input. That is a workstation probe, a test rig and not a result.
  - Loop 5 (re-run): seven of the ten lenses said they did not read the shared brief or the loop 1 to 3 merges. They read the loop 5 task and loop 4's register and went to the source. Their rulings are on evidence they re-opened; their view of how each row grew is thinner than asked.
- There is one cumulative score. It is under 95%, so the team's solutioning is written below. A score is a signal, never permission.

## Verdict

|                           |                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Answer**                | **It cannot yet be shown to work, and it is not ready to be turned on.** The drawer is corrected in source and the staging cases are ready for an archive. But no real archive has gone through the shipped code in a Worker, no street has ever been drawn on staging, and nothing can turn streets off once the object lands. |
| **System score**          | **0%.** Weighted deductions total 253, so the raw figure is -153. The loosest reading the protocol allows gives about 5; with every disputed severity at its lowest and every candidate merge taken, about 35. No reading reaches 95.                                                                                           |
| **Security Critical**     | None today (Dr of Security, loops 1 to 5): production has no `MAP_TILES` binding and a planted archive reads no database. R8 becomes Security Critical on the day a production binding merges while the `staging` environment has no branch policy or reviewer.                                                                 |
| **Regulatory**            | None today. The licence text was read in loop 4: the OpenStreetMap credit meets the notice duty as written (R25). The Google Geocoding term (R43) is a contract term whose application the text does not decide.                                                                                                                |
| **Assessment confidence** | **55%.** Direction: about 85 (ten of ten lenses in loop 5 gave the same answer). Size of the figure: about 50. About a quarter of the weight rests on command or run-time evidence, about 55% on source reading, about 20% on general knowledge. Nothing was measured through a Worker.                                         |
| **Gate**                  | **STOP, human gate.**                                                                                                                                                                                                                                                                                                           |
| **Subject**               | `main` at `79647f2dc644b8fbd6f8e2301e4d9dcf23c79a64`. `main` did not move during the run (last read 06:26 UTC, 2026-11-15).                                                                                                                                                                                                     |
| **Earlier run**           | Same question on `bf1c696d`: 0%, raw -82, 25 open rows. Like for like, those rows fell from 182 points to 146. The register is larger because a wider area was measured, as the owner asked.                                                                                                                                    |

**What works, as far as it was shown:**

- The hexagon map works on staging today: `/` answers 200 with one `<h1>`, ten areas and no street layer; `/api/v2/map/areas` answers 200 with `streets: null` (loop 1, run time).
- "Any failure leaves hexagons only" holds, and is tested at the mock layer, for a missing object, an R2 error, a damaged header or directory, an oversize tile, too many tiles and a slow read.
- The drawer now pays roads before water, cuts an oversize line instead of skipping it, hides a thin layer, and draws nothing under zoom 7 (PR 1270). `street-map.ts` is mutated whole at 99.81 against a floor of 99.6 (run 43674393963).
- The four Bruno street cases and the place-panel spec read the `streetMapArchiveLoaded` flag (PR 1272), so a load no longer reddens the chain. Seen on `main` in run 43674436446.
- `NOTICE.md`, ADR-035, the security records and threat-ledger entries TL-098 to TL-101 exist (PR 1267).
- No script-injection path, no cookie, no request geo, no `FORMS_DB` read, tokens only, one `<h1>`.

**What does not:**

- **Proof (R1).** Zero load runs. No test in any layer reads a real tile. Every `main` chain that is green today printed NOT RUN for the street cases.
- **Who writes the bucket (R8).** The `staging` environment has no branch policy and no reviewer; a branch-deployed Worker has a writable binding; nothing that can fail controls the one bucket production will read.
- **No way back (R20) and no way forward (R27).** Streets go live the moment the object lands, with no switch. The flag cannot go "true" on a green chain as the tests stand.
- **After a load (R24, R38).** The dot's touch target is under 44 px below a 379 px viewport, and map text is under the 13 px floor with contrast under AA by computation. Dots draw only over a street layer, so this is not live today.
- **Records (R32).** ROLE-STATE has no entry for PRs 1270 and 1272; ADR-033 D4 and three documents describe the old drawer.

## What was reviewed

**In scope:** the street map drawn under the H3 hexagons on the landing page and in the public area map, from one PMTiles archive in R2 (bucket `ose-map-tiles`, binding `MAP_TILES`), as it stands at `79647f2d`.

- Runtime: `workers/oursharedevents/src/lib/pmtiles.ts`, `mvt.ts`, `street-map.ts`, `attendee-map.ts`, `landing-area.ts`, `map-zoom-style.ts`; `src/handlers/pages.ts` and `map-areas.ts`; the route header in `src/router.ts`; `wrangler.toml`.
- Load path: `.github/workflows/street-map-archive-load.yml`, `scripts/ci/street-map-archive-load.mjs`, `workers/oursharedevents/scripts/street-map-archive/check.ts`, `docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`.
- Tests and gates: the mock-layer specs, the four Bruno cases, `tests/e2e/3-flows/map-place-panel.spec.ts`, `scripts/ci/street-map-flag.mjs`, the mutation configuration and floors, the main workflow and the staging lock.
- Records: `docs/brain/ROLE-STATE.md`, `CONSTRAINTS.md`, the conformance report, the threat ledger, `docs/security/`, ADR-033, ADR-035, `NOTICE.md`, the cost and integration documents, Linear OSE-2064, the org brain.

**What merged since the earlier run, and what each chain proved (command output, re-read 06:11 to 06:26 UTC):**

| PR / commit     | `main` run  | T1 Deploy → Staging | T2 Contract → Staging (Bruno) | T3 E2E Smoke → Staging (Playwright) | T4 Functional → Staging | State                                                |
| --------------- | ----------- | ------------------- | ----------------------------- | ----------------------------------- | ----------------------- | ---------------------------------------------------- |
| 1267 `00aed0d4` | 43669630533 | success             | success                       | success                             | failure (Share test)    | Done through run 43674394060, which contains it      |
| 1270 `d99ce264` | 43674394060 | success             | success                       | success                             | success                 | Done                                                 |
| 1271 `1e7cf90d` | 43674415164 | success             | success                       | success                             | success                 | Done (a stall-page check, not the map)               |
| 1272 `5d16bfdb` | 43674436446 | success             | success                       | success                             | success                 | Done                                                 |
| `79647f2d`      | 43676301628 | success             | success                       | success                             | failure (Share test)    | Merged, not Done (a conformance report, not the map) |

**None of these chains checked a drawn street.** In run 43674436446, job "T2 Contract (pages)", the four street cases each printed `NOT RUN (street-map archive not loaded on this environment: streetMapArchiveLoaded is not true): …` and the step then printed `✓ With no street layer: says the street map is not here (amap-no-tiles)`. The place-panel spec took its "note or streets" branch. T4k ended `1 flaky`, `40 passed`; the flaky test is the Share test, counted as a pass.

**State of the world (command output):**

- "Street-map archive load (stg)" has 0 runs. No archive has ever been loaded.
- The `staging` environment's rules read `{"policy":null,"rules":[]}` (loop 5). `main` requires 11 status checks and no review (loop 3).
- 14 `main` chains finished on 2026-11-15 UTC: 6 success, 8 failure. Loop 5 counted 6 of 13; run 43676301628 then ended red at T4 on the Share test alone (`1 failed`, `40 passed`). Four merges waited 68 to 118 minutes for the staging lock.

**Out of scope, noted for the owner:**

- The public events API publishes exact address and coordinates (OSE-1245).
- `/` has had no rate limit since before the map, against `docs/security/ROUTE_CLASSIFICATION_POLICY.md:97`.
- The repository-level deploy token is not bound by the `production` environment's reviewers (`docs/security/PR_SECRET_EXPOSURE_GUARD.md:60-70`).
- The agent guard passes a `gh api` write when a header argument comes first (workstation probe, loop 3).
- Google Static Maps on event pages and Google-placed hexagons on today's map fall under the same Google terms as R43.
- The landing's hexagon number is about 12 px at a 320 px viewport today, without streets.
- The Share test's intermittent 403 from the staging edge, pass-on-retry counted as green, and the staging lock's queue are pipeline-wide.
- Cloudflare account state: no agent read it. The bucket's settings, the Workers plan and the tokens' scopes are unknown.

## Loop 1

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Critical layer: what is true against what is assumed. Lens verdicts: six "works with conditions"; design "cannot tell for streets"; SDET/SRE "does not work as evidence"; security "does not work as a set of controls for the day production binds".

- **Security.** Nothing exposed today: the bucket is empty, no R2 key is set anywhere, production is unbound. R8, R13 and R23 are unchanged in code since the earlier run. The load workflow's only bar to a branch sits inside the file a branch can edit. TL-098 to TL-101 carry no test, so they are records, not gates.
- **Functionality.** Backend: the drawer is corrected in source; nothing ran on real tiles. Database: the street layer reads no D1; the landing reads `DB` only; no migration. Front end: tokens only; nothing rendered with streets; the dot's target and the map's text looked small by arithmetic.
- **Performance.** Nothing measured through a Worker. No `[limits]` in `wrangler.toml`; the plan is unknown. The timeout is a race that cannot interrupt synchronous decode and draw.
- **CI/CD.** The flag is read only by tests. Streets go live when the object lands. The flag-change PR is red on four axe tests by design (R27, new).
- **Test pyramid.** The mock layer is deep and mutation-gated. No real tile in any test. Staging asserts a street in zero cases while the flag is "false".
- **Test reporting to the shared brain.** ROLE-STATE has no line for the three correction PRs. NOT RUN lines live only in job logs. The cost document, ADR-033 D4 and the integration document contradict the code after PR 1270.

Score: 0%

Raw figure: -131 (1 Critical, 11 High, 20 Medium, 3 Low: 231). R7 was lowered from Critical: the water-first mechanism is gone by source.

## Loop 2

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Conservative layer: assume the worst case, and ask whether the floor "any failure leaves hexagons only" still holds. It holds for the tested failures. It does not hold for an isolate ended at a CPU or memory limit, for long synchronous decode, or against a hostile or replaced object.

- **Security.** R8 settled: High today, Security Critical on the bind day. The deploy token created the bucket (run 43659704554), so it holds R2 write. A branch Worker could plant an object before the owner locks it.
- **Functionality.** A dense frame keeps a scatter of long streets, not a grid; there is no minimum kept fraction. Database: nothing found. Front end, computed: the dot's target is 36.4 px at 320 px; dot numbers are 7 to 8.8 px; the pale dot's number is 2.1 to 2.4:1.
- **Performance.** Computed: 25 R2 operations cold and 12 warm per landing; byte caps allow 48 MiB read. On a free plan every dense frame of the old rig would be ended (general knowledge).
- **CI/CD.** The load workflow, step by step: a landed object under a red step makes the re-run refuse; verify is size only; step limits sum past the job limit. Bind-day gates check strings.
- **Test pyramid.** No test goes red for a schema that differs from the fixtures, for offset roads, or for streets invisible in the dark theme. The text-floor gate cannot see the map's text.
- **Test reporting to the shared brain.** One root for R19 and R32: no link from a code change to the prose that describes it. A newcomer following today's records would redden `main` or redo done work.

Score: 0%

Raw figure: -190 (1 Critical, 18 High, 17 Medium, 5 Low: 290).

## Loop 3

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Adversarial layer: act as someone who wants this to fail or to misuse it. Proved by command: no review is required on `main`; staging serves the last branch's code until the next `main` deploy; any deploy re-creates a missing bucket.

- **Security.** Nothing Security Critical today. R8 absorbs R41. Nothing but the absent keys stops anyone with write access dispatching the load (R47). OpenStreetMap label text reaches the page escaped but unfiltered (R48).
- **Functionality.** Renamed `kind` values or tiles shifted one tile east pass every check. A scraper recovers a dot's res-9 cell and reads the home marker and the venue text (R9). One distant event removes streets for every visitor (R51). Dots draw only over a street layer, so the dot defects exist only after a load.
- **Performance.** The area-map route draws streets for any res-7 cell (R37). A directory of about 2 KB can allocate about 170 MB before it throws (R2).
- **CI/CD.** Gates can be weakened in the PR they judge (R44). A nightly or a T2/T3 green is not tied to a commit (R45). Queue waits of 68 and 101 minutes.
- **Test pyramid.** Ten paper mutants: all killed at the mock layer, all survive at staging today.
- **Test reporting to the shared brain.** The pipeline board reads job results only and cannot show NOT RUN. The "no Google Maps" ruling has no written record while dot positions come from Google Geocoding (R43).

Score: 0%

Raw figure: -189 (1 Critical, 16 High, 20 Medium, 7 Low: 289).

## Loop 4

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Compliance layer: hold the subject against the written rules, clause by clause. The security lens's re-read of the `staging` environment was refused by the permission classifier, so it relied on loop 1's command evidence. The product owner lens read the ODbL and Google's Geocoding terms at their public sources, as its prompt allowed.

- **Security.** Breaches today: `staging` against "main only" (`docs/security/CI_DEPLOY_HARDENING.md:164`); the deploy token created a bucket outside its written permission list; ADR-035 D5 (one writer) is a rule with no control.
- **Functionality.** Complies: the two-database rule, the LLM-free runtime, invariants 1, 3, 4, 5 and 7. Breach after a load: invariant 8's 44 px (R24), the spine's 13 px text floor (R38), WCAG AA by computation (R39). Not decided by the text: whether invariant 2 covers counts of events.
- **Performance.** `/` has no route limit against the route policy (older than the map). No rule requires a signal for a degraded surface.
- **CI/CD.** Met by the letter: PRs 1267 and 1270 are Done on a chain with NOT RUN lines. The owner's every-branch rule: three PRs merged before their branch chains ended.
- **Test pyramid.** "Every case at two layers": three behaviours have no staging case; the four street cases have never executed an assertion. Born red for PR 1270 is a sentence.
- **Test reporting to the shared brain.** ROLE-STATE, the ADR reconciliation rule and "keep Linear matched to `main`" are each unmet (R32). The ledger's mirror is stale (R33). At the first load: Google's term on non-Google maps (R43); the ODbL method link (R25).

Score: 0%

Raw figure: -209 (1 Critical, 17 High, 22 Medium, 7 Low: 309).

## Loop 5

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner, role-scrum-master

Recursive layer: was the assessment itself honest. Each lens re-opened the evidence behind its rows; the data scientist audited the score. Re-run in full by the second session.

**The answer to "is the growth from 25 open rows to 47 honest":** mostly, and the register did not say so. Of the 148 points loop 4 added under new ids, 91 came from a wider area measured (CI/CD as evidence, records, licences, accessibility), 35 from rows split out of older rows, 5 from a double count, and 17 from defects in what the corrections themselves changed. The three corrections removed 21 points from the old ids and added 17.

- **Security.** Evidence confirmed at run time and source. R47 folds into R8: one root, one fix (DevOps dissents: who starts the load is not who writes the bucket). R48 lowered to Low. R2's tag corrected: the 170 MB figure is source arithmetic on a workstation's bytes-per-entry figure. Nothing Regulatory or Security Critical today.
- **Functionality.** R7 lowered to Medium: "never drawn on real tiles" is R1's and was counted twice. R9 lowered to Medium with its citation corrected. Design's final ruling is two rows: R24 (44 px) and R38 (text size and contrast together); R39 merges into R38. Dots need the street layer (`attendee-map.ts:629-631`), so both exist only after a load.
- **Performance.** R5 lowered to Medium: the claim that the area-map route is uncached was wrong at source (`map-areas.ts:193-195` sets a cache header); edge behaviour is unseen. Performance rows lean on general knowledge more than their tags said. Nothing was measured.
- **CI/CD.** "2 of 11 chains green" was stale: 6 of 13. Loop 4's Done table was stale: PR 1272 is Done. R28 and R45 lowered to Medium: their queue, flake and retry parts are pipeline-wide. R44 lowered to Medium. R21 is not ended by run 43674436446, which shows passing while skipping.
- **Test pyramid.** R52 was partly wrong: the area-map route is in Bruno (`bruno/ose-pages/15. Public Area Map (OSE-2039)/`, three cases, run by CI). Its residual, no OpenAPI path, is Low. R31 confirmed.
- **Test reporting to the shared brain.** R32 stays High on three unmet written rules and absorbs R34. "Seven false runbook sentences" was overstated: two false and two stale or likely false were confirmed, and "names a job that does not exist" was refuted. The product owner and data lenses would move R33, R35 and R16 beside the register; the lead keeps them because the owner asked for this area to be weighed.

Not looked at by five loops: a rendered page with streets in either theme; anything through a Worker; the Cloudflare account; the scope of the repository-level deploy token.

Score: 0%

Raw figure: -153 (1 Critical, 10 High, 24 Medium, 9 Low: 253). This is the cumulative figure.

## Findings register

One row per root cause, after all five loops. R1 to R26 are the earlier run's ids; rows from R27 are new. Proof: C = command output or seen at run time; S = source read, not run; G = general knowledge, not checked; L = licence text read at its public source; W = a workstation measurement. "partly" means partly ended since the earlier run; the residual is what is counted.

| Id  | Severity | Status                   | Proof   | Finding                                                                                                                                                                                                                                                                                             | What would end it                                                                                                                   |
| --- | -------- | ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Critical | open                     | C       | No real archive has gone through the shipped code in a Worker. 0 load runs. No test reads a real tile; the fixtures' schema has no stated source; renamed kinds or shifted tiles pass every check. Every green chain printed NOT RUN.                                                               | Streets drawn through the staging Worker from the loaded file, and one real tile committed as a fixture.                            |
| R2  | High     | open                     | S, W, G | CPU and memory are unmeasured; the plan is not in the repository. `decodeDirectory` bounds its count by byte length (`pmtiles.ts:157`), so a 2 KB directory can allocate about 170 MB; no cap on features or points; an ended isolate fails the page. Needs a writer (R8). Critical on a free plan. | The plan known, CPU and memory measured on staging, the count bound corrected, a cap on features and points.                        |
| R4  | High     | open                     | C, S    | No log, metric, probe or smoke for streets. NOT RUN lines are `console.log`, not test names; the board cannot show them. Becomes Critical when an object lands while the flag is "false".                                                                                                           | A street outcome on the cost line, a scheduled probe, NOT RUN carried to the job summary and the board.                             |
| R8  | High     | open                     | C, S    | Nothing that can fail controls who writes the one bucket: `staging` has no branch policy or reviewer; branch Workers have a writable binding; the deploy token holds R2 write; any deploy re-creates a missing bucket; no actor check on the load. Security Critical on the bind day.               | The write key in an environment limited to `main` with a reviewer; the lock seen to refuse a write; an actor check on the dispatch. |
| R17 | High     | partly                   | S, C    | Check and staging cases now need roads. Residual: they prove "some road exists", not "roads sit under the hexagons"; three floors disagree; three behaviours have no staging case; no real file has met the check.                                                                                  | Staging cases for thin layer, timeout and zoom floor; one floor; a case that compares roads to hexagons.                            |
| R20 | High     | open                     | S       | No runtime switch: the flag gates tests only. Streets go live when the object lands. Rollback is an owner dashboard action or a PR and a queued deploy.                                                                                                                                             | A configuration switch for the street layer, read by the Worker.                                                                    |
| R24 | High     | open                     | S       | Dot touch target under 44 px below a 379 px viewport (36.4 px at 320); breaches invariant 8. The 375 px gate never visits `?area=`. After a load only. Computed, not rendered.                                                                                                                      | A minimum on-screen hit size and a 320 px check on a page with streets.                                                             |
| R27 | High     | open                     | S       | The flag cannot go "true" on a green chain: four T4k axe tests fail by design once streets are binding, and `env-parity.test.js:278` wants the flag set in a PR whose run drew streets.                                                                                                             | A contrast judge that can pass with streets, and a flag-change path that can reach Done.                                            |
| R32 | High     | open                     | S, C    | Records are hand-carried and unchecked. ROLE-STATE has no entry for PRs 1270 and 1272; PR 1270 changed what ADR-033 D4 describes and touched no ADR; LINEAR-MAP has no OSE-2064 rows; four runbook lines false or stale; no story or CI/CD testing ticket for the drawing. Absorbs R19 and R34.     | The entries written, ADR-033 D4 and the documents corrected, a testing ticket for the drawing.                                      |
| R38 | High     | open                     | S       | Text legibility over the map. Dot numbers 7 to 8.75 px and town names 10.3 to 12.8 px against the 13 px floor; the pale dot's number 2.1 to 2.4:1 and boundary about 2.1:1. The text-floor gate cannot see it. After a load only. Computed, not rendered. Absorbs R39.                              | Larger type with a halo, a token choice for the pale dot, a rendered check in both themes.                                          |
| R43 | High     | open                     | L, G    | Dot positions come from Google Geocoding (`lib/event-place.ts:107`); Google's terms bar use with a non-Google map; after a load they sit over OpenStreetMap streets. Whether a derived H3 cell counts is not decided by the text. The "no Google Maps" ruling is unwritten.                         | An owner or counsel ruling, written in the repository.                                                                              |
| R3  | Medium   | open                     | S, G    | The timeout is untested on the Worker path; reads are not cancelled; a shared pending promise may hold later requests 1.5 s (platform behaviour unproven).                                                                                                                                          | Read times through the binding on staging; a workers-pool test that loses the race and calls again.                                 |
| R5  | Medium   | partly                   | S, C    | The zoom floor is now on the landing. Residual: every landing reads, decodes and draws inline, twice rendered, with no stored copy, no cache header and no negative cache.                                                                                                                          | A stored copy of the drawn layer; a short memory of a missing or bad frame.                                                         |
| R6  | Medium   | open                     | S       | File size and runner fit are unmeasured; the cut has no `--maxzoom`; the choice is fixed once locked.                                                                                                                                                                                               | One `measure` dispatch by the owner and the `--maxzoom` decision.                                                                   |
| R7  | Medium   | partly                   | S, C    | The drawer pays roads first, cuts lines and hides thin layers (unit-tested, mutation 99.81). Residual: a dense frame keeps a scatter of long streets; no minimum kept fraction; water can vanish.                                                                                                   | A minimum kept fraction or hexagons only, and a test that feeds the measured demand.                                                |
| R9  | Medium   | open                     | S       | Loading turns on a dot map from which a scraper recovers a home-capable place's res-9 cell, the home marker and the organizer's venue text (`map-place-panel.ts:59-61`). The address is already in the public events API. The location ruling is unwritten.                                         | An owner ruling, written.                                                                                                           |
| R12 | Medium   | open                     | S       | The load workflow has never run: orphaned parts, a refused re-run after a landed-but-red object, step limits of 360 minutes in a 300-minute job, and owner-side mistakes that are silent.                                                                                                           | A `measure` run, next-step lines on each stop, step limits inside the job limit.                                                    |
| R13 | Medium   | open                     | S       | No integrity pin: the upload is verified by size; the hash goes to the job summary and nothing compares it; nothing reads the lock back. High on the bind day.                                                                                                                                      | A hash read back from the bucket against the check record; the etag pinned and compared on read.                                    |
| R14 | Medium   | partly                   | S       | Eighteen probes now. Residual: no rural, edge or border probe; every staging cell is Chicago; probe coordinates unpinned.                                                                                                                                                                           | Probes chosen by population and water share, pinned by a test.                                                                      |
| R15 | Medium   | open                     | S       | A frame partly outside the region draws one side only and still shows.                                                                                                                                                                                                                              | Hexagons only when part of the frame has no tile.                                                                                   |
| R21 | Medium   | partly                   | C, S    | The cases read the flag, seen on `main` (run 43674436446: NOT RUN and pass). Residual: a thin-but-shown layer reddens three cases on correct output; the keyboard test with streets is unjudged.                                                                                                    | The cases agreeing with the Worker's floor; one run with the flag "true" on a throwaway branch after a load.                        |
| R23 | Medium   | open                     | S       | `npm ci` with lifecycle scripts on the runner that later holds the R2 key; reachable only through a compromised pinned package.                                                                                                                                                                     | Scripts off for that install, or the upload in its own job.                                                                         |
| R25 | Medium   | partly                   | L, S    | NOTICE written; the credit meets ODbL s.4.3. Residual: no page links the method (s.4.6); a copied picture carries no credit; nothing but a runbook sentence holds the load until the owner answers.                                                                                                 | One link to the method, and the owner's answers to NOTICE's open questions.                                                         |
| R26 | Medium   | partly                   | S       | ADR-035 and the security records exist. Residual: ADR-033 and ADR-035 are "Proposed" while cited as the rule; no ADR for the location ruling; the runbook cites an AGENTS.md line that does not exist and holds bucket deletion steps outside a break-glass runbook.                                | Owner decisions on the ADR status and the AGENTS.md line (a governed file: its own review).                                         |
| R28 | Medium   | open                     | C       | What a merge proved for the map: PRs 1267, 1270 and 1272 merged before their branch chains ended, and are Done on chains that checked no street. Four merges waited 68 to 118 minutes for staging.                                                                                                  | Branch chains read before merge; a street assertion in the chain.                                                                   |
| R29 | Medium   | open                     | S       | The staging-cases unit test builds pages by hand and never meets the real renderer; drift fails loud on staging, late.                                                                                                                                                                              | The test fed by the real renderer.                                                                                                  |
| R31 | Medium   | open                     | S       | `check.ts` (the owner's gate), `map-areas.ts`, `map-zoom-style.ts` and `html-escape.ts` are outside mutation (`stryker.conf.mjs:59-207`).                                                                                                                                                           | The four files under mutation with floors.                                                                                          |
| R33 | Medium   | open                     | S       | The conformance report and the ledger cannot tell a tested control from an open one with no test; the only test on open entries cannot fail; the ledger's mirror is stale.                                                                                                                          | A test that fails on an open entry with no test past a date; the mirror regenerated or removed.                                     |
| R36 | Medium   | open                     | S, W    | `layerShows` on real places: hides a village with only minor roads; shows one main-road point plus 99 minor, an off-screen highway, a two-cell zoom 7 sketch. Thresholds rest on the old workstation measurement.                                                                                   | Thresholds checked on real tiles after a load; points counted inside the frame.                                                     |
| R37 | Medium   | open                     | S, C    | The area-map route draws streets for any res-7 cell with no events requirement, bounded by a limiter that keys the whole IPv6 address and fails open (`public-read-limit.ts:85-89`, `:148-149`). The limiter is site-wide.                                                                          | A limit keyed on the /64, and an owner view on drawing streets for cells with no events.                                            |
| R42 | Medium   | open                     | S       | No gate proves the object exists, is locked or drew streets before production binds; no workflow runs `prod-preflight`; `--strict` parity fails by design. DevOps rates it High.                                                                                                                    | A CI step that reads the object and its lock; `MAP_TILES` out of UNDECIDED.                                                         |
| R44 | Medium   | open                     | S, C    | Gates can be weakened in the PR they judge: the flag back to "false", a file dropped from `mutate` and `FLOORS` together. "Never lower" is a comment. No review is required on `main`.                                                                                                              | A ratchet against the base branch for floors and the mutate list; a test that pins the flag.                                        |
| R45 | Medium   | open                     | C       | Staging serves the last branch's code until the next `main` deploy; a nightly or T2/T3 green is not tied to a commit. Only T4 asserts the deployed version. Pipeline-wide.                                                                                                                          | The version assertion in T2 and T3 and the nightly.                                                                                 |
| R50 | Medium   | open                     | S       | Hexagons use `--accent` against the spine's map rule; in the light theme hexagons and water are the same colour (not re-checked in loop 5).                                                                                                                                                         | A token choice through CHANGING-COLORS.                                                                                             |
| R51 | Medium   | open                     | S       | No span cap (`street-map.ts:589`): one published event in a distant area drops the landing frame under zoom 7 and removes streets for every visitor.                                                                                                                                                | A span cap on the landing frame.                                                                                                    |
| R11 | Low      | open                     | C       | Build 20261109 is pinned in the workflow and about 15 files; it was still offered at loop 2.                                                                                                                                                                                                        | Load, or re-point to a current build.                                                                                               |
| R16 | Low      | open                     | S       | Counts of 1 to 4 events on dots and captions (not decided by invariant 2's text); no refresh owner; labels ignore dots.                                                                                                                                                                             | Two owner answers and small corrections.                                                                                            |
| R22 | Low      | open                     | S       | The landing's second render sits in the same try; two clock reads. No throw path was found.                                                                                                                                                                                                         | The second render in its own try.                                                                                                   |
| R30 | Low      | open                     | S       | Born-red for PR 1270 is a sentence; the staging cases were never seen red on staging.                                                                                                                                                                                                               | A fault list in the PR; one injected fault on staging after a load.                                                                 |
| R35 | Low      | open                     | S       | The org brain predates the map; no rule requires recording a new data dependency there.                                                                                                                                                                                                             | An owner view on whether it should.                                                                                                 |
| R40 | Low      | open                     | S       | No forced-colours or print handling for streets; no written rule.                                                                                                                                                                                                                                   | A design decision.                                                                                                                  |
| R48 | Low      | open                     | S       | OpenStreetMap label text reaches the landing escaped but unfiltered (bidi controls) and its width is mis-estimated for wide glyphs.                                                                                                                                                                 | A character filter and a width rule for wide glyphs.                                                                                |
| R49 | Low      | open                     | S, G    | Edge geometry untested: antimeridian, pentagon cell, high latitude.                                                                                                                                                                                                                                 | Three unit tests.                                                                                                                   |
| R52 | Low      | open                     | S       | `/api/v2/map/areas` has no OpenAPI path and no `tests/contract` entry. It is in Bruno (three cases, run by CI).                                                                                                                                                                                     | An OpenAPI path.                                                                                                                    |
| R18 | Medium   | closed                   | S, C    | A wrong but non-null layer accepted as good. `layerShows` now hides water-only and stub layers (`street-map.ts:253-256`; mutation run 43674393963). Not seen on real tiles; the residual is R36 and R4.                                                                                             | Nothing.                                                                                                                            |
| R19 | Medium   | closed (merged into R32) | S       | Product documents promise what the drawer does not deliver.                                                                                                                                                                                                                                         | See R32.                                                                                                                            |
| R34 | Medium   | closed (merged into R32) | C, S    | No story, acceptance criteria or CI/CD testing ticket for the drawing.                                                                                                                                                                                                                              | See R32.                                                                                                                            |
| R39 | High     | closed (merged into R38) | S       | WCAG AA fails by computation for the pale dot and town names.                                                                                                                                                                                                                                       | See R38.                                                                                                                            |
| R41 | High     | closed (merged into R8)  | S, C    | The bucket remake route is unwired; any deploy re-creates a deleted bucket.                                                                                                                                                                                                                         | See R8.                                                                                                                             |
| R47 | Medium   | closed (merged into R8)  | S       | Nothing but the absent keys stops a writer dispatching the load.                                                                                                                                                                                                                                    | See R8.                                                                                                                             |
| R10 | Medium   | withdrawn                | S       | The landing leads with a list below 10 events: designed behaviour.                                                                                                                                                                                                                                  | Nothing.                                                                                                                            |

**Arithmetic, fixed weights (Regulatory 25, Critical 15, High 10, Medium 5, Low 2):** 1 × 15 + 10 × 10 + 24 × 5 + 9 × 2 = 15 + 100 + 120 + 18 = 253. 100 - 253 = **-153**, clamped to **0%**. 44 open rows.

**The earlier run's rows (R1 to R26), like for like:**

- Ended: R18 (source and a mutation run; not seen on real tiles). Withdrawn before: R10. Merged: R19 into R32.
- Partly ended: R5, R7, R14, R17, R21, R25, R26. R17 and R21 moved because the checks and cases changed (source, and seen on `main` at run time for R21). R25 moved because the licence text was read.
- Open: R1, R2, R3, R4, R6, R8, R9, R11, R12, R13, R15, R16, R20, R22, R23, R24.
- Points: 182 in the earlier run; 161 after loop 4; **146** after loop 5 (R1 15; six High 60; thirteen Medium 65; three Low 6). The moves: R7 from Critical to Medium (-10); R5, R21 and R25 from High to Medium (-15); R11 and R22 from Medium to Low (-6); R18 and R19 out (-10); R20 up from Medium to High (+5).

**The new rows (R27 on): 21 open rows, 107 points.** By origin: a wider area measured 65 (R28, R31, R32, R33, R35, R40, R42, R43, R44, R45, R48, R49, R50, R52); rows split out of older rows 25 (R27, R37, R38); defects in what the corrections changed 17 (R29, R30, R36, R51).

**Comparison with the earlier 0%, raw -82:** the system is closer than it was on the rows both runs measured (182 to 146), and three correction PRs are Done by the chain. The raw figure is lower (-153) because this run weighed CI/CD, the pyramid, the records and the licences as the owner asked. Neither figure is a measure of distance; both mean "far below 95".

**Other readings, for honesty about the figure:**

- Modifiers were not applied. With the staging modifier alone (0.75): 100 - 190 = -90. With the loop-position modifier the figure only falls (the data scientist's figure on loop 4's table was at least 332 points).
- Loosest legal reading (every finding partly verified and staging-only, 0.375 of its weight): 100 - 95 = about 5.
- Every disputed severity at its lowest and every candidate merge taken (the data scientist's 38 rows, 174 points): -74 at fixed weights; about 35 at 0.375.
- No reading reaches 95.

**Lens dissents kept on the record:** DevOps would keep R47 apart from R8 and raise R42 to High. SDET/SRE would lower R3 to Low and move R28 and R45 beside the register. The data scientist would lower R43 to Medium and move it beside the register, and would end R21. The product owner would lower R32 to Medium.

## Solutioning

Worked out by the lenses in loops 2 to 5 and put in order by the scrum master lens. Nothing below has been done. The owner decides the order (see the human gate).

**Of the earlier worksheet's eight steps:** step 1 (staging cases read the flag) is Done, PR 1272. Step 5 (the drawer and its gates) is Done, PR 1270, without a span cap. Step 4 (licences) is partly done, PR 1267: NOTICE is written and its questions wait on the owner. Steps 2, 3, 6, 7 and 8 are the owner's and have not started.

**What agents can do without the owner (each a PR, each run on staging):**

1. **Records (R32).** ROLE-STATE entries for PRs 1270 and 1272; LINEAR-MAP rows for OSE-2064 to OSE-2067; ADR-033 D4, the cost and integration documents and the router header brought in line with the code; the runbook's false and stale lines (`:56`, `:400-401`, `:336-343`, `:443-444`); the code comments that say what the code does not do. Scrum master and backend.
2. **Reader and drawer hardening (R2, R51, R15, R49, R22).** The count bound `4n <= length` in `decodeDirectory`; a cap on features and points while decoding; a span cap on the landing frame; hexagons only for a partly covered frame; edge-geometry tests. Backend.
3. **Gates (R31, R44, R52, R29, R33).** The four files under mutation with floors; a ratchet against the base branch; an OpenAPI path for the area-map route; the staging-cases unit test fed by the real renderer; a ledger test that can fail. QA.
4. **Staging cases and signals (R17, R4, R21, R45).** Cases for thin layer hidden, timeout leaves hexagons and the zoom floor; NOT RUN carried to the job summary and the board; a street outcome on the cost line; the version assertion in T2 and T3. QA, FE integration, SDET/SRE.
5. **The page (R24, R38, R50, R27, R20, R48).** A minimum on-screen hit size; larger map text with a halo; token choices for the pale dot and for water against hexagons through CHANGING-COLORS; a contrast judge that can pass with streets; a runtime switch for the street layer. Design and FE integration.
6. **The load path (R8, R13, R12, R23, R42).** A workflow change that takes the write key from an environment limited to `main`; an actor check on the dispatch; a hash read back from the bucket; a lock readback; the install without lifecycle scripts; step limits inside the job limit. DevOps prepares the PR; the environment and its reviewer are the owner's.

**What only the owner can do, in order:**

7. Answer the human-gate questions that block the load (questions 1 to 6 and 10 to 14).
8. Check the bucket (no public URL, an acceptable jurisdiction) and create the environment for the write key.
9. Dispatch `measure`, then decide `--maxzoom`.
10. Dispatch the load to staging, with the flag "false" and production unbound; then lock the object and remove the keys.

**After the load:**

11. SDET/SRE and backend measure through the staging Worker: CPU and memory for the densest frame, cold and warm reads, a lost timeout (R1, R2, R3). One real tile is committed as a fixture. Design renders the page at 320 px in both themes (R24, R38). The thresholds of `layerShows` and the probes are checked on real places (R36, R14).
12. The flag goes "true" in a PR whose staging run prints the street cases as test names and passes. Production binds only after that, and only with R8, R13 and R42 ended.

**Acceptance for "the map works"** (the earlier worksheet's list, still unmet): a one-area view in a city and in a small town shows legible streets at 320 px in both themes with a 44 px dot target; a multi-area frame draws highways and major roads in every cell in view or hexagons only; checked on staging through the Worker with the staging cases printing test names.

## What must be true before shipping

**Before the owner loads the archive to staging:**

- The owner has ruled on the Google Geocoding term (R43), the ODbL method link (R25) and the dot over streets (R9).
- The write key's home is an environment limited to `main` with a reviewer, or the owner has accepted loading without it (R8).
- The owner has looked at the CI-made bucket; it is confirmed empty just before the load (R8).
- `measure` has run, the size fits the runner, and `--maxzoom` is decided (R6, R12).
- The plan's CPU limit is known and the directory count bound is corrected (R2).
- A switch exists to turn streets off, or the owner accepts that the only way back is a dashboard action (R20).
- The dot target and map text corrections have merged, because the defects go live with the object, not with the flag (R24, R38).

**Before the `streetMapArchiveLoaded` flag is set to "true":**

- Streets have been seen through the staging Worker, with CPU, memory and read times measured (R1, R2, R3).
- A contrast judge exists that can pass with streets, and the flag-change PR can reach Done (R27).
- The page with streets has passed a rendered check at 320 px in both themes (R24, R38).
- Staging cases exist for a thin layer, a timeout and the zoom floor, and agree with the Worker's floor (R17, R21).
- A street failure emits a signal, and NOT RUN is visible outside a job log (R4).

**Before production binds the bucket:**

- A control that can fail limits who writes the bucket, and the lock has been seen to refuse a write through a Worker binding. Without this the Dr of Security rates the binding Security Critical (R8).
- The loaded object's hash is compared and its etag is pinned (R13).
- A CI step proves the object exists, is locked and drew streets; `MAP_TILES` has left UNDECIDED in env-parity (R42).
- Gates cannot be weakened in the PR they judge, or the owner has accepted that (R44).
- ADR-033 and ADR-035 carry the status the owner intends, and ROLE-STATE says what is true (R26, R32).
- Production is still held closed: binding the bucket is a production change and goes through CI's release path with a ticket.

## Verification

After a load, in this order:

- `gh run list --workflow "Street-map archive load (stg)"` shows one successful load; its check step ends in PASS; the key is listed at the checked size. These three checks exist today.
- The lock is read back and the object's hash matches the check record. Neither check exists today.
- A staging chain is green for T1 Deploy → Staging, T2 Contract → Staging (Bruno), T3 E2E Smoke → Staging (Playwright) and T4 Functional → Staging, and the street cases print test names, not NOT RUN. Today they print NOT RUN while the flag is "false", so a green chain after a load proves nothing about streets until the flag changes.
- The staging pages for the acceptance frames are read through the Worker and the drawn road classes are counted.
- The cost line shows a street outcome. It does not exist today.

Three checks the QA lens says would settle most of the source-read rows: the loader in the workers pool against one real tile; the archive check against a real cut; the flag set to "true" on a throwaway branch through T2 and T4 once after a load.

## Risks accepted

None. The run accepted nothing on the owner's behalf. Put to the owner to accept or refuse:

- Frames under zoom 7 show hexagons only, for good.
- A village with only minor roads shows hexagons and no dots (R36).
- `/` stays without a rate limit until its own ticket.
- The pipeline-wide rows (R28, R45) are worked outside the street map.

## Human gate

The gap appeared in loop 1, Critical layer (no real archive through the shipped code), and widened in loop 2, Conservative layer (the floor does not cover an ended isolate or a replaced object) and loop 4, Compliance layer (the written rules that are unmet or silent). The run stops here. Only the owner can answer these. Under each question: what closes it, and where the gap appeared.

**Carried over from the earlier run's nine:**

1. Which Workers plan is the account on, and what CPU limit applies to one request?
   - Closes with the plan and limit written in the repository. Earlier run, loop 1, Critical; still open.
2. The bucket `ose-map-tiles` was made by the deploy: keep it after checking it has no public URL and an acceptable jurisdiction, or delete it and make it by hand?
   - Closes with the owner's read of the bucket and the choice written on OSE-1883. Earlier run, loop 3, Adversarial; still open.
3. Where should the R2 write key live so that only `main` can reach it, and what can the repository-level deploy token do?
   - Closes with a named environment, its reviewer, and the token's permissions stated. Earlier run, loop 3, Adversarial; still open.
4. Cut with `--maxzoom 14`?
   - Closes with one `measure` run and the decision. Earlier run, loop 1, Critical; still open.
5. Corrections first, then the load?
   - Partly answered in writing ("corrections first", runbook `:29`, `:330`). Still open: which of steps 1 to 6 above must land before the load. Closes with the owner's list. Earlier run, loop 3; this run, loop 5, Recursive.
6. Is a dot for a home-hosted event over legible streets wanted, with the organizer's venue text in its panel?
   - Closes with the 2026-11-09 location ruling and the 2026-10-31 privacy goal written in the repository in the owner's words. Earlier run, loop 3; this run, loop 4, Compliance.
7. Does invariant 2 cover counts of events (the map shows 1 to 4), or only counts of people?
   - Closes with a ruling. Earlier run, loop 4, Compliance; still open.
8. The landing now hides streets under zoom 7 (PR 1270). Is that the wanted answer, and should a span cap stop one distant event removing streets for every visitor?
   - Closes with a ruling on R51. Earlier run, loop 2; this run, loop 3, Adversarial.
9. Can the public reach the staging pages?
   - Answered by observation, not by the owner: staging answered a plain GET with 200 in loop 1, so licence duties start at the load. Closes with the owner confirming that reading. Earlier run, loop 4, Compliance.

**New in this run:**

10. Does Google's "non-Google map" term apply to dot positions derived from Google Geocoding and drawn over OpenStreetMap streets?
    - Closes with an owner or counsel ruling, and the "no Google Maps" ruling written. Loop 4, Compliance.
11. Does the ODbL method need a link from the page (s.4.6), and does a copied picture need a credit?
    - Closes with an answer and, if yes, one link. Loop 4, Compliance.
12. Which rule wins: "staging changes only through CI after a merge to `main`", "main only" in the deploy hardening record, or "every branch runs on staging"?
    - Closes with a ruling; it decides how R8 can be ended. Loop 4, Compliance.
13. Is CI creating a bucket an action that needs human approval?
    - AGENTS.md lists deletion, not creation. Closes with a ruling on the AGENTS.md line (a governed file). Loop 4, Compliance.
14. The runbook has the owner paste keys in a browser. Do dashboard steps count as "the owner's own terminal"?
    - Closes with a ruling. Loop 4, Compliance.
15. Does a merge ratify a "Proposed" ADR (ADR-033, ADR-035)?
    - Closes with a ruling or a status change. Loop 4, Compliance.
16. Should a degraded street surface emit a signal, and should the cost line count R2 calls?
    - No rule requires either. Closes with a decision. Loop 4, Compliance.
17. May a gate be weakened in the PR it judges while the owner is the only reviewer?
    - Closes with a ruling. Loop 3, Adversarial.
18. Must the map's dot itself reach 44 px at 320 px, or does the 44 px list row that reaches the same place count?
    - Invariant 8 has no equivalent-control exception. Closes with a ruling. Loop 3, Adversarial.
19. Do the reporting rows (R33, R35) and the pipeline rows (R28, R45) belong in the street map's work, or in their own?
    - The lead kept them here because the owner asked for those areas to be weighed. Closes with the owner's view. Loop 5, Recursive.

**What would move the score:** a load to staging with streets seen through the Worker (R1), a control on who writes the bucket (R8), and a switch with a flag path that can go green (R20, R27) together remove 45 of the 253 points and most of the doubt behind the rest.
