# Tracking plan: which spine keys each measure carries

**Story:** OSE-1614, part of epic OSE-1612 (measurement tracking plan).
**Status:** DRAFT for PO sign-off. Decision 3 is settled. Decisions 1 and 2 carry a recommendation, not a decision.
**Source of facts:** the tracking audit of 2026-10-04 (`.telemetry/current-state.yaml`, `.telemetry/audits/2026-10-04.md`), re-read against the code the same day. Every "today" statement below names its file.

## 1. What this plan decides

Every first-party measure already carries `event_id`. The spine keys therefore live on `events`, computed by the server, and each measure reaches them by joining through `event_id`. No measure table gets a new column. This keeps never-who intact: every key describes a place, an event or a day, never a person.

The spine (ADR-010 in OCR-docs, status Proposed):

```
corridor  ->  venue  ->  event type  ->  event
H3 res-7      venue_canonical_id   uec_code    event_correlation_id
```

| Key                    | Grain                                             | Exists today?                | Where it lives                                                             |
| ---------------------- | ------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `brand_id`             | tenant (venue operator, league, chamber, sponsor) | yes                          | `events.brand_id`; tenant tree in `node_hierarchy`                         |
| `corridor_id`          | an area, the H3 res-7 cell                        | yes, with a caveat (see 1.1) | `events.h3_res7`; `events.corridor_id` is a legacy slug                    |
| `uec_code`             | event type                                        | yes                          | joined from the type registry at export time (`event_type_id` on `events`) |
| `venue_canonical_id`   | one physical venue                                | **no**                       | to be added (OSE-1615)                                                     |
| `event_correlation_id` | one event: this venue, this type, this day        | **no**                       | to be added (OSE-1615)                                                     |

### 1.1 What "corridor id" means in code

A corridor is a res-7 H3 cell, never a slug. `canonicalCorridorId(r.h3_res7 ?? r.corridor_id)` (`handlers/bigquery.ts:140`, `lib/export-geography.ts:78`) writes the lower-cased cell, or `'unknown'` when the value is not a valid cell. `assertCorridorGrainRow` throws on anything finer than res-7. The old slug in `events.corridor_id` (migration 0029) is only a fallback for events geocoded before the cell columns existed (`COALESCE(h3_res7, corridor_id)` in `refreshCorridorBaselines`). New work reads `h3_res7`.

## 2. Measures

Privacy classes: **entity** (a row about an organizer or sponsor action, not about attendees), **anonymous exact** (a count of anonymous visits, exact in the store, never shown below the floor outside admin), **floored K=5** (count withheld below 5, `lib/count-floor.ts`).

| Measure           | Grain of one write                                                                                     | Store                                                         | Join to `events`                         | Privacy class                                                              | Spine keys reachable                                                                    | Who buys it                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `qr_scan`         | one scan of a poster code, two split rows: placement (where) and node return (anonymous id, hashed UA) | `scan_placement_events`, `scan_node_returns` (main `DB`)      | `event_id` on both                       | anonymous exact in the store; floored K=5 in SharedReport and exports      | `brand_id`, `corridor_id`, `uec_code`, `venue_canonical_id`\*, `event_correlation_id`\* | venue, sponsor, league, chamber, OW                         |
| `shortlink_click` | one redirect; stored as one counter per link per UTC day, no per-click row                             | `shortlinks.clicks`, `shortlink_click_daily` (migration 0094) | `shortlinks.event_id`                    | anonymous exact; the day series follows the floor wherever it leaves admin | same five                                                                               | venue, sponsor, the Oct 24 report (pre-event reach by week) |
| `impression`      | one sponsor card shown (beacon, filtered by `classifyBeacon`)                                          | `sponsor_impressions`, `event_type='impression'`              | `event_id`                               | anonymous exact, then floored K=5 per event before any sum                 | same five, plus the sponsor's own `brand_id`                                            | sponsor                                                     |
| `click`           | one sponsor card clicked                                                                               | `sponsor_impressions`, `event_type='click'`                   | `event_id`                               | as `impression`                                                            | as `impression`                                                                         | sponsor                                                     |
| `checkin`         | running total per event, plus the last anonymous id                                                    | `checkin_counts` (`FORMS_DB`)                                 | `event_id`, no SQL join across databases | anonymous exact                                                            | same five, reached by the application reading `events`                                  | venue, league                                               |
| `email_signup`    | one signup, email stored hashed and encrypted, hour bucket                                             | `email_signups` (`FORMS_DB`)                                  | `event_id`, no SQL join across databases | entity (PII, retention-limited)                                            | `brand_id`, `event_id`; never exported as rows                                          | organizer only                                              |
| `report_access`   | one SharedReport read, granted or denied                                                               | `report_access_log`                                           | `event_id`                               | entity                                                                     | `brand_id`                                                                              | operations (our own audit)                                  |

\* reachable once OSE-1615 adds the two columns. Today `venue_canonical_id` and `event_correlation_id` appear nowhere in `workers/oursharedevents/src`.

Notes the table cannot hold:

- **`FORMS_DB` rows never join to `DB` in SQL** (ADR-001). A roll-up that needs `checkin` or `email_signup` by corridor reads `events` first, then counts per event in `FORMS_DB`. `handlers/dashboards.ts` is the one authorised reader (`tests/architecture.spec.ts`).
- **The two scan rows share no durable key** (OSE-798). The placement row answers "how many, where"; the node-return row answers "did this browser come back". Neither is joined to the other.
- **Derived tables** (`scan_aggregates`, `scan_cell_aggregates`, `anon_id_returns`, `corridor_density_snapshots`) are materializers over the above. They carry `h3_res7` (and `event_id` where the grain allows), so they inherit the spine through the same join. They are not measures.

## 3. Where `ose_anon` is set

The `ose_anon` cookie (HttpOnly, Secure, SameSite=Lax, one year, `lib/anonymous-id.ts`) is set in exactly two places:

- the QR scan path, `/q/` (`handlers/qr-scan.ts:215`);
- the form paths: register, check-in, survey and email signup (`handlers/forms.ts:301, 420, 467, 523, 552`).

Public read surfaces set **no cookie**: the landing page, `/events`, the event page, the display, the poster, the map and the shortlink redirect (OSE-1312). So "a visitor gets a cookie" is true only for a person who scans a printed code or submits a form. A person who only reads a page, or follows a short link, is counted (a day counter, a card impression) but never marked.

## 4. Decisions

### Decision 1: the time bucket in `event_correlation_id` (OPEN, recommendation)

ADR-010 defines `event_correlation_id = hash(venue + uec_code + time_bucket)`. The bucket has to keep one league night as one id, and keep two different nights apart.

| Option                                                                                          | A league night that runs past midnight                                 | Two leagues, same venue, same type, Tuesday and Thursday | Verdict         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | --------------- |
| Calendar day, UTC                                                                               | splits when UTC midnight falls mid-event (any evening event in the US) | kept apart                                               | no              |
| Calendar day, event local time                                                                  | splits if the event crosses local midnight                             | kept apart                                               | close           |
| **Local day with a 04:00 rollover** (the bucket is the local date of `starts_at` minus 4 hours) | stays one night                                                        | kept apart                                               | **recommended** |
| ISO week                                                                                        | one id                                                                 | **merged**, wrong                                        | no              |

Recommendation: the local date of `starts_at - 4h` in the event's own IANA zone, written `YYYY-MM-DD`. `starts_at` and the zone already exist (OSE-1313, `lib/event-datetime.ts`). A date-only event (no `starts_at`) uses `start_date`. The hash input is versioned (`v1`), so a later change to the rule is visible rather than silent.

### Decision 2: where `venue_canonical_id` lives (OPEN, recommendation)

Today there is no canonical venue entity. An event carries free text (`location` and `where_address`), `lat`/`lon`, and the cells `h3_res9` / `h3_res7`.

Recommendation: **a new nullable column on `events`, computed by the server, not a new venue table.** It is `hash('v1' + normalised venue name (`location`) + h3_res7)`. Normalisation lower-cases, strips punctuation and leading "the", and collapses whitespace. No coordinates enter the hash. This is what OSE-1615 already assumes, and it avoids building a venue registry before there is a second consumer that needs one.

Known weakness, accepted for now: the same venue geocoded into two neighbouring res-7 cells gets two ids, and two same-named venues in one cell share one. Both are rare at the current scale and are visible in the data. If either shows up, the fix is a registry, and the column becomes its foreign key.

Per ADR-010 the normalisation is a shared contract between OSE and OW. OSE-1615 should publish its test fixtures (names in, id out) so the OW side can run the same cases.

### Decision 3: do the keys reach OW? (SETTLED, PO 2026-10-04)

**Leagues, chambers and the OW side must all be supported** by the spine keys. OW receives the keys, never person-level rows. Section 5 gives one recipe per buyer.

## 5. Roll-up recipes, one per buyer

Each recipe states the key it joins on and what the buyer may see. All of them stay inside the K=5 floor and the 90-day window rules of OSE-1460: a key never makes a withheld count visible.

### Chamber of commerce

- **Joins on:** `corridor_id` (the res-7 cell) and `venue_canonical_id`.
- **May see:** floored counts per corridor and per venue, by event type, over the window. Which venues are in a corridor is public by design (they are on the map).
- **May not see:** anything below K=5, any per-event row for an event under the floor, any anonymous id.
- **Shape:** `GROUP BY corridor_id, venue_canonical_id, uec_code`, each count floored before it is summed across venues.

### League

- **Joins on:** `brand_id` (the league as a tenant, with its events as children) and `uec_code`, over a date range. It does **not** join on `event_correlation_id`.
- **May see:** floored counts per night and for the season, across the venues where its teams played.
- **May not see:** another league's events at a shared venue; an attendee, or a team member, by identity.

**Finding for the PO.** OSE-1617 words the league recipe as "by `event_correlation_id` across venues in a season". With the ADR-010 definition the venue is inside the hash, so a league night played at two venues yields two correlation ids. They cannot be joined by that key. `event_correlation_id` answers "is this the same event" (the same venue, type and night, entered once by OSE and once by OW). A season across venues is a tenant question, so it joins on `brand_id` plus `uec_code` plus dates. I recommend OSE-1617 is reworded that way. This needs a PO yes, because it changes a sentence in a ticket the PO wrote.

### OW

- **Joins on:** all five keys, through the pool dataset OW reads (`oureventring_general`, per-environment names per OSE-1416). OW stamps the same `venue_canonical_id` and `event_correlation_id` at write time from the shared normalisation, so the halves agree by construction (ADR-010 section 1). There is no cross-database join.
- **May see:** the keys plus floored, windowed aggregates (the `corridor_returns_export`, `corridor_density_baseline_export` and `event_series_export` shapes).
- **May not see:** `anon_id`, its hash, a per-person row, a count below K=5. Person-level participation on the OW side is the person's own opt-in declaration (the covenant in ADR-010 section 2), never inferred from a scan.

## 6. Dr of Security review

Claim to be checked: no key can single out a person.

- `venue_canonical_id` is derived from a venue name and an area cell. `event_correlation_id` adds an event type and a day. None of the inputs is about a person. The keys are unkeyed hashes (they must agree across OSE and OW), so anyone who knows a venue and a night can compute the id. That reveals nothing the public event page does not already say.
- A one-person event is the edge case: its id plus any exact count would identify that attendee's presence. The defence is the floor, which withholds any count under 5 on every surface that leaves admin. A key never relaxes it (OSE-1617 acceptance).
- The hash input must not contain coordinates or res-9 cells (OSE-1615 security test).
- Keys are server-computed and never client-supplied (400 on a supplied value, as for `starts_at`).

**Sign-off: PENDING.** This section is the analysis. The story's acceptance needs the Dr of Security to sign it, and that has not happened.

## 7. Changes this plan implies

| Where                                    | Change                                                                                                                    | Story                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| ADR-010 (OCR-docs repo, status Proposed) | record the chosen bucket and that `venue_canonical_id` is a stored column; record that league roll-ups join on `brand_id` | this story, after the PO decides; a separate change in OCR-docs |
| `events`                                 | `venue_canonical_id`, `event_correlation_id`, indexes                                                                     | OSE-1615                                                        |
| `lib/pool-contract.ts`, exports          | carry both keys, joined from `events` at export time                                                                      | OSE-1617                                                        |
| `lib/measurement-registry.ts` and a gate | the seven measures declared; regenerates `.telemetry/current-state.yaml`                                                  | OSE-1616                                                        |
| alerts                                   | a measure that stops writing                                                                                              | OSE-1618                                                        |

## 8. Open items before this can be marked signed

1. PO: decision 1 (bucket) and decision 2 (stored column).
2. PO: the OSE-1617 league wording (section 5).
3. Dr of Security: the sign-off in section 6.
4. ADR-010 is in the OCR-docs repo, so its update is a second pull request there, opened once 1 and 2 are decided.
