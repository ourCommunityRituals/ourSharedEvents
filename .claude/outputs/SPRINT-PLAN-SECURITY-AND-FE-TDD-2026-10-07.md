# Sprint plan: security and front-end stories, test first

2026-10-07, `main@ce3c33f5`. Companion to `CCR-TEST-PLAN-SECURITY-AND-FE-2026-10-07.md`, which did not clear its CCR gate (25%). **The decisions this plan waited on were made the same day** (section 3). The four owner actions are still open. No Linear cycle was changed.

---

## 1. The shape

About 179 stories are open: about 123 security and 56 front end. Cycle 14 closed 72 issues in two weeks while its scope grew from 73 to 239. At that rate "all" is four sprints at best, and about 50 of the stories cannot start until a decision, a backend piece or an asset exists.

| Sprint | Linear cycle               | Dates           | Theme                                                          |
| ------ | -------------------------- | --------------- | -------------------------------------------------------------- |
| 15     | Cycle 15                   | Oct 8 to Oct 22 | Trust the gates, clear the anonymity veto, rehearse production |
| 16     | Cycle 16                   | Oct 22 to Nov 5 | Launch (Oct 24), then the tenant boundary                      |
| 17     | Cycle 17 (not yet created) | Nov 5 to Nov 19 | Token hardening, audit integrity, front-end slice 2            |
| 18     | Cycle 18 (not yet created) | Nov 19 to Dec 3 | Remaining High backlog and the unprioritised front end         |

**There is one full sprint before launch.** That fixes the order:

- **Anonymity moves ahead of the tenant boundary.** OSE-1493 carries a veto: no production scans or registrations until it closes. Launch day takes both. The test plan had these the other way round; the date reverses them.
- **The tenant boundary moves after launch**, on one condition: launch with the founder as the only admin. OSE-1456 already forbids any client admin until that work is done, and it does not fit in Sprint 15.

The PO confirmed that condition on 2026-10-07: the founder is the only admin on launch day.

**Lanes.** A: security, backend, CI. B: `admin.html`, public pages, phone audit. A piece is claimed on its ticket before it starts.

---

## 2. How every item is built

1. **Write the failing test first, and watch it fail** for the stated reason. A test that errors is fixed until it fails properly.
2. **Write the least code that passes it.** Then run the whole suite, not only the new file.
3. **Tests for behaviour that already exists** (the front-end backfill) are seen red by reverting that behaviour, then restored.
4. **Each case lives at two layers:** the workers pool and staging (Bruno or browser).
5. **Browser cases run on one device.** After launch, the layout contracts also run on five isolated profiles: desktop, tablet, Android, new iPhone, old iPhone (PO, 2026-10-07). Until then the audit stays as it is: nothing is added before 2026-10-24.
6. **Done** is T1 to T4 green on a commit that contains it. For a security story, T5 has also run on it.

**Not test-first, and needing your say-so:** dashboard settings, secret rotation and written decisions have no production code. Each gets a proof check instead, named in the tables.

Existing code to build on, so nothing is invented twice:

| Need                            | Already in the repo                                                               |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Many brands, every route        | `tests/helpers/brand-matrix*.ts` (brands and routes; no roles yet)                |
| A test written before its story | `tests/helpers/red-story.ts` and `docs/ops/TDD-RED-MAP.md`                        |
| Workflow rules as tests         | `tests/integration/workflow-token-hardening.test.js`, `infra-consistency.test.js` |
| Count limiting                  | `publicCountLimited` and `tests/scan-count-limit.spec.ts`                         |
| Publish rules                   | `lib/core-values.ts` and `tests/core-values-refused-log.spec.ts`                  |
| Lifecycle pages on a phone      | `tests/playwright/helpers/lifecycle-seed.ts` and the phone audit's spec list      |
| Staging contracts               | `bruno/ose-api`, folders 12 and 13                                                |

---

## 3. Sprint 15 (Oct 8 to Oct 22)

### Decided on 2026-10-07 (PO)

| Question                   | Decision                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin on launch day        | Founder only. The tenant-boundary chain follows launch                                                                                             |
| Merge freeze               | Tuesday 2026-10-20                                                                                                                                 |
| OSE-1493 (D6)              | Replace the raw anonymous id in the forms database with a per-event keyed id. Not removed, so check-in can still spot a repeat tap                 |
| OSE-1496, past the limit   | Keep "send on, uncounted". No 429 on poster links                                                                                                  |
| OSE-1496, the 4-scan probe | Accepted for launch and recorded in the threat model (OSE-1486). Designed after launch                                                             |
| OSE-1643 question 4        | A live event's page opens by link while off the map                                                                                                |
| OSE-292                    | Accept one short scroll to the first action. The two switched-off fold checks are retired and replaced by a "within one screen of scrolling" check |
| OSE-1620                   | All eight toast assumptions accepted                                                                                                               |

### Still owner actions, before the freeze

| Action                                                                       | Ticket   | Proof                                                                       |
| ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Rotate the exposed credentials                                               | OSE-1467 | Old values refused on staging                                               |
| Delete the pre-fix CI artifacts (229 left on 2026-10-07; last expiry Oct 22) | OSE-1470 | None listed before 2026-10-02 16:38 UTC in the six families                 |
| Create the production Access app; issue a production-only service token      | OSE-1353 | Three `curl -I` calls return 302 to the production login path; canary green |
| Two-factor on owner accounts                                                 | OSE-1478 | Dated record per account                                                    |
| Lanes: confirm A and B                                                       | n/a      | Written on the tickets                                                      |

### Lane A

| #   | Story                          | First failing test                                                                                                                                                                        | Fails today because                                               |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A1  | OSE-1369                       | Integration: the wrangler version in `workers/oursharedevents/package.json` is exact                                                                                                      | It is `^4.145.0`, a range                                         |
| A2  | OSE-1506                       | Integration: `red-team-adversarial.yml` has a schedule and a job a scheduled run can reach                                                                                                | Its only trigger is `workflow_run`                                |
| A3  | OSE-1227                       | Integration: some workflow step runs the pool-manifest check                                                                                                                              | Nothing runs it; the manifest is 131 specs behind                 |
| A4  | OSE-1493                       | Workers pool: register and scan with one cookie; no forms value equals any `scan_node_returns` value                                                                                      | The raw id is written to both (per the ticket; not yet run by me) |
| A5  | OSE-1496                       | None before launch: the probe is an accepted risk (decided above). Write it into the threat model, OSE-1486                                                                               | n/a                                                               |
| A6  | Rate-limit bar                 | Already red on staging for 4 nights: first refusal at 6.5 s and 9.0 s, bar 3 s. First add a workers-pool case with an edge-limiter stub to find whether code or staging config is wrong   | Unknown; this is a diagnosis                                      |
| A7  | OSE-1568                       | Tighten the verify-qr guard to assert the refusal code on an archived event                                                                                                               | Seen red by deleting the rule at that door                        |
| A8  | Production rehearsal           | Production smoke: `/health` names a commit and has no `_debug`; admin is redirected by the production Access app; the internal header, a bearer key and the staging token are all refused | Red on production now: old build, no Access app                   |
| A9  | OSE-1494, 1495, 1492           | Workers pool: capture every log line of one request; none holds the anonymous id, the email hash or a signed link                                                                         | In Progress; state not checked                                    |
| A10 | Status outside the four states | Workers pool: a write of `status = 'published'` is refused                                                                                                                                | No constraint exists; one staging row has it                      |

**Must** before launch: A4, A8. **Should:** A1, A2, A6, A9. **Could:** A3, A5, A7, A10.

### Lane B

| #   | Story                                        | First failing test                                                                                            | Seen red by                                                                |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| B1  | OSE-1578, 1568                               | None to write: confirm the staging chain, then close                                                          | n/a                                                                        |
| B2  | OSE-1601, 1591, 1592, 1593, 1595, 1597, 1598 | Per finished story: one security case, one contract case, one Bruno case, one phone journey                   | Reverting the behaviour each covers                                        |
| B3  | OSE-1564 then OSE-1644                       | The parked `redStory` in `tdd-red-fe-wave.spec.ts`: the map heads-up is a toast with a Turn off action        | Red today by design; released by the OSE-1620 decision                     |
| B4  | OSE-1643 question 4                          | Workers pool and Bruno: a live off-map event's page and short link answer with the page                       | Reported 404 on staging; released by the decision                          |
| B5  | OSE-292                                      | Phone audit: the first action is within one screen of scrolling, with the longest date line seeded on purpose | The check does not exist; the two fold checks it replaces are switched off |
| B6  | OSE-1636                                     | Read what was built before writing anything                                                                   | n/a                                                                        |

**Exit for Sprint 15:** the anonymity veto is lifted with a red-first cross-database test on `main`; production is redeployed and its smoke is green; T5 runs nightly; the phone leg is green without a switched-off check hiding a known gap, or the gap is accepted in writing.

---

## 4. Sprint 16 (Oct 22 to Nov 5)

**Oct 22 to Oct 24: launch.** No merges except fixes. The launch checklist (OSE-1491) is run from the production smoke, the canary and the monitors, not from memory.

**Then the tenant boundary, in this order.** Each step's tests are the next step's safety net.

| #   | Story               | First failing test                                                                                        | Fails today because                              |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A11 | OSE-1446            | Workers pool: every `/api/v2/admin/**` route in the router appears in the committed matrix                | No matrix file exists. Needs the team's decision |
| A12 | OSE-1554, role axis | The brand matrix self-check finds four roles in each brand                                                | The fixture has brands and no roles              |
| A13 | OSE-841             | Unit: 4 roles × 13 capabilities, 52 assertions; unknown role resolves to `staff`; no rows means no rights | The module does not exist                        |
| A14 | OSE-850             | `organizer` in brand A sets a per-event flag override on an A event → 403                                 | Today 200: admin plus brand scope only           |
| A15 | OSE-845             | `staff` in A sends `PUT` on an A event → 403; verify-qr the same                                          | No capability gate                               |
| A16 | OSE-849             | Five handlers × four roles × own and foreign brand                                                        | Not started                                      |
| A17 | OSE-1561            | Organizer A reads organizer B's registrations in the platform brand → 404                                 | No owner predicate. Needs the two PO answers     |
| A18 | OSE-857             | One generated test per route × role, built from the matrix                                                | Not started                                      |
| A19 | OSE-1447            | Bruno on staging: an email actor gets the same 404 body as an unknown route                               | No such request; staging has one identity        |
| A20 | OSE-1456            | The gate itself: signed off from A11 to A19                                                               | Follows                                          |

**Staging needs a second identity** for A19 and for any Bruno case in A14 to A17. That is an owner step (a second Access identity and membership rows on staging), listed here so it is not found late.

**Lane B:** OSE-1557 tablet layout once decided (first test: content width at 820 px against the chosen option); OSE-1599; toast adoption across surfaces; OSE-1642, 1646, 1630, 1641 as each decision lands.

**Exit:** a client organizer can be given `/admin`, with the per-role Bruno run on staging showing every test name.

---

## 5. Sprint 17 (Nov 5 to Nov 19)

| Group                                             | Stories                                                        | First failing test                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens never viewable                             | OSE-1475                                                       | Workers pool: no response body, header or log line of any route contains a credential pattern                                                     |
|                                                   | OSE-1471, 1472, 1473, 1474, 1476                               | Mostly dashboard settings: a drift canary per setting, which is red until the setting is made                                                     |
| Audit integrity                                   | OSE-1448, 1449, 1450, 1445                                     | Every admin request writes an audit row, grants and refusals; an update or delete of an audit row is refused                                      |
| Erasure                                           | OSE-1458, OSE-1133                                             | An erase that fails halfway resumes and never reports success with errors; a second approver is required                                          |
| Probes                                            | OSE-403, 404, 405, 926                                         | T5: two report snapshots a week apart cannot be differenced to one person                                                                         |
| Front-end slice 2                                 | OSE-1640, 1639, 1645, 1525, 1556                               | Each starts only when its backend story is on `main`; first test is the contract the page reads                                                   |
| Five device profiles (post-launch, PO 2026-10-07) | Android, new iPhone, old iPhone legs beside desktop and tablet | Unit: the table names five devices and each maps to a real Playwright descriptor. Full steps in `2026-10-07-device-matrix-implementation-plan.md` |

---

## 6. Sprint 18 (Nov 19 to Dec 3)

- **Security, High:** CSP without inline styles (OSE-1391, OSE-638), CSRF on admin writes (OSE-1500), the registration self-delete oracle (OSE-1497), dead PII tables (OSE-1124), the three "false green" stories (OSE-1125, 1126, 1430), the go-live evidence stories (OSE-1425, 1426).
- **Security, written work:** threat model, incident response, backups, alerting, organization and DNS hardening (OSE-1479 to 1487). Documents have no failing test; each ends in one drill or one check that is run.
- **Front end, no priority set (18):** street map, landing, poster drag and drop, the check-in colour mismatch. Needs a priority before it needs a test.

---

## 7. Not placed in any sprint

| Item                                | Why                                                               |
| ----------------------------------- | ----------------------------------------------------------------- |
| OSE-1633 fundraiser art             | No artwork exists                                                 |
| OSE-1628 printed poster             | Needs a person and a printer                                      |
| OSE-1638 Access page text           | Dashboard, owner                                                  |
| OSE-568                             | Confidential; not read                                            |
| OSE-1488 agent and tool credentials | Not read                                                          |
| OSE-1466 items 0.3 and 0.9          | Other repos                                                       |
| OSE-1466 item 0.10                  | An edit to root `CLAUDE.md`, which needs its own five-loop review |
| OSE-1551, 1532, 1524                | Not specified to build depth, or waiting on a security answer     |

---

## 8. Risks to this plan

- **The owner actions carry the sprint.** The decisions are made; rotation and the production Access app are not. If they slip a week, A8 slips with them and production is unrehearsed at the freeze.
- **Sprint 15 is full.** Three musts in Lane A plus a production redeploy is the realistic limit. The shoulds may roll.
- **Unread stories.** About 95 lower-priority security stories and 18 front-end stories are placed by title or theme. Their size is a guess.
- **The estimate is rough.** 72 closed per cycle includes small tickets. Security stories with several test tiers are larger.
- **Staging is not production.** Production has no events and an old build, so nothing here is proven there until A8.
