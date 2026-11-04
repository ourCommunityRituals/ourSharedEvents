# ADR-017: Enforce SharedReport depth server-side, at exactly one point

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** Matthew Zdano (PO)
**Amended:** 2026-11-04, the plan caps depth (see "Amendment" below; OSE-682, OSE-1562)

> This ADR was ratified on 2026-08-16 and referred to in code comments as
> "ADR-0001" before it had a file. OSE-815 gives it its real home and number;
> the code citations were reconciled to ADR-017 in the same change.

## Context

A SharedReport is assembled once and then read by several token classes — the
organizer (`bar_owner`), platform `admin`, an in-fleet `internal` batch consumer,
and the `sponsor` who received a signed share-link. Not every class is entitled
to every section: the corridor map and cross-event trend are the paid depth a
sponsor's tier buys (Invariant #5, tier equity — pricing governs _display depth_,
never data collection).

`lib/report-depth.ts` (OSE-459) implemented the depth filter `filterReportByDepth()`
— pure, fail-closed, well-reasoned — but **SR-25 removed the call from the read
handler** ("straight readout") and left a one-line comment saying the client
would enforce the exclusion instead. The result: on the wire, a `mid` sponsor
token still received `headcount_trend` (a Premium-only section); the browser hid
it, `curl` did not. On 2026-08-16 an adversarial review found the comment and
raised it as a live security hole. It was not a hole — no attendee data, no
competitor rows crossed the line (§5 scope isolation always bound server-side) —
but it was a **commercial** leak (paid sections delivered free) with **no written
contract** saying where enforcement was supposed to live.

Trigger: OSE-815 (specify the contract) and OSE-816 (wire the gate). Blocked-by
context: OSE-577 (batch/service-token class split), OSE-595 (sponsor-scope
isolation, rank-6).

## Decision

**Depth is enforced server-side, in the read handler, at exactly one point, for
the `sponsor` role only.** _(Amended 2026-11-04: also for any viewer the plan
caps below premium. See "Amendment" below.)_

1. **One gate.** `filterReportByDepth()` is called in `handlers/shared-report-read.ts`
   after the report is built. It is the _only_ place a section is withheld for
   depth. The corridor-map renderer never gates (it renders when H3 cells exist),
   and **the client never re-strips** — an under-entitled caller simply never
   receives the section in the payload.
2. **Filtering is by omission only.** No value is transformed, rounded, delayed,
   or degraded per tier. Same pipeline, same numbers, fewer sections. (Degradation
   would violate Invariant #5; omission does not.)
3. **Role, not endpoint, decides depth.** `resolveDepth()` keys off the token's
   class: `admin` / `bar_owner` / `internal` → `premium` (full; a depth claim on
   these is ignored, never honoured downward); `sponsor` caps at `mid` and
   **fails closed to `local`** on any invalid/garbage claim (never to the nearest
   valid value). The cross-product WKRP token never reaches `resolveDepth()` — it
   fails closed at the handler auth boundary (OSE-577). _(Amended 2026-11-04: the
   role's depth is then capped by the plan; see "Amendment" below.)_
4. **The withheld sections are named, not hidden.** The response carries
   `upgrade: { locked_sections: string[], next_depth }` — a **descriptive,
   load-bearing** wire field stating exactly which next-rung sections exist but
   were withheld. A refusal is _printed, not promised_: the client renders the
   locked state solely from this field (OSE-817). `sponsor_class_breakdown` is
   class-level aggregate and is present at **every** depth (OSE-719) — the
   tier-neutral competitive-intel delivery chosen over field-stripping it.

## Amendment 2026-11-04: the plan caps depth (OSE-682, OSE-1562)

**Why.** The PO ruled on 2026-08-10 (OSE-682) that _everyone gets a
SharedReport_: Free is the honest smoke test, and the map is the first paid
line. OSE-1562 (plan per brand) states that report depth (this ADR) follows the
plan. The code had neither: on a plan without the paid report
(`analytics.shared-report` off, the Free preset) the report page answered 403,
and the read API served organizer and admin links at premium regardless of plan.
The PO restated the model on 2026-11-04: Local is the basic essentials, and paying
buys the deeper report.

**What changes in the Decision.**

- Decision 3 still resolves a role's depth as written. That depth is then capped
  by the plan: when the event's plan does not include the paid report, every
  signed-link viewer (`admin`, `bar_owner`, `sponsor`) reads at `local`.
  `capDepthToPlan()` in `lib/report-depth.ts` only lowers depth, never raises it,
  and never changes sponsor scoping (§5, TL-040, OSE-595).
- Decision 1 still holds: there is one gate. It runs for the `sponsor` role, as
  before, and for any viewer the plan capped below premium. The client still never
  re-strips; the capped organizer gets `upgrade.locked_sections` like a sponsor.
- The plan is read in the router, event override then global, and handed to the
  read handler as a lookup that runs only after the token checks out. The lookup
  fails **closed** (`isPaidReportEnabled`): an unreadable forms database reads as
  `local`, never as paid. The handler itself never reaches the forms database.
- The in-fleet `internal` batch read is not capped. It is a service class, not a
  customer view.
- Decision 2 (omission only) is unchanged: same numbers, fewer sections.

**Addendum, same day (owner decisions 2026-11-04): who × plan on every read.**
The same numbers also leave through admin reads and the internal batch read, and
what the front end hides does not matter if the back end returns it. So:

- The internal batch read is capped by plan too (Local on a Free event), through
  the same `capDepthToPlan` → `filterReportByDepth` gate. This narrows Decision
  3's "`internal` → premium" to "`internal` → premium on a paid plan".
- Admin reads (event dashboard, pre-event activity, poster deployments, the
  corridor dashboard) give a brand admin the Local line on a Free event: totals,
  with per-day, per-poster, per-placement and map data withheld and named in a
  `plan` block. A platform admin (scope `all` or an `ose-platform` member)
  sees everything, audited. These are not SharedReport sections, so they sit
  beside this ADR's one gate rather than in it; the rule and table live in
  `docs/features/REPORT-DEPTH.md` ("Who × plan on every read").
- The sponsor home prints totals only on every plan; a test locks it.

**Consequences.** The report page loads on every plan, and the auth boundary is
the report API (`/api/v2/events/:id/shared-report`), not the page shell; the
EX-003 red-team probes test it there. Until OSE-1562 makes the plan per brand, the
flag is one setting for the whole deployment.

## Alternatives Considered

### Alternative A: Client-side enforcement (the SR-25 status quo)

The API returns the full report; the browser hides sections above the viewer's
tier.

**Rejected because:** the wire is the real interface. Any non-browser client
(`curl`, a scraper, a second front-end) receives the paid sections. Two gates —
a server that under-fills and a client that hides — drift silently: a section
moved down a tier server-side stays hidden by a stale client list; a section
added up-tier renders an empty region instead of a lock. Untestable
dead-looking-but-not-dead code is the worst category.

### Alternative B: Accept the paywall as a UI convention and price accordingly

Treat depth as best-effort presentation and lean on the honest-numbers covenant
for everything that matters.

**Rejected because:** it leaves `upgrade.locked_sections` _advisory_ and makes a
too-generous payload err _unsafe for revenue_. The PO chose to bind gating
server-side and clean it up at the API so the contract is provable, not trusted.

### Alternative C: Filter at materialization / storage time

Store per-tier report variants.

**Rejected because:** it forks the pipeline and re-introduces the risk that a
lower tier gets a _different number_, not merely fewer sections — the exact
Invariant #5 violation omission-only avoids. Read-time filtering keeps one
materialization and guarantees identical values.

## Consequences

### Positive

- The wire is honest: a `curl` of a `local` sponsor token gets `local` depth. The
  gate is provable by a test that reads the emitted JSON, not the rendered DOM.
- One enforcement point → one place to audit, one place to test. The
  enforcement-state test fails if the wiring is removed.
- `upgrade.locked_sections` lets the client print an accurate, drift-free locked
  state with no client-side depth logic (OSE-817).

### Negative

- Ongoing discipline: nobody may add a second depth check — not in the renderer,
  not in the client. The rule has to be restated at each tempting site (and is,
  in `corridor-map.ts` and the signed-link template).
- A depth-capped sponsor calling the API directly still learns _which_ sections
  exist (their names appear in `locked_sections`). This is accepted: it is
  commercial disclosure (a map exists at Mid), never per-competitor or attendee
  data (§5 still binds).

### Neutral

- Three tier vocabularies now coexist deliberately (`sponsors.tier` = display
  priority; flag tiers = feature presets; report depth = viewer sections).
  `lib/report-depth.ts` is the ONLY module where more than one may appear;
  `handlers/demo.ts` is the only translator of the fourth (demo slug). See
  `docs/features/REPORT-DEPTH.md`.

## Enforced by invariants

Back-reference added per OSE-1291 / CCR finding F3 (ADR↔invariant traceability),
recorded in the OCR-docs brain `architectural-invariants.yaml`:

- **Invariant #5 — tier_equity.** This ADR enforces SharedReport depth
  server-side by tier; #5 is the invariant it names ("pricing governs _display
  depth_, never data collection"). A depth change that varied a _value_ per tier
  would be an Invariant #5 change (see Revisit Criteria below).

## Implementation Notes

- Code: `workers/oursharedevents/src/lib/report-depth.ts` (`resolveDepth`,
  `filterReportByDepth`, `DEPTH_SECTIONS`, `UpgradeHint`);
  `src/handlers/shared-report-read.ts` (the one call, sponsor-guarded, and since
  the 2026-11-04 amendment also run for a plan-capped viewer); `capDepthToPlan`
  in `lib/report-depth.ts`; `isPaidReportEnabled` in `lib/feature-flags.ts`.
- Client: `src/templates/shared-report.html` renders the printed refusal from
  `report.upgrade.locked_sections` (OSE-817).
- CI gate: `tests/shared-report-read.spec.ts` — enforcement-state test
  ("filterReportByDepth is WIRED in the single-read handler, sponsor-guarded"),
  T0 Gate `tests` shard; `tests/report-depth.spec.ts` — lib-level depth +
  next-rung-symmetry (OSE-817) and the plan cap; the OSE-682 blocks in
  `tests/shared-report-read.spec.ts` and `tests/shared-report-read-depth-wiring.spec.ts`;
  `tests/paid-report-plan-lookup.spec.ts` (the lookup fails closed); Bruno T2
  `GET Organizer Report on Free reads at Local` (staging).
- PRs: #411 (OSE-816, wire the gate); #473 (OSE-817, print the refusal); #1085
  (the plan caps depth, this ADR's 2026-11-04 amendment).

## References

- Linear: OSE-815 (this spec/decision record), OSE-816 (server-side enforcement),
  OSE-817 (client renders the refusal), OSE-577 (service-token class split),
  OSE-595 (sponsor-scope isolation), OSE-719 (class-breakdown at every depth),
  OSE-682 (map = paid value line), OSE-920 (the depth-enforcement goal).
- Prior ADRs: ADR-011 (SharedReport / WKRP consumer boundary), ADR-013 (local
  sponsor covenant display priority), ADR-016 (API v2 response contract).
- Feature spec: `docs/features/REPORT-DEPTH.md`.
- Invariant #5 (tier equity) — `CLAUDE.md` / brain invariant register.

## Revisit Criteria

- If a second non-browser consumer needs a per-tier variant that omission can't
  express, the read-time model needs revisiting.
- If depth ever needs to vary a _value_ (not merely presence) for a tier, that is
  an Invariant #5 change and must reopen this decision, not patch around it.
- If `distinct_scanners` / `sponsor_displays` are renamed off the banned
  lexicon (OSE-815 §9 decision 2), the wire keys change and the contract table
  here and in the feature spec must move together.
