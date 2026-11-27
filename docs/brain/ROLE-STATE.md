# Role current states (from CLAUDE.md §3)

> Moved out of the root `CLAUDE.md` (2026-10-11) so it is read when needed instead of on every turn.
> Edit this file directly.
>
> **Counts in this file are the value on the date beside them, and many are old** (OSE-1672).
> For today's counts run `node scripts/brain/counts.mjs`; quote the number with the date.

> **Split 2026-11-24.** This page is short on purpose: agents read the start and end of a long file well and miss the middle (Liu et al., "Lost in the Middle", TACL 2024). Each role keeps its standing duties here and the titles of its five newest entries. **Every dated entry, verbatim, is in `docs/brain/role-state/<role>.md`.** To record a change: add the full entry at the top of that role file, then add its title line under **Latest** here and drop the oldest title. `scripts/ci/agent-instructions-budget.mjs` keeps this page under its budget.

## 3. Scrum Team — Role POVs

Every story is implemented from all six POVs simultaneously. CC reads all six and writes code that satisfies all six.

### Product Owner (PO) — You

- Defines acceptance criteria
- Prioritizes backlog
- Reviews sprint progress in Linear
- Accepts/rejects completed stories

**Latest** (newest 5 of 26 by the date in each title; full text in [role-state/product-owner.md](role-state/product-owner.md)):

- 2026-11-23: Pick by icon: the icon category slider (OSE-2207; PR #1518, merged 2026-11-23 16:48 UTC as `b0b8938`; staging chain T1–T4 green on `4bd8ba1`, a later `main` SHA that contains it, run 45220685354)
- 2026-11-22: Storytime is an event type (OSE-2155, testing ticket OSE-2205; PR #1511, merged 2026-11-22 UTC as `d3ca8cf`; staging chain T1–T4 green on `d3ca8cf`, run 45024684315)
- 2026-11-20: The zoomed map measures to each place, and the position is read only on a tap: what is still the owner's (OSE-2198; PR #1491, merged 2026-11-20 03:55 UTC as `86b1a6d1`; staging chain T1–T4 green on the later `main` SH…
- 2026-11-18: Invariant 2's open gaps sentence now points to a list (part of OSE-2087; PR #1436, merged by the owner 2026-11-18 15:20 UTC as `3b29c49`; documents only, so there is nothing to see on staging)
- 2026-11-18: Voting design accepted: ADR-040, an anonymous vote is a counter on an object (part of OSE-1193 and OSE-2123; PRs #1414 and #1417 merged by the owner 2026-11-18, #1420 merged 07:28 UTC as `8c0a64d0`; review worksheet #…

### Lead Backend Architect (BE)

- Writes Worker route handlers
- Implements D1 queries (Phase 2)
- Owns DB design, API contracts, auth, feature flags, testing pyramid

**Latest** (newest 5 of 40 by the date in each title; full text in [role-state/backend-architect.md](role-state/backend-architect.md)):

- 2026-11-26: Stricter in-room voting (OSE-2234, migration 0122, then 0123 in a follow-up; PR #1562, merged by the owner 2026-11-26 08:09 UTC as `43fa82c`)
- 2026-11-24: Weekly corridor flows to BigQuery (OSE-2216, the NCR map layers' history; boundary rules in OCR-docs #185 and #186, both merged; PR #1536, merged 2026-11-24 02:19 UTC as `4da6415`; staging chain T1–T4 green on `e2333f…
- 2026-11-23: Sponsor kind of business (OSE-2207, migration 0116, `REQUIRED_DB_MIGRATION` = 116; PR #1518, merged 2026-11-23 16:48 UTC as `b0b8938`; staging chain T1–T4 green on `4bd8ba1`, a later `main` SHA that contains it, run 4…
- 2026-11-23: One scan figure, from the poster rows (OSE-1784; PR #1528, merged 2026-11-23 as `d782e7e`)
- 2026-11-23: Scans are counted on the code, never the phone (OSE-2214, owner 2026-11-23: "This should not be counting people, but traffic of the clicks"; ADR-024 option C for scans; PR #1531, merged 2026-11-23 as d266016)

### Lead FE Integration (FD)

- Coordinates 5 MVP surfaces + forms QR routing
- Integration testing between front and back

**Latest** (newest 5 of 17 by the date in each title; full text in [role-state/frontend-integration.md](role-state/frontend-integration.md)):

- 2026-11-26: The public event page is a card display, Supported by is a row of equal banners, and Register is on the first phone screen (owner requests 2026-11-26, no Linear story; PR #1567, merged 2026-11-26 as `6c4a854`)
- 2026-11-26: The map's own tooltip, clear of the pointer, and press and hold on a phone (owner request 2026-11-25, no Linear story; PR #1556, merged 2026-11-26 02:40 UTC as `caed3311`; the staging chain for that SHA, run 45743974057…
- 2026-11-23: Icon category slider on the landing, `/map` and Create Sponsor (OSE-2207; PR #1518, merged 2026-11-23 16:48 UTC as `b0b8938`; staging chain T1–T4 green on `4bd8ba1`, a later `main` SHA that contains it, run 45220685354)
- 2026-11-20: The zoomed map measures to each place, and the position is read only on a tap (OSE-2198; PR #1491, merged 2026-11-20 03:55 UTC as `86b1a6d1`; staging chain T1–T4 green on the later `main` SHA `ac0d7a4` (#1505), which…
- 2026-11-18: The admin Voting card (OSE-2127; PR #1432, merged by the owner 2026-11-18 13:47 UTC as `697f498`; staging chain T1–T4 green on that SHA, run 44317363830)

### Sr Design FE

- Mobile-first form UX, Kaizen, uniform design, color palette
- Dedication to test-ids and automation-friendly selectors

**Latest** (newest 5 of 11 by the date in each title; full text in [role-state/design-fe.md](role-state/design-fe.md)):

- 2026-11-23: Icon slider look (OSE-2207; PR #1518, merged 2026-11-23 16:48 UTC as `b0b8938`; staging chain T1–T4 green on `4bd8ba1`, a later `main` SHA that contains it, run 45220685354)
- 2026-11-17: Top menu: Events and Map, and the mark on `/map` (part of OSE-1990, testing ticket OSE-2111; PR #1394, merged 2026-11-17 UTC as `87b7b773`; staging chain T1–T4 green on `1e2bc848`, a later `main` SHA that contains it,…
- 2026-11-15: Landing map: a hexagon is a link only where it is a 44 px touch target (part of OSE-2084; PR #1291, merged 2026-11-15 UTC as `24702758`; staging chain T1–T4 green on that SHA, run 43760539191)
- 2026-11-15: Withheld counts, the look (part of OSE-1656; PR #1260, merged 2026-11-15 UTC as `4421311`; staging chain T1–T4 green on the later `main` SHA `8e37510` that contains it, run 43669610456)
- 2026-11-14: Series card in admin (OSE-2014; PR #1207, merged 2026-11-14 UTC as `89017f4d`; staging chain T1–T4 green on that SHA, run 43540436362)

### Sr Automation QA

- API tests, Playwright E2E per form type, PII scrub verification

**Latest** (newest 5 of 59 by the date in each title; full text in [role-state/qa-automation.md](role-state/qa-automation.md)):

- 2026-11-24: Corridor flow export at both layers (OSE-2216; PR #1536, merged 2026-11-24 as `4da6415`; staging run 45321309812 on `e2333f7` green T1–T4)
- 2026-11-23: Icon slider at both layers (OSE-2207; PR #1518, merged 2026-11-23 16:48 UTC as `b0b8938`; staging chain T1–T4 green on `4bd8ba1`, a later `main` SHA that contains it, run 45220685354)
- 2026-11-21: The names move to build `20261120` (part of OSE-2064; this pull request, not merged when this was written)
- 2026-11-20: Place distances and tap-only location at both layers (OSE-2198; PR #1491, merged 2026-11-20 03:55 UTC as `86b1a6d1`; staging chain T1–T4 green on the later `main` SHA `ac0d7a4` (#1505), which contains it, run 44741613…
- 2026-11-20: H3 seams at both layers (OSE-2199; PR #1493, merged 2026-11-20 UTC as `bebcc1e`; staging chain as on the Backend line, run 44741613561)

### SRE/SDET (Performance + Observability)

- CI/CD gates, observability, form submission monitoring, destruction job monitoring

**Latest** (newest 5 of 27 by the date in each title; full text in [role-state/sdet-sre.md](role-state/sdet-sre.md)):

- 2026-12-02: Dependency audit: one named exception, ending 2026-12-02 (part of OSE-2121; owner chose option B on 2026-11-18; PR #1419, merged by the owner 2026-11-18 07:28 UTC as `a36f141`; staging chain T1–T4 green on that SHA, r…
- 2026-11-23: Room burst on staging (OSE-2122; PRs #1415 and #1416, merged 2026-11-18)
- 2026-11-18: Staging T2 race between its two legs (OSE-2137; fix in PR #1430, merged by the owner 2026-11-18 13:46 UTC; staging proof pending)
- 2026-11-18: T4k "the When pills filter the places" timed out on every staging run since 2026-11-18 (OSE-2138; fix in PR #1431, merged by the owner 2026-11-18 13:46 UTC; staging proof pending)
- 2026-11-18: Two gates that each passed alone went red together on `main` (read 2026-11-18; part of OSE-1475)

### DevOps

- DB provisioning, service config, CI/CD pipeline, secrets management

**Latest** (newest 5 of 21 by the date in each title; full text in [role-state/devops.md](role-state/devops.md)):

- 2026-11-18: Staging chain red at T2 on a leftover test event (seen 2026-11-18, three `main` runs: 44348442230, 44365467922, 44365545177)
- 2026-11-18: Migration 0112 is on the staging database (OSE-1561; PR #1454, merged by the owner 2026-11-18 19:52 UTC as `d79581f`; `T1 Deploy → Staging` of run 44384962929)
- 2026-11-18: Migration 0113, vote code and event status (part of OSE-2140 and OSE-2142; PR #1460, merged 2026-11-18 21:35 UTC as `68e1980b`; the staging chain for that SHA, run 44403047974, had not run when this line was written)
- 2026-11-18: The dependency audit is not a required check, as recorded (read 2026-11-18 by Dr of Security in the review of PR #1419, part of OSE-2121; live settings not read)
- 2026-11-18: Agent identity readiness (part of OSE-1746; PR #1424, merged by the owner 2026-11-18 08:42 UTC as `99cc60c`)
