# ADR-029: A campaign stays in its brand and is public only through a placement that is on show

**Status:** Proposed. Decision 1 is the owner's (2026-11-12). Decisions 2, 3 and 6 follow from rules
the owner already set. Decisions 4 and 5 are choices made while building and need the owner's yes
(see "Owner decisions needed"). It moves to Accepted when those are answered and the code is on
`main`.
**Date:** 2026-11-13
**Deciders:** Owner (PO). Dr of Security advises on the brand wall.
**Ticket:** OSE-1552 (testing ticket OSE-2021)

## Context

The owner decided on 2026-11-12 that a partner for a whole showcase station is an OSE campaign
across that station's events, and not a new "station sponsor" object (ourWKRP,
`.claude/outputs/SHOWCASE-next-increment-scope-2026-11-12.md`, section 5 and story S14).

What existed on `main` on 2026-11-13:

- the `campaigns` table (migration 0039): one brand, a title, a status;
- `sponsor_placement.campaign_id` (0067);
- the SharedReport's `campaign_summary`, read by joining a placement to its campaign;
- no route that created a campaign, and no public surface that named one.

Three rules already bind anything a sponsor touches, and a campaign is a sponsor's banner across
events, so they bind it too:

- two-sided consent (AGENTS.md invariant 6; ADR-019, `workers/oursharedevents/docs/ops/`);
- tenant isolation (invariant 9 in the brain; `lib/admin-object-scope.ts`);
- sponsors are never a filter (showcase plan, section 5).

While building, one older path was found that broke the brand rule. A sponsor's own sign-up draft
could carry a `campaign_id` taken from its request body (`handlers/sponsors-draft.ts`), and
promotion copied it onto the placement unchecked (`lib/sponsor-promotion.ts`). The SharedReport
then joined that id to `campaigns` with no brand match, so a brand's report could have named
another brand's campaign. No row of that kind is known to exist; the path is closed in the same
change.

## Decision

1. **A station partner is a campaign** (owner, 2026-11-12). There is one concept. A campaign is a
   title and a status in exactly one brand.
2. **The brand wall is in the statement, not only at the door.** Every statement that puts a
   campaign on a placement proves in its own SQL that the campaign is in the placement's event's
   brand. Every join to `campaigns` is on a brand match. The by-id admin routes also sit under
   `guardAdminObjectScope`, so another brand's campaign reads exactly like one that does not exist.
   The automation key is held to the same rule: it may act in any brand, never across two.
3. **A campaign is public only through a placement that is on show.** The one public read is
   `readShownPlacementCampaigns` (`lib/campaigns.ts`), under `PLACEMENT_ON_SHOW_SQL`: the event
   opted in, the sponsor accepted, the organizer accepted. It hands out an `id` and a `title` and
   nothing else. It is carried on the sponsor inside `GET /api/v2/events/:id/sponsor-bundle`; the
   public event projection does not change.
4. **Only an active campaign is announced.** A paused or completed campaign is not named in public.
   Its sponsor still shows. _Needs the owner's yes._
5. **A campaign takes a title and a status, and nothing else, at create.** Any other field is
   refused, so no caller is left believing it was saved. _Needs the owner's yes._
6. **A campaign title is never a filter, a search key or a sort key**, in admin or in public. Lists
   are ordered by creation time.

No tier or plan is read by any of this (invariant 7).

## Alternatives Considered

### A separate "station sponsor" object in ourWKRP

**Rejected because:** the owner ruled it out. It would be a second consent path beside OSE's, and
ourWKRP would store which sponsor backs what.

### The campaign as a list beside the sponsors in the bundle

`{ sponsors: [...], campaigns: [{ id, title, sponsor_ids }] }`.

**Rejected because:** a list can name a campaign whose sponsors are all hidden. Carrying the
campaign on a sponsor the bundle already shows makes "no campaign without an on-show placement"
true by construction.

### Trust the route guard alone for the brand wall

**Rejected because:** the guard is skipped for the automation scope, and the sign-up path never
passed through it. A rule that lives in each write and each join cannot be walked around by a new
caller.

### Show a paused campaign

**Not chosen, pending the owner:** "paused" most plainly means "stop announcing this". Showing it
would make the status do nothing in public.

## Owner decisions needed

- **D4.** Is a paused or completed campaign hidden in public (as built), or shown?
- **D5.** Is a campaign only a title and a status for now (as built)? The table has a `description`
  column that no route writes.
- **D7. A conflict with ADR-022.** ADR-022 (Proposed) describes `/events?sponsor=<sponsor>` as an
  optional filter. The showcase plan, and this story's brief, say a sponsor is never a filter. No
  code reads a `sponsor` parameter today. One of the two documents has to change; this ADR does not
  choose.

## Consequences

### Positive

- ourWKRP can show a station's partner from the public bundle alone and stores nothing about
  sponsors.
- A new writer of `campaign_id`, or a new join to `campaigns`, fails CI unless it carries the brand
  match (`tests/e2e/0-architecture/campaign-brand-and-consent.invariant.spec.ts`).
- The sign-up path can no longer attach another brand's campaign, and the SharedReport can no
  longer name one.

### Negative

- One more D1 read on each public sponsor-bundle request.
- A sign-up that names a campaign outside its brand is promoted with no campaign and no error. The
  sponsor is not told.
- A placement has one campaign. A sponsor in two campaigns at one event is not expressible.

## Invariants touched, and how each holds

| Invariant                                | How it holds                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 6, sponsors need two-sided consent       | The public read is under `PLACEMENT_ON_SHOW_SQL`; a campaign rides only on a sponsor the bundle already shows. |
| 9 (brain), tenant isolation              | Brand match in every write and join; `campaigns` is now in the tenant-table scan; object-scope guard on by-id. |
| 7, security is never tier-gated          | No tier or plan is read. A worker spec fails if the campaign code names one.                                   |
| 1 and 2, never who and the under-5 floor | No count is published by any of this. `campaign_summary` keeps its floors; only its join changed.              |
| 21 (brain), SharedReport schema          | Field names and types are unchanged. `campaign_id` is now null when the campaign is not in the event's brand.  |

## Implementation Notes

- Routes: the header of `workers/oursharedevents/src/router.ts`. Contract for consumers:
  `docs/features/CAMPAIGNS.md`.
- Tests: `tests/campaigns.spec.ts` and the brand matrix (workers pool);
  `tests/campaign-never-a-filter.spec.ts` (static); the T0 invariant named above;
  `bruno/ose-api/18. Campaigns (S14)` with `bruno/fixtures/campaigns-seed.sql` (staging).
- Not built here, and still owned by OSE-1552: rename, a status change after create, the
  event-to-campaign link, the campaign SharedReport.

## The shared brain (OCR-docs), read on 2026-11-13 at `0716b6b`

- **Two-sided consent is not an invariant in the brain.** It appears only inside invariant 2's
  description of a structural gate, and that text still says "an unanswered placement must NOT
  hide — COALESCE(...accepted, 1) = 1". Since ADR-019 the sponsor side is strict
  (`sponsor_accepted = 1`), and the gate itself asserts the strict rule. The brain's wording is
  behind the code.
- **"Sponsors are never a filter" is in neither the brain nor AGENTS.md.** It lives in the showcase
  plan. See D7.
- **Invariant 9** does not list its tenant tables; OSE's scan does, and `campaigns` was missing
  from it until this change.
- **Invariant 19** already names `campaigns` as a table no migration may drop. **Invariant 21**
  already locks the campaign fields of the SharedReport.

Nothing in the brain was changed. These are proposals for its owner.

## References

- ourWKRP `.claude/outputs/SHOWCASE-next-increment-scope-2026-11-12.md`, section 5 and S14
- ADR-019 (`workers/oursharedevents/docs/ops/ADR-019-sponsor-consent-traced-rendering.md`)
- ADR-022 (event is the base; the `sponsor` filter line)
- OSE-1080 (object-level brand scope), OSE-1554 (brand test matrix), OSE-1900 (opt-in sponsors)

## Revisit Criteria

- The owner answers D4, D5 or D7 differently from what is built.
- Events gain their own campaign link (OSE-1552, scope 1 and 4): decide which wins when a
  placement's campaign and its event's campaign differ.
- A sponsor needs to be in two campaigns at one event.
