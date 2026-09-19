# ADR-019 — Sponsor consent-traced rendering ("silence ≠ consent")

**Status:** Accepted — 2026-09-16 (ratified from banked draft per the CCR-PR567 5-loop assessment, finding M4; PO decision recorded).
**Supersedes:** the resolver-level "NULL-permissive by design" interpretation noted against migration 0068.
**Related:** OSE-1301 (sponsor consent-traced rendering), the Triangle brand motif (Sponsors corner), `docs/security/` never-who posture.

## Context

`sponsor_placement.sponsor_accepted` (migration 0068) records whether a sponsor
has accepted a placement. Until now the public resolver treated it as
**NULL-permissive**: `COALESCE(sp.sponsor_accepted, 1) = 1`, so a placement
rendered on every public surface unless the sponsor had _actively declined_
(`= 0`). A sponsor who had never responded (NULL) appeared anyway.

That contradicts two things we already assert:

1. **OSE-1301 / "silence ≠ consent."** A sponsor's non-response is not permission
   to put their name on a public poster, event page, or live screen.
2. **The `/sponsor` UI copy itself** — "Accepting shows your name on this event's
   page, poster, and live screen" — which promises that _accepting_ is the act
   that makes a sponsor appear.

The 5-loop full-team CCR (`.claude/outputs/CCR-PR567-5LOOP-FULLTEAM-ADVERSARIAL-2026-09-16.md`)
surfaced the drift as finding M4.

## Decision

Rendering is **asymmetric**:

- **Sponsor side — STRICT.** A placement renders on a public surface **only when
  `sponsor_accepted = 1`.** NULL (pending) and `0` (declined) both hide. The
  sponsor must accept — via the sponsor-home link — before appearing.
- **Organizer side — PERMISSIVE.** `COALESCE(sp.organizer_accepted, 1) = 1`
  stays: the organizer created the placement, so their silence _is_ consent;
  only an explicit organizer rejection (`0`) hides.

Applied at the three public resolver sites:
`src/lib/sponsor-resolver.ts` (Path-1 direct), `src/handlers/pages.ts`
(public event page sponsor strip), `src/handlers/sponsors.ts` (geo/h3 lookup).

The organizer's **own** admin view is unchanged — the admin sponsors card still
shows pending placements (`sponsor_accepted !== 0`) so the organizer can see who
has not yet answered.

## Consequences

- Pending and declined sponsors are invisible to attendees until the sponsor
  accepts. This is the intended consent-traced behavior; the `/sponsor` copy is
  now truthful.
- **Organizer flow — the sponsor self-accepts, always** (PO decision, CCR-PR567
  re-run item 6). When an organizer directly adds a sponsor (Path-1) or a covenant
  promotes one, the placement is born PENDING — `sponsor_accepted` is NULL (0068
  has no DEFAULT and the create INSERTs omit the column) — and does NOT render
  until the sponsor accepts via their sponsor-home link. The organizer's action is
  deliberately NOT a stand-in for the sponsor's consent (no auto-accept was added).
  **Launch implication:** organizers must mint + send the home-link and get
  sponsors to accept BEFORE posters print — a sponsor added last-minute will not
  appear until they accept. The admin sponsors card shows the pending state so the
  organizer can see who has not yet answered.
- **Backfill:** none required. Phase-1 infrastructure is not yet deployed and
  there is no production sponsor data; the change is data-migration-free. Any
  future pre-existing NULL placements simply become hidden-until-accept, which
  organizers resolve by sending the sponsor-home link.
- Born-red coverage: `tests/sponsor-lifecycle-acceptance.spec.ts` now asserts
  the strict-sponsor / permissive-organizer split; the shared `seedSplitSponsor`
  helper defaults `sponsor_accepted = 1` (a seeded sponsor that should _render_
  is an _accepted_ sponsor), with an override for pending/declined fixtures.
- **Path 2 (template + geo auto-match) is DEFERRED, not merely off.** It is
  dark-at-launch — gated behind the off-by-default `SPONSOR_GEO_MATCH_ENABLED`
  flag with a `brand_id` tenant fence — but that flag is a **marker on unfinished
  design, not a toggle to flip.** Path 2 is the sponsor face of the hyperlocal
  **matching network** — the same layer as the QR corridor funnel / Choice
  Network (see `ADR-INCENTIVE-SPINE` §5 and the brain note
  `project_choice_network`) — and it inherits that layer's unsolved core:
  **multi-sided explicit opt-in.**
  - Today Path 2 has only the _sponsor's_ opt-in (their `sponsor_event_types`
    subscription). There is **no event-side opt-in**: an organizer inherits
    template-matched sponsors as a side effect of choosing a `template_id` (a
    categorization, not a consent), and can only opt _out_ via the rejection
    clause. That is opt-out for the organizer — the asymmetry ADR-019 exists to
    close, applied to the Events corner.
  - **Precondition to ever enabling it:** a real event-side consent signal (e.g.
    an `events.accepts_geo_sponsors` opt-in the organizer sets) — NOT `template_id`
    as a consent proxy — so BOTH corners of the triangle actively say yes,
    mirroring the sponsor-accept requirement. The QR funnel is stricter still
    (three-sided: business, event, and the attendee who scans).
  - Until that consent model is designed (alongside the broader matching-network /
    QR-funnel work), Path 2 stays off. The `brand_id` fence and strict gate it
    carries are defense-in-depth for that future, not a sign it is ready.
