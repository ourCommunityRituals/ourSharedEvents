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
- **Backfill:** none required. Phase-1 infrastructure is not yet deployed and
  there is no production sponsor data; the change is data-migration-free. Any
  future pre-existing NULL placements simply become hidden-until-accept, which
  organizers resolve by sending the sponsor-home link.
- Born-red coverage: `tests/sponsor-lifecycle-acceptance.spec.ts` now asserts
  the strict-sponsor / permissive-organizer split; the shared `seedSplitSponsor`
  helper defaults `sponsor_accepted = 1` (a seeded sponsor that should _render_
  is an _accepted_ sponsor), with an override for pending/declined fixtures.
- Path 2 (template + geo auto-match) is unaffected here and remains
  dark-at-launch per OSE-1301; when it lands it inherits the same strict gate.
