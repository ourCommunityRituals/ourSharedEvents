---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: extended
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 0, critical: 2, high: 8, medium: 14, low: 1 }
subject_commit: bf1c696d (on main; the full SHA is in the Verdict table)
---

# CCR: will the street map work for the application in its present form (2026-11-15)

**Owner's request, word for word:** "First assess through a CCR 5 loop extended scrum assessment if this map will event work for the application in its present form"

**How it ran:**

- Five loops in the owner's order: Critical, Conservative, Adversarial, Compliance, Recursive. All nine role lenses of the extended scrum team ran in every loop.
- The subject was frozen at `main` commit `bf1c696d`. Nothing was changed between loops and no correction was made during the run.
- There is one cumulative score. It is under 95%, so the team's solutioning is written below.
- Loops 1 and 2 and the real-tile measurement were run by an earlier session, which stopped at the owner's session token cap. This session merged them and ran loops 3, 4 and 5.
- A score is a signal, never permission.

## Verdict

|                           |                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Answer**                | **Not in its present form.** On a workstation the shipped drawer gave a clear street grid for the one-area view (two places, one run each), and a water-only or thinned map for the dense multi-area frame that was tried (Manhattan). No check in the repository can tell those two results apart, and nothing has yet run in a Worker on staging. |
| **System score**          | **0%.** Weighted deductions total 182, so the raw figure is -82. On the loosest reading the protocol allows the figure is about 32. No reading reaches 95.                                                                                                                                                                                          |
| **Security Critical**     | None today: production has no `MAP_TILES` binding. The Dr of Security ruled that it becomes one on the day production binds the bucket if nothing changes first (R8). That is a condition for binding, written below.                                                                                                                               |
| **Regulatory**            | None counted. Loop 4 rated the licence finding Regulatory from general knowledge; loop 5 lowered it to High because no licence text was read and no street is public yet (R25).                                                                                                                                                                     |
| **Assessment confidence** | **60%.** The direction is well supported. The size of the figure is not: about two thirds of the weight rests on source reads, and the one measurement is a single workstation run. Confidence in direction rose after the measurement. Confidence in magnitude fell in loops 4 and 5.                                                              |
| **Gate**                  | **STOP, human gate.**                                                                                                                                                                                                                                                                                                                               |
| **Subject**               | `main` at `bf1c696d9ccaec2f2066acf122da4510f3be92ff`. `main` moved four commits during the run (to `b28b11d2`). None touched the street-map files. `workers/oursharedevents/src/handlers/pages.ts` changed in three places unrelated to the map (an import, an export keyword, a registrations count query). The assessment stays on `bf1c696d`.    |

**What works, as far as it was shown:**

- The shipped reader, decoder and drawer read real Protomaps tiles without error. Sizes are far inside the reader's limits: the largest tile was 0.17 MiB unpacked against a 4 MiB limit.
- The one-area view at zoom 14 drew a full street grid in Manhattan and in Sawyer MI. This is the view a visitor reaches by tapping an area, and the view the first customer (Sawyer) meets. It was judged by eye from two frames, without the shipped zone outline and dots.
- Multi-area frames at zoom 12 in Los Angeles, Chicago and Sawyer drew highways and major roads.
- A thrown error or a missing tile leaves hexagons only. There is no script-injection path from a hostile file. Invariants 3, 4, 5, 7 and 9 hold in the street-map code.
- The mock-layer tests are strong. The load workflow keeps the bucket, the token, the dispatch and the lock with the owner, uses GitHub-hosted runners, and asks nothing of the owner's computer.

**What does not:**

- **The drawer (R7).** It pays water first out of 9,000 points and skips any feature that costs more than what is left. Manhattan with 19 areas drew water only. Manhattan with 7 areas drew highways, major roads on the New Jersey side only, and no minor roads. A two-city frame at zoom 6 drew 10 points of road.
- **The checks (R17).** The archive check and the staging cases accept any one road path, or a water path, as "streets". A water-only layer would pass them.
- **Proof (R1).** No real archive has gone through the shipped code in a Worker. The United States file has never been cut or read.
- **The staging chain (R21).** Loading the archive turns two staging cases red on correct behaviour, for every branch.
- **The bucket (R8).** CI created it against the runbook's order, and nothing enforces who may write the object production will read.

## What was reviewed

**In scope:** the street map drawn under the H3 hexagons on the landing page and in the public area map, from one PMTiles archive in R2, as it stands at `bf1c696d`.

- `workers/oursharedevents/src/lib/pmtiles.ts`, `street-map.ts`, `mvt.ts`
- the callers in `workers/oursharedevents/src/handlers/pages.ts` and `map-areas.ts`, and `src/lib/attendee-map.ts`, `landing-area.ts`, `map-zoom-style.ts`
- `.github/workflows/street-map-archive-load.yml` and `scripts/ci/street-map-archive-load.mjs`
- `workers/oursharedevents/scripts/street-map-archive/check.ts`
- `docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md`, `workers/oursharedevents/wrangler.toml`, the street-map tests and the staging cases

**Out of scope, noted for the owner:**

- The public events API already publishes each active event's exact `where_address`, `lat` and `lon` (`workers/oursharedevents/src/lib/public-event-projection.ts:61-63`; `src/handlers/events.ts:207-208`, `:295`). That is finer than anything the street map draws, home-hosted events included, and it sits beside invariant 3. It is older than the street map and is the subject of OSE-1245.
- The missing rate limit on `/` is older than the street map (`docs/security/ROUTE_CLASSIFICATION_POLICY.md:97` requires one).
- Cloudflare account state: no agent read it. The bucket's settings, the Workers plan and the tokens' scopes are unknown.

**State of the world during the run (command output):**

- "Street-map archive load (stg)" has 0 runs. Staging and production draw hexagons only.
- The bucket `ose-map-tiles` exists and CI made it. The post-merge deploy of `bf1c696d` (run 43659704554, job "T1 Deploy → Staging", 2026-11-15 01:07:38 UTC) logged `Creating new R2 Bucket "ose-map-tiles"...` and `MAP_TILES provisioned`.
- The GitHub environment `staging` has no branch policy, no reviewers and 0 secrets.
- Run 43659704554 on `bf1c696d`: T1 Deploy, T2 Contract (Bruno), T3 E2E Smoke (Playwright) and T4 Functional all success, with no street assertion counted.
- The staging edge challenges reads from a GitHub runner: run 43637530383 failed two place-panel cases on a 403 and a bot-check beacon until PR 1255 sent the CI header.

## The measurement (a workstation vetting run, not staging)

The earlier session ran the repository's own reader (`pmtiles.ts`), decoder (`mvt.ts`) and drawer (`drawStreets`, `MAX_POINTS` 9,000 unchanged) in Node on a workstation, against real tiles of Protomaps planet build 20261109 read by byte range over HTTPS. Nine hand-picked frames, one run each.

**It supports a finding. It does not stand in for a Worker on staging, for an R2 binding or for the United States cut.** Under the owner's environment rule it is a test rig.

| Frame (res-7 cells)                        | zoom | tiles | bytes read | read ms | decode ms | draw ms | points drawn: water / highway / major / minor | labels |
| ------------------------------------------ | ---- | ----- | ---------- | ------- | --------- | ------- | --------------------------------------------- | ------ |
| Manhattan, 1 cell                          | 14   | 12    | 1.10 MiB   | 1002    | 53        | 27      | 2256 / 735 / 1862 / 3471                      | 0      |
| Manhattan, 7 cells                         | 12   | 6     | 0.52 MiB   | 732     | 29        | 89      | 5093 / 2928 / 979 / 0                         | 6      |
| Manhattan, 19 cells                        | 12   | 12    | 0.85 MiB   | 384     | 48        | 94      | 8999 / 0 / 1 / 0                              | 5      |
| Los Angeles, 7 cells                       | 12   | 6     | 0.56 MiB   | 660     | 23        | 69      | 372 / 4512 / 4116 / 0                         | 1      |
| Chicago, 19 cells                          | 12   | 12    | 0.88 MiB   | 1018    | 15        | 58      | 2373 / 2655 / 3972 / 0                        | 1      |
| Sawyer MI, 1 cell                          | 14   | 12    | 0.37 MiB   | 672     | 4         | 4       | 342 / 144 / 109 / 2539                        | 4      |
| Sawyer MI, 7 cells                         | 12   | 6     | 0.31 MiB   | 313     | 2         | 4       | 679 / 224 / 190 / 1873                        | 1      |
| Chicago + New York, 2 cells                | 6    | 8     | 0.75 MiB   | 658     | 27        | 87      | 8990 / 10 / 0 / 0                             | 6      |
| Seattle, Miami, San Diego, Bangor, 4 cells | 4    | 12    | 0.72 MiB   | 328     | 20        | 14      | 5463 / 2996 / 0 / 0                           | 6      |

What the tiles asked for before the budget: Manhattan 19 cells asked for 16,358 points of water, 13,538 of highway, 19,045 of major road and 48,676 of minor road.

**What loop 5 checked about it:**

- **The script is faithful.** It calls the shipped `frameForCells`, `tilesFor`, `readTiles` and `decodeTile`, hands tiles to `drawStreets` in the shipped order, and imports `MAX_POINTS` unchanged. An HTTP range returns the same bytes an R2 range would. Only timing differs.
- **The table matches the raw numbers** for all nine frames.
- **Two descriptions were wrong and are corrected here.** The Manhattan 7-cell frame was described as "roads on one side". In fact highways cross the whole frame, major roads sit only on the New Jersey side, and there are no minor roads. The zoom 4 frame was described as "almost no roads". It drew 2,996 points of highway.
- **Only Manhattan drew water only.** Los Angeles and Chicago lost minor roads and kept highways and major roads. That other water-heavy cities fail the same way is predicted by the mechanism and is untested.
- **The frames carried the script's own hexagons** (fill-opacity 0.2). The landing ships 0.15 to 0.50 over streets and the zoomed view ships a zone at 0.06 with dots. Nobody has seen the shipped page with streets.
- **The times say nothing about a Worker.** They came from a workstation over the public internet.

## Loop 1

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Critical layer: what is true against what is assumed. Run by the earlier session.

Lens verdicts: four said "works with conditions" (security, FE integration, data scientist, product owner). Five said "cannot tell" (backend, design, QA, SDET/SRE, DevOps).

What it found, merged to 16 root causes (R1 to R16):

- No real archive has ever gone through the shipped code, and no test reads a real tile (R1, Critical).
- CPU and memory in a Worker are unmeasured (R2). The 1,500 ms timeout sits beside the only timing on record (R3). Nothing signals when streets stop (R4).
- The landing does the work on every request with no stored copy and no width guard (R5). The size of the United States file is unmeasured (R6). How the map looks was unknown (R7).
- The shared-bucket protections are statements, not gates (R8). Loading the archive turns on the dot map (R9). The landing leads with a map only at 10 events (R10).
- Five Medium items on the build's age, the load workflow's first run, the hash compare, probe coverage and the region edge (R11 to R15), and one Low (R16).

Score: 0%

Raw figure: -32 (1 Critical, 9 High, 5 Medium, 1 Low: 132).

## Loop 2

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Conservative layer: assume the worst case, and ask whether the floor "any failure leaves hexagons only" still holds. Run by the earlier session, after the measurement.

What it added or moved:

- The water-only frame is a deterministic result of the shipped drawer, so R7 rose to Critical.
- Neither the archive check nor the staging cases can tell a water-only layer from a good one (R17, new, Critical).
- A wrong but non-null layer is accepted as good: the credit shows, the hexagons lighten, the dot map turns on (R18, new).
- The floor does not cover the isolate being ended at a CPU limit, and the plan and limit are not in the repository (R2).
- Documents promise streets where the drawer shows none (R19, new). The way back is coarse (R20, new).
- R9 and R10 were lowered to Medium. Cost is not the risk.
- Dr of Security: nothing Security Critical.

Score: 0%

Raw figure: -62 (3 Critical, 7 High, 9 Medium, 1 Low: 162).

## Loop 3

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Adversarial layer: act as someone who wants this to fail or to misuse it.

What it added or moved:

- **Proved by command output:** CI created the bucket; the `staging` environment has no branch policy; a pull request's head is deployed to a staging Worker whose binding can write the bucket (R8 worse).
- **The load itself reddens the staging chain (R21, new, High).** `tests/e2e/3-flows/map-place-panel.spec.ts:162` and Bruno folder 16 require the "no street map" note and do not read the `streetMapArchiveLoaded` flag.
- The mutation program covers only the loader part of `street-map.ts`, not `drawStreets` (R17).
- Work is bounded by tile bytes, not by features or points, so a swapped file can end the isolate (R2 worse).
- Backend and SDET/SRE disagreed on what a lost timeout race leaves in the reader's module-scope cache (R3).
- Any res-7 cell with one event can be zoomed by URL, which puts a dot for a home-capable place over legible streets (R9 back to High).
- A visitor cannot widen the landing's frame by link. The frame follows published events.
- New Medium items: the landing's try and catch empty the whole area on a throw (R22); the load job runs `npm ci` on the runner that later holds the write key (R23); forced-colours, print and 400% zoom were never designed for streets (R24).
- Dr of Security: nothing Security Critical. No script-injection path.

Score: 0%

Raw figure: -92 (3 Critical, 9 High, 11 Medium, 1 Low: 192).

## Loop 4

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Compliance layer: hold the subject against the written rules, clause by clause.

Rulings:

- **Complies:** invariants 3, 4, 5, 7 and 9; tokens only, no raw colour; no `FORMS_DB` in the street code; the route header lists the area route; the load workflow's actions are pinned, its runners are GitHub-hosted, and the owner holds bucket, token and lock; no runbook step asks for a command on the owner's computer.
- **Breaches a written rule:**
  - `staging` against "main only" in `docs/security/CI_DEPLOY_HARDENING.md:160-164` (R8).
  - The bucket's creation against the runbook's order, `docs/runbooks/RUNBOOK-STREET-MAP-ARCHIVE.md:320-326` (R8). No agent broke a rule: the deploy did it, and AGENTS.md does not name bucket creation.
  - The dot's touch target against invariant 8's 44 px floor at 320 px (R24, raised to High).
  - "Every case at two layers": 0 of 6 street cases can fail on staging today (R4).
- **Met by the letter, not the intent:** the Definition of Done. T1 to T4 are green on `bf1c696d` with zero street assertions counted, and ROLE-STATE reads "staging chain green" beside street work (R4).
- **Not decided by the text, so questions for the owner:** whether invariant 2 covers counts of events (the map shows 1 to 4); whether a home-capable place's dot over streets is wanted. The dot complies with invariant 3 and the 2026-11-09 ruling.
- **New:** licence duties are recorded nowhere (R25, rated Regulatory by the product owner lens from general knowledge). Decision and security records were not updated: no ADR for the one-bucket decision, no entry under `docs/security/` (R26).
- Dr of Security: nothing Security Critical or Regulatory.

Score: 0%

Raw figure: -127 (1 Regulatory, 3 Critical, 10 High, 11 Medium, 1 Low: 227).

## Loop 5

Team: dr-of-security, role-backend-architect, role-frontend-integration, role-design-fe, role-qa-automation, role-sdet-sre, role-devops, role-data-scientist, role-product-owner

Recursive layer: was the assessment itself honest. Each lens audited the findings in its area, and the backend, design and data scientist lenses audited the lead's own measurement.

All nine lenses returned "honest with corrections". The corrections, which the register below carries:

- **Severities lowered.** R25 from Regulatory to High (no licence text read, no street public). R17 from Critical to High (it harms only because R7 exists). R3 from High to Medium (its timings are not the Worker's path). R6 from High to Medium (one `measure` dispatch settles it). R9 from High to Medium (it complies with the written rules, and the public API already publishes finer locations).
- **Withdrawn.** R10: a list below 10 events is designed behaviour. The map is still built and the street read still runs behind the list, which is counted in R5.
- **Tags corrected.** R17 and R21 were tagged PROVEN and are source reads: nobody ran the check on a real file or loaded the archive. R7 is proven on a workstation for nine frames; how often real frames hit it is inferred.
- **Double counts removed.** The bucket-creation fact sat in R8, R12 and R26: it stays once, in R8. The missing etag pin moved from R8 to R13. R18's cache claim was cut back: no edge cache exists for the route, so "25 hours" reaches only browsers and consumers.
- **Claims found unproven or wrong.** "OurWKRP copies the SVG" is not shown in this repository. The landing's events come from the `root` brand only, not from every organizer. The flake estimate for the staging chain was arithmetic on an assumption and is dropped. A size estimate of "about 3 GB" of decoded objects was a guess and is dropped. Two frame descriptions by the lead were wrong (see the measurement).
- **Understated.** The Dr of Security: "nothing Security Critical" was never tied to the day production binds. With no branch policy, a writable binding and no integrity pin, it becomes one on that day. Also new: a branch-deployed Worker could write the archive's key before the owner loads, and the owner would then lock a file nobody checked.
- **Understated.** Design: the dot's touch target is smaller than loop 4 computed. If the browser's default figure margin applies (no reset was found in source), it is about 26 px at 320 px, not 41.6 px. Nothing was rendered.
- **Not looked at by four loops:** a rendered page with streets in either theme; right-to-left layout with the credit; the scope of the repository-level Cloudflare token; the frame Sawyer's real organizer produces; whether hexagons alone are good enough for launch.

Score: 0%

Raw figure: -82 (2 Critical, 8 High, 14 Medium, 1 Low: 182). This is the cumulative figure.

## Findings register

One row per root cause, after all five loops. "Measured" means the workstation run above. "Command" means a CI run, a log or a settings read during this run. "Source" means read from the code or documents, not run.

| Id  | Severity | Proof                                                                           | Status    | Finding                                                                                                                                                                                                                                                                                                                                                                                                              | What would end it                                                                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Critical | Command (0 load runs; no spec reads a real tile)                                | open      | No real archive has gone through the shipped reader and drawer in a Worker. The United States file has never been cut or read.                                                                                                                                                                                                                                                                                       | Streets drawn through the staging Worker from the loaded file, and one real tile committed as a test fixture.                                                                |
| R7  | Critical | Measured for nine frames; mechanism from source; frequency in real use inferred | open      | The drawer's budget (`workers/oursharedevents/src/lib/street-map.ts:252-267`): water first, tile order, whole-feature skip. Manhattan 19 areas draws water only; Manhattan 7 areas draws no minor roads and major roads on one side; a zoom 6 frame draws 10 points of road. Labels are leftovers such as "Communipaw" for New York.                                                                                 | Roads paid before water, the budget spread across the frame, oversize features cut down instead of skipped, and unit tests that pin the order.                               |
| R2  | High     | Source                                                                          | open      | CPU and memory in a Worker are unmeasured. The Workers plan and CPU limit are not in the repository. Work is bounded by tile bytes, not by features or points (`src/lib/mvt.ts:114-124`). "Never a reason the page fails" does not hold if the isolate is ended. Node took 8 to 142 ms to decode and draw.                                                                                                           | The plan's limit known, CPU measured on staging for the densest frame, and a cap on features and points while decoding.                                                      |
| R4  | High     | Command for the NOT RUN prints and green chain; source for the rest             | open      | No signal when streets stop or draw wrongly: no log, no metric, no probe. Definition of Done is met by the letter with zero street assertions counted on staging. `docs/brain/ROLE-STATE.md` reads "staging chain green" beside street work.                                                                                                                                                                         | An outcome counter on the cost line, a scheduled street probe, and ROLE-STATE lines that say no street is proven on staging.                                                 |
| R5  | High     | Source                                                                          | open      | The landing reads, decodes and draws on every request, inline, twice rendered, with no stored copy, no zoom floor and no span cap, even when the map sits behind the list (`src/handlers/pages.ts:3016`). `/` has no rate limit.                                                                                                                                                                                     | A stored copy of the drawn layer keyed by cells and archive, the area map's zoom floor on the landing, and a limit on `/` (its own ticket).                                  |
| R8  | High     | Command for settings, log and baseline text; attack path from source            | open      | Nothing enforces who may write the bucket production will read. CI created it against the runbook's order. `staging` has no branch policy. A pull request's head deploys to a staging Worker with a writable binding. The lock was never tried. A branch could write the key before the owner loads. Becomes Security Critical on the day production binds if unchanged.                                             | The write key in an environment limited to `main`; the lock proved to refuse a write through the binding; the bucket checked or remade by the owner; an integrity pin (R13). |
| R17 | High     | Source (the check's logic was read, not run on a real file)                     | open      | No check can tell a wrong layer from a good one. `workers/oursharedevents/scripts/street-map-archive/check.ts:321` takes any road path as "streets"; a one-point path passes. The staging cases match a water path. No unit test pins the budget. Mutation testing skips `drawStreets`. Manhattan is not probed.                                                                                                     | A minimum share of road points per probe, water-heavy probes at 7 and 19 areas, staging cases that require road classes, and `drawStreets` under mutation.                   |
| R21 | High     | Source (predicted; no load has happened)                                        | open      | Loading the archive turns two staging cases red on correct behaviour, for every branch and every push to `main`: `tests/e2e/3-flows/map-place-panel.spec.ts:162` and Bruno folder 16 require the "no street map" note. No written rule says how the owner may load while the chain is red.                                                                                                                           | Both cases made aware of the flag before the load, and the order named in the runbook.                                                                                       |
| R24 | High     | Source and arithmetic; nothing rendered                                         | open      | Accessibility, a hard gate by owner rule. The dot's touch target is under the 44 px floor at 320 px: 41.6 px at best, about 26 px if the default figure margin applies. Street labels fall under the 13 px text floor. Forced-colours and print are undesigned. No accessibility gate and no viewport or theme check runs on a page with streets.                                                                    | A rendered check at 320 px in both themes through axe, a larger hit area, and the figure's margin reset.                                                                     |
| R25 | High     | General knowledge; no licence text read                                         | open      | Licence duties are recorded nowhere and were never checked at the source. There is no NOTICE. The method of cutting the extract is not stated as a licence notice. The OpenStreetMap credit sits beside the map, not in it, is English only on the area map, and reaches a consumer only as an instruction. No street is public today. Becomes Regulatory if the source shows an unmet duty once streets are public. | The ODbL and Protomaps terms read at the source, a NOTICE written, and the credit delivered with the SVG.                                                                    |
| R3  | Medium   | Source                                                                          | open      | The 1,500 ms timeout is untested on the Worker's path; the only timings come from a different path. The timeout does not cancel reads. What a lost race leaves in the reader's cache is unknown in workerd. When streets fail in the zoomed view the whole map is replaced by a note.                                                                                                                                | Cold and warm read times through the R2 binding on staging, and a workers-pool test that loses the race and calls again.                                                     |
| R6  | Medium   | Source                                                                          | open      | The United States file's size and runner fit are unmeasured, and the cut has no `--maxzoom` while the Worker reads zoom 14 at most. A change after the lock needs a new key.                                                                                                                                                                                                                                         | One `measure` dispatch by the owner, and the `--maxzoom` decision made before the first load.                                                                                |
| R9  | Medium   | Source                                                                          | open      | Loading the archive turns on the dot map. A one-event, home-capable place reachable by URL gets a dot at its res-9 centre over legible streets, and the page says "never a street address". It complies with invariant 3 and the 2026-11-09 ruling, and the public API already publishes finer locations.                                                                                                            | An owner ruling.                                                                                                                                                             |
| R11 | Medium   | Source                                                                          | open      | Protomaps build 20261109 ages out within days. The cut then stops with a clear error, and a new build is a pull request over about eleven files.                                                                                                                                                                                                                                                                     | Load before it ages out, or re-point to a current build.                                                                                                                     |
| R12 | Medium   | Source                                                                          | open      | First-run unknowns of the load workflow: the deploy token's level, the parsing of two tool outputs, orphaned upload parts if a runner dies, stop messages that do not say what to do next.                                                                                                                                                                                                                           | A `measure` run, which retires some, and next-step lines on each stop.                                                                                                       |
| R13 | Medium   | Source                                                                          | open      | Nothing detects a replaced object: the Worker pins no etag or hash and its cached directories have no time limit (`src/lib/pmtiles.ts:256`). High before production binds.                                                                                                                                                                                                                                           | The loaded object's etag pinned in configuration and compared on read.                                                                                                       |
| R14 | Medium   | Source                                                                          | open      | Thin probe coverage: eight single areas plus Chicago in the archive check; every staging street frame is one Chicago cell; the region file's contents are unpinned.                                                                                                                                                                                                                                                  | Probes chosen by population and water share, and the region file pinned by a test.                                                                                           |
| R15 | Medium   | Source                                                                          | open      | A frame partly outside the region draws streets on one side and flat land on the other.                                                                                                                                                                                                                                                                                                                              | Hexagons only when part of the frame has no tile.                                                                                                                            |
| R18 | Medium   | Source                                                                          | open      | A wrong but non-null layer is accepted as good at run time: credit shown, hexagons lightened, dot map on, long cache headers on the area map. It can be a blank rectangle. Reach of the cache is browsers and consumers only.                                                                                                                                                                                        | No layer when drawn roads fall under a floor: hexagons only, no credit, no dots.                                                                                             |
| R19 | Medium   | Source                                                                          | open      | Product documents promise what the drawer does not deliver: `docs/positioning/MAPPING-COST-STRUCTURE.md:19` and `:129`, `docs/adr/ADR-033-public-area-map.md` D4.                                                                                                                                                                                                                                                    | The documents say what is drawn where, and that no archive is loaded yet.                                                                                                    |
| R20 | Medium   | Source                                                                          | open      | The way back is coarse: no switch to turn streets off; a wrong locked object needs a new key, a pull request and an owner session.                                                                                                                                                                                                                                                                                   | A configuration switch for the street layer.                                                                                                                                 |
| R22 | Medium   | Source                                                                          | open      | The landing's floor is weaker than its comment: a throw in the second render empties the whole area (`src/handlers/pages.ts:3017-3020`); the two renders take two clock readings; a missing object is read again on every request.                                                                                                                                                                                   | The second render in its own try that keeps the first, one clock reading, and a short memory of a missing object.                                                            |
| R23 | Medium   | Source                                                                          | open      | The load job runs `npm ci` with lifecycle scripts on the runner that later receives the R2 write key.                                                                                                                                                                                                                                                                                                                | Scripts off for that install, or the upload in its own job.                                                                                                                  |
| R26 | Medium   | Command (search)                                                                | open      | Records were not updated: no ADR for the one-bucket decision; `MAP_TILES` sits under UNDECIDED in `scripts/ci/env-parity.mjs`; nothing under `docs/security/` for the map route or the new secret; AGENTS.md does not name bucket creation though the runbook cites it.                                                                                                                                              | An ADR, the security records, and an owner decision on the AGENTS.md line (a governed file: its own review).                                                                 |
| R16 | Low      | Source                                                                          | open      | No refresh owner or cadence; the area map's credit is hard-coded English; counts of 1 to 4 events on dots and captions (invariant 2's text does not decide them); land uses `--surface` where the guideline says `--bg`; real streets were never mocked in the design system.                                                                                                                                        | Small corrections and two owner answers.                                                                                                                                     |
| R10 | Medium   | Source                                                                          | withdrawn | The landing leads with a list below 10 events. Loop 5: designed behaviour, not a defect of the street map. The street read behind the list is counted in R5.                                                                                                                                                                                                                                                         | Nothing.                                                                                                                                                                     |

**Arithmetic, fixed weights (Regulatory 25, Critical 15, High 10, Medium 5, Low 2):** 2 × 15 + 8 × 10 + 14 × 5 + 1 × 2 = 182. 100 - 182 = **-82**, clamped to **0%**.

**Other readings, for honesty about the figure:**

- Loosest legal reading (every finding partly verified and staging-only, 0.375 of its weight): 100 - 68 = about 32.
- The protocol's loop-position modifiers would lower the figure further. They were not applied.
- R7 alone, which is measured, leaves 85.

The figure means "far below 95". It is not a measure of how far.

## Solutioning

Worked out by the lenses in loops 2 to 5 and put in order here. Nothing below has been done.

**The team's recommended order.** The owner decides it (see the human gate).

1. **Make the staging chain ready for the archive (R21, R17).** One pull request: the two "no street map" cases read the `streetMapArchiveLoaded` flag; the street cases require road classes and a minimum count, not any path. QA and FE integration. Without this, the load turns every branch red.
2. **Settle the bucket and the key (R8, R13).** Owner, in Cloudflare and GitHub:
   - Look at the bucket CI made: no public URL, and a jurisdiction the owner accepts. Jurisdiction cannot be changed later, so if it is wrong, delete the empty bucket and make it by hand.
   - Put the R2 write key in an environment limited to `main`. It cannot be `staging` as that stands, because the owner's rule that every branch runs on staging needs branches to deploy there. That means a small workflow change (DevOps) and a new environment (owner).
   - Say what the repository-level `CLOUDFLARE_API_TOKEN_OSE` can do.
3. **Measure before cutting (R6, R12).** Owner dispatches the workflow's `measure` mode, which writes nothing. Then decide `--maxzoom 14` or not. DevOps prepares the change if the answer is yes.
4. **Read the licences (R25).** Product owner and DevOps read the ODbL and the Protomaps terms at the source and write a NOTICE that names the build, the region file and the command.
5. **Correct the drawer and its gates (R7, R18, R17, R5).** Backend, with QA. This needs no new archive, so it can run beside steps 1 to 4:
   - roads before water; the budget shared across the frame; an oversize feature cut down, not skipped;
   - no layer at all when drawn roads fall under a floor, so the page shows hexagons with no credit and no dots;
   - the landing gets the area map's zoom floor and a span cap;
   - the archive check asserts a share of road points and probes water-heavy cities at 7 and 19 areas;
   - `drawStreets` goes under mutation testing.
6. **Load to staging and measure through a Worker (R1, R2, R3).** Owner loads, with the flag still "false" and production unbound. SDET/SRE and backend then measure cold and warm reads, CPU for the densest frame, and what a lost timeout leaves behind.
7. **Show it to someone (R24, R9).** Design renders the page with streets at 320 px in both themes and runs axe. The owner rules on the dot.
8. **Only then flip the flag.** The staging street cases must print PASS on the corrected drawer.

**Acceptance for "the map works", proposed by the product owner lens and tightened in loop 5:**

- A one-area view in a city and in a small town shows legible streets and water at 320 px in both themes, with a dot target of at least 44 px.
- A multi-area frame draws highways and major roads in every cell in view, or draws hexagons only. Never water alone.
- Labels are places a local would know, or there are none.
- Checked on staging through the Worker for Manhattan, Boston, Seattle, San Francisco, Miami, Sawyer and one mid-size town, with the staging cases printing PASS.

## What must be true before shipping

**Before the owner loads the archive to staging:**

- The two "no street map" staging cases read the flag (step 1), or the owner has accepted a red chain for a stated period.
- The owner has looked at the CI-made bucket and either kept it or remade it.
- The write key's home is decided, and the bucket is confirmed empty just before the load.
- `measure` has run, and `--maxzoom` is decided.
- The Protomaps build is still offered, or the workflow points at a current one.

**Before the `streetMapArchiveLoaded` flag is set to "true":**

- The drawer and the checks are corrected (step 5), and the staging cases print PASS for the frames in the acceptance list.
- CPU and read times are measured through the staging Worker, and the Workers plan's limit is known.

**Before production binds the bucket:**

- The lock rule is on and has been seen to refuse a write through a Worker binding. Without this and the next line, the Dr of Security rates the binding Security Critical.
- The Worker pins the loaded object's etag, and no branch can reach a key that writes the bucket.
- A signal exists for a null or thin layer.
- The page with streets has passed an accessibility check at 320 px.
- The licence NOTICE exists and the credit travels with the SVG.
- The owner has ruled on the dot over streets.
- An ADR records the one-bucket decision, the security records name the route and the secret, and the `MAP_TILES` entry leaves UNDECIDED in env-parity.
- The documents that say streets are "built" say what is true.

## Verification

After a load, in this order:

- `gh run list --workflow "Street-map archive load (stg)"` shows one successful load, and its check step ends in PASS.
- A staging run of the chain is green for T1 Deploy, T2 Contract (Bruno), T3 E2E Smoke (Playwright) and T4 Functional, and the street cases print test names, not NOT RUN.
- The staging pages for the acceptance frames are read through the Worker and the drawn road classes are counted.
- The cost line shows the street outcome counter moving.

Three checks the QA lens says each take under an hour and would settle most of the inferred rows: the loader in the workers pool against one real tile; the archive check against a real Manhattan cut; the flag set to "true" on a throwaway branch through T2 and T4 once.

## Risks accepted

None. The run accepted nothing on the owner's behalf. Proposed for the owner to accept or refuse:

- Wide frames show hexagons only, for good. The product owner lens calls that an acceptable permanent answer.
- The 9,000-point budget stays, with roads paid first.
- The landing's `/` stays without a rate limit until its own ticket.

## Human gate

The gap appeared in loop 2, Conservative layer (the water-only frame and the blind checks), and widened in loop 3 (the bucket and the chain). The run stops here. Only the owner can answer these:

1. Which Workers plan is the account on, and what CPU limit applies to one request?
2. The bucket `ose-map-tiles` was made by the deploy, not by you: do you keep it after checking it has no public URL and an acceptable jurisdiction, or delete it and make it by hand?
3. Where should the R2 write key live so that only `main` can reach it, and what can the repository-level `CLOUDFLARE_API_TOKEN_OSE` do?
4. Do you cut with `--maxzoom 14`, given that the Worker reads zoom 14 at most and the choice is fixed once the object is locked?
5. Do you want the small corrections first (steps 1 to 4) and then the load, or the load now with the staging chain red for a stated period?
6. Is a dot for a home-hosted event over legible streets wanted, when any area with one event can be opened by URL?
7. Does invariant 2 cover counts of events (the map shows 1 to 4 on dots and captions), or only counts of people?
8. Should wide frames draw streets at all, or show hexagons only below a zoom floor on the landing, as the area map already does?
9. Can the public reach the staging pages, which decides whether the licence notice is needed before the load or before production?

**What would move the score:** a corrected drawer with tests (R7), streets seen through the staging Worker (R1), and checks that fail on a wrong layer (R17) together remove 40 of the 182 points and most of the doubt behind the rest.
