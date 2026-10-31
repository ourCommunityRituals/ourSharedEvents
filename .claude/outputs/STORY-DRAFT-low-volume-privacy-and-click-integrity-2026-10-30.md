# DRAFT (not created in Linear): low-volume privacy and click integrity on the scan signal

Drafted 2026-10-30 from the owner's questions and the sweep of 2026-10-28 to 2026-10-30 (code, git history, GitHub, Linear, threat ledger). Filed 2026-10-30 and 2026-10-31 as epic OSE-1766 with slices 1 to 13 (OSE-1767 to OSE-1779). Extended-team CCR loop 1 ran 2026-10-31 and stopped at the human gate (system score 0%, Security Critical unresolved): see `CCR-low-volume-privacy-epic-2026-10-31.md`. Treat the slice text below as superseded where the worksheet disagrees.

**Suggested shape:** one epic in the OSE team, thirteen slices (below; 11 to 13 added 2026-10-31), ranked by risk over effort. **Related tickets:** OSE-1496 (forged `ose_anon`), OSE-1656 and OSE-1652 (admin-read counts), OSE-945 (adaptive time buckets, deferred), OSE-1706 (distinct scanners), OSE-1460 (hour or 15 minutes), OSE-1493 (forms keyed id), OSE-1750 (area grain), OSE-1189, OSE-405 and OSE-1337 (red-team and differential re-id). **Routing:** security, PII and count-floor work is Opus at high effort, with a Dr of Security pass and a CCR before merge (CLAUDE.md, models and effort).

## Why

When an event has about five or fewer people an hour, small numbers do the damage: a count crossing the floor, a total that moves by one, or two tables that line up row for row can each point at one person. Separately, a sponsor or an event manager has a reason to inflate clicks, and the current limits slow a single caller but do not stop a determined one. The code already does the hard parts (hour buckets, keyed ids, the under-5 floor with drop-before-sum, rounding on exports). This epic closes the gaps the sweep found, and no more.

## What exists today (read 2026-10-30)

| Finding | Evidence (method) |
|---|---|
| Stored scan times are hour-only on both split tables | `hourStamp` in `lib/scan-buffer.ts:91-93`; migrations 0100 and 0101; `scan-split-hour-precision.spec.ts` (read) |
| Both split tables are ordinary SQLite tables, so rows keep an insertion order | `migrations/0062_split_scan_path.sql` has no `WITHOUT ROWID`; both rows are written in one batch (`buildScanStatements`, `scan-buffer.ts:101-137`). **Inferred, not tested** that order links a placement row to a return row within an hour |
| The live view polls every 30 s and counts include the open hour | `LIVE_REFRESH_SECONDS = 30` in `handlers/live-monitor.ts:31`; `scan-cells.ts` has no open-hour exclusion (agent read, `live-monitor.ts` header re-read) |
| Memo rules R1 to R4 (single rung, finalized-only exposure) were never ratified or built | `SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md`; no test or ADR cites them (ledger agent, grep) |
| `/s` taps have no dedup, and counting stops only at 360 a minute per caller | `shortlink-resolve.ts:116-118`; `PUBLIC_READ_MAX = 360` in `lib/public-read-limit.ts:53` |
| `/q` dedups per cookie, so a request without one counts as a new person; `/q` does not apply the link-preview robot rule | `qr-scan.ts:174-187`; `share-count.ts` used by `/s` and event codes only (2026-10-28 report, verified by the lead) |
| The floor is crossable by one person tapping five times | follows from the two rows above (inferred) |
| Impression and click beacons need a signed 10-minute token, dedup per caller (impressions 1 h, clicks 5 min), a bot filter and 20 a minute | `lib/beacon-token.ts:65`, `lib/invalid-traffic.ts:75-91` (read) |
| Those controls are per caller, fail open when KV is down, and the token is minted from a public bundle | `invalid-traffic.ts:45-52`; `beacon-token.ts:14-27` (read) |
| Placement, deployment and short-link writes write no audit row, and a changed `/s` target is not recorded | 2026-10-28 report, appendix A section 1 and 3 (agent read) |
| The public poster-bundle GET has no rate limit and mints short-link rows | `router.ts:1819-1823`, `poster-bundle.ts:283` (verified by the lead) |
| The WAF flood rule covers only `/api/v2/events*` | `cf-waf-rate-limit.mjs:37` (verified by the lead) |
| `/s` has no staging test; `/q` has one happy-path probe; T4g accepts a 403 and checks nothing | `flow-shortlink-resolver.spec.ts` named by no workflow; `launch-story-smoke.spec.ts:250-265` (verified by the lead) |
| No timing jitter or delay exists anywhere, and none was ever built | `git log -S` for jitter and 30-second values; the doc claim was corrected in `b3045e04` |
| The scan key `snk1_` is the same for one browser at every event and is kept up to 365 days; the forms key `evk1_` is per event and cannot be joined to it | `lib/scan-node-key.ts` header (read 2026-10-31). Readers: distinct count, `materializeAnonIdReturns` (return to another event), erasure by browser |
| The scan tables carried a second-precision `created_at` from 2026-08-20 to 2026-10-11 (52 days); the writer set `datetime('now')` itself, not only the schema default | migration 0062 (#364); `scan-buffer.ts` at `565fb780`; fixed by 0100 and `hourStamp` (#946) |
| The time-bucketing memo (2026-08-24, #378) already named the `created_at` problem (section 4) and left it as open decision 3 until #946 | `docs/security/SCAN_TIME_BUCKETING_DISCLOSURE_MODEL.md` (read). Its rules R1 to R4 are unratified and unbuilt |
| The org D1 standard contradicts itself: rule 4 says `datetime('now')` on every `created_at`, rule 6 says bucketed timestamps for anonymous data; CHOICE-INVARIANTS A-8 calls it known drift | `OCR-docs/docs/standards/OCR_STANDARD_d1Migration.md`, `OCR-docs/docs/CHOICE-INVARIANTS.md` (read). A-8 also still says the raw row keeps its exact time, which 0100 made false for scans |
| The OW opt-in bridge (named identity by consent, B-1 to B-7) is not built; OW `src/` references no OSE anonymous id | owner confirmation 2026-10-31; grep of `ourWKRP/src` (ts, js, md, sql) |

## Principles and constraints

1. **Never who, only how many** (AGENTS.md invariant 1). No slice stores a new per-visitor value. Every signal is read, used and dropped.
2. **The under-5 floor has no exceptions** (invariant 2), for a brand's own admin too. A slice may make withholding stricter, never looser.
3. **No cookies on public surfaces** (invariant 4). Slice 1 may not add one. Cookie signing (OSE-1496) stays in its own ticket.
4. **Counts stay honest.** A change that lowers a published count (dedup, robots) says so in the report note, as OSE-923 did for `total_scans`.
5. **Born red.** Each new test is watched failing on an injected fault, and each new structural spec is listed in the T0 `invariants` step.
6. **Changes to AGENTS.md, CLAUDE.md or the protocol need five CCR loops with a human gate after each.** Slice 9 only proposes text.

## Decisions needed first (owner)

| # | Decision | Blocks |
|---|---|---|
| D1 | Does a published tap count mean people or taps? (Lets us decide whether `/s` dedups per caller or the floor counts distinct callers.) | Slice 1 |
| D2 | Hide the open hour from the live view, or keep it live and round it? | Slice 3 |
| D3 | Raw poster and event coordinates: drop them (invariant 3) or amend the rule (hub invariant 4)? | Slice 9 |
| D4 | Exact `consent_given_at` and `created_at` on the forms side: truncate, drop, or keep with a written reason and retention? | Slice 9 |
| D5 | Add seeded noise to small published cells? (It would end the promise that a number at 5 or more is exact.) Recommended: no. | none, parked |
| D6 | Scan key across events: per-event key like forms (recommended; makes B-3 and B-5 structural; ends the cross-event returns count and erasure by browser), shorten its life (rotate the pepper epoch or delete raw rows early), or keep it and word the public claim honestly. Named-by-consent tracking stays with OW, which has not built the bridge yet. | Slice 11 |

## Slices (ranked)

| # | Slice | Result | Size |
|---|---|---|---|
| 1 | **Count integrity on taps and scans.** Dedup `/s` taps per caller per hour (D1). A request with no cookie stops counting as a new person on `/q`. Apply the link-preview robot rule on `/q`. | One person cannot clear the floor by tapping; robots and cookie-less requests stop adding people | small |
| 2 | **Unlink insertion order.** First a spike: a born-red test that proves or disproves that row order links the two tables. If it does, move to a random-key `WITHOUT ROWID` table, or a periodic shuffled rewrite, with a migration. | No ordering channel between WHERE and WHO rows | medium |
| 3 | **Open-hour hold and sticky suppression (D2).** The live view and every organizer card read only sealed hours, or round the open hour. A withheld cell stays withheld until it passes 5 plus a margin, so the crossing itself reveals nothing. | The 30 s poll cannot difference a person in | medium |
| 4 | **Audit placement and short-link writes.** Audit rows for placement create, update and delete, and short-link mint. The row records the `/s` target. | A backroom change to a printed code leaves a trace | small |
| 5 | **Poster-bundle GET.** Rate-limit the public bundle and stop minting rows on a public GET. | The write-on-GET hole is closed | small |
| 6 | **Sponsor and organizer integrity.** Report an invalid-traffic share (bot, duplicate, flood) beside sponsor numbers. Flag a spike concentrated in a narrow window. Written down: what it cannot catch (rotating IPs, a real crowd paid to click). | A sponsor sees how clean its numbers are; a collusion pattern is visible | medium |
| 7 | **Staging proof.** Name `flow-shortlink-resolver` in a T3 or T4 step; make T4g send `X-OCR-CI` and stop accepting 403; add unknown-token, cookie and dedup checks; add a Bruno zero-checks floor. | The two-layer rule holds for `/q` and `/s` | small |
| 8 | **Adaptive grain for small cells (OSE-945).** When an hour holds under 5, merge into 6-hour or daily cells so the number can show. Needs its own CCR, since the memo scored about 89 percent. | Small events show something instead of nothing | large |
| 9 | **Doc and rule alignment.** After D3 and D4: a gate for exact timestamps on the forms side (the TL-023 test checks the bucket function, not the exports), a rule text for `CF-Connecting-IP` ("never stored, never used for location"), the coordinate rule. AGENTS.md text goes through the five-loop CCR. | Docs, rules and tests say the same thing | small |
| 10 | **Edge rule (owner action).** A WAF flood rule or managed challenge covering `/q`, `/s`, `/e` and `/forms`, with its production state recorded. | The edge backs up the in-Worker limits | config |
| 11 | **Per-event scan key (D6).** Replace `snk1_` with a per-event key (the `evk1_` pattern in `lib/event-anon-key.ts`); retire or freeze `anon_id_returns` and `materializeAnonIdReturns`; old rows stay unlinkable (no cookie to re-derive from); decide erasure and the returns wording. Spike first: list every reader of `scan_node_returns.anonymous_id` and what each metric loses. | No stable pseudonym survives across events; "anonymous forever" (B-3) no longer rests on nobody joining on the key | medium |
| 12 | **Time-precision structural spec.** A T0 `invariants` gate that reads every migration (`migrations/`, `migrations-forms/`) and the source SQL, and fails on a `datetime('now')` or `strftime` default or write into a timestamp column of a scan or identity table unless the table is on a short allowlist with a written reason. Born red: put the 0062 default and the explicit `datetime('now')` insert back and watch both fail. List it in the T0 `invariants` step. | The hour rule stops depending on whoever authors the next table | small |
| 13 | **Doc and standard alignment (OCR-docs, own PR there).** Rule 4 of `OCR_STANDARD_d1Migration.md` gets an exception for anonymous tables and rule 6 is stated as binding; `CHOICE-INVARIANTS.md` A-8 updated; OCR_VISION invariant #1 status line refreshed once its Phase 2 scope is checked; ratify memo rules R1 to R4 into the Story-0 ADR (R4 maps to slice 3 and D2, R3 to a sponsor-path floor check). Needs the five-loop CCR where it changes protocol text. | Org docs, the standard and the gates say the same thing | small |

Not recommended as a slice: **write-time jitter** (a random delay before a scan write). Stored times are already hourly, the delay would not touch edge logs, and production has no scan queue. Revisit only if slice 2's spike shows a timing channel the hour bucket does not cover. If so, add it through Queue `delaySeconds` as part of slice 2.

## Acceptance criteria (slices 1 and 2, the first buildable)

**Slice 1**
- [ ] Two `/s` taps from the same caller in the same hour add one click, and the count note says taps are deduped.
- [ ] A burst of requests to `/q/<token>` with no cookie counts once per caller per poster per hour, not once per request.
- [ ] A request with a link-preview User-Agent, or none, is not counted on `/q`, matching `/s`.
- [ ] Neither route sets a new cookie, stores a new per-visitor value, or returns 429 to a real visitor (the link still redirects).
- [ ] Counts shown before and after the change are explained in the report note.

**Slice 2**
- [ ] A test writes N scans in one hour and shows whether row order in `scan_placement_events` lines up with `scan_node_returns` (the spike). If it does not, the slice ends here with the test kept.
- [ ] If it does, after the change no ordering of either table reveals the other's order within an hour.
- [ ] Migration is idempotent and leaves existing rows unreadable as an ordered pair; counts are unchanged.
- [ ] The hot path stays within its current latency.

## Tests (born red: each watched failing on an injected fault)

- **Unit and worker layer:** per-slice specs for the cases above; dedup keys carry no identity; the robot rule on `/q`; row-order test for slice 2; sealed-hour read and sticky suppression for slice 3 (a cell going 4 to 5 to 4 reveals nothing at the crossing); audit row for every placement and short-link write; poster-bundle limit and no mint on GET.
- **Structural invariants:** one spec that fails if a placement or short-link write path has no audit call; one that fails if an exact timestamp reaches an export row. Both are listed in the T0 `invariants` step (`tests/integration/infra-consistency.test.js` enforces it).
- **Staging (Bruno and Playwright):** `/q` unknown token, cookie, dedup and robot cases; `/s` resolve, malformed, guessed and repeated-tap cases; live-view read of a sealed hour. A Bruno request with no `test()` names does not count.
- **Threat ledger:** each slice appends entries with a real `test_ref`, and the harness is extended so a `test_ref` must resolve to a test name (5 of 13 relevant refs are stale today).

## What this does not cover

Identity-bound abuse (a real crowd paid to click), a hostile organizer who owns the event, anything on the OurWKRP side, and the cookie-signing work in OSE-1496. The raw-coordinates and forms-timestamp questions are decisions (D3, D4), not code, until the owner rules.

## Pull request and Linear notes

Slice PRs use `Part of OSE-###`, with no id in the branch or title and no closing word near an id in the body or commit messages (`scripts/check-pr-linear-close.mjs`). Each slice gets a CI/CD testing ticket before it reaches Done. After merge: In Progress with an evidence comment, then `docs/brain/ROLE-STATE.md`; Done only when T1 to T4 are green for the merge SHA.
