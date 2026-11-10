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

## Amendment — 2026-09-30: sponsor-initiated placements (sponsor discovery, PR #700)

**Context.** The Decision above makes the organizer side permissive _because the organizer created the placement_. Sponsor discovery (`src/lib/sponsor-discovery.ts`) adds the first placement the organizer did **not** create: a sponsor, from its `/sponsor` page, asks to back one of its brand's published, upcoming events.

**Decision.** A sponsor-initiated placement is `source = 'sponsor_request'` and needs **both** sides' explicit yes before it renders anywhere:

| State                   | `sponsor_accepted` | `organizer_accepted` | `is_active` | Renders publicly |
| ----------------------- | ------------------ | -------------------- | ----------- | ---------------- |
| Sponsor asked (waiting) | 1                  | NULL                 | 0           | no               |
| Organizer approved      | 1                  | 1                    | 1           | yes              |
| Organizer declined      | 1                  | 0                    | 0           | no               |

- **Two independent locks.** A request is born `is_active = 0`, and the public resolvers read `COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1`. For organizer-created placements that is exactly the original permissive rule; for requests, NULL means **no**. A future writer that flips `is_active` alone still cannot publish a request. Applied at the same public readers as the original decision (`sponsor-resolver.ts` Path 1, `pages.ts` sponsor strip, `sponsors.ts` impression/click gate, `sponsor-asset-route.ts`). Writers of `sponsor_placement.is_active` are enumerated and reviewed by `tests/red-team/sponsor-promotion.spec.ts`.
- **Only the organizer approves.** `POST /api/v2/admin/sponsor-requests/:id/respond` (admin-gated, brand-scoped, JSON-only, audited). The organizer attaching that sponsor to that event through the sponsors card is also an approval, since it is the organizer's explicit act and the sponsor's yes is already recorded. An organizer may approve after an earlier decline; a decline cannot be applied to an approved placement (use Deactivate).
- **Scope.** The brand comes from the signed sponsor-home claim; a sponsor can only ask about its own brand's listed, active, upcoming events, which `/events` already lists publicly. Event fields reach the sponsor through the public event projection (`toPublicEvent`), so a location-precision policy (OSE-1245) applies there too.
- **Limits.** At most 5 waiting requests per sponsor, counted only on events still listed and upcoming (a stale request never locks a sponsor out), enforced inside the insert. The route is rate-limited at the router.
- **Path 2 (geo auto-match, still DEFERRED).** Its `NOT EXISTS (… organizer_accepted = 0 OR sponsor_accepted = 0 …)` means a **declined** request also suppresses template-matched rendering of that sponsor on that event, which is the intended reading. A **waiting** request does not; that is part of Path 2's existing event-side consent gap and must be closed with it before Path 2 is ever enabled.

**Consequences.** Organizers see requests in the Event checklist inbox ("N sponsors asked to join") and on the sponsors card (Approve / Decline). Sponsors see them under "Your requests" (waiting / the organizer said no). Coverage: `tests/sponsor-discovery.spec.ts` (including "not on any public surface until approved", verified red by making requests born switched on), `tests/playwright/sponsor-home-flow.spec.ts` (ask → approve → public, in a browser).

## Amendment, 2026-11-09: the event's own yes comes first (`useSponsors`, OSE-1900)

**Context.** Everything above is consent per placement: the sponsor accepted, and the organizer accepted. Nothing asked whether the event wanted sponsors at all. Sponsor discovery let a sponsor ask to back any listed event of its brand, including one whose organizer had never chosen to have sponsors, and the section above on Path 2 names the same gap ("there is no event-side opt-in"). Owner decision, 2026-11-09: sponsors show only if the event chose them.

**Decision.** Each event has a switch, `useSponsors`, in `events.settings_json` (`src/lib/event-settings.ts`). It is opt-in, so **absent means off**. That is the one exception to that module's "absent means on" rule, and only a stored JSON `true` turns it on. A placement shows when all three hold:

| The event opted in | The sponsor accepted | The organizer accepted (source-aware, as above) | Shows publicly |
| ------------------ | -------------------- | ----------------------------------------------- | -------------- |
| yes                | yes                  | yes                                             | yes            |
| no, or never set   | any                  | any                                             | no             |
| yes                | no, or not answered  | any                                             | no             |
| yes                | yes                  | no                                              | no             |

- **One gate.** `eventUsesSponsorsSql` and `PLACEMENT_EVENT_USES_SPONSORS_SQL` in `src/lib/sponsor-card.ts`, beside `PLACEMENT_ON_SHOW_SQL` and `SPONSOR_ON_SHOW_SQL`, which now include it. Every reader goes through it: the card line on the landing, `/events` and the list API (`fetchSponsorTitles`); the resolver behind the event API, the TV bundle and the poster (it returns nothing before either path runs); the event page strip; the public sponsor card; the logo and creative routes; the display and click beacons (nothing is recorded for an event that did not opt in); and sponsor discovery. `tests/sponsor-opt-in-readers.spec.ts` fails when a statement in `src/` carries the consent rule without the gate.
- **Discovery.** An event that has not opted in is not offered to a sponsor, and a request to it is refused with the same 404 as an event that does not exist. No row is written.
- **Off hides, it does not delete.** Turning the switch off hides every placement of the event on the next read. The placement rows and both sides' answers stay, so turning it back on restores what was agreed.
- **Who sets it.** The event's own admins, through the existing `PUT /api/v2/admin/events/:id` (`settings.useSponsors`, true or false only): the admin write guard, the brand scope (`guardAdminObjectScope`) and the audit log apply as to any admin write, and each write of the switch adds its own audit row, `EVENT_SPONSORS_SWITCH`, saying which way it went. No tier or plan is read (invariant 7).
- **Existing events.** Migration `0107` switches on the events whose organizer had already chosen a sponsor (a placement that is on and organizer-accepted under the rule above), so no sponsor disappears. Every other event, and every new one, starts off. A copy made with "Repeat this event" starts off as well, since it carries no placements.
- **Path 2 (geo auto-match, still DEFERRED and dark).** It now sits behind the same gate, so if it is ever lit it reaches only events that opted in. This is the event-side signal the section above asks for. It does not by itself make Path 2 ready: the sponsor's per-event yes is still missing there.

**Not decided here.** Whether an organizer adding a sponsor in the admin should turn the switch on by that act (today it does not: the sponsor is saved and stays hidden until the switch is on), and the admin wording. Both are listed for the owner on the pull request.

**Consequences.** A new event shows no sponsor anywhere until its organizer turns sponsors on and both sides accept a placement. Coverage: `tests/sponsor-opt-in-gate.spec.ts` (every reader, the pairwise consent matrix, discovery, the admin switch and its audit rows, the backfill), `tests/admin-sponsors-switch.spec.ts` (the control in the admin's sponsors card) and, on staging, the Bruno folder "16. Opt-in sponsors (OSE-1900)".
