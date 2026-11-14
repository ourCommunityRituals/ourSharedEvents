# Brain loop-back: event series (OSE-2014, OSE-2017 to OSE-2020)

**Date:** 2026-11-13. **Brain read:** `OCR-docs` `main` at `0716b6b`, `ocr-docs-brain/`.
**Code read:** this branch. **Scope:** what the series work touches in the shared brain, where the
brain and the code now differ, and what to propose. This file proposes; it changes nothing in
OCR-docs.

## 1. Result of the brain's own check

`check_brain_contract.py --product-id ose` against this branch: **7 pass, 0 fail, 1 gap**. The gap
(three invariant test files the brain lists as "in construction") is on `main` too and is not from
this work.

## 2. Brain invariants this work touches

| Brain invariant                  | What the series work does                                                                                                                                 | Gate that goes red                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1 anonymous id                   | A series holds a name and a schedule. No person field in the table, the bodies or the responses.                                                          | `event-series.invariant.spec.ts` rules 4 and 5; `event-series.spec.ts` "never a per-attendee field"                                      |
| 7 aggregate-only reporting       | The trend reads a declared series through the reader a detected one uses. No new count is published. The admin card and the public object carry no count. | `event-series.spec.ts` trend tests; `public-event-series.spec.ts`; `admin-series-card.spec.ts` "shows no count"                          |
| 9 tenant isolation               | A series' brand is its anchor event's brand. Every read and write binds it.                                                                               | `event-series.invariant.spec.ts` rule 1; brand matrix (six routes); `event-series.spec.ts` "another brand's event"                       |
| 14 mobile workability            | The admin card uses 44 px controls and 16 px fields from existing rules.                                                                                  | `admin-series-card.spec.ts`; the PR's mobile-workability job                                                                             |
| 16 API response schema stability | `series` is a sibling of `item` / `items`. The projection and snapshot are unchanged.                                                                     | `api-response-schema.invariant.spec.ts` (unchanged, still green); `public-event-series.spec.ts` "series_id is not a public event column" |
| 17 OER emission boundary         | No export code changed. See finding F3: an export that already existed now has rows to send.                                                              | `export-grain.invariant.spec.ts` (unchanged)                                                                                             |
| 19 migration monotonicity        | No migration. `event_series` stays on the load-bearing list.                                                                                              | `migration-monotonicity.invariant.spec.ts`                                                                                               |
| 21 SharedReport schema stability | `headcount_trend` shape unchanged.                                                                                                                        | `shared-report-schema.invariant.spec.ts`                                                                                                 |
| 24 auditability                  | Five new audit actions, each written against the event so the row carries its brand.                                                                      | `event-series.spec.ts` "every write is audited"                                                                                          |

## 3. Findings: where the brain and the code differ

**F1. Invariant 9 says every multi-tenant table has a brand column. `event_series` has none.**
The brain text: "Dual-key pattern (id + brandId) on every multi-tenant table." `event_series`
resolves its brand through its anchor event (owner ruling 2026-10-01, OSE-1421; kept by ADR-029
D3). `poster_deployments` does the same through its event. So the brain's wording is stricter than
two tables the code has had for months. The code is deliberate; the brain text is behind.
_Proposal:_ amend invariant 9 to read "has a brand column, or resolves its brand through exactly
one owning row that every query binds", and name the two tables and their gates.

**F2. Invariant 16 locks `items` and `item`. It does not lock the siblings.**
The snapshot's `envelope_keys` are `ok`, `status`, `items`. `sponsor_titles` (OSE-1522) and now
`series` sit beside them and are in no snapshot. ourWKRP will depend on `series`. Today a change
that drops it turns `public-event-series.spec.ts` red, but not the brain's invariant gate.
_Proposal:_ add the sibling keys to `public-events.snapshot.json` and one case to the invariant
spec. That is a change to a brain-registered gate, so it wants its own ticket and review.

**F3. An export that never had rows now does.**
`exportEventSeries` (`lib/shared-report-export.ts`) has always sent `confirmed` series to the
BigQuery table `event_series_export`. Until this work no series could become confirmed, so it sent
nothing. From the first declared series it sends: the series id, the anchor event id (as
`venue_id`), `series_name`, `cadence`, weekday, hour, `state`, `confirmed_at`, corridor and UEC
tags. Points for the owner:

- `series_name` is the organizer's free text. The name rule refuses a contact detail, but a name
  can still be a person's name ("Dana's Monday room"). On staging that matters: the plan says
  nothing OSE serves there may name creator #1. The same care applies to what is exported.
- `cadence` in the export schema is a plain string, so the two new values load. Any reader that
  assumed three values will meet five.
- `confirmed_at` is a full timestamp of an admin action, not of a person. It is the pre-existing
  shape and the export-grain gate accepts it.
- The brain's `bigquery-schemas/` does not define `event_series_export`. Its schema lives only in
  this repo (`workers/oursharedevents/bigquery/event_series_export.schema.json`).
  _Proposal:_ the owner confirms that series names may leave OSE for BigQuery, or the export drops
  `series_name`. Register the table in the brain's schema set either way.

**F4. The research registry names a dataset that does not exist.**
ED-001 needs `event_series_logs`. Nothing by that name exists in OSE or in the brain's schemas. The
nearest real thing is `event_series_export` plus per-event `scan_aggregates`.
_Proposal:_ rename the requirement to what exists, or define the dataset.

**F5. The monitors assume a recurring event is evenly spaced.**
SM-002 (temporal autocorrelation, "per recurring event") uses Ljung-Box, which assumes equal gaps
between sessions. Before this work "recurring" had no definition in data. Now it has one: events on
one confirmed series. But a series can be `as-announced` (no schedule at all), `daily-weekdays`
(four or five sessions a week, with a weekend gap) or `monthly` (gaps of 28 to 35 days), and a
promoted trial may have changed its day between tries.
_Proposal:_ SM-002 states which cadences it applies to (`weekly`, `biweekly`), and how it treats a
series whose early instances were trial tries.

**F6. "Intent" is not in the brain.**
The showcase plan gives every event an intent: one-off, pop-up, programme or trial. It lives in
ourWKRP's link to the event. OSE does not store it, and the brain does not define it. The event
taxonomy calls some types "recurring" (league night, dinner series), which is a third, separate
statement about the same idea.
_Proposal:_ one brain entry that says where intent lives (ourWKRP), that a series is OSE's only
fact about recurrence, and that a type's "recurring" description is a hint and never a rule.

**F7. A detector name can become public.**
A confirmed suggestion keeps its auto-name ("Thursday 7 PM (auto-detected)") unless the organizer
gives a new one, and the public reads now show it. It is harmless but reads oddly on a public page.
_Proposal (OSE, small):_ the admin card asks for a name when confirming. Not done in this change.

## 4. What was checked and found in line

- No series file reads `FORMS_DB` or a people table (rule 4 of the new gate).
- No new cookie, no request geo, no IP read (invariants 2 and 4 untouched).
- No new migration, no model-provider import, no new dependency.
- The under-5 floor: the trend still floors per bucket; a promoted trial with small tries reads
  "Fewer than 5" on those instances, as the plan expects.

## 5. Proposed follow-ups, in order

1. Owner decision on F3 (series names in the BigQuery export). It is the only finding where data
   leaves OSE.
2. Brain wording for invariant 9 (F1) and a definition of intent (F6): two edits in OCR-docs.
3. Lock the response siblings in the snapshot (F2).
4. Registry and monitor wording (F4, F5).
5. Ask for a name at confirm (F7).

## 6. Owner decisions, 2026-11-14

The owner answered "yes" to all four open items.

| Item                                        | Decision                    | Where it landed                                                                        |
| ------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| F3, series names in the BigQuery export     | Yes: the name may leave OSE | ADR-029 D14. No export code changed                                                    |
| F1, F2, F4, F5, F6, the brain proposals     | Yes: make them              | OCR-docs PR under OCR-212 (the owner reviews and merges it); F2's OSE half is OSE-2042 |
| F7, ask for a name at confirm               | Yes                         | OSE-2041, ADR-029 D13                                                                  |
| The drift ticket for the failed brain check | Close it                    | OCR-210, closed with its cause                                                         |
