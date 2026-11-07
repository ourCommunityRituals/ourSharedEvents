# Staging full site (layer 1): build rulings

Decisions the build controller made on the owner's behalf while executing `2026-11-04-staging-full-environment.md`, in order, with what each costs if wrong. Ruling 3 is the owner's own decision (2026-11-04). The rest are controller calls, open to the owner's correction.

- Ruling 1: Run Task 5 (Instagram art) before Task 4 (build). — Task 4 imports `pickArt` from Task 5. — If wrong: none; the tasks are otherwise independent.
- Ruling 2: Task 2 lists `STAGING_VARIANT` as an intentional staging-only difference in `scripts/ci/env-parity.mjs` (alongside its existing staging-only entries). The test's "ok unchanged" assertion is checked after that listing. — The spec requires env-parity to keep passing, and a staging-only var is intentional. — If wrong: the owner sees one more listed difference in the parity report.
- Ruling 3: (owner input 2026-11-04) quantity is one number, stock/targets.json perNode=12; build loads exactly perNode/node, checks read it + manifest, never literals; validator's count renamed acceptedPerNode to avoid the clash. — owner: dynamic data must not drift from test expectations — if wrong: 12 is easy to change in one file.
- Ruling 4: distinct placeholders (OWNER_TO_FILL_DB_STAGING_FULL / _FORMS_DB_ / _KV_) instead of weakening constraints.spec — keeps the uniqueness gate binding — if wrong: owner pastes ids anyway, placeholders vanish.
- Ruling 5: Oak Lawn zips = [60453] only (plan's 60456/60457 are Hometown/Hickory Hills) — correct geography — if wrong: one zip to add in nodes.json.
- Ruling 6: node membership = point-in-polygon on the stored (simplified) boundary; cells = overlapping res-7 cells (border cells may be in two nodes); Task 6 counts manifest-assigned events and sanity-checks the server cell is among the node's overlapping cells. Plan updated (commit after this line). — centre-cell lists of 1-3 cells per node would refuse most real addresses — if wrong: polygon sizes inflate nodes.json; simplify harder.
- Ruling 7: require explicit offset; window on America/Chicago date; export chicagoDate() for later tasks' today. — Chicago is the product's time zone — if wrong: a few edge events shift a day.
- Ruling 8: listPosts never throws — failures return gathered posts + fixed warning (status/name only) — spec: art never turns the run red — if wrong: an Instagram outage hides behind a warning, visible in the run summary.
- Ruling 9: tier wire map premium→title, mid→gold, local→bronze (exported SPONSOR_TIER_WIRE) — matches Worker VALID_TIERS — if wrong: one constant.
- Ruling 10: send start_time (Chicago HH:MM) + timezone America/Chicago — real events have times — if wrong: none.
- Ruling 11: short computed for all six nodeIds — a node with no finds must read as short — if wrong: none.
- Task 4: parked — chicagoDate would throw on an invalid starts_at if one were selected — Ruling: validator refuses invalid/offset-less starts_at as bad-shape, so selected rows are always valid; no change.
- Ruling 12: Task 6 also returns the R2 upload keys to delete per node (uploads would otherwise pile up daily) — Task 7 deletes them with wrangler r2 object delete --env staging-full — if wrong: bucket grows ~70 images/day.
- Ruling 13: qPath expectation = 302 to this site's /events/<eventId> (observed /q behaviour) — if wrong: one assertion.
- Ruling 14: promote Minors 1-3 to fix now — (1) public-read paths must stay on origin (secret-leak once Access headers added), (2) manifest name manifest-YYYY-MM-DD-<runId>.json with (date,runId) staleness so same-day reruns purge, (3) per-column exemptions — Task 7 builds on all three — if wrong: small extra work.
- Task 6: parked — event_series anchored on a stock event loses an owner confirm/reject — Ruling: acceptable on an owner-only test site; detector re-proposes.
- Ruling 15: manifests tracked by an R2 index object stock/manifest-index.json (wrangler has no reliable object list); index lists live manifest names; a name leaves the index only after its purge succeeded — if wrong: index drift, recoverable by hand.
- Ruling 16: scheduled runs gated on vars.STOCK_FULL_ENABLED == 'true' (no daily red until owner setup); workflow_dispatch always runs — if wrong: owner flips one variable.
- Ruling 17: manifest name gains run attempt; refuse if today's object exists; buildDay onRecord hook writes manifest after every record; promote minors 1,2,3,4,5,6,8,10 into round 1; same ref for all jobs (dispatch from a branch tests that branch on the test site) — if wrong: a branch dispatch deploys an unmerged Worker to the owner-only test site.
- Ruling 18: stale-manifest purge excludes ids today's manifest also records; Build step timeout-minutes 25 (step failure → job failure → check-swap runs); empty manifest written at build start; download continue-on-error — if wrong: an extra day of stale rows in a corner case.
- Ruling 19: accept implementer's deviation — no continue-on-error (down-only ratchet, OSE-1691); run-day step runs on download failure via if: — respects the ratchet without an admin merge — if wrong: none.
- Ruling 20: one fix wave covers Critical+Importants+Minors 5-13 (+ contract test pinning fake shapes to handler Response.json; notice position:relative; drop BigQuery from stg-full if it skips cleanly else checklist) — findings file final-fix-findings.md — if wrong: rework visible in one commit range.

## Open for the owner

- OWNER CHECK: CLOUDFLARE_API_TOKEN_OSE / CLOUDFLARE_ACCOUNT_ID may be staging-environment-scoped secrets (T1 uses environment: staging); stock workflow has no environment: — confirm or deploy fails.
- Confirm on the first live dispatch: Claude action Write() path specifiers, wrangler r2 delete on a missing key (now treated as success), the ignored-file gate against the action's own writes, and that a step timeout yields job result failure.

## Deferred minors (not blocking)

- Task 1: minor (deferred): unasserted SELF.fetch('/health') warm-up in test-site-notice.spec.ts:170; TV below-fold not asserted by smoke; staging smoke cases (/, /display) unrun until CI
- Task 2: minor (deferred): check-binding-placeholders regex blind to OWNER_TO_FILL; security-alert STAGING_VARIANT positional param threading
- Task 2: minor (deferred): cors-allowlist owned-domain test only reads 500 chars after first ALLOWED_ORIGINS, so STAGING_ONLY_ORIGINS entries may be unchecked (pre-existing)
- Task 3: minor (deferred): hole-handling test not born-red on its own injected fault; title slice may split surrogate pair
- Task 5: minor (deferred): listPosts.warning is function-level state (single-run script OK)
- Task 5: minor (deferred): redactUrl exported but unused
- Task 4: minor (deferred): implementation preceded tests (born-red by fault injection after)
- Task 6: minor (deferred): FORMS_DB rows on stock events not purged; shortlink_click_daily counters remain for purged codes
- Task 7: minor (deferred): CLAUDE_CODE_VERSION↔action SHA pairing unenforced (comment only); run-day.mjs size; r2 delete of missing key exit code unproven until live run; Write() path specifier unproven until live run.
- Task 7: minor (deferred): gate comment overclaims git-ignored coverage (no --ignored); build step/job timeout margin only 5 min; stale filter by bare id not kind|id; 'already exists' double-fault wording; row killed before onRecord unhinted

## Pivot (owner, 2026-11-05)

These supersede Rulings 3 and 16 and the search parts of Ruling 17 and of the Task 7 deferred minors.

- No nightly search, ever. The search ran once, on 2026-11-05; its rows are committed in `stock/seed/finds.json` and `businesses.json`, and `scripts/stock/make-seed.mjs` turned them into `stock/seed/seed.json` (US Census geocoder, cached in `stock/seed/geocode-cache.json`; this is the only network call, and it ran once).
- The full site is loaded from the committed seed only when the owner dispatches `stock-data-full.yml` by hand. The `schedule` trigger, the `STOCK_FULL_ENABLED` gate and the `search` and `validate` jobs (Claude action, spend cap, `ANTHROPIC_API_KEY`, checkout-integrity gate) are removed. The chain is access-gate → deploy → seed → build → check-swap.
- Populated zips: 60620 Auburn Gresham, 60406 Blue Island, 60805 Evergreen Park, 60453 Oak Lawn.
- 60655 Mount Greenwood is deliberately empty, so the under-10 experience can be shown by zip.
- Beverly is dropped from `stock/nodes.json`.
- Dates are re-based on every load: each event keeps its offset in days from 2026-11-05 and its Chicago local start time (and its duration when known). A load places it at load day + offset, at that wall-clock time in America/Chicago (DST-safe), so each place's count in the 90-day window never changes.
- Totals are tied to the tests: the expected count per node comes from the committed seed (`expectedByNode`), never a literal. `stock/targets.json` is removed. A test on the committed seed asserts every populated place reaches the map gate of 10 and Mount Greenwood holds 0.
- Controller call: a node expected to hold 0 passes when no stock event is assigned to it and none is listed in a res-7 cell that is its own alone. Mount Greenwood shares five of its six cells with Blue Island, Evergreen Park and Oak Lawn (border cells), and nine seed events (seven Evergreen Park, two Oak Lawn) sit in those shared cells, inside their own node's polygon. Counting them would fail every load. — If wrong: Mount Greenwood's cell list needs trimming, or the owner accepts that a cell-based view of Mount Greenwood shows those nine (still under 10).
- Controller call: the empty node's landing-map check is skipped and the run summary says so. The zip view still takes about 17 km around the zip center (`lib/zip-areas.ts`), so `/?zip=60655` shows its neighbors' events; narrowing it is a separate story.
- Controller call: the seed job writes `load.json` with the load day, and the build records that day, so a build that starts after Chicago midnight still matches the rows' dates.

## Pivot (owner, 2026-11-06)

These supersede every ruling that names stg-full, staging-full, the Access gate or the deploy job.

- One staging site: the seed loads into stg.oursharedevents.com. The populated zips and the empty 60655 show both experiences there. `[env.staging-full]`, the `stg-empty.` alias and `STAGING_VARIANT` are removed; nothing had been provisioned.
- Owner choice: load onto open stg. The Access gate job is removed; every staging page shows "Testing purposes only." and the not-an-endorsement line.
- The workflow is seed → build → check-swap, deploys and migrates nothing, targets `--env staging --remote` only, and uses the existing repo secrets `ADMIN_KEY`, `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
- The deploy job's hub-staging step is recorded as retired in `.ci-integrity-baseline.json` (`readUsesOnNewSecret.retired`).

## Permanent totals and the daily loop (owner, 2026-11-06)

- Permanent testing totals: Blue Island 10, Auburn Gresham 9 (8 from 2026-11-07, below), Evergreen Park 11, Oak Lawn 17, Mount Greenwood 0 (`stock/totals.json`, pinned by a test). `make-seed` trims to exactly these, keeping the widest mix of event types.
- Owner: "This should on a loop every day so that the data is always in a position to enable the automation testing across the entire CICD test pyramid." The stock workflow runs daily at 09:23 UTC and on dispatch, re-dating the same seed; no search.
- Controller call: Auburn Gresham's 9 is taken as written, under the map gate; its landing-map check is skipped, its count is checked. — If wrong: set it to 10 in `stock/totals.json` and re-run `make-seed`.

## Auburn Gresham reads 9 in its town search (owner, 2026-11-07)

- Owner: "Please remove one event from Auburn Gresham so the total is always 9." CI's permanent fixture `test-event-001` (Community Game Night, Beverly Arts Center, 2407 W 111th St, zip 60643) is in the owner's Auburn Gresham town list (60620, 60621, 60636, 60643, 60652), so the town search counted 9 stock events + 1. `stock/totals.json` now holds Auburn Gresham at 8: the town search reads 9, the zip 60620 reads 8, and Beverly's town search (60643, 60655, 60620) also reads 9. The trim dropped "Winter coat giveaway" (the later of two mutual-aid events), so no event type is lost.
- Search totals are checked, not assumed: `stock/totals.json` `searches` holds what each zip and town search must read on stg (stock + `fixtures.counts`, i.e. test-event-001 in Auburn Gresham and Beverly). `seed.test.js` derives every total from the seed's address zips and the town table; after each daily swap, `check-full.mjs` `checkSearches` reads each search's summary line on stg and a wrong count turns the run red. The fixture's place on stg comes from staging's place lookup (its SQL has no coordinates), so only the staging check can prove it.
