# ADR-019: Sponsor rendering is consent-traced — silence is not consent

**Status:** Proposed (DRAFT — pending CCR verdict + human ratification; OSE-1301 is out of October scope per OSE-1312)
**Date:** 2026-09-13
**Deciders:** mzdan (PO) + Claude (Co-Architect); reconciliation ratified by mzdan 2026-09-13

## Context

A sponsor's name/logo renders across public surfaces (event page pre/live/recap, poster, display, shared report). Migrations 0067/0068 modeled the sponsor↔event relationship as `sponsor_placement` with **two-sided acceptance** columns (`organizer_accepted`, `sponsor_accepted`), but with a **permissive default**: `NULL` ("not answered") rendered, and only an explicit rejection (`0`) hid the placement (`COALESCE(sp.sponsor_accepted, 1) = 1`).

Observed on staging 2026-09-11 (trigger for **OSE-1301**): _"Free Test sponsor 1"_ rendered on poster, display, and report with **no sponsor party having agreed to anything** — an organiser _asserting_ a relationship, not a relationship. That is a **default-on** consent posture: the platform published a claim about a third party who never said yes.

This collided with a shipped contract. **OSE-1298**'s structural invariant (`geo-resolution.structural.invariant.spec.ts`) _locked the permissive rule as a contract_ and would fail if `sponsor_accepted` flipped to a strict `= 1`. So closing the OSE-1301 gap required overturning a ratified invariant — a governance-weight decision, not a one-line change.

The governing principle (OSE-1301, "the second principle the architecture rests on"): **"Nothing appears about a party unless that party said yes. Silence never becomes consent."**

## Decision

**OSE-1301 supersedes OSE-1298 on sponsor-side semantics.** Sponsor rendering is consent-traced, with a **split default** that reflects the two distinct acts the two columns encode:

- **Organizer side stays permissive.** Creating the placement _is_ the organizer's pick (OSE-1301 leg 1). `COALESCE(sp.organizer_accepted, 1) = 1`; only an explicit organizer rejection (`0`) hides.
- **Sponsor side is strict.** The sponsor must confirm its own appearance (leg 3). `sp.sponsor_accepted = 1` — `NULL` (silence) does **not** render.

Realized as:

1. **Render flip** on every public direct-placement query — the public event page (`pages.ts`), the resolver Path 1 (`sponsor-resolver.ts`), **and the shared-report impressions→name join (`shared-report-builder.ts`)**. The report is the surface of the original incident: `handleLogImpression` is an unauthenticated POST, so without a confirmed-placement `EXISTS` predicate any sponsor with a logged impression leaked its name. (Added in CCR reactive correction 2026-09-13 — the first draft flipped only the event page + resolver and _over-claimed_ report coverage.)
2. **OSE-1298 invariant rewritten** (not deleted) to lock the _split_; its docstring reconciled to cite OSE-1301.
3. **New `sponsor-consent-trace.invariant.spec.ts`** — a property-asserting gate over all three public surfaces, run against **comment-stripped source** (so a "strict" assert cannot pass against docstring prose, and deleting the clause — not only reverting to COALESCE — turns it red), plus a negative control that **eradicates** `COALESCE(sponsor_accepted, 1)` from `src/`. Registered in the T0 `invariants` shard.
4. **Leg-3 confirmation write** — `POST /api/v2/admin/events/:eventId/sponsors/:sponsorId/confirm` sets `sponsor_accepted = 1`, the loopback that makes the strict gate usable. **Hardened** (CCR): brand-scoped via `isSponsorReachable` (no cross-brand confirm), `is_active` guard, a durable-rejection guard (confirming an explicit `0` returns **409**, never a silent flip), and the router audits on `response.ok`. Stateless + cookieless (never-who). **Admin-gated interim**; the sponsor-facing anonymous per-placement confirm-token is deferred (see Revisit).

Consent is intrinsic to one create path: a **`corridor_covenant` self-promotion** (`sponsor-promotion.ts`) — the sponsor promoting its OWN draft — materializes its Path-1 placement born `sponsor_accepted = 1`, so the strict gate does not hide a sponsor that just consented by the act of promoting.

**Explicit non-decisions (open):**

- **Path 2 (template/geo auto-match)** stays permissive (reject-only) to **PRESERVE invariant #2 (hyper-local geo-resolution) and the pool/pricing model** — the strict gate is Path-1-only. (An earlier CCR-loop attempt to make Path 2 strict was **reverted**: requiring a confirmed placement disabled the geo auto-match feature and broke invariant #2's acceptance suite. Consent for Path 2 must come from a design that carries consent _without_ breaking geo-resolution — a venue GRANT / pre-authorised standing rotation.) It renders on sponsor silence, a KNOWN exposure on the unauthenticated `/sponsors` + `/sponsor-bundle` endpoints, expected **dark at launch** (no `sponsor_event_types`), tracked as the OSE-1301 open question.
- **Confirm auth model.** OSE side is anonymous token (no login/cookies); the login+profile variant is the OW (ourWKRP) follow-on. The token primitive means "authorize anonymously" on OSE and "resolve to a logged-in profile" on OW.

## Alternatives Considered

### Alternative A: Keep the permissive default (reject OSE-1301's strict reading)

Leave `COALESCE(sp.sponsor_accepted, 1) = 1`; treat silence as consent.
**Rejected because:** it is a default-on consent posture — the platform publishes claims about parties who never agreed. It contradicts OSE-1301 as ratified and leaves the observed "Free Test sponsor 1" leak in place.

### Alternative B: Make BOTH sides strict

Require explicit `organizer_accepted = 1` and `sponsor_accepted = 1`.
**Rejected because:** the organizer already asserts the relationship by _creating_ the placement; requiring a second organizer confirmation is redundant friction and conflicts with leg 1 ("the event owns its sponsors — the organiser picks"). The split is the faithful reading.

### Alternative C: Delete OSE-1298's invariant entirely

Let the new `sponsor-consent-trace` gate absorb its role.
**Rejected because:** OSE-1298 also locks the resolver's geo/lifecycle/dedup shape, which remains valid. Deleting it would drop that protection. Rewriting only its acceptance clause preserves the regression guard while aligning it to the new principle.

### Alternative D: Also make Path 2 strict now

Require confirmation for template/geo auto-matched sponsors too.
**Deferred, not rejected:** auto-matched sponsors have no per-event placement row to confirm, so strict-Path-2 effectively disables the standing-rotation feature. That is a genuine product decision (the epic's own open question) and belongs to a dedicated ruling, not this ADR.

## Consequences

### Positive

- The observed cross-party leak ("Free Test sponsor 1" with no agreement) is closed on the direct-placement path.
- The consent posture is now **structural** — a property-asserting invariant eradicates the permissive pattern from `src/`, so it cannot silently return in a new handler.
- The confirmation write completes the loop end-to-end (organizer picks → sponsor confirms → renders), born-red verified.

### Negative

- **Overturns a shipped invariant (OSE-1298).** Requires the rewrite to stay in lockstep and the shared brain (`architectural-invariants.yaml`) to be updated, or CI/brain drift.
- **Legacy hides.** Any existing placement with `NULL sponsor_accepted` stops rendering. Pre-launch this is only test/demo data (desirable); a real confirmed sponsor would need a one-time `sponsor_accepted = 1` backfill.
- **Confirm endpoint is interim** (admin-gated). Until the sponsor-facing token lands, only an admin can confirm — the true leg-3 sponsor experience is not yet shipped.

### Neutral

- **Path 2 remains a known permissive gap**, honestly named in the invariant. The consent guarantee is currently "no _directly-placed_ sponsor renders without confirmation," not a total guarantee — a state recorded rather than hidden.
- Ongoing discipline: the split (`COALESCE` organizer, strict sponsor) must be preserved in any future sponsor query; the invariant enforces this.

## Implementation Notes

- **Code:** `workers/oursharedevents/src/handlers/pages.ts` (public query), `workers/oursharedevents/src/lib/sponsor-resolver.ts` (Path 1 + docstring), `workers/oursharedevents/src/handlers/sponsors.ts` (`handleConfirmSponsorPlacement`), `workers/oursharedevents/src/router.ts` (confirm route)
- **CI gates:** `tests/e2e/0-architecture/sponsor-consent-trace.invariant.spec.ts` (new), `tests/e2e/0-architecture/geo-resolution.structural.invariant.spec.ts` (rewritten) — both in the T0 `invariants` shard
- **Behavioral born-red:** `workers/oursharedevents/tests/sponsor-lifecycle-acceptance.spec.ts`
- **Brain invariant:** propagation to `OCR-docs/ocr-docs-brain/architectural-invariants.yaml` — **PENDING** (behind the human gate)
- **Branch:** `ose-1301-sponsor-consent-trace` (commit `b18cb0e`) — banked, **unmerged**

## References

- Linear: **OSE-1301** (epic — consent-traced placement and sponsorship), **OSE-1298** (geo-resolution structural invariant, superseded on sponsor semantics), **OSE-1312** (landing-page — declares OSE-1301 out of October scope)
- Prior ADRs: **ADR-013** (local sponsor covenant), **ADR-015** (tier-sort / named-slot retirement) — the sponsor-placement lineage
- Doctrine memory: `project_never_who_only_how_many`, `project_no_cookies_geo_surface_only`, `project_ose_token_anon_ow_login_profile`

## Revisit Criteria

- **When Path 2 is decided** — resolve the "standing-rotation = default-on?" question; update the named exemption in the invariant accordingly.
- **When the sponsor-facing confirm token ships** — replace the admin-gated interim with the anonymous per-placement `confirm_token` (needs a migration); this ADR's "interim" note is retired.
- **When the OW login+profile variant lands** — document how the same token primitive resolves to an identified profile on OW vs anonymously on OSE.
- **If real (non-test) sponsors exist at cutover** — a backfill decision for legacy `NULL sponsor_accepted` rows is required before this renders in production.
