---
ccr: 1
class: architecture
requested_loops: 5
loops_run: 5
team: base
gate: stop
cumulative_score: 0
system_score: 0
unresolved: { regulatory: 0, security_critical: 0, critical: 4, high: 14, medium: 5, low: 3 }
---

# CCR: is OSE-1193 (anonymous votable-object primitive) ready, and what is its smallest safe shape?

Date: 2026-11-17. Claude Code ran this for a readiness and design pass that the owner's standing session prompt asked for. Nothing was built: no Worker code, no migration, and no ticket state changed.

The subject is a design, not code. Every finding was read from source at `main` 82a4767 and at ourWKRP `main` f32b79a. Nothing was run at runtime or on staging. The author spot-checked four findings against source (`display-config.spec.ts:84`, `withheld-count-words.spec.ts:190`, `architecture.spec.ts:103-110`, `qr-scan.ts:168-181`). The Loop 5 auditor checked twelve more citations and found two small errors, corrected below. The rest are the lenses' own citations.

## Verdict

| Item                                                                 | Result                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification                                                       | Architecture, anonymity and count floor: 5 loops, base team. The Dr of Security sat in loops 1, 2 and 3                                                                                                         |
| Loops run                                                            | 5 of 5: Critical, Conservative, Adversarial, Compliance, Recursive                                                                                                                                              |
| Loop results                                                         | 0%, 0%, 0%, 1%, 46%                                                                                                                                                                                             |
| Cumulative, before any solutioning                                   | **0%**                                                                                                                                                                                                          |
| System, after solutioning (design v2)                                | **0%**. Open: 4 Critical, 14 High, 5 Medium, 2 Low. Each waits on an owner decision, a prerequisite not yet built, or a risk only the owner can accept                                                          |
| If the owner accepts every recommendation and the prerequisites land | about **51%**. The 49 points left are the residual risks in "Risks accepted", which only written acceptance can carry. Still under 95%                                                                          |
| Assessment confidence                                                | **50%**. Source reads only, nothing proven at runtime, and Loop 5 found one arithmetic error, a weighting error and one design contradiction (all corrected here)                                               |
| Gate                                                                 | **Stop. Human gate.**                                                                                                                                                                                           |
| Readiness verdict for OSE-1193                                       | **Not ready.** The story text no longer matches the code or later rulings. Two owner rulings conflict under the floor. Two prerequisites are not built. Presence for a full room behind one address is unsolved |

What held through all five loops:

- **Nothing in the events Worker votes today.** A `grep` for vote, ballot, votable and tally over `src`, `migrations` and `migrations-forms` finds no voting code. It finds an event-type seed line (`migrations/0024`) and two unrelated uses of the word "tally" (`attendee-map.ts:286`, a comment at `form-pages.ts:610`).
- **The September 2026 branch is gone.** `feat/ose-1193-votable-object-primitive` (commits 4689b51 and a5fe9f4, migration "0069") is not on the remote. Migration numbers have moved on: the latest is 0110.
- **Aggregate-only, with no per-vote row, is still the right base.** Every loop attacked it, and none asked for per-vote rows back.
- **A vote is not a scan.** Scans have no side, dedup per poster per hour, and count on a GET (Backend, Loop 1).

A score here is a signal, never permission. Below 95%, nothing is built until the owner rules.

## What was reviewed

- **Subject:** candidate design v1 for OSE-1193, written by the author from the code. It had:
  - three tables in `DB`: `votable_objects` (event, kind, label, optional booth, state), `vote_tallies` (up and down counters) and `vote_participation` (distinct voters per event);
  - no per-vote row and no per-vote time;
  - dedup in KV, keyed on an HMAC of the browser's scan key and the object;
  - a public `POST /api/v2/votes` that reads `ose_anon` and never sets it, with a "publicCountLimited-style" limit and no count in its answer;
  - admin create, open and close, with tallies read after an object closes through `applyCountFloor`, and a winner when at least 5 voters voted;
  - no display tally, the SharedReport left to OSE-520, and OurWKRP keeping the song-to-object mapping.
- **In scope:**
  - the four Definition of Done lines of OSE-1193;
  - the scan path: `handlers/qr-scan.ts`, `lib/scan-buffer.ts`, `lib/scan-node-key.ts`, migrations 0100 and 0101;
  - `lib/anonymous-id.ts` and `lib/count-floor.ts`;
  - the limiters: `lib/public-read-limit.ts`, `lib/rate-limit.ts`, `lib/edge-rate-limit.ts`;
  - booths: migration 0109 and `lib/booth-counts.ts`;
  - ADR-034, the invariant gates, and the CI workflow's T0 to T4 steps;
  - Linear: OSE-1193, OSE-1192, OSE-2000, OSE-2011, OSE-513 and its children, OSE-520, OSE-923, OSE-683, OSE-1496, OSE-1997, OSE-1080, OW-218, OW-219 and OW-73;
  - ourWKRP: migration 0011 and its two feature docs.
- **Out of scope:**
  - OurWKRP's vote endpoint (OW-73) and its roster;
  - SharedReport results (OSE-520), except the rules the tally must support;
  - OCR-docs, which is not on disk;
  - staging and production behaviour.
- **Why it matters:** voting adds preference to presence. A wrong shape would publish who preferred what (invariant 1) or a count under 5 (invariant 2). Two things wait on this story: OSE-2000, under the fairs epic that the owner names as the priority, and OW-218 (Fist of Five, February).

## OSE-1193's Definition of Done, line by line

| Line (as written 2026-09-02)                                                           | Today                | Why                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `votable_object` + `vote` schema (hardened-anonymous, mirrors scan pattern); migration | **No longer fits**   | The September CCR held a per-voter `vote` table and accepted aggregate-only. "Mirrors scan pattern" now means keyed per-row ids (migration 0101), the shape that was refused. Replace it with objects, side counters, and short-lived receipts that carry no side and no time.                                      |
| Born-red covenant tests (no PII, bucketed, aggregate-only, dedup)                      | **Fits with change** | "Bucketed" is retired. The scan path keeps the hour only (migration 0100 and the `timestamp-precision` gate), and OW-218 says the events side keeps an hour bucket only. A vote keeps no time at any grain. Add tests for presence, a missing pepper, and never-who in logs and the cost line, at both test layers. |
| Anonymous vote endpoint + tally; SharedReport crowns winner                            | **Fits with change** | The endpoint stays. Crowning the winner belongs to OSE-520, and the September CCR deferred it. The tally rules change (Solutioning, R1 to R6).                                                                                                                                                                      |
| Named attachment explicitly OUT of scope                                               | **Fits**             | ADR-034 decision 5 and OSE-520 agree.                                                                                                                                                                                                                                                                               |
| Covenant: "A-8 `vote_bucket` rounding (15 min)"                                        | **No longer fits**   | The hour-only scan path and OW-218 supersede it. A vote keeps no time at all, so the conflict with OW-218 goes away.                                                                                                                                                                                                |
| Covenant: "hashed anon_id at rest; do not inherit OSE-923's raw storage"               | **Fits with change** | OSE-923 is Done: `scan_node_returns` holds a keyed id (`snk1_`). A vote keeps no voter id at rest except receipts keyed on the raw cookie, and those are deleted at close.                                                                                                                                          |
| Covenant: "aggregate-only tally (invariant #7)"                                        | **Fits with change** | Aggregate-only stands. AGENTS.md #7 is now about tier-gating, so the reference should be to invariant 1.                                                                                                                                                                                                            |

The invariants:

- **Never who:** holds in design v2, with residuals the owner must accept (D8).
- **Under-5 floor, no exceptions:** holds only if the OSE-520 winner rule changes (D4, D5).
- **Place, not person:** a vote stores no place and reads no geo. A per-caller limit reads `CF-Connecting-IP` as a limit key only, as `/q` does today (`lib/edge-rate-limit.ts:58`). ADR-040 must say so (L5-07).
- **No cookies except `ose_anon` on `/q` and forms routes:** the vote never sets a cookie, but it reads one on a new route. That needs an owner ruling (D3).
- **The display shows no counts:** holds only if OSE-513 and OSE-518 are rewritten and the display gate is widened (D7, L4-09).

## Loop 1

Team: dr-of-security, role-data-scientist, role-backend-architect, role-qa-automation

Critical layer: what is true against what is assumed. The most dangerous assumption was that the scan path's patterns are strong enough for a vote whose winner is decided on exact counts. Those patterns are an unsigned cookie, KV dedup by get then put, and a per-address limit that fails open. They are not strong enough:

- a forged `anon_*` string counts as a new voter (`lib/anonymous-id.ts:36`);
- KV dedup can be raced (`handlers/qr-scan.ts:197-207`);
- the limiter counts everything when there is no address or KV fails (`lib/public-read-limit.ts:145-149,246`).

The design also had no team grouping, no participation denominator, and no `participation_mode` column to gate on.

Findings L1-01 to L1-31 (see the register), all at full weight: Critical 15 x 2 = 30, High 10 x 10 = 100, Medium 5 x 14 = 70, Low 2 x 5 = 10. Total 210.

Score: 0%

## Loop 2

Team: dr-of-security, role-sdet-sre

Conservative layer: assume the worst.

- **A missing pepper (L2-01).** If the vote path copied the scan fallback, the raw cookie would go into a KV key beside the object id: a listable map of who voted for what. It counts as Security Critical while unaddressed. The staging check only warns (`oursharedevents-ci.yml:1185-1191`).
- **Markers keyed on `snk1`.** A pepper holder could list every voter from `scan_node_returns`.
- **A full room.** The in-Worker limiter's KV write fails under room load, and the error is caught as "not limited".
- **The scan queue.** A replayed counter update would double-count, and production has no queue.
- **Staging cannot reset KV.** Repeated runs stay green without ever exercising the 5-voter path.
- **Closing on time.** The daily cron cannot close a voting window.
- **The cost line.** `OPERATION_COST` shows, for each vote, whether it counted.

Findings L2-01 to L2-16. An unaddressed Security Critical gets no partial credit.

Score: 0%

## Loop 3

Team: dr-of-security, role-data-scientist

Adversarial layer: the lenses attacked design v1 and the fixes that loops 1 and 2 proposed.

Blocked:

- a replayed POST (same receipt);
- a cross-site POST (`SameSite=Lax`);
- pepper rotation under the epoch rule;
- booth scans beside booth votes.

Succeeded:

- **n-1 collusion (L3-01).** Five colluders and one other voter: any fixed threshold on exact counts reveals the other person's vote. This is the known limit of every floored count in OSE, the same shape as OSE-1496's K-1 probe, now applied to preference. No function of the counts closes it. Only added noise or the owner's written acceptance does.
- **Unanimity (L3-02).** With 5 voters and a margin of 5, "winner" means 5 to 0. A known room learns everyone's vote.
- **Sybil (L3-03).** A caller with no `CF-Connecting-IP`, or a KV failure, mints and counts without limit (`public-read-limit.ts:145-149,246`). Under the limit, each new browser gets its own cookie. Signing (OSE-1496) does not bound either case.
- **Time Travel (L3-04).** D1 keeps 30 days of history. Its write order links a browser's scan to the counter that moved seconds later. The scan split tables already carry the same kind of residual.
- **Conflicting rules (L3-14).** The OSE-520 owner rules contradict each other under the floor.

Arithmetic at full weight: Critical 15 x 2 = 30, High 10 x 8 = 80, Medium 5 x 4 = 20, Low 2 x 4 = 8. Total 138.

Score: 0%

## Loop 4

Team: role-product-owner, role-frontend-integration

Compliance layer: the design and the story checked against the binding rules.

- **The story format.** The story fails STORY-FORMAT and the Definition of Done: it has no CI/CD testing ticket, no prerequisite, no route or UI spec, and no load or deploy gate.
- **The blocks are circular.** ADR-034:65 refuses `competition` until OSE-513 and OSE-1193 ship. Design v1 refuses a vote unless the mode is `competition`. ADR-034:178 names only OSE-513.
- **Counts are post-event (invariant 5).** That rules out reading a tally when one song closes mid-event, and OSE-513 and OSE-518 propose a live display tally outright.
- **Reading the cookie.** No gate stops a new route reading `ose_anon`: `cookie-setters` matches setters only.
- **The display gate.** Its "no counts" check matches fundraiser words only (`display-config.spec.ts:84`), and the TV reads the event answer (`display.html:594`).
- **Wording.** "Held" is banned under a live gate (`withheld-count-words.spec.ts:190`). The house words are "Fewer than 5".
- **Gate coverage.** `COUNT_WORDS` has no vote words, and several page and CI gates are per-file lists that a new file escapes.

Arithmetic at full weight: High 10 x 5 = 50, Medium 5 x 9 = 45, Low 2 x 2 = 4. Total 99.

Score: 1%

## Loop 5

Team: role-scrum-master

Recursive layer: was the assessment itself honest? The auditor read the draft of this worksheet and the loop inputs, and checked citations against the repo.

The auditor's verdict: the draft was honest about where it landed (stop, not ready), but it overstated its closures, the projected score and its confidence. What it found, and what was done:

- **A design contradiction (L5-01).** Design v2 closed the full-room finding (L1-04) with "no per-address limit on votes". But presence was proven by a `scan_node_returns` row. `/q` writes that row, and mints a cookie, only while the caller is under its per-caller limit (`qr-scan.ts:168-181`, verified by the author). So a room behind one address is limited again, one step earlier. On staging, scans also go through a queue with 5 s batches, so a vote straight after a scan can be refused there and accepted on production. L1-04, L1-24 and L2-16 are reopened. Presence is now a ticket in the `/q` redirect (design v2, item 3), and a staging spike (S0) is added.
- **The weighting was read backwards (L5-02).** The draft gave inferred findings half weight. `ccr-protocol.md:440-450` gives half only to a partly verified item whose gap is named. An unproven, inferred finding costs the full weight. Every loop is now scored at full weight.
- **Overstated closures (L5-03).** Reopened:
  - L1-02, which needs OSE-1496 and a mint cap;
  - L4-04 (needs D7);
  - L1-06, L2-04 and L3-10 (need D11);
  - L3-08 (needs D4);
  - L1-18 (needs the PO to amend OSE-514).
- **Loop 3 arithmetic (L5-04).** Loop 3 has 8 High rows, not 7, so its total was 79 at the draft's weights and 26% was wrong. Corrected.
- **A citation (L5-05).** L3-03 said "/q mints a cookie for every cookieless request". Over the limit it mints none. Reworded.
- **Sequencing (L5-06).** S4 did not fit one session and is split into S4a and S4b. D3 amends AGENTS.md, which is a governance change needing its own 5-loop CCR; it is now in the commit sequence. N1 to N5 are now defined, and S2 has a staging case.
- **The caller address (L5-07).** A mint cap per caller reads the caller address. ADR-040 must say it is a limit key only and never stored.
- **Two small citation errors (L5-08).** The "only hit" grep claim and ADR-034:65's two ids. Corrected.
- **A missing decision (L5-09).** Dropping the participation rate overrides an OSE-520 owner rule, but no question asked the owner about it. D12 is added and L1-07 is reopened.

Confidence was lowered from 70% to 50%, as the auditor proposed. These would raise it:

- a script that re-checks every register citation;
- a throwaway workers-pool test of the D1 batch order (L3-18);
- the S0 spike on staging;
- reading Linear directly instead of the excerpts the lenses were given;
- the Dr of Security in a compliance loop.

Arithmetic at full weight: High 10 x 3 = 30, Medium 5 x 4 = 20, Low 2 x 2 = 4. Total 54.

Score: 46%

## Findings register

**Weights:** Regulatory 25; Security Critical and Critical 15; High 10; Medium 5; Low 2.

**How they apply:**

- Every finding is at full weight, because none is verified safe (`ccr-protocol.md:440-450`).
- No environment modifier (x 1.0). Production is held closed and staging is the environment of record, but the design is meant for production.
- The loop-position multiplier (H1) is not applied. Under the owner's 2026-11-01/02 ruling, each loop is a different lens. A finding first seen in Loop 3 was that lens's job, not something Loop 1 missed.

**"Resolved (design v2)"** means the revised design below carries the control. That is a closure on paper only: each one must be seen failing first in the build story named in brackets.

| Id    | Severity          | Finding                                                                                                                     | Verified | Status                                                                                                      |
| ----- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| L1-01 | Critical          | Winner decided on exact upvotes (OSE-520) ranks counts held under 5 and leaks them beside floored totals                    | inferred | open: owner decision D4                                                                                     |
| L1-02 | Critical          | Forged `anon_*` values are new voters; the limiter fails open; signing alone does not bound it                              | source   | open: needs OSE-1496 signing and a `/q` mint cap (N2)                                                       |
| L1-03 | High              | KV dedup by get then put is racy and only eventually consistent                                                             | inferred | resolved (design v2: D1 receipts in one batch; S4a)                                                         |
| L1-04 | High              | Shared venue Wi-Fi: per-address limits drop real votes, or (via `/q`) real presence                                         | source   | open: S0 spike and design decision in ADR-040 (reopened by L5-01)                                           |
| L1-05 | High              | No team grouping, so OSE cannot compute a team result                                                                       | source   | resolved (design v2: `group_id`; S2)                                                                        |
| L1-06 | High              | Successive reads can be differenced (reopen; participation read after each close)                                           | inferred | open: owner decision D11                                                                                    |
| L1-07 | High              | Participation denominator undefined; check-ins are in FORMS_DB                                                              | source   | open: owner decision D12                                                                                    |
| L1-08 | High              | `participation_mode` does not exist                                                                                         | source   | withdrawn: merged into L4-03                                                                                |
| L1-09 | High              | `ose_anon` is host-only and `SameSite=Lax`; where the vote button lives is undecided                                        | source   | open: owner decision D2                                                                                     |
| L1-10 | High              | KV dedup cannot be shown failing at either test layer                                                                       | inferred | resolved (design v2: dedup in D1; S4a)                                                                      |
| L1-11 | High              | Dedup lifetime not tied to the voting state                                                                                 | inferred | resolved (design v2: receipts live until the set closes; S4a)                                               |
| L1-12 | High              | A fail-closed handler with a missing binding passes "not counted" tests vacuously                                           | source   | resolved (design v2: a positive control first in every spec; S4a)                                           |
| L1-13 | Medium            | KV expiry stamps show each vote's time                                                                                      | inferred | resolved (design v2: no KV for votes)                                                                       |
| L1-14 | Medium            | A pepper holder can test whether a known key voted                                                                          | inferred | resolved (design v2: receipts keyed on the raw cookie, deleted at close)                                    |
| L1-15 | Medium            | The `/q` log pattern would put object ids, timed to the millisecond, in logs                                                | source   | resolved (design v2: no object, side or event in logs; S2 L0)                                               |
| L1-16 | Medium            | Admin object routes must check that the object belongs to the path's event                                                  | source   | resolved (design v2; S3)                                                                                    |
| L1-17 | Medium            | The proposed gates could not fail on the real channels                                                                      | source   | resolved (design v2: named asserts per channel; S2)                                                         |
| L1-18 | Medium            | Per-object dedup against pick-one ballots; OSE-514 asks for per-vote rows                                                   | inferred | open: PO amends OSE-514 to aggregate-only                                                                   |
| L1-19 | Medium            | No server close time; no read for the voter page                                                                            | inferred | resolved (design v2: `closes_at`; open-objects read; S3)                                                    |
| L1-20 | Medium            | No recount after stuffing                                                                                                   | inferred | resolved (design v2: void flag with a reason; refused and duplicate counters; S5)                           |
| L1-21 | Medium            | OurWKRP's route to open and close song objects is unscoped and out of scope                                                 | source   | open: proposed new ticket N1                                                                                |
| L1-22 | Medium            | Reading `ose_anon` on a new route is outside the 2026-10-22 ruling                                                          | source   | withdrawn: merged into L4-01                                                                                |
| L1-23 | Medium            | Co-publication bans not stated                                                                                              | inferred | resolved (design v2: R5)                                                                                    |
| L1-24 | Medium            | Staging needs at least 10 voters; forgeable today, and after signing each needs `/q` from one runner address                | source   | open: S0 spike (reopened by L5-01)                                                                          |
| L1-25 | Medium            | No voter page named, so Playwright has nothing to test                                                                      | source   | resolved (design v2: `GET /events/:id/vote`; S4b)                                                           |
| L1-26 | Medium            | The answer must be the same bytes whether counted or duplicate                                                              | inferred | resolved (design v2; S4a)                                                                                   |
| L1-27 | Low               | Hour precision not written in the schema; schema-guard bump; rollback entry                                                 | inferred | resolved (design v2; S2)                                                                                    |
| L1-28 | Low               | "No per-vote time at any grain" overstates (Time Travel)                                                                    | inferred | resolved (reworded; residual in L3-04)                                                                      |
| L1-29 | Low               | The handler must use a read-only cookie parser                                                                              | source   | resolved (design v2; S4a)                                                                                   |
| L1-30 | Low               | `kind` in a CHECK forces a rebuild later                                                                                    | inferred | resolved (design v2: list kept in code)                                                                     |
| L1-31 | Low               | Born red is self-declared                                                                                                   | source   | resolved (design v2: the injected fault is named per test)                                                  |
| L2-01 | Security Critical | Pepper unset: the scan fallback would put the raw cookie into vote keys                                                     | source   | resolved (design v2: no pepper means refused; the vote's staging check is an error, not a warning; S2, S4a) |
| L2-02 | High              | Markers keyed on `snk1` let a pepper holder list every voter                                                                | inferred | resolved (design v2: keyed on the raw cookie)                                                               |
| L2-03 | High              | Receipt and counter written in one batch pair up in Time Travel                                                             | inferred | withdrawn: merged into L3-04                                                                                |
| L2-04 | High              | A brand admin learns one vote by opening one object with one target present                                                 | inferred | open: owner decision D11 (one set, results only after the event); residual in L3-01                         |
| L2-05 | High              | Pepper rotation mid-event doubles the voter count                                                                           | inferred | resolved (design v2: epoch stored on the set; S4a)                                                          |
| L2-06 | High              | The per-address KV limiter throws at room load and is caught as "not limited"                                               | source   | resolved (design v2: not used for votes)                                                                    |
| L2-07 | High              | The scan queue would double-count; production has no queue                                                                  | source   | resolved (design v2: direct D1, no queue)                                                                   |
| L2-08 | High              | Staging cannot reset KV                                                                                                     | source   | resolved (design v2: no KV; fresh object ids per run)                                                       |
| L2-09 | Medium            | The daily cron cannot close a window                                                                                        | source   | resolved (design v2: `closes_at` enforced in the write)                                                     |
| L2-10 | Medium            | The WAF rule on `/api/v2/events*` would answer 429 to a whole venue                                                         | source   | resolved (design v2: vote routes outside that prefix)                                                       |
| L2-11 | Medium            | `OPERATION_COST` shows, per vote, whether it counted                                                                        | source   | resolved (design v2: rows-written null for the vote operation; S2 L0)                                       |
| L2-12 | Medium            | A rollback mid-event loses votes silently                                                                                   | inferred | resolved (design v2: a rollback voids open sets, written in ROLLBACK_PLAN)                                  |
| L2-13 | Medium            | A free `choice` label can name a person                                                                                     | inferred | resolved (design v2: no `choice` kind in this story)                                                        |
| L2-14 | Medium            | Erasure cannot reach votes                                                                                                  | source   | resolved (design v2: privacy line "no who held; receipts gone at close")                                    |
| L2-15 | Low               | Whole-table dumps are not a channel; keep it that way                                                                       | source   | resolved (design v2: L0 lists vote tables as never exported)                                                |
| L2-16 | Low               | No load evidence for a room behind one address                                                                              | source   | open: S0 spike (reopened by L5-01)                                                                          |
| L3-01 | Critical          | n-1 collusion reveals one person's vote at any fixed threshold                                                              | inferred | open: risk only the owner can accept, D8                                                                    |
| L3-02 | Critical          | Unanimity at 5 voters names everyone's vote                                                                                 | inferred | open: owner decision D5                                                                                     |
| L3-03 | High              | Sybil: one person, many cookies, while under the caller limit, or without limit when there is no caller address or KV fails | source   | open: residual for the owner, D8                                                                            |
| L3-04 | High              | D1 Time Travel write order links a scan to a vote                                                                           | inferred | open: risk only the owner can accept, D8                                                                    |
| L3-05 | High              | "Too close, champion retains" favours the defender                                                                          | inferred | open: game rule, D9                                                                                         |
| L3-06 | High              | Remote voting with a leaked object id; object ids from other events                                                         | inferred | resolved (design v2: presence ticket for this event; S4a)                                                   |
| L3-07 | High              | Flooding the room under a per-object limit                                                                                  | inferred | resolved (design v2: no per-object limit; one receipt per cookie)                                           |
| L3-08 | High              | A winner from exact counts orders two values inside one rounding step                                                       | inferred | open: owner decision D4 (R2)                                                                                |
| L3-09 | High              | A forced two-way choice with a known headcount gives the split                                                              | inferred | resolved (design v2: both sides or neither, R6)                                                             |
| L3-10 | High              | Repeated sets and a season of nights can be differenced                                                                     | inferred | open: owner decision D11                                                                                    |
| L3-11 | Medium            | `floorTotalOfParts` is exact beside rounded parts                                                                           | source   | resolved (design v2: a team total is the sum of published parts, every part clearing)                       |
| L3-12 | Medium            | "Devices seen" is not a superset of voters                                                                                  | source   | withdrawn: merged into L1-07                                                                                |
| L3-13 | Medium            | OurWKRP roster join; per-play windows against one set                                                                       | inferred | resolved (design v2: per-object windows inside one set; results after the event)                            |
| L3-14 | Medium            | OSE-520 rules contradict each other under the floor                                                                         | inferred | withdrawn: merged into L1-01                                                                                |
| L3-15 | Low               | A duplicate may answer measurably faster                                                                                    | inferred | open: residual, D8                                                                                          |
| L3-16 | Low               | Team members vote for their own song                                                                                        | inferred | open: game rule, D9                                                                                         |
| L3-17 | Low               | Percent-up from rounded numbers misleads                                                                                    | inferred | resolved (design v2: R5 bans it)                                                                            |
| L3-18 | Low               | The order of `UPDATE ... WHERE changes()=1` inside a batch is unproven                                                      | inferred | resolved (design v2: born-red test named; S4a)                                                              |
| L4-01 | High              | No gate stops a new route reading `ose_anon`; the ruling covers `/q` and forms only                                         | source   | open: owner decision D3                                                                                     |
| L4-02 | Medium            | A forms route cannot hold the vote write (forms.ts never touches DB)                                                        | source   | resolved (design v2: a DB-side handler)                                                                     |
| L4-03 | High              | Circular block between ADR-034 decision 4 and the vote gate                                                                 | source   | open: owner decision D6                                                                                     |
| L4-04 | High              | "Counts are post-event" against per-object reads; live display tallies in OSE-513 and OSE-518                               | inferred | open: owner decision D7                                                                                     |
| L4-05 | High              | The ticket fails STORY-FORMAT and the Definition of Done                                                                    | source   | open: owner decision D10 (adopt the refreshed text)                                                         |
| L4-06 | Medium            | The parent, OSE-1192, is post-first-launch; the stories that depend on this one are not                                     | source   | open: owner decision D10                                                                                    |
| L4-07 | Medium            | Production answers on the held host; the route must be inert there                                                          | inferred | resolved (design v2: `VOTING_ENABLED` off by default, listed in env parity)                                 |
| L4-08 | Low               | The covenant cites the wrong invariant and a superseded bucket                                                              | source   | resolved (refreshed story text)                                                                             |
| L4-09 | High              | The display's no-counts gate matches fundraiser words only; the TV reads the event answer                                   | source   | resolved (design v2: votables never on the event read; display gate widened; S2)                            |
| L4-10 | Medium            | "Held" is banned wording, but the tickets use it                                                                            | source   | open: owner decision D4 (wording)                                                                           |
| L4-11 | Medium            | `COUNT_WORDS` lacks vote words; the gate reads one projection                                                               | source   | resolved (design v2: words added; S2)                                                                       |
| L4-12 | Medium            | The lexicon gate reads a fixed file list                                                                                    | source   | resolved (design v2: the voter page renders through form-pages.ts)                                          |
| L4-13 | Medium            | The two-database gate is a per-file list                                                                                    | source   | resolved (design v2: vote handler listed as never touching FORMS_DB; S2)                                    |
| L4-14 | Medium            | Page rules (44 px, one h1, strip order) are checked page by page                                                            | source   | resolved (design v2: voter page added to each; S4b)                                                         |
| L4-15 | Medium            | The unrun-spec check reads tests/e2e only                                                                                   | source   | resolved (design v2: specs placed in tests/e2e and named in T3 and T4; widening proposed as N5)             |
| L4-16 | Low               | Host-only cookie: apex against www                                                                                          | inferred | resolved (design v2: voter link built on the `/q` host)                                                     |
| L5-01 | High              | Design v2 contradicted itself: presence from a `/q` scan row re-imposes `/q`'s per-caller limit and the staging queue lag   | source   | resolved: L1-04, L1-24 and L2-16 reopened; presence ticket and S0 added                                     |
| L5-02 | High              | Inferred findings were scored at half weight against `ccr-protocol.md:440-450`                                              | source   | resolved: rescored at full weight                                                                           |
| L5-03 | High              | Closures overstated (they depend on owner decisions or prerequisites not yet built)                                         | source   | resolved: eight rows reopened                                                                               |
| L5-04 | Medium            | Loop 3 arithmetic wrong (8 High, not 7)                                                                                     | source   | resolved: corrected                                                                                         |
| L5-05 | Medium            | L3-03 misquoted `/q` minting                                                                                                | source   | resolved: reworded                                                                                          |
| L5-06 | Medium            | S4 too large; the D3 governance CCR missing from the sequence; N1 to N5 undefined; S2 had no staging case                   | source   | resolved: split, sequenced, defined                                                                         |
| L5-07 | Low               | Invariant 3 not addressed for a per-caller limit                                                                            | source   | resolved (design v2: ADR-040 states the address is a limit key only, never stored)                          |
| L5-08 | Low               | Two small citation errors                                                                                                   | source   | resolved: corrected                                                                                         |
| L5-09 | Medium            | Dropping the participation rate overrides an OSE-520 owner rule without asking                                              | source   | resolved: D12 added; L1-07 reopened                                                                         |

**Open rows:**

- Critical (4): L1-01, L1-02, L3-01, L3-02.
- High (14): L1-04, L1-06, L1-07, L1-09, L2-04, L3-03, L3-04, L3-05, L3-08, L3-10, L4-01, L4-03, L4-04, L4-05.
- Medium (5): L1-18, L1-21, L1-24, L4-06, L4-10.
- Low (3): L2-16, L3-15, L3-16.

**System score after solutioning:** 100 - (15 x 4 + 10 x 14 + 5 x 5 + 2 x 3) = 100 - 231, which floors at **0%**.

**If the owner accepts every recommendation and the prerequisites land** (OSE-1496, the mint cap, the S0 spike, and the OSE-514 and N1 tickets), only the accepted residuals stay open: L3-01 15, L3-03 10, L3-04 10, L3-05 10, L3-15 2, L3-16 2. That is 49 points, about **51%**.

## Solutioning

How the team gets from 0% toward 95%. Design v2 is the smallest safe shape the five loops left standing. It is a proposal, not a decision.

### Design v2

1. **A new ADR first (OSE ADR-040, the next free number).** No code before it. ADR-034 decision 4 gets one line pointing at it.
2. **Tables in `DB` only, in one additive migration (the next free number):**
   - `votable_objects`:
     - `id` (random) and `event_id` (foreign key).
     - `set_id`.
     - `kind`: booth, team or song. The list lives in code, not a CHECK.
     - `label`: a trading, team or song name. Email-shaped and phone-shaped labels are refused, as for booths.
     - `booth_id`: nullable foreign key. The handler checks that the booth belongs to the same event.
     - `group_id`: nullable, pointing at a team object.
     - `state`: draft, open or closed. Closed is final.
     - `closes_at`: set by the server at open, with a fixed maximum.
     - `sort`, and timestamps at the hour.
   - `vote_sets`, one per event:
     - `id` and `event_id` (unique).
     - `state` and `pepper_epoch`.
     - a `void` flag and its reason.
     - counters `counted`, `duplicate` and `refused`, with no object and no time.
   - `vote_tallies`: `object_id` (primary key), `up_count`, `down_count`. Both sides exist from the start, because changing a CHECK later means rebuilding the table.
   - `vote_receipts`:
     - primary key (`object_id`, `receipt`), with no side and no time;
     - `receipt = HMAC(HKDF(ANON_ID_HASH_PEPPER, 'ose:vote:v1'), raw ose_anon || object_id)`;
     - the cookie value is stored nowhere, so the database is not a list of voters.
   - `vote_participants`: (`set_id`, `receipt`) primary key, keyed the same way on the set.
   - Receipts and participants are deleted when the set closes. A sweep also closes any set left open past the event's end.
3. **Presence.** When `/q` serves a scan, its redirect carries a short-lived presence ticket: an HMAC over the event id, an expiry within the event day, and a hash of the browser's cookie value. The ticket is stored nowhere. It works whether or not the scan was counted, and whatever the queue's delay. Whether `/q` mints a cookie for a whole room behind one address is the S0 spike's question.
4. **The vote**, a POST on the OSE origin outside `/api/v2/events*`. It checks, in order:
   1. `VOTING_ENABLED` is on.
   2. The body is JSON: `{object_id, side, ticket}`.
   3. It reads `ose_anon` with a read-only parser and never sets a cookie.
   4. No cookie, an unsigned cookie, no pepper, or a ticket that does not match this cookie and this event: refused, and nothing is written.
   5. The object's set is open, the object is open and before `closes_at`, and the set's pepper epoch is current.

   Then it writes one D1 batch:
   1. `INSERT OR IGNORE` the receipt.
   2. Raise the side counter only if that insert changed a row.
   3. `INSERT OR IGNORE` the participant.

   No queue and no KV.

5. **The answer** is the same bytes whether the vote was counted or a duplicate. It carries no count and no cookie. A refusal says only what the voter must do: "scan the code first", or "voting has closed".
6. **Logs** carry no object, side or event id. `OPERATION_COST` reports rows-written as null for this operation.
7. **The voter page** is a form-page kind, `GET /events/:id/vote`, on the host that served `/q`. It gets:
   - the nonce CSP and the lexicon scan;
   - one h1 and 44 px buttons;
   - the sponsor strip below the title and date.

   The OurWKRP room screen shows only a QR code that opens this page.

8. **Admin** routes live under `/api/v2/admin/events/:id/votables`:
   - brand-scoped by `guardAdminObjectScope`, and checked with `WHERE id = ? AND event_id = ?`;
   - create, list, open and close;
   - one set per event, and a closed set never reopens;
   - every change audited.
9. **Results.** Only the admin reads them, only after the event's end time and after the set closes, and they are computed once:
   - **R1.** A side's count goes through `applyCountFloor`, then `roundForPublish`. Under 5, it reads "Fewer than 5" in words, never 0.
   - **R2.** A winner is named only from published values. Three conditions must all hold:
     - the winner's and the runner-up's counts are both published;
     - the margin between them is at least 5;
     - at least 10 distinct voters voted in the set.

     Otherwise the result reads "too close to call" and the champion keeps the belt.

   - **R3.** A team total is the sum of its published parts. It is shown only when every part clears 5, and never beside a winner it could contradict.
   - **R4.** Distinct voters are published through `roundForPublish` only. There is no rate and no denominator from FORMS_DB, unless the owner keeps the OSE-520 rate (D12).
   - **R5.** Banned: a net score, up plus down, percent up, a votes-to-scans ratio, any list sorted by tally, and any count before the event's end.
   - **R6.** A two-way choice publishes both sides or neither.
10. **The display** shows no tally, no margin and no voter count. Vote objects are never added to the event answer the TV reads.
11. **Gates**, each seen failing on a named fault:
    - the timestamp gate's scan-shaped rule gains `vote|tally|ballot|receipt|participant`;
    - a new `votes-never-who` L0 invariant;
    - a named list of the files that may read `ose_anon`;
    - the display gate gains vote words, and so does `COUNT_WORDS`;
    - the vote handler joins the list of files that never touch FORMS_DB.

    All of them are listed in the T0 invariants step.

12. **The caller address.** Any per-caller limit uses `CF-Connecting-IP` as a limit key only, never stored or logged, as `/q` does today. ADR-040 says so under invariant 3.

### Stories, one session each

- **S0. Spike on staging (no product code):** can 150 browsers behind one address mint `ose_anon` through `/q` within 20 seconds today? What must change in `/q`'s limits, or at the edge (OSE-1589), for a whole room to get presence? Output: a short note for ADR-040.
- **S1. The voting ADR.** ADR-040 records the shape above and the owner's answers to D1 to D12. No code.
- **S1g. The invariant 4 amendment**, only if D3 is yes. A governance change to AGENTS.md through its own 5-loop CCR, with a human gate after every loop.
- **S2. The vote tables and their gates:**
  - the migration, the `REQUIRED_DB_MIGRATION` bump and the ROLLBACK_PLAN entry;
  - the L0 and static gates in design v2 item 11;
  - the staging case: T1 shows the migration level, and T2 Bruno asserts that no vote field appears on the event answer.
  - No routes.
- **S3. Admin: a vote set and its objects:** the admin routes in item 8, `closes_at`, the audit, the kill switch, and the open-objects read for the voter page.
- **S4a. The vote route:** items 3 to 6, with workers-pool tests and the Bruno folder. Waits on S1 to S3, OSE-1496 signing, and the `/q` mint cap.
- **S4b. The voter page:** item 7 with its Playwright spec in T4. Waits on S4a.
- **S5. Results after the event:** item 9, for the admin only. The SharedReport stays in OSE-520.

**Proposed new tickets (none created):**

- N1: the OurWKRP to OSE song-object route.
- N2: a `/q` cookie-mint cap per caller (or as part of OSE-1496).
- N3: the CI/CD testing ticket for OSE-1193.
- N4: the staging load case, 150 voters behind one address.
- N5: widen the unrun-spec check to tests/ui and tests/playwright.

## What must be true before shipping

- The owner has ruled on D1 to D12 (see the Human gate), and ADR-040 is accepted.
- OSE-1496 signs `ose_anon`. `/q` caps cookie mints per caller, and S0 shows that a room behind one address still gets presence.
- Each story's tests were seen failing on the named fault, at both layers: the workers-pool layer and staging (Bruno in T2, Playwright in T3 or T4).
- A CI/CD testing ticket is attached to each story (STORY-FORMAT).
- Production stays inert: `VOTING_ENABLED` is off there and listed as an intended difference in `scripts/ci/env-parity.mjs`.

**Commit sequence:**

1. S0 and S1, and S1g if D3 is yes.
2. S2, then S3.
3. S4a, once OSE-1496 and N2 are merged.
4. S4b, then S5.

Each story merges on its own, and is Done only when T1 to T4 are green for its merge SHA.

## Verification after shipping

- **Staging, every run:**
  - fresh object ids;
  - 10 browsers mint cookies through `/q`, carry their tickets and vote;
  - a duplicate vote changes nothing;
  - the answer has no count and no `Set-Cookie`;
  - results stay withheld until the event's end, and after it, sides under 5 read "Fewer than 5".
- **Staging load:** 150 browsers behind one address scan and vote within 20 seconds, and every vote counts.
- **The display**, after votes, shows no vote word and no count.
- **Each merge SHA** has the four T1 to T4 jobs green.

## Risks accepted

None yet. These are proposed for the owner to accept in writing (D8, D9):

- **n-1 collusion (L3-01).** Five or more people who know their own votes can work out one other person's vote from any published result. This is the known limit of the floor everywhere in OSE, now applied to preference.
- **D1 Time Travel (L3-04).** For 30 days, the database's history can link a scan to a vote by the order of writes. Limit who holds D1 rights.
- **Many browsers, one person (L3-03).** Someone who scans with several browsers can vote several times.
- **Timing (L3-15).** A duplicate may answer faster than a counted vote.
- **Game rules (L3-05, L3-16).** "Too close to call" favours the defending champion, and team members may vote for their own songs.

## Human gate

Stopped at Loop 1 (Critical) and at every loop after it. The gap first appeared in Loop 1, in the Critical layer. These questions close it:

1. D1. Do votes live in OSE's anonymous database, aggregate-only, as you ruled on 2026-10-09, so that OW-73 sends voters to OSE instead of storing votes on OurWKRP?
2. D2. May the vote button live only on an OSE page (`/events/:id/vote`), with the OurWKRP room screen showing just a QR code to it?
3. D3. May `ose_anon` be read, never set, on exactly one new route (the vote), recorded as an amendment to invariant 4 through its own 5-loop CCR?
4. D4. May the OSE-520 winner rule change from "exact upvotes, songs under 5 included" to "only from published counts, with a margin of at least 5 and the runner-up published", using "Fewer than 5" in place of "held"?
5. D5. Should at least 10 distinct voters be needed, instead of 5, before any winner or per-object count is shown?
6. D6. Should OSE-1193 gate votes on its own vote set, with ADR-034 decision 4 refusing `competition` only until OSE-1193's vote route ships?
7. D7. Do you confirm that no tally, winner or voter count appears before the event's end, and no tally on the display, so that OSE-513 and OSE-518 are rewritten?
8. D8. Do you accept in writing the residual risks listed under "Risks accepted", or do you want added noise instead (which means the exact winner can no longer be shown)?
9. D9. Do you accept the game rules: own-team voting is allowed, and "too close to call, the champion retains"?
10. D10. Should OSE-1193 move out from under the post-launch container epic OSE-1192, take the refreshed text in its comment, and split into S0 to S5?
11. D11. Is one vote set per event, never reopened, acceptable for Fist of Five nights and for fairs?
12. D12. Should the OSE-520 participation rate (unique voters against the logged headcount) be dropped, leaving only a rounded count of distinct voters?
