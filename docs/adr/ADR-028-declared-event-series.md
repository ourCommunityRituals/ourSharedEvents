# ADR-028: A series an organizer declares

**Status:** Accepted. Owner decision 2026-11-12 (showcase plan, story S15); built in the change that
adds this file.
**Date:** 2026-11-13
**Deciders:** Owner (PO).
**Ticket:** OSE-2014
**Amends:** `docs/features/SHARED-REPORT-DATA-PIPELINE.md`, Q2 ("hybrid auto-suggest + admin
confirm"). No earlier ADR covered `event_series`; that design doc was its only record.

## Context

`event_series` (migration 0033) and `events.series_id` (0034) group a brand's events across time. A
`confirmed` series feeds the SharedReport's `headcount_trend` and the venue return rate.

**What the code did before this change** (`main` at `2cdaf5fd`):

- The only writer of `event_series` was the nightly detector (`detectEventSeriesClusters`,
  `lib/shared-report.ts`). It clusters a brand's events of the last 8 weeks by venue string, weekday
  and hour, and writes a `pending` row for a cluster of 3 or more.
- Q2 of the design doc promised an admin step: accept, reject or rename a suggestion. That step was
  never built. No route wrote `state`, and no route wrote `events.series_id`.
- So no series could become `confirmed` outside a test fixture, and the trend never had a series to
  read on a real event.
- The detector skips an event with no `location`. An online programme could never get a series.
- A new programme has no history, so it could not get one either.

**What the owner asked for** (2026-11-12): a frequency is "purposeful, scheduled". A programme's
occurrences are OSE events on a series the organizer declares up front. A trial can become a
programme: its past events join the series, and nothing about the past changes.

## Decision

**D1. An organizer declares a series, and it is `confirmed` at once.** A declared series states a
name, a cadence (`weekly`, `biweekly` or `monthly`), a weekday and an hour. Declaring is the
organizer's yes, which is all that confirming a suggestion ever meant. `detected_at` stays NULL on a
declared row; that is how the two origins are told apart (migration 0033 already said so).

**D2. The anchor is an event, not a venue.** `event_series.venue_id` has always held an event id.
A declared series puts the event it was declared on there. No venue is needed, so an online
programme works. The column keeps its name; renaming it is a migration with no behaviour to gain.

**D3. A series' brand is its anchor event's brand.** This is the owner ruling of 2026-10-01
(OSE-1421), unchanged. `event_series` gets no brand column. Every read and write of a series joins
to the anchor and binds the brand.

**D4. One address, under the event.** Every route is under `/api/v2/admin/events/:id/series`:

| Method and path         | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `GET …/series`          | The event's series, and the pending suggestions in its brand |
| `POST …/series`         | Declare a series anchored on this event; `event_ids` join it |
| `PUT …/series`          | Attach this event to a confirmed series of its brand         |
| `DELETE …/series`       | Detach this event                                            |
| `POST …/series/confirm` | Accept a detector suggestion; `event_ids` join it            |
| `POST …/series/reject`  | Turn a suggestion down, with a reason from a fixed list      |

The path event is brand-scoped by `guardAdminObjectScope` with no new code. The handler then holds
every id in the body (a series, other events) to that event's brand. That second half is a rule
about the data, so it binds a key actor too. A miss is 404, the same for "not yours" and "does not
exist".

**D5. Promoting a trial is declaring.** OSE does not store an event's intent (`trial`,
`programme`); ourWKRP does. So promotion is one call: declare on one of the tries and list the
earlier ones in `event_ids`. Where the detector already suggested the series, confirm it with the
same list.

**D6. Attaching writes one column.** `events.series_id`, and nothing else: not a date, not a count,
not `updated_at`. An event already on a series is never moved by a list; the request is refused
(409) and the organizer detaches it first.

**D7. A suggestion is a prompt, never a promotion.** Confirming attaches nothing by itself. The
organizer names the events.

**D8. A series holds nothing about a person.** Request bodies are an allowlist and an unknown field
is refused, not ignored. The response is built field by field. A rejection reason is one of four
fixed words. A name that is email-shaped or phone-shaped is refused.

**D9. Every write is audited** against the path event (`DECLARE_SERIES`, `ATTACH_SERIES_EVENT`,
`DETACH_SERIES_EVENT`, `CONFIRM_SERIES`, `REJECT_SERIES`), so the row carries the event's brand.

## Alternatives rejected

- **A brand column on `event_series`.** It would make the brand explicit. It would also be a
  second answer to "whose series is this" beside the anchor, and the two could disagree. The anchor
  rule is already enforced in the report reader and the detector.
- **Routes addressed by series id** (`/admin/series/:id`). Each would need its own scope guard and
  its own brand-matrix shape. Under the event, the existing guard covers them.
- **A promote route that finds the past tries itself.** OSE cannot tell a trial's tries from any
  other past event of the brand. Guessing would attach events the organizer did not mean.
- **Free-text rejection reason.** It is the one field where a person's name would most easily land.

## Consequences

- A programme can sit on a series from its first event, online or in person.
- The trend of a promoted trial starts from its first try.
- The detector does not suggest again what was declared at a venue: its lookup already skips a
  cluster that a `confirmed` row covers.
- `cadence` stays the three values the schema documents. ourWKRP's `daily-weekdays` and
  `as-announced` slots have no OSE cadence; a Monday-to-Thursday programme is four weekly series, or
  the owner adds a value later.
- `day_of_week` and `hour_of_day` on a declared row are what the organizer stated. On a detected row
  they come from `start_date` as stored. Nothing compares the two today.
- The public event response does not carry `series_id`. A reader outside admin cannot yet see that
  an event sits on a series.
- There is no admin screen for this yet; the routes are the whole surface.

## Enforcement

- Mock layer: `workers/oursharedevents/tests/event-series.spec.ts`. The three owner rules (another
  brand's event never joins; never a per-attendee field; promotion changes no past date or count)
  were each watched failing on an injected fault.
- Brand matrix: the six routes are in `tests/helpers/brand-matrix-routes.ts`, and the matrix
  snapshot now includes `event_series`.
- Staging: Bruno folder "18. Declared series (OSE-2014)", fixture
  `bruno/fixtures/declared-series-seed.sql`.
