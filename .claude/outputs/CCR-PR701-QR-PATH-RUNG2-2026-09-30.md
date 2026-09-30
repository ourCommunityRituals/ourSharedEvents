# CCR v3.0 — PR #701, QR Path to Done rung 2 (OSE-867 + OSE-869)

- **Target:** ourCommunityRituals/ourSharedEvents#701, branch `claude/funny-hypatia-27i7vp`
  (commits d2d2d7c, 800bdfd, plus the CCR fix commit)
- **Date:** 2026-09-30
- **Team lenses:** PO · BE · FD · Sr Design FE · Sr Automation QA · SRE/SDET · DevOps · Security
- **Scoring:** the repo protocol (`.claude/skills/ccr-protocol.md`). Start at 100;
  High −10, Medium −5, Low −2. Gate is ≥ 95. Findings are fixed between loops.

## Loop 1: Critical (what would break this?)

Each finding was reproduced by a test that failed before the fix.

| #   | Lens         | Finding                                                                                                                                                                                                                                                                                                                                                | Sev    | Evidence                                                                                        | Fix                                                                                                                             |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F1  | BE / SRE     | Folding sponsors into `poster-bundle` coupled their failure modes. `resolveSponsorsForEvent` throws on a D1 error and the handler had no catch, so a sponsor-query error returned **500 for the whole poster, QR codes included**. Before OSE-867 the strip was a separate, non-critical call. This is an availability regression on the revenue path. | High   | New test renames `sponsor_placement`. It was red on the pushed code (`expected 500 to be 200`). | try/catch around the sponsor lookup: log `DB_ERROR`, return `sponsors: []`, keep serving the codes.                             |
| F2  | PO / FD      | With the switch off, the **digital** poster also lost its tappable links. Its "codes" are links, not QR images, and the control is labelled "Print QR codes on this poster".                                                                                                                                                                           | Medium | New JSDOM test (digital + off). Red before the fix.                                             | The switch applies to `KIND === 'print'` only.                                                                                  |
| F3  | FD / Design  | Switching events in admin left the checkbox showing the **previous** event's value until the new load finished, and indefinitely if the load failed. A toggle at that moment writes to the new event based on the old event's state.                                                                                                                   | Medium | New JSDOM test (second event's load fails → switch must be disabled). Red before the fix.       | Disable the switch at load start; re-enable only after a good load.                                                             |
| F4  | PO / DevOps  | The PR body said `Closes OSE-867/869`, so Linear marks both Done at merge. The root CLAUDE.md §5 DONE gate needs all 7 pyramid levels. Levels 6 (API against live staging) and 7 (E2E) only run after merge (T1–T4 are skipped on PRs).                                                                                                                | Medium | CI run on 800bdfd: T1–T4 `skipped`.                                                             | Body changed to `Part of`. The close-guard allows this because branch and title carry no id.                                    |
| F5  | Security/SRE | `poster-bundle` is a public read that is **not** wrapped in `publicReadLimited` (the same is true of `sponsor-bundle`). It now also does the sponsor resolve (`bypassCache`). Per page load the work is unchanged, but per request it is heavier.                                                                                                      | Low    | `router.ts` ~1312: bare `handleGetPosterBundle`.                                                | Deferred to a follow-up story (below). Rate-limiting printed posters is a product-visible change.                               |
| F6  | BE           | The settings PUT did a read-modify-write, so two concurrent toggles could overwrite each other.                                                                                                                                                                                                                                                        | Low    | Code read.                                                                                      | The merge now happens in SQL: `json_patch(COALESCE(settings_json,'{}'), ?)`. It is one statement, and the extra SELECT is gone. |

**Checked and cleared** (verified in code, no finding):

- **No early exposure.** The bundle's `event` is not wider than the public API. The poster renders only `active` events (`domain/event-state.ts:72`), the same rule as `GET /events/:id`. It reuses `toPublicEvent`, so OSE-1245's future narrowing applies automatically.
- **No fake sponsors on paper.** `getSponsors` falls back to fixtures only in mock mode or with no DB binding, not on a query error.
- **Settings stay private.** They never enter the public projection (tested).
- **Tenant isolation unchanged.** The bundle is id-keyed like `GET /events/:id`, and sponsors are brand-fenced by the resolver.
- **No external consumers of `eventName`.** I checked all 11 in-scope repos; the only consumers were tests in this repo.
- **Migration ordering.** If the Worker ships before 0082 is applied, the schema guard fails closed (503). CI applies migrations before deploy.

**Loop 1 score:** 100 − 10 − 5 − 5 − 5 − 2 − 2 = **71**, below the gate. Stopped and fixed F1, F2, F3, F4 and F6.
**Re-score after fixes:** 100 − 2 (F5, deferred and named) = **98**.

## Loop 2: Conservative (smallest version that ships; worst case if Loop 1 missed something)

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                   | Decision                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| C1  | Two tickets in one PR. The project plan pairs them ("same surface, one session"), and they touch the same `loadPosterBundle` seam.                                                                                                                                                                                                                                                                     | keep                                 |
| C2  | `eventName` removal is a breaking field change. It was kept out of a deprecation window because no consumer exists (see Loop 1).                                                                                                                                                                                                                                                                       | keep                                 |
| C3  | A per-event settings column (migration 0082) instead of waiting for all of OSE-851. PO chose this; one key; additive. Worst case (a wrong home) costs a data copy later, and there is one reader module to change.                                                                                                                                                                                     | keep                                 |
| C4  | `mergeEventSettings` became dead after F6.                                                                                                                                                                                                                                                                                                                                                             | **cut** (removed with its unit test) |
| C5  | Rate-limiting `poster-bundle` (F5).                                                                                                                                                                                                                                                                                                                                                                    | defer to its own story               |
| C6  | **New:** the unscoped `/poster` picker has no request sequence token. Switching events A→B quickly can paint A's late bundle (codes, sponsors) onto B's card. This existed before the PR (the old `loadPosterQR`/`loadPosterSponsors` had the same race). It is the same class as OSE-1428 on admin. It is not introduced here, and the scoped (`?event=`) path used from the dashboard is unaffected. | defer, Low (−2)                      |

**Loop 2 score:** 98 − 2 (C6, new Low) = **96**. F4 was fixed during this loop.

The score dropped 98 → 96. This is not decay of an earlier conclusion. It is a newly found, pre-existing Low that is named and bounded. Stated here so it isn't hidden.

## Loop 3: Recursive (what does this imply we should also do?)

Loop 3 confirms the fixes against their verification criteria:

- F1, F2 and F3 each have a test that failed before the fix and passes after.
- Full worker suite (workers + node): **308 files / 4,308 tests pass**.
- 0-architecture shard: **172/172**. Tenant exemption re-keyed `events.ts:336→337` (the import is now one line).
- `poster-print.spec.ts`: **41/41** on chromium. `tsc` clean. Design check OK. Testid registry OK.

**Loop 3 score:** **96**, holding.

### Follow-on items

| #   | Item                                                                                                                                                                                                                                          | Tag          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| R1  | After merge, run pyramid levels 6–7 (Bruno `2. Public Events API` against staging, poster E2E). Then close OSE-867 and OSE-869 by hand with the CI/CD evidence.                                                                               | required     |
| R2  | After merge, update root `CLAUDE.md` §3: BE (REQUIRED_DB_MIGRATION 82; `poster-bundle` carries event, sponsors and settings), FD (scoped poster = one call), QA (new specs). Also update `STORIES.md` and `docs/projects/qr-path-to-done.md`. | required     |
| R3  | Comment on OSE-851: `lib/event-settings.ts` and `events.settings_json` exist. Its other toggles and the `default_sections` fallback must extend that module.                                                                                  | required     |
| R4  | Story: wrap `poster-bundle` and `sponsor-bundle` in `publicReadLimited` (F5).                                                                                                                                                                 | recommended  |
| R5  | Story: sequence token for `/poster` picker loads (C6). Sibling of OSE-1428.                                                                                                                                                                   | recommended  |
| R6  | PO confirms F2 (the switch hides **printed** QR codes only; the digital poster keeps its links) and the testid naming (`poster-qr-section`, not the ticket's `poster-qr-grid`).                                                               | recommended  |
| R7  | Drift: root `CLAUDE.md` §5 ("all 7 levels or not DONE") and worker `CLAUDE.md` ("Done = merged + a named CI job") define Done differently. That difference is how F4 arose. File a reconciliation ticket.                                     | recommended  |
| R8  | OSM mirrors OSE routes in Postman/Newman docs; `poster-bundle` has no entry there.                                                                                                                                                            | nice-to-have |

## Synthesis

- **Verdict: PASS (96).** The score reached 96 in Loop 2 and held in Loop 3, above the 95 gate. Every High and Medium finding was fixed and has a test that failed first. Two Lows remain, named and deferred.
- **Top concerns:** F1 (sponsor failure took down the whole poster), F3 (stale admin switch), F4 (premature DONE).
- **Top follow-ons:** R1 (staging pyramid, then close the tickets), R4 (rate limit), R5 (picker race).
- **Holds:** none.
