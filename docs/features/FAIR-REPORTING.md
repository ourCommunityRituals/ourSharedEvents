# Fair Reporting

> **What a fair's organizer reads about its stalls, at what grain, and what is
> withheld.** A fair with no tickets has no headcount. Its stalls' scans are the
> number an organizer takes to funders, so every figure here is a sum of cells
> that each clear the floor, and nothing published can be subtracted back to a
> smaller group.
>
> Story: OSE-2004 (part of OSE-1996). Decision record:
> [OSE ADR-034](../adr/ADR-034-booths-sessions-and-participation-mode.md),
> items 6, 8 and 9. Code: `workers/oursharedevents/src/lib/booth-counts.ts`,
> `src/handlers/booth-counts.ts`. Words: `src/lib/withheld-words.ts`.

---

## The one rule

**A count of people or of their actions under 5 is withheld for every reader,
a brand's own admin included, and reads in words: "Fewer than 5".** Never 0,
never the number, never a blank (AGENTS.md invariant 2; the owner, 2026-11-14:
"Once an exception is introduced, this exception can be exploited").

On the wire a withheld count is `{ "count": null, "suppressed": true, "floor": 5 }`,
the shape `/stats` and the poster list already use. The admin page turns it into
words with `oseFewerThan` from `lib/withheld-words.ts`, with the tail "scans in
any hour", because a stall's figure is a sum of hourly cells: withheld means no
hour at any of its codes reached 5, not that the stall had fewer than 5 scans in
all.

## What one scan means

From ADR-034 item 8 and the scan path (`src/handlers/qr-scan.ts`):

- **One scan is one visitor at one stall code in one hour.** The scan path keeps
  one scan per visitor per code per hour. Two purchases by one visitor in that
  hour are one scan.
- **A stall with two codes** (a table card and a banner) can count one visitor
  twice in an hour, once per code. The stall's figure is a count of scans, not
  of distinct visitors.
- **The stall number means what the fair's process makes it mean.** Where the
  fair requires a scan before paying, the report says "scans before a purchase".
  Where scanning is invited and not required, it says "visitors who chose to
  scan". It never says "sales": a scan is not proof of a sale, and no price,
  basket or payment is stored here.
- **Which of the two applies is not stored yet** (ADR-034 open decision 7). The
  admin route below does not say which. The report that shows stall counts must
  say it once that choice is recorded.

## The cell every figure is built from

One placement (a code on a stall, or a poster anywhere) in one hour. A cell with
5 or more scans is at least 5 distinct visitors, because of the hourly dedupe.
A cell with fewer is withheld and joins no sum, on any route (`lib/scan-cells.ts`,
OSE-1656). A total over hours is not a count of people (one visitor scanning
once in each of 5 hours is 5 scans), so no figure is floored on its own total.

## The metric table

| Measure                     | What it counts, in plain words                                                           | Grain                      | Floor rule                                                                                             | Who may read it                                                                                                                          | When withheld it reads                      | Status                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| Scans at a stall            | Scans at the stall's codes, from the hours where one code drew 5 or more                 | Stall, over the whole fair | Sum of the stall's placement-hours with 5 or more (`floorTotalOfParts`); withheld when none clears     | Organizer on a paid plan; platform admin (audited). Vendor: not decided (ADR-034 open decision 4). Sponsor: not built. Public: not built | "Fewer than 5 scans in any hour"            | Built: `GET …/booths/counts`, `booths[].scans`                             |
| Scans with no stall         | Scans at the fair's codes that point at no stall (entrance posters, posters across town) | One bucket per fair        | The same rule, as one more part beside the stalls; never a remainder worked out by subtraction         | As above                                                                                                                                 | "Fewer than 5 scans in any hour"            | Built: `no_stall.scans`                                                    |
| Scans by category           | Scans at the stalls of one category (food, craft, art and so on)                         | Category                   | `floorTotalOfParts` over the category's published stall counts: a withheld stall never joins it        | As above                                                                                                                                 | "Fewer than 5 scans in any hour"            | Built: `categories[].scans`                                                |
| Scans at the fair           | Every published stall count and the "no stall" bucket, added                             | Fair                       | `floorTotalOfParts` over the published rows. Equals the event's scans on `/stats`, exactly             | Organizer on every plan (it is the `/stats` figure). Public recap: not built for fairs                                                   | "Fewer than 5 scans in any hour"            | Built: `total`                                                             |
| Any row withheld            | Whether at least one stall, or a "no stall" bucket that has codes, reads "Fewer than 5"  | Fair                       | A boolean, never how many; it is read off the published rows                                           | Organizer on a paid plan                                                                                                                 | Not a count                                 | Built: `any_withheld`                                                      |
| Scans per fair day          | Scans at every code of the fair on one local day                                         | Day                        | Sum of that day's placement-hours with 5 or more (`scansByLocalDay`)                                   | Organizer on a paid plan, on the existing 14-day series of the event's dashboard                                                         | "Fewer than 5 scans in any hour"            | Exists (not on this route)                                                 |
| Scans at a stall per day    | One stall on one day                                                                     | Stall × day                | Would be the same rule                                                                                 | Nobody                                                                                                                                   | Would read "Fewer than 5 scans in any hour" | Not built: the coarser cut only (see below)                                |
| Scans per hall section      | Stalls in one part of the hall                                                           | Hall section               | Would be `floorTotalOfParts` over published stalls                                                     | Not decided                                                                                                                              | "Fewer than 5 scans in any hour"            | Not built: a stall has a spot on the plan (`hall_x`, `hall_y`), no section |
| Scans for a team of stalls  | Stalls entered together (competition mode)                                               | Team                       | Would be `floorTotalOfParts` over published stalls; a margin under 5 between two teams is not a number | Not decided                                                                                                                              | "Fewer than 5 scans in any hour"            | Not built yet (waits on OSE-2000 and the voting work, OSE-513)             |
| Sign-ups for a session      | People who signed up for one talk or workshop                                            | Session                    | `applyCountFloor` on the session's sign-ups; never added to the stalls' total (ADR-034 item 9)         | Not decided                                                                                                                              | "Fewer than 5"                              | Not built yet (waits on ADR-034 open decision 2)                           |
| Draw of each part of a hall | Gathering mode: where visitors went, with no rank                                        | Hall section               | As "per hall section"                                                                                  | Not decided                                                                                                                              | "Fewer than 5 scans in any hour"            | Not built yet (waits on OSE-2000)                                          |

**The hall display shows none of these.** Counts are post-event; the displays at
the fair carry no number (AGENTS.md invariant 5).

**No stall row leaves for BigQuery.** The export row guard
(`lib/export-geography.ts`) refuses a stall's id, number, name or hall spot, and
no exporter reads `event_booths` (`tests/booth-export-boundary.spec.ts`). A
stall-level row leaves only if the acceptance contract (OCR-154) names it.

## The admin route

`GET /api/v2/admin/events/:id/booths/counts` (brand-scoped by the event in the
path; another brand's admin gets the unknown-event 404).

```json
{
  "ok": true,
  "status": 200,
  "event_id": "evt_…",
  "booths": [
    {
      "id": "booth_…",
      "number": "A1",
      "name": "Hilltop Honey",
      "category": "food",
      "is_active": true,
      "scans": { "count": null, "suppressed": true, "floor": 5 }
    }
  ],
  "categories": [
    { "category": "food", "booths": 2, "scans": { "count": null, "suppressed": true, "floor": 5 } }
  ],
  "no_stall": { "placements": 2, "scans": { "count": 11, "suppressed": false, "floor": 5 } },
  "total": { "count": 18, "suppressed": false, "floor": 5 },
  "any_withheld": true
}
```

- Stalls come in the organizer's order (in use first, then sort, number, id), and
  categories in the catalog's order. **No list is ever sorted by a count**: a
  list sorted by raw scans would rank the withheld stalls against each other.
- A stall out of use stays on the list (`is_active: false`); its past scans still
  count.
- **On a plan without the paid report** a brand admin gets the stalls and the fair
  total only, and a `plan` block names what was left out (`booths.scans`,
  `categories.scans`, `no_stall.scans`, `any_withheld`). A stall's count is
  poster attribution at a coarser grain, so it follows the poster list (OSE-682).
  A platform admin reads it all, and that read is audited (`READ_PAST_PLAN`).

## What each surface shows

Stall A1 has two codes: the table card drew 4 scans at 10:00 and the banner 3 at
11:00 (7 in all, never 5 at one code in one hour). Stall A2 has one code that
drew 7 at 10:00.

| Surface                                     | Stall A1 (4 + 3)                                                                   | Stall A2 (7 in one hour)  |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| `…/booths/counts`, the stall                | "Fewer than 5 scans in any hour"                                                   | 7                         |
| `…/booths/counts`, its category             | Adds nothing                                                                       | Adds 7                    |
| `…/booths/counts`, the fair total           | Adds nothing                                                                       | Adds 7                    |
| `…/poster-deployments`, per code            | Table card and banner each "Fewer than 5 scans in any hour"                        | 7                         |
| `…/stats`, the event's scans                | Adds nothing                                                                       | Adds 7                    |
| Event dashboard, pre-event card, day series | Adds nothing                                                                       | Adds 7 to its day         |
| SharedReport poster attribution             | Its codes are left off the list (ADR-034 item 6 asks for "Fewer than 5" there too) | Its code is listed with 7 |

If the 4 and the 3 fell in the same hour, they are still two cells (one per
code), and A1 still reads withheld. The 7 that A1 drew is not published anywhere,
and no sum of published figures holds it.

## Why nothing can be differenced back

**Claim.** On the stall route, `/stats`, the poster list, the pre-event card and
the dashboards, every published scan figure is a sum of placement-hour cells that
each hold 5 or more. So every published figure is a function of the cleared cells
(and of the organizer's own structure: which stalls and codes exist). Change any
cell that stays under the floor, by any amount, and nothing published moves.

**Consequence.** Take any arithmetic over published figures: a difference of two,
of two subsets, the fair total minus the list. Its value is the same whether a
withheld stall's true count is what it was or 0. So it can equal the stall's true
count only when it also gives that value with the stall at 0, which says nothing
about the stall. In particular:

- the fair total minus every published stall and "no stall" is always 0;
- each stall's figure equals the sum of its codes' figures on the poster list, so
  the two lists hold the same information and neither can be differenced against
  the other;
- the fair total equals `/stats` exactly.

**Why the stall cut and the per-code cut can both be published.** Both are sums of
the same cells. A stall is a set of codes, and its figure is exactly the sum of
its codes' published figures. A stall whose codes are each withheld reads withheld
however much they add up to.

**Why stall × day is not published.** It would be safe under the same argument,
since it is a sum of the same cells. It is left out because it would mostly read
"Fewer than 5" (193 of 360 stall-days in the example below), and a second cut of
the same stalls adds a list for an organizer to read against the first with no
gain. The coarser cut (the stall over the whole fair) is the one built.

## What is proved, and what is not

Proved, at the workers-pool layer against real D1 and the real router:

- `tests/booth-counts.property.spec.ts` (fast-check, `FC_RUNS`, 25 runs by
  default): for random fairs of up to 6 stalls (in and out of use, three
  categories), 7 codes (with and without a stall) and 4 hours of scans, read
  together on the stall route, `/stats` and the poster list: no published figure
  is 1 to 4; the total is the sum of the published rows, equals `/stats` and the
  poster list's sum, and each stall equals its codes; a withheld stall set to 0,
  or to other values under the floor, moves nothing on the three routes, and the
  set of every pairwise difference of published figures is the same; any one cell
  under the floor, changed under the floor, moves nothing.
- `tests/scan-counts-neighbour-floor.spec.ts`: the stall route joins the seven
  routes the neighbour harness already holds (the poster list, the pre-event card,
  `/stats`, the event, operations and corridor dashboards, and the sponsor's
  page). One scan more in a stall under the floor, or a second hour of 3 beside a
  4, moves none of them; one scan more in a cell of 7 moves every one.

Not proved, or not covered:

- **The general claim rests on reading the code**, not on the property alone: the
  property runs on small fairs. Every route above builds its scans from
  `lib/scan-cells.ts`, which groups by placement and hour.
- **Reads at two moments.** A cell that already holds 5 or more shows each new
  scan as a step of 1 between two reads. That is true of every scan figure today
  and is not new here. The rounding to steps of 5 (`roundForPublish`) is used for
  chains and running totals, not for scan figures.
- **A code moved between stalls** carries its cleared cells with it. Nothing
  withheld moves, but the organizer who moved it knows which code they moved.
- **One visitor can be two scans** at a stall with two codes in one hour (see
  above). Each cleared cell is still at least 5 distinct visitors.
- **What an organizer knows from outside** (a vendor's own till) is outside what
  any floor can guard.
- **Event delete.** `DELETE /api/v2/admin/events/:id` refuses an event that has
  any scan, return or sponsor display (`EVENT_HAS_ACTIVITY`). That tells an admin
  "none" from "some" for the whole event, a distinction the floor otherwise hides.
  It is a yes or no, not a count, and it is not new; it is listed for the owner.

## Worked example

A synthetic fair at the size of the reference fair: 120 stalls over 3 days, open
10:00 to 17:00. Nothing here is a real fair, vendor or person, and the
distribution is invented:

- 15 stalls in each of 8 categories; each stall has a table card, and every
  fourth stall a banner too; 4 entrance posters point at no stall.
- Each code's scans in an hour are Poisson with a mean of the stall's tier times
  the day's factor: 24 busy stalls (6 an hour), 60 steady (2.5), 36 quiet (0.8);
  a banner draws half its stall's mean; an entrance poster 4. The days' factors
  are 0.6, 1.3 and 1.0.
- The random source is fixed (mulberry32, seed 2004), so the numbers are the same
  on every run.

Each cell that clears the floor is rounded down to a multiple of 5 before it
joins any sum (owner ruling 2026-11-18, OSE-2151), so every figure below is a
multiple of 5 and the sums above still hold between the published figures.

The numbers come from the real code, and the test fails if this table and the
code disagree:

```
cd workers/oursharedevents
npx vitest run --config vitest.node.config.mts tests/fair-reporting-example.spec.ts
```

<!-- fair-example:begin -->

| Measure                                                   | Value      |
| --------------------------------------------------------- | ---------- |
| Codes (placements)                                        | 154        |
| Placement-hour cells                                      | 3234       |
| Cells with 5 or more scans                                | 537        |
| Scans made (raw, never published)                         | 7828       |
| Scans published (fair total)                              | 2950       |
| Share of scans published                                  | 38%        |
| Fair total equals /stats                                  | true       |
| Stalls reading "Fewer than 5"                             | 38 of 120  |
| Days reading "Fewer than 5"                               | 0 of 3     |
| Categories reading "Fewer than 5"                         | 0 of 8     |
| "No stall" (4 entrance posters)                           | 165        |
| Stall-days that would read "Fewer than 5" (not published) | 193 of 360 |

<!-- fair-example:end -->

What it shows:

- **About a third of the stalls read "Fewer than 5"** over three days: all 36
  quiet stalls and 2 of the 60 steady ones. None of their codes drew 5 scans in
  one hour, though a quiet stall still drew about 16 scans over the fair (its expected
  count; none is published).
- **Fewer than half the scans made are published.** The floor sits on the hour at
  one code, so a steady stall drawing 2 or 3 an hour publishes only the odd hour
  that reached 5. That is the price of "5 scans is 5 visitors". A floor on a stall's
  total over the fair would publish more, but a total over hours is not a count
  of distinct visitors, so it would not be a floor at all.
- **Days and categories all clear.** Pooling works where it should: a category or a
  day is many cells.

## Open questions for the owner

1. **Required or optional** (ADR-034 open decision 7): once chosen, the report
   says "scans before a purchase" or "visitors who chose to scan" beside every
   stall figure.
2. **A vendor's own count** (open decision 4): the floor has no exceptions either
   way; the question is whether a vendor gets a view at all.
3. **Fewer than half the scans published** at a fair this size: is that the number
   the owner wants funders to see, with the reason printed beside it?
4. **Event delete's yes or no** (above): keep, or answer the same 409 for every
   event that has ever been published?
