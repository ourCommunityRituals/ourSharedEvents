# CCR: can the metrics be gamed or corrupted, and what makes the exchange fair?

Date: 2026-10-12. Five loops, extended scrum team plus Sr Data Scientist and Dr of Security, and the
extended business lens (Risk & Compliance, Product Strategist, FinOps, Launch/Customer Ops) in loop 4.
Protocol: `.claude/skills/ccr-protocol.md` (v3). The subject is a governance and compliance surface
(counts sold as proof to sponsors), so the protocol sets 5 loops and a human gate. Loops ran in order.

## Verdict

|                                  |                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **System score**                 | **8%** (92 points unresolved; fails the 95% bar)                                                                                                             |
| **Assessment confidence**        | **65%**: every finding is source-read or inferred. No swarm or abuse test was run against a deployed environment, and production holds no traffic to measure |
| **Security Critical unresolved** | none. The privacy floor, the per-person-column ban and the neighbour-dataset checks held                                                                     |
| **Gate**                         | **Do not present counts as proof to a paying sponsor yet.** Safe to collect and to show to the organizer as "scans recorded"                                 |

**One-line answer.** The numbers are hard to _leak_ and easy to _inflate_. The platform has strong
controls against revealing a person and weak ones against someone manufacturing, polluting or
mis-describing a count. A sponsor is told a number and not told what it is made of.

**What the design gets right** (verified, so it is not re-litigated): the floor holds against a brand's
own admin; the only writers of the counted tables are the scan buffer, the nightly materializer, the
short-link counter and the share counter, so no admin API edits a count; scan buckets use the server
clock; display beacons need a signed, expiring token and pass a bot, duplicate and flood filter; the
`sponsor_displays` table has no attendee column; sponsors render only on mutual consent; a sponsor's tier
buys depth, not a different number.

## The principle everything below hangs on

> **A published count may understate and may never overstate.**

Privacy rounds down (the floor). Honesty has to round down too. Today three behaviours break it:
repeats across hours add (B1), identity is a clearable cookie (G2), and a failed filter fails open
(G3). Every control in this document is a way of making that sentence enforceable, not asserted.

## Who can game it, and for what

| Actor                           | Wants                              | Cheapest attack today                                                               |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| **Organizer**                   | a bigger number to show sponsors   | scan their own posters; rehearse on the production event; script fresh browsers     |
| **Sponsor**                     | to look better, or to hurt a rival | flood display beacons for own placement across many IPs; collude with the organizer |
| **Attendee / bot**              | nothing, or sabotage               | link-preview robots; prefetchers; a scripted swarm                                  |
| **Platform operator / insider** | to fix a number, or to hide one    | write to the database directly; change a definition without telling anyone          |
| **Outsider**                    | to unmask a person                 | add controlled scans until a suppressed bucket clears the floor                     |
| **Competing sponsor**           | to dilute a rival                  | inflate own displays so a rival's share looks smaller                               |

## Loop 1: inventory and the obvious attacks

**Critical (most dangerous assumption).** That a recorded scan is a person at a poster at the event.
Checked against the ingestion path.

- **G1 (High 10) [source].** `handleQrScan` (`src/handlers/qr-scan.ts`) validates the token shape and
  that the poster deployment is active, and then counts. Nothing in the file or in the count limiter
  (`src/lib/public-read-limit.ts`) reads a bot signal, a prefetch header or the method. The display-beacon
  path has exactly that filter (`src/lib/invalid-traffic.ts`); the scan path does not. Separately, a
  deployment is deactivated only through its own handler, so an event that is archived, or one still in
  draft, keeps counting scans on its poster.
- **G2 (High 10) [source].** The identity is the `ose_anon` cookie, hashed to a keyed id. Clearing it, or
  opening a fresh private or headless context, mints a new identity, so each scan is a new person. The
  only bound is a per-caller rate limit, which a spread of addresses defeats.
- **G4 (High 10) [source].** `events.data_class` defaults to `production` and nothing in the events
  handler lets an organizer set another value. Rehearsals, test scans, demos and an organizer's own
  scans are production data by default. Only seed scripts set `synthetic` or `demo`.

**Conservative (worst case).** A sponsor pays on a number an organizer inflated with a script.
Nothing in the report distinguishes it.

**Recursive.** Score 100 − 30 = **70**. Confidence 70%.

## Loop 2: pressure, including the collusion and the window design

- **G5 (High 10) [source].** `distinct_scanners` sums each hour's distinct browsers, so a person seen in
  two hours counts twice (OSE-1706). This is the one existing overstatement in the design.
- **G6 (High 10) [source].** The report publishes a count and nothing about what it is made of: not the
  dedup mode, not how many scans were refused as invalid traffic, not whether the duplicate filter ran or
  fell open. A sponsor cannot tell a clean number from a degraded one. This is the core of the fair
  exchange: one side holds information the other needs to price the number.
- **G7 (Medium 5, pre-build) [inferred].** The window design (OSE-1706) is safe only if one resolution is
  published per event and every audience sees the same one. If depths or tokens can show different
  resolutions, an organizer and a sponsor who compare reports recover the withheld hour by subtraction
  (26 − 22 = 4). Not yet built, so it is a design risk, scored Medium.
- **G8 (Medium 5) [inferred].** _Poison to unmask._ A floor is a threshold, and a controlled addition
  moves a bucket across it: an attacker who adds four of their own scans learns that a suppressed bucket
  held at least one. K-anonymity thresholding does not defend against controlled additions. Per-caller
  contribution caps are the practical defence.

**Conservative.** A rival's displays are flooded and the sponsor's share looks wrong. The token and the
filter cover the single-source flood; a distributed one is bounded only by per-IP limits.

**Recursive.** Score 70 − (10 + 10 + 5 + 5) = **40**. The fall is the protocol working: loop 1 was
about counts, loop 2 about what a reader is told and how the window can be abused. Confidence 68%.

## Loop 3: the operator, provenance and time

- **G3 (Medium 5) [source].** Filters fail open by design: the scan dedup is "best-effort" if the
  key-value store is down, and the display filter counts everything on a storage fault. That is a
  defensible availability choice (the comments say a missed impression is not recoverable). But nothing
  marks the affected period, so an overstated hour looks like any other.
- **G10 (Medium 5) [source].** There is no tamper evidence on a published number. The audit log records
  API actions, not direct database edits, and a report is not sealed over its figures. Someone with
  database access can change an aggregate, and neither a sponsor nor the owner could prove it.
- **G11 (Medium 5) [source].** Definitions live in code and scattered docs. The snapshot has a version,
  but a report carries no methodology version, and this session changed a meaning (migration 0101:
  `total_scans` became browser-hours) with a PR note and nothing a sponsor holding an old report would
  see.
- **G12 (Medium 5) [inferred].** An organizer can edit an event's date and zone after scans exist.
  Aggregation reads every scan for events starting in the last 90 days with no scan-window snapshot, so a
  retroactive edit can move scans in or out of what the report calls the event.

**Conservative.** The owner themselves, under pressure, changes a definition. The system has no
structural friction for that, only the owner's own discipline.

**Recursive.** Score 40 − 20 = **20**. Confidence 66%.

## Loop 4: fair exchange (business lens)

Risk & Compliance, Product Strategist, FinOps and Launch/Customer Ops asked one question: what has each
party promised the others, and where is it written?

- **G14 (High 10) [source].** No binding statement exists of who warrants what. The organizer is not
  asked to warrant that counts are not self-inflated; the sponsor is not told that counts are floored and
  approximate; the platform's method is not published with a version; there is no dispute window, audit
  right or remedy. A number sold as proof with no written terms is the weakest part of the exchange.
  Whether any of it touches advertising-claim law is for the owner's counsel (human gate), not for this
  review to assert.
- **G15 (Low 2) [inferred].** A competing sponsor inflating displays only matters if displays feed back
  into allocation. They are an outcome today, not an input, but nothing holds that: a future change that
  weights rotation by performance would create a feedback loop that pays to cheat.

**Conservative.** A dispute arrives and there is no method document to cite, no version to point at and
no sealed record to show.

**Recursive.** Score 20 − (10 + 2) = **8**.

## Loop 5: confirmation, and what holds

Re-checked each finding against the file and looked for what was assumed.

- G1, G2, G4, G5, G6, G14 **re-confirmed**; G3, G10, G11 re-confirmed from comments and migrations.
- G7 and G12 stay **inferred**: G7 is a design not yet built, G12 needs a reading of the report path
  against an edited date and was not exercised.
- No finding withdrawn. One reclassified: the earlier CCR's B2 (the hourly floor may blank a small event)
  is closed by measurement and by the window design, and is not counted here.
- **What I could not test:** a distributed swarm, the display filter under a real botnet, and the
  behaviour of the dedup store during an outage. Those need the red-team harness against staging, and
  production has no traffic. Confidence is 65% for that reason.

**Recursive.** Score **8%**, confidence 65%.

## Findings register and arithmetic

| #   | Finding                                                                  | Wt       | Basis    | Closing control |
| --- | ------------------------------------------------------------------------ | -------- | -------- | --------------- |
| G1  | scan path has no bot, prefetch or event-state filter                     | High 10  | source   | I1              |
| G2  | identity is a clearable cookie; only a per-caller limit bounds inflation | High 10  | source   | I2              |
| G4  | every event is production data; no test or rehearsal class               | High 10  | source   | I3              |
| G5  | distinct count sums hours and overstates                                 | High 10  | source   | OSE-1706        |
| G6  | a count ships without what it is made of                                 | High 10  | source   | I4              |
| G14 | no binding terms, methodology, dispute or audit right                    | High 10  | source   | I8              |
| G3  | fail-open filters leave no mark on the hour                              | Medium 5 | source   | I2              |
| G7  | window resolution could be differenced across audiences                  | Medium 5 | inferred | I5              |
| G8  | controlled additions can unmask a suppressed bucket                      | Medium 5 | inferred | I2              |
| G10 | no tamper evidence on published figures                                  | Medium 5 | source   | I6              |
| G11 | no methodology version on a report; meaning changes unflagged            | Medium 5 | source   | I7              |
| G12 | event dates editable after scans exist; no scan-window snapshot          | Medium 5 | inferred | I9              |
| G15 | displays are not provably kept out of allocation                         | Low 2    | inferred | I10             |

Arithmetic: 6 × 10 + 6 × 5 + 2 = **92** → score **8**.

## The integrity charter: the binding structures

These are the governance pieces. Each has an owner, an artifact and a test, so none relies on goodwill.

| #   | Structure                                                                                                                                                                        | Binds                  | Artifact                                                            | Enforced by                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| C1  | **Never overstate.** A published count is at most the true number of distinct people; any doubt rounds down                                                                      | the platform           | `docs/metrics/METHODOLOGY.md` + a property test                     | CI: random event shapes, published ≤ true                      |
| C2  | **Say what it is made of.** Every report carries an integrity statement: methodology version, resolution, floor K, dedup mode, filters and the share they refused, quality flags | the platform → sponsor | `_meta.integrity` block, rendered on page and sponsor view          | contract snapshot + a render test                              |
| C3  | **Separation of powers.** The organizer cannot change a count; the sponsor cannot; the platform cannot do so silently                                                            | all three              | the only-writers invariant, a sealed ledger (I6)                    | the only-writers test; the seal verifier                       |
| C4  | **Provenance classes.** real, rehearsal, test, demo. Only real is shown to a sponsor                                                                                             | organizer              | organizer toggle; scans before go-live and after close are not real | I3 tests                                                       |
| C5  | **Change control for the definition.** A change to what a count means needs a ticket, a methodology version bump and a CCR at the loop count its class sets                      | the owner              | `METHODOLOGY.md` changelog                                          | CI: a change to the counting code fails without a version bump |
| C6  | **Dispute and audit.** A sponsor can ask for the aggregate, recompute it, and dispute within a stated window; the platform answers from the sealed record                        | all                    | the terms (I8); an export that recomputes                           | the recompute test                                             |
| C7  | **One resolution per event.** Fixed at first report, identical for every audience, coarsened only                                                                                | the platform           | the setting; the lock                                               | the differencing harness                                       |
| C8  | **Warranty from the organizer.** Counts are not self-generated; rehearsal uses the rehearsal class                                                                               | organizer              | the terms                                                           | provenance + anomaly flags                                     |

## Solutions by finding

| #                   | What to build                                                                                                                                                  | Tooling                                                 | Tests (born red first)                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **I1** (G1)         | Count only while the event is active or within a close grace; refuse bots, prefetchers and non-GET; tie poster deactivation to event status; record the reason | a shared `classifyScan` reusing the beacon filter       | a matrix: draft, ready, archived, HEAD, prefetch, known crawler, past grace each refused; a real phone counted |
| **I2** (G2, G3, G8) | A cap on new identities per source bucket per hour; a quality flag per hour when dedup or the filter degraded; a contribution cap per caller                   | KV counters; a `quality` column on the hourly aggregate | the swarm harness: many fresh contexts from few and from many sources; the outage case marks the hour          |
| **I3** (G4)         | An organizer-set class (real, rehearsal, test) and automatic rehearsal for scans before go-live                                                                | `events.data_class` writer; admin toggle                | a test event never reaches a sponsor report or a dashboard default                                             |
| **I4** (G6)         | The `_meta.integrity` block                                                                                                                                    | builder + template                                      | snapshot; render; a degraded hour shows "approximate"                                                          |
| **I5** (G7)         | The resolution lock, with the window count taken as distinct over the window (OSE-1706)                                                                        | setting + builder                                       | differencing harness across audiences, depths and tokens                                                       |
| **I6** (G10)        | An append-only aggregate ledger with a hash chain and a nightly verifier; reports quote the seal id                                                            | `aggregate_ledger` table; verifier job                  | a tampered row fails the chain; an unchanged chain passes                                                      |
| **I7** (G11)        | `METHODOLOGY.md`, a `methodology_version` in `_meta`, a CI gate on the counting modules                                                                        | docs + gate                                             | a change to a builder without a bump fails                                                                     |
| **I8** (G14)        | The exchange terms: obligations, guarantees and non-guarantees, a dispute window, a remedy                                                                     | owner and counsel                                       | reviewed, versioned, linked from every report                                                                  |
| **I9** (G12)        | Snapshot the scan window at the first report; refuse a date edit once scans exist, or re-bucket with an audit entry                                            | events handler                                          | edit after scans is refused or audited; the report does not shift                                              |
| **I10** (G15)       | An invariant that no rotation or allocation reads from displays or clicks                                                                                      | static test                                             | a planted read fails the gate                                                                                  |

## Order, and what depends on the owner

1. **Now, code only:** I4 (the integrity block), I1 (ingestion guard), I3 (provenance class), I10.
   These change nothing about what a person sees and make every later control possible.
2. **With the naming decision:** I5 together with OSE-1706 (window, one resolution, distinct over the window).
3. **Then:** I2 (identity velocity and quality flags), I6 (ledger and seal), I7 (methodology version gate), I9.
4. **Owner and counsel, in parallel from day one:** I8 and C8. The code controls are worth little
   without the terms that make them binding.

## Verification after shipping

- Property test: for a thousand random event shapes, published ≤ true distinct people.
- Swarm harness nightly against staging: injected inflation is refused or flagged, never counted clean.
- A sponsor can recompute a published figure from the exported aggregates and get the same number.
- The seal verifier is green; a deliberately edited row turns it red.

## Risks accepted until built

- Counts shown to the organizer only, as "scans recorded", until I1, I3 and I4 land.
- A distributed swarm is bounded by per-source limits only until I2; it can inflate, and with I4 it can
  at least be flagged.

## Human gate

1. **The principle.** Do you adopt "may understate, never overstate" as binding, with the property test as
   its gate (C1)?
2. **Who may set the data class.** The organizer (rehearsal toggle), or only the platform (C4)?
3. **The terms.** Who writes and who reviews the exchange terms (I8), and is counsel involved?
4. **Governance.** A counting change needs a methodology bump and a 5+ loop CCR (C5): do you accept that cost?
5. **Sponsor visibility.** Should a sponsor see the quality flags and the refused share (C2)? It makes the
   number honest and makes a degraded night visible.
