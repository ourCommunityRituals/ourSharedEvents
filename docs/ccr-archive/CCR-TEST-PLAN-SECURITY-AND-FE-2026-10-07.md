# Test plan and order of work: security and front-end stories

CCR planning session, extended scrum team. 2026-10-07, `main@ce3c33f5`.

**Status: draft. Not cleared.** Loop 1 scored 37.5%, Loop 2 scored 25%. The protocol stops a run whose score falls between loops, so Loop 3 was not run. The score says how much of this plan rests on things nobody has verified or decided yet. It is not a verdict on the order below. What would raise it is listed at the end.

Readings in this document were taken on 2026-10-07 from GitHub Actions, Linear, the staging database and production, unless a line says otherwise. The front-end story list was supplied by the PO from another session and was not re-read ticket by ticket.

---

## 1. The order

Launch day is 2026-10-24, 17 days out. What must be on production by then has not been decided, so this is an order by dependency, not a schedule.

| Step | What                                       | Who             | Why it sits here                                                                       |
| ---- | ------------------------------------------ | --------------- | -------------------------------------------------------------------------------------- |
| 0    | Repair the tests that are red or blind     | Lane A          | Every later result is read off these gates                                             |
| 1    | One sitting of decisions and owner actions | PO              | Nothing here needs code, and it unblocks steps 2 to 6                                  |
| 2    | Production rehearsal                       | PO, then Lane A | Production runs an old build; no production test means anything until it is redeployed |
| 3    | Tenant boundary                            | Lane A          | It is the gate for letting any client into `/admin`                                    |
| 4    | Anonymity                                  | Lane A          | Two stories carry an anonymity veto on production scans                                |
| 5    | Front-end test backfill                    | Lane B          | Independent of everything above, so it runs alongside from day one                     |
| 6    | Front-end builds released by step 1        | Lane B          | Each waits on one named decision                                                       |
| 7    | Token hardening and the remaining backlog  | Both            | Mostly dashboard settings and post-launch depth                                        |

**Lanes.** Two sessions worked the same queue this week and opened overlapping pull requests twice. Lane A is security, backend and CI. Lane B is `admin.html`, the public pages and the phone audit. A piece is claimed on its Linear ticket before it is started.

**The rule behind the order.** Fix the measuring first, unblock in parallel, then build in dependency order. Steps 1 and 5 start on day one because neither waits on anything.

**Changed by the sprint plan.** Laid against the calendar, steps 3 and 4 swap: there is one full sprint before launch, OSE-1493 carries a veto on production scans, and the tenant work can follow launch if the founder is the only admin on the day. See `SPRINT-PLAN-SECURITY-AND-FE-TDD-2026-10-07.md`.

---

## 2. Step 0: the test system today

A plan that leans on a gate has to know the gate works. Five do not.

| Gate                         | Last 8 runs                                | What is wrong                                                    |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Nightly live rate-limit test | 4 of 4 failed                              | A flood is refused after 6.5 s and 9.0 s. The PO bar is 3 s      |
| Access canary                | 8 of 8 failed                              | Routing job red for staging (OSE-1510) and production (OSE-1353) |
| Branch protection drift      | 6 of 8 failed                              | Reported by the other session: its read token is not set         |
| Conformance report           | 8 of 8 failed, 100 of 100 since 2026-09-28 | The token cannot push to this repo (OSE-1141)                    |
| Test-pool manifest check     | Never runs                                 | Not wired into CI; the manifest is 131 specs behind (OSE-1227)   |

Three more weaknesses, found this week:

- **The adversarial tier can be skipped for the change that needs it.** T5 runs only after a green push to `main`: 17 of the last 100 triggers ran. The scan-limit change's own run failed at T1 on a Cloudflare API error, so T5 never ran on that commit.
- **Done does not include T5.** The Done bar is T1 to T4. A security story can be Done with no adversarial run.
- **Two tests failed by the clock in 24 hours.** One at midnight UTC (fixed in #851). One on a Wednesday, when a longer date line moved a button 3 px; that check was switched off, not fixed.

**Step 0 tests**

| Test                                                                                           | Tier                      | Seen red by                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Rate-limit bar: first refusal within 3 s on staging                                            | Nightly, staging          | It is red now; find whether the limiter or the bar is wrong |
| T5 runs nightly on `main` regardless of the last push (OSE-1506)                               | Schedule                  | Break one red-team assertion on a branch                    |
| Triage manifest check in the T0 lint shard                                                     | PR                        | Add a spec without regenerating                             |
| Clock rule: any test that seeds "today" runs at 00:30 and 23:30 UTC and on the longest weekday | Workers pool, phone audit | The two failures above, replayed with a fixed clock         |
| The weak verify-qr guard asserts the refusal code (OSE-1568)                                   | Workers pool              | Delete the rule at that door                                |

**Exit:** all five gates green or deliberately retired with a note, and T5 has run on the current `main`.

---

## 3. Step 1: decisions and owner actions, each with its proof

None of these is code. Each has a check that shows it happened.

| Item                                                       | Unblocks                                  | Proof                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Rotate the exposed credentials (OSE-1467)                  | Step 2                                    | Old values are refused: a staging request with the old admin key and old service token gets 401 or 403 |
| Delete 262 pre-fix artifacts (OSE-1470)                    | The last open part of that story          | Artifact listing shows none before 2026-10-02 16:38 UTC in the six families                            |
| Create the production Access app (OSE-1353)                | Steps 2 and 3                             | Three `curl -I` calls return 302 to the production login path; canary green                            |
| Two-factor on owner accounts (OSE-1478)                    | Launch checklist                          | Screenshot or export per account, dated                                                                |
| Role matrix (OSE-1446)                                     | OSE-841, 850, 845, 849                    | A committed YAML and a coverage test that fails on an unmapped admin route                             |
| Organizer questions (OSE-1561)                             | Step 3                                    | Recorded on the ticket                                                                                 |
| Anonymous id in the forms database (OSE-1493, D6)          | Step 4                                    | Recorded on the ticket                                                                                 |
| Scan limit: refuse or send on; the 4-scan probe (OSE-1496) | Step 4                                    | Recorded on the ticket                                                                                 |
| Toast assumptions (OSE-1620)                               | OSE-1564, 1644, 1599                      | Recorded on the ticket                                                                                 |
| Off-map live event page (OSE-1643, question 4)             | One front-end build                       | Recorded on the ticket                                                                                 |
| Tablet layout (OSE-1557); action in view (OSE-292)         | Front-end builds; two switched-off checks | Recorded on the ticket                                                                                 |
| What must be on production by 2026-10-24                   | The whole schedule                        | Written down, with the last day to merge                                                               |

---

## 4. Step 2: production rehearsal

Production today: `/health` returns `version: "main"` and `_debug`; `/admin` answers 404 from the Worker with no Access redirect; the database is at 77 of 94 migrations with 0 events and one membership row.

| Test                                                                                       | Tier               | Pass means                                                                |
| ------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------- |
| Deploy runs the same-commit staging chain first                                            | Pipeline           | T1 to T4 green in the same run before production deploys                  |
| Migrations 78 to 94 apply                                                                  | Deploy step        | Count is 94; table set matches staging                                    |
| `/health` names its commit and has no `_debug`                                             | Production smoke   | Closes OSE-1512                                                           |
| Admin is behind the production Access app for GET, HEAD and POST                           | Canary, production | 302 to the production login path, never the staging one                   |
| Production refuses the internal header, a bearer key, the staging token and no credentials | New, production    | The live half of OSE-1466 item 0.7; needs a production-only service token |
| Founder signs in and sees the root brand                                                   | Manual, once       | Closes OSE-1415                                                           |
| Monitors point at production                                                               | Schedule           | `PRODUCTION_LIVE` set; a forced failure opens an urgent issue             |

**Not testable before the redeploy:** anything about production behaviour. Until then every production claim in Linear is a staging claim.

---

## 5. Step 3: tenant boundary

Order inside the step: OSE-1446 (decision) → OSE-841 (the capability module) → OSE-850, 845, 849 (routes) → OSE-1561 (owner boundary) → OSE-857 (red team across roles) → OSE-1456 (the launch gate).

**A blocker for the staging tier.** Staging holds one admin identity, `root` / `brand_owner`. No second brand admin and no second role exists there, so no role or cross-brand test can run on staging with real identities.

In the workers pool the brand fixture from OSE-1554 already exists (`tests/helpers/brand-matrix*.ts`: several brands, every brand-scoped route). It has no roles. The role axis has to be added before any capability test can be written.

| Story    | What to test                                                      | Tiers                        | Example case                                                                                              |
| -------- | ----------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| OSE-841  | The matrix itself                                                 | Unit                         | 4 roles × 13 capabilities = 52 assertions; an unknown role resolves to `staff`; zero rows means no rights |
| OSE-850  | Global flags are key-actor only; per-event override is owner only | Workers pool, Bruno, browser | `organizer` in brand A sets an override on an A event → 403; `brand_owner` on a B event → 404             |
| OSE-845  | Event writes are scoped and capability-gated                      | Workers pool, Bruno, browser | `staff` in A sends `PUT` on an A event → 403; any role on a B event → 404, never 403                      |
| OSE-849  | Poster, upload, export, erase and audit routes                    | Workers pool, Bruno          | Five handlers × four roles × own and foreign brand                                                        |
| OSE-1561 | Two organizers in the platform brand                              | Workers pool, Bruno, browser | Organizer A reads organizer B's registrations → 404; a row with no creator is unreachable                 |
| OSE-1447 | Platform data stays platform-only                                 | Bruno, browser               | An email actor gets the same 404 body as a route that does not exist                                      |
| OSE-857  | Every forbidden route, every role                                 | Generated from the matrix    | One test per route × role, built from the YAML so a new route cannot be missed                            |

**Born red:** each refusal test is run against the route before its guard exists. The matrix coverage test is run with one route removed from the YAML.

**Exit:** OSE-1456 can be signed, with the Bruno run on staging showing each test name printed.

---

## 6. Step 4: anonymity

| Story                | What to test                                               | Tiers                 | Example case                                                                                                      |
| -------------------- | ---------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| OSE-1496             | A caller cannot move a count across the floor              | Workers pool, staging | After the PO's rule: one address adds 4 new ids to a node holding 1 real scan; the published count stays withheld |
| OSE-1496             | The limit on the deployed Worker                           | Staging               | With the edge limiter bound, a burst is uncounted and `SCAN_NOT_COUNTED` appears in Workers Logs. Not yet seen    |
| OSE-1493             | No forms row can be joined to a scan row                   | Workers pool          | Register and scan with one cookie; no value in the forms database equals any value in `scan_node_returns`         |
| OSE-1494, 1495, 1492 | Logs carry no id, hash or signed link                      | Workers pool          | Capture every log line in a request; scan for the id, the hash and the token                                      |
| OSE-403, 404, 405    | Probes: tenant isolation, identity leak, re-identification | T5                    | Difference two report snapshots a week apart; no single person is recoverable                                     |
| OSE-926              | The anonymity seams                                        | Workers pool          | Count floor, spend-blind sponsors, placement isolation, each with a removal mutation                              |
| OSE-1421             | Four privacy defects                                       | Not read              | Title only; needs reading before a test is named                                                                  |

**Exit:** the two veto stories are closed with a red-first cross-database test, and the probes run in T5.

---

## 7. Steps 5 and 6: front end

**Step 5, test backfill for finished stories.** These were closed on a green staging chain while their test-level tickets stayed open.

| Ticket         | Surface         | Missing levels, as reported                          |
| -------------- | --------------- | ---------------------------------------------------- |
| OSE-1601       | Several         | Security, contract and Bruno; part went in with #850 |
| OSE-1591       | TV display      | Full pyramid                                         |
| OSE-1592, 1593 | Logs, Settings  | Full pyramid                                         |
| OSE-1595       | Create flow     | Full pyramid                                         |
| OSE-1597       | Poster layout   | Full pyramid, including a WebKit run                 |
| OSE-1598       | Organizer entry | Full pyramid                                         |

For each: one security case (escaping or an auth boundary), one contract case (the shape the page reads), one Bruno case on staging with its test name printed, and the browser journey on the phone leg. Each new test is seen red by reverting the behaviour it covers.

**Devices (PO, 2026-10-07).** Not every test runs on every device; that costs too much. The full suite runs on one project. Five device profiles are isolated, each as its own check, and each runs the layout contracts only: desktop, tablet, Android, new iPhone, old iPhone. Desktop and tablet legs exist today. The other three are a post-launch add (PO, same day): nothing is added to the audit before 2026-10-24. Their plan is `2026-10-07-device-matrix-implementation-plan.md`. Only the existing phone leg is required. These are emulations: an old Safari or a real Android browser needs a physical device. Two above-the-fold checks on the event page are switched off pending the PO answer on OSE-292.

**Step 6, builds released by a decision.**

| Decision            | Releases                                    | First test                                                        |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| OSE-1620            | Toast service, the two map toasts, OSE-1599 | The parked red test in `tdd-red-fe-wave.spec.ts`                  |
| OSE-1643 question 4 | The public page of a live off-map event     | Its codes and short link land on the page, not on "couldn't find" |
| OSE-1557            | Tablet layout                               | Content width at 820 px against the chosen option                 |
| OSE-292             | The two switched-off checks                 | Re-enabled against the longest date line                          |

**Not in this plan's reach:** the 13 stories blocked on backend or artwork, the 18 with no priority, and OSE-1636, which another session marked In Progress and nobody has checked.

---

## 8. Rules every test in this plan follows

1. **Seen red.** Every new test fails once, on an injected fault or the old code, before it counts.
2. **Two layers.** Every case exists in the workers pool and on staging (Bruno or browser). Browser cases run on one device; only the layout contracts run on all five.
3. **Named in a workflow.** A spec nothing runs is not coverage. The ratchet today: 97 orphan specs, 30 unconditional skips, 364 conditional skips, 22 `continue-on-error`.
4. **Read the log.** A green check is confirmed by its output, and a Bruno pass by its printed test names.
5. **No clock luck.** A test that seeds "today" is run at both ends of the UTC day.
6. **Done is T1 to T4 green.** For a security story this plan adds: T5 has run on a commit that contains it.

---

## 9. The session

| Role                | What they pressed on                                   | What came out                                                                                                                               |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Owner       | Is this the right order for 2026-10-24?                | Cannot be answered: the launch scope is undecided. Added to step 1                                                                          |
| Lead Backend        | Can the tenant work start?                             | No. The matrix is undecided, and OSE-841 must not invent it                                                                                 |
| Lead FE Integration | Do the front-end tests collide with the security work? | Only through shared files. Lanes written down                                                                                               |
| Sr Design FE        | Is "above the fold" still measured?                    | No, on two pages. Named as a decision, not a pass                                                                                           |
| Sr Automation QA    | Which existing tests can fail?                         | Found one guard that passes for the wrong reason, and a manifest check that never runs                                                      |
| Sr SDET/SRE         | Are the gates healthy?                                 | Five are red or blind. This became step 0                                                                                                   |
| DevOps              | Is the production path proven?                         | No production deploy in the last 100 pipeline runs                                                                                          |
| DevOps Manager      | What is the single point of delay?                     | The owner: ten Urgent stories wait on owner actions                                                                                         |
| Dr of Security      | Does Done mean attacked?                               | No. T5 is outside the Done bar and skipped the last security merge                                                                          |
| Sr Data Scientist   | Is the test data like production?                      | Staging has 183 events across 5 brands; production has 0. One staging event has the status `published`, which is not one of the four states |

---

## 10. Scoring worksheet

Classification: custom set (a plan, not a change), drawn from the protocol's QA items. Standard run, three loops intended. Environment modifier 1.0.

**Loop 1, surface pass.** Scope: the test system, the 27 Urgent security stories, the front-end list as supplied.

| Item                                        | Severity     | State      | Deduction | Evidence or gap                                                                                |
| ------------------------------------------- | ------------ | ---------- | --------- | ---------------------------------------------------------------------------------------------- |
| Environmental assumptions verified          | Base, 15     | Partial    | 7.5       | Pipeline, required checks and production read; front-end states taken from the supplied list   |
| Full surface mapped                         | Base, 15     | Partial    | 7.5       | About 95 lower-priority security stories and 18 front-end stories known by title or count only |
| Partial-fix risk assessed                   | Base, 10     | Verified   | 0         | Each step states what it does not close                                                        |
| Chunk scope defined                         | Base, 10     | Verified   | 0         | Stated above                                                                                   |
| Human gate not bypassed                     | Base, 15     | Verified   | 0         | Every decision is listed as a gate; none assumed                                               |
| Every Urgent story has a test that can fail | Critical, 15 | Partial    | 7.5       | Nine Urgent stories read by title only                                                         |
| The gates relied on run and can fail        | Critical, 15 | Partial    | 7.5       | Five red or blind; repair is step 0                                                            |
| Production tier can run                     | High, 10     | Partial    | 5         | Old build, no Access app                                                                       |
| Device coverage defined                     | High, 10     | Unverified | 10        | Not read at this point                                                                         |
| No flaky test hides a failure               | High, 10     | Partial    | 5         | Two clock failures in 24 hours                                                                 |
| Test data like production                   | Medium, 5    | Unverified | 5         | Not read at this point                                                                         |
| Results are observable                      | Medium, 5    | Partial    | 2.5       | New log lines unread on staging; no alerting                                                   |
| One owner per piece of work                 | High, 10     | Partial    | 5         | Two sessions, two collisions                                                                   |

**Loop 1: 100 − 62.5 = 37.5%.** Stop.

**Corrections applied before Loop 2**

- Read the phone audit's legs and browser projects. Device coverage: Verified.
- Read the staging database. Test data: Partial (staging known, production empty).

**Loop 2, pressure pass.** Carried deductions: 50. New findings carry the loop-two weight of 1.25.

| New finding                                                                       | Severity | State      | Deduction |
| --------------------------------------------------------------------------------- | -------- | ---------- | --------- |
| Staging has one admin identity, so step 3 cannot be tested there without fixtures | High     | Partial    | 6.25      |
| Done excludes T5, and T5 skipped the last security merge                          | High     | Partial    | 6.25      |
| A staging event has a status outside the four states; cause not looked into       | Medium   | Unverified | 6.25      |
| The launch scope is undecided, so the order cannot be checked against the date    | High     | Partial    | 6.25      |

**Loop 2: 100 − 50 − 25 = 25%.** The score fell. The protocol stops here and goes to the human gate. Loop 3 was not run.

---

## 11. What would raise the score

| Action                                                          | Who             | Items it clears                                       |
| --------------------------------------------------------------- | --------------- | ----------------------------------------------------- |
| The twelve decisions and owner actions in step 1                | PO              | Launch scope, lanes, and the blockers on steps 2 to 6 |
| Repair or retire the five gates in step 0; put T5 on a schedule | Lane A          | Gates relied on; Done excludes T5; flaky tests        |
| Read the nine Urgent stories known by title, then the High ones | Lane A          | Urgent coverage; full surface                         |
| Re-read the front-end tickets against `main`                    | Lane B          | Environmental assumptions                             |
| Build the brand and role fixtures (OSE-1554)                    | Lane A          | The staging blocker on step 3                         |
| Find out why one staging event is `published`                   | Lane A          | The data finding                                      |
| Redeploy production                                             | PO, then Lane A | Production tier                                       |

A second run is worth doing after step 1 and step 0, not before.
