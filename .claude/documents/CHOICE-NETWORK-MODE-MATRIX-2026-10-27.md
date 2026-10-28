# Choice Network: mode-by-mode matrix

Draft for the owner, 2026-10-27; revised 2026-10-28 with the owner's answers. Direction: Matt. Nothing here is filed in Linear.

**Evidence base:** the OSE working tree at `c0910a43` on branch `admin-start-param`, the ourWKRP working tree, and the docs (OCR-docs invariants 1 and 26, `CHOICE-INVARIANTS.md`, ADR-002, ADR-010; OSE ADR-022), read by search and spot reads. The docs corroborate the owner's three answers. It is not `main`, and no CI run was read. "Built" means code exists that I read; it does not mean a green staging chain. Every row says what it rests on.

## The claim

The Choice Network is every combination of **sponsor, event and attendee**, across four ways an event happens. The infrastructure gives each party a choice, and gives the privacy-minded a way to take part while keeping nothing about who they are. Coverage, testing and reporting are how the organization sees that this is true, mode by mode.

## Owner answers (2026-10-28)

1. **Objects** are inanimate objects, such as the library book.
2. **Flags** ("plant your flag") are the OurWKRP (OW) arm of the choice infrastructure: a person uses one or many templates to say publicly "I am these things". A flag is not a map placement and not an organizer's poster placement.
3. **Online events** have a place: the online space itself. OCR is the conduit to the gathering.

**What the docs say about each (read 2026-10-28):**

- **Flags.** `CHOICE-INVARIANTS.md` calls the Identity Contract the one "where people plant their flag". OCR-docs invariant #26 (status `partial`) defines the "plant my flag, this is me" layer: born only from an affirmative act, never required to reach a public surface, revocable, composed on top of the anonymous base. ADR-002 names the OW contributor "who plants a flag" and puts identity behind an explicit opt-in.
- **Templates.** ADR-010 (OCR-docs) fixes six base templates: Worship, Arts, Sports, Academic, Volunteer, Hobbyist. They double as the base facets of a profile, and "a person is many of them at once, self-declared". That is the "one or many templates".
- **Online.** OSE ADR-022 §4: online traffic arrives by a `/s/` short link and is counted as a click, tagged with the area it was published into. Clicks and scans are reported side by side, never added. ADR-010 calls the platform "online, but rooted in a real place".

My first draft counted the organizer's poster placements as flags. That was wrong; they belong to mode 1.

## The choices, per actor

| Actor     | Their choice                                                                                                                             | Where it lives today                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Attendee  | Untracked, anonymous (counts only), or identified. Printed on every poster card. "Plant your flag" is the identified choice, made in OW. | `ConsentTier` and `tier_label`, `src/handlers/poster-bundle.ts`; forms are the only identity moment (`FORMS_DB`); OW `flag_facets` |
| Organizer | Pick sponsors, or none. Approve or decline a sponsor's request.                                                                          | `/api/v2/admin/sponsor-requests/:id/respond`; router header                                                                        |
| Sponsor   | Accept or decline a placement. Shows only when both sides accepted.                                                                      | `SPONSOR_ON_SHOW_SQL`, `src/lib/sponsor-card.ts` (invariant 6)                                                                     |

## The four modes, as the code defines them today

| #   | Mode                          | In code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Live with real people         | **In person** is derived: the event has `lat`/`lon` or a `venue`/`location`. `modalityOf`, `src/lib/landing-area.ts`. There is no modality column. Organizer poster placements (`placement_type` `venue` or `community`, migration 0082) belong here.                                                                                                                                                                                                                                                       |
| 2   | Online with people            | **Online** is derived: neither of the above. Same function. The place is the online space itself, which the code does not name; it shows "Online" as the venue.                                                                                                                                                                                                                                                                                                                                             |
| 3   | Live with objects (inanimate) | Not in code. No object-tracking table or handler (search of `src/` and `migrations/`, 2026-10-27). The idea is recorded in memory and, I believe, `docs/discovery/OSE_REFERENCE_posterPrimitiveReconciliation_2026-09-04.md` (not read).                                                                                                                                                                                                                                                                    |
| 4   | Flags (OW)                    | Partly, and in OW, not OSE. A signed-in contributor declares a `(domain, depth)` pair, one per domain: `flag_facets`, ourWKRP migration `0009_flag_facets.sql`; `POST /api/facets`, `DELETE /api/facets/:id`, `src/handlers/facets.ts`. Depth is `lifelong`, `hobbyist`, `dabbler` or `newcomer`; the domain is free text. **No link to the six base templates found** (the domain is free text). OSE surfaces already say "Anonymous or plant your flag." (spine `packages/ui/src/partials.ts`, OSE-1327). |

"Hybrid" in the landing filter is a present-but-inert pill (OSE-1520). The word "hybrid" in `poster-bundle.ts` and `shared-report.ts` means something else (a design brief and an event-series detector). Neither is the OSE/OW hybrid. OSE and OW are composed, never fused (ADR-009).

## Matrix 1: coverage (event × sponsor × attendee, per mode)

Status: **Built** (code read), **Partial**, **Not built**, **Unverified** (plausible, no evidence found).

| Mode                 | Organizer / event                                                                                                                                                         | Sponsor                                                                         | Attendee (privacy-minded path)                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Live, real people | **Built.** Events, poster with venue and community placements, display, live view, SharedReport.                                                                          | **Built.** Two-sided consent, impressions and clicks, requests, sponsor home.   | **Built.** Anonymous `/q` scan, share opens (`/e /p /r /c`), forms for the identified tier, tier named in words on the poster.                                                     |
| 2. Online, people    | **Partial.** The place is the online space; the code only knows "no geo, no venue". It lists, filters ("Where") and shows "Online" as venue, and does not name the space. | **Unverified.** Sponsor rules are surface-based; no test names an online event. | **Partial.** Short links and forms work by URL; OCR is the conduit (ADR-022: online traffic arrives by `/s/`). No online-specific attendee flow found.                             |
| 3. Live, objects     | **Not built.**                                                                                                                                                            | **Not built.**                                                                  | **Not built.** Designed to keep never-who (item scan equals a res-7 poster scan).                                                                                                  |
| 4. Flags (OW)        | **Not built.** None found; a flag describes a person, not an event.                                                                                                       | **Not built.** None found.                                                      | **Partial.** OW declares `(domain, depth)`, authed. The facets do not point at the six base templates. The hand-off from an anonymous OSE visitor to planting a flag was not read. |

## Matrix 2: testing (per mode, against the repo's two layers)

The contract: every case at the workers-pool mock layer and on staging (Bruno, Playwright); a gate counts only if CI names it, and only after it was watched failing. **I did not check which of these a workflow runs.**

| Mode          | Worker layer (named specs)                                                                                                                                   | Staging layer                                                                                           | Gap                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Live       | `poster-deployment-attribution-chain`, `poster-deployments-h3-tagging`, `poster-deployment-address`, `count-floor`, `shared-report-*`                        | Playwright `tests/e2e` 1-smoke, 2-pages, 3-flows (Public, Display, Poster, SharedReport); Bruno folders | Strong. Open count-floor gaps OSE-1656, OSE-1652.               |
| 2. Online     | `landing-area.spec.ts` (in-person with geo, in-person with a venue string, online with neither), `event-card-filter.spec.ts`                                 | Two Playwright files mention "online"; relevance not read                                               | No end-to-end online event: create, share, attend, report.      |
| 3. Objects    | None                                                                                                                                                         | None                                                                                                    | Nothing to test yet.                                            |
| 4. Flags (OW) | In ourWKRP: `facet-schema.test.ts`, `facets-flow.test.ts`, `facets-security.test.ts` (39 test or describe blocks by file match; unit, integration, security) | Not read for OW                                                                                         | No spec for templates, or for the hand-off from an OSE visitor. |

## Matrix 3: reporting (what the organization can say, per mode)

Standing rules for every mode: counts, never identities; a published count under 5 reads "Fewer than 5", for a brand's own admin too; physical places are H3 cells, never coordinates; the display shows no counts; the BigQuery export never carries `lat`, `lon`, `where_address` or `h3_res9`.

| Mode          | What can be reported                                                                                                                                                                        | What stays withheld                                                                                          | Open issue                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Live       | Scans by poster and by placement type, check-in counts, sponsor displays and clicks (the tables exist; I did not confirm each reaches SharedReport). Res-7 cells in dashboards.             | Anyone's identity; counts under 5; res-9 and coordinates.                                                    | OSE-1656: some counts an admin still reads exactly.                                                                                                               |
| 2. Online     | Click counts on the `/s/` short link, tagged with the area the link was published into (a res-7 cell), plus form counts. Clicks and scans are reported side by side, never added (ADR-022). | The same. Who joined the gathering, and anything inside the space.                                           | ADR-022 floors the onsite, offsite and online split per cell when shown. No code that shows the split was found, and the click-to-cell tagging was not confirmed. |
| 3. Objects    | Would be scans per object over its life, at res-7.                                                                                                                                          | Who held it.                                                                                                 | Not designed in code.                                                                                                                                             |
| 4. Flags (OW) | Not read for OW. A flag is a declaration the person chose to make.                                                                                                                          | OSE never learns it: forms are the only identity moment, and OSE and OW are composed, never fused (ADR-009). | Decide whether flag counts per domain are reported; if so, the floor applies.                                                                                     |

## What the organization can say today

1. **Live events** are covered end to end for the sponsor, the organizer and the attendee, and an attendee can stay anonymous or leave no trace at all.
2. **Online events** have a place, the online space itself, and OCR is the conduit to the gathering. The decision is that their traffic arrives by short link and counts by the area the link was published into (ADR-022). Today they are listed and shared; the report that shows that split was not found.
3. **Flags** exist in OurWKRP as a self-declared `(domain, depth)` pair that a person chooses to make, and the identity layer is opt-in and revocable (invariant 26, status partial). The six base templates are decided in ADR-010, but the facets do not point to them yet, and the hand-off from an anonymous visit is not built.
4. **Objects** (the library book) are direction, not product.

## Proposed next steps (none filed)

1. **Decide whether modality needs a column.** Derived from geo works for two values. It cannot say objects or name an online space.
2. **Online reporting.** Show the online split ADR-022 already decides: `/s/` clicks by publication area, floored per cell, beside scans and never added to them. Name the online space with an organizer-entered label (decided).
3. **Objects spike.** One program (the library book case), against the existing scan primitive.
4. **Flags: templates and the bridge.** Tie each OW facet's domain to exactly one of the six base templates (decided), and decide how "Anonymous or plant your flag" hands a visitor to OW without OSE learning who.
5. **A mode × layer test index, born red.** One page generated from spec names that fails CI when a mode loses a layer. A gate that cannot fail counts as absent.

## Decided by the owner, second round (2026-10-28)

The docs settled three of my earlier questions: a template is one of the six base families and a person holds many (ADR-010); a flag is public by the person's own act and revocable (invariant 26); online traffic is counted by publication area (ADR-022).

1. **An OW facet's domain is tied to exactly one base template** (a bocce league under Sports), as ADR-010 says event types are. Today the domain is free text, so this is a change to build.
2. **The online space is named by an organizer-entered label**, not the link's host. It is free text shown publicly, so it needs the same validation as other organizer text, and the meeting link itself must not be the label.

Nothing from the three questions is still open.

## Not verified

No CI or staging run was read. Counts of tests per mode were file matches, not coverage. The Bruno collection was not read for these modes. The Playwright "online" mentions were not opened. For OW, only the facets migration, the handler header and the test file names were read. The online split and the tagging of a `/s/` click with its publication area come from ADR-022 and AGENTS.md; I did not find the code that shows the split, and did not read the click handler. The docs were read in part (named sections), not end to end.
