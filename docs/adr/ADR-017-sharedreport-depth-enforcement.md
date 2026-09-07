# ADR-017: Enforce SharedReport depth server-side, at exactly one point

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** Matthew Zdano (PO)

> This ADR was ratified on 2026-08-16 and referred to in code comments as
> "ADR-0001" before it had a file. OSE-815 gives it its real home and number;
> the code citations were reconciled to ADR-017 in the same change.

## Context

A SharedReport is assembled once and then read by several token classes — the
organizer (`bar_owner`), platform `admin`, an in-fleet `internal` batch consumer,
and the `sponsor` who received a signed share-link. Not every class is entitled
to every section: the corridor map and cross-event trend are the paid depth a
sponsor's tier buys (Invariant #5, tier equity — pricing governs *display depth*,
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
the `sponsor` role only.**

1. **One gate.** `filterReportByDepth()` is called in `handlers/shared-report-read.ts`
   after the report is built. It is the *only* place a section is withheld for
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
   fails closed at the handler auth boundary (OSE-577).
4. **The withheld sections are named, not hidden.** The response carries
   `upgrade: { locked_sections: string[], next_depth }` — a **descriptive,
   load-bearing** wire field stating exactly which next-rung sections exist but
   were withheld. A refusal is *printed, not promised*: the client renders the
   locked state solely from this field (OSE-817). `sponsor_class_breakdown` is
   class-level aggregate and is present at **every** depth (OSE-719) — the
   tier-neutral competitive-intel delivery chosen over field-stripping it.

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

**Rejected because:** it leaves `upgrade.locked_sections` *advisory* and makes a
too-generous payload err *unsafe for revenue*. The PO chose to bind gating
server-side and clean it up at the API so the contract is provable, not trusted.

### Alternative C: Filter at materialization / storage time

Store per-tier report variants.

**Rejected because:** it forks the pipeline and re-introduces the risk that a
lower tier gets a *different number*, not merely fewer sections — the exact
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
- A depth-capped sponsor calling the API directly still learns *which* sections
  exist (their names appear in `locked_sections`). This is accepted: it is
  commercial disclosure (a map exists at Mid), never per-competitor or attendee
  data (§5 still binds).

### Neutral

- Three tier vocabularies now coexist deliberately (`sponsors.tier` = display
  priority; flag tiers = feature presets; report depth = viewer sections).
  `lib/report-depth.ts` is the ONLY module where more than one may appear;
  `handlers/demo.ts` is the only translator of the fourth (demo slug). See
  `docs/features/REPORT-DEPTH.md`.

## Implementation Notes

- Code: `workers/oursharedevents/src/lib/report-depth.ts` (`resolveDepth`,
  `filterReportByDepth`, `DEPTH_SECTIONS`, `UpgradeHint`);
  `src/handlers/shared-report-read.ts` (the one call, sponsor-guarded).
- Client: `src/templates/shared-report.html` renders the printed refusal from
  `report.upgrade.locked_sections` (OSE-817).
- CI gate: `tests/shared-report-read.spec.ts` — enforcement-state test
  ("filterReportByDepth is WIRED in the single-read handler, sponsor-guarded"),
  T0 Gate `tests` shard; `tests/report-depth.spec.ts` — lib-level depth +
  next-rung-symmetry (OSE-817).
- PRs: #411 (OSE-816, wire the gate); #473 (OSE-817, print the refusal).

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
- If depth ever needs to vary a *value* (not merely presence) for a tier, that is
  an Invariant #5 change and must reopen this decision, not patch around it.
- If `unique_gatherings` / `sponsor_impressions` are renamed off the banned
  lexicon (OSE-815 §9 decision 2), the wire keys change and the contract table
  here and in the feature spec must move together.
