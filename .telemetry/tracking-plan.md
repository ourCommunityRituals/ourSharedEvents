# Tracking plan: which spine keys each measure carries

**Story:** OSE-1614, part of epic OSE-1612 (measurement tracking plan).
**Status:** Decisions 1, 2 and 3 are made (PO, 2026-10-04). Decision 4 (do venue-grain keys cross the BigQuery boundary) is open and blocks OSE-1617. The Dr of Security sign-off (section 6) is still pending.
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

| Measure           | Grain of one write                                                                                     | Store                                                         | Join to `events`                         | Privacy class                                                                                                          | Spine keys reachable                                                                    | Who buys it                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `qr_scan`         | one scan of a poster code, two split rows: placement (where) and node return (anonymous id, hashed UA) | `scan_placement_events`, `scan_node_returns` (main `DB`)      | `event_id` on both                       | anonymous exact in the store; floored K=5 in SharedReport and exports                                                  | `brand_id`, `corridor_id`, `uec_code`, `venue_canonical_id`\*, `event_correlation_id`\* | venue, sponsor, league, chamber, OW                         |
| `shortlink_click` | one redirect; stored as one counter per link per UTC day, no per-click row                             | `shortlinks.clicks`, `shortlink_click_daily` (migration 0094) | `shortlinks.event_id`                    | anonymous exact; no read path for the day series exists yet, and any added must apply the floor before it leaves admin | same five                                                                               | venue, sponsor, the Oct 24 report (pre-event reach by week) |
| `impression`      | one sponsor card shown (beacon, filtered by `classifyBeacon`)                                          | `sponsor_impressions`, `event_type='impression'`              | `event_id`                               | anonymous exact, then floored K=5 per event before any sum                                                             | same five, plus the sponsor's own `brand_id`                                            | sponsor                                                     |
| `click`           | one sponsor card clicked                                                                               | `sponsor_impressions`, `event_type='click'`                   | `event_id`                               | as `impression`                                                                                                        | as `impression`                                                                         | sponsor                                                     |
| `checkin`         | running total per event, plus the last anonymous id                                                    | `checkin_counts` (`FORMS_DB`)                                 | `event_id`, no SQL join across databases | anonymous exact                                                                                                        | same five, reached by the application reading `events`                                  | venue, league                                               |
| `email_signup`    | one signup, email stored hashed and encrypted, hour bucket                                             | `email_signups` (`FORMS_DB`)                                  | `event_id`, no SQL join across databases | entity (PII, retention-limited)                                                                                        | `brand_id`, `event_id`; never exported as rows                                          | organizer only                                              |
| `report_access`   | one SharedReport read, granted or denied                                                               | `report_access_log`                                           | `event_id`                               | entity                                                                                                                 | `brand_id`                                                                              | operations (our own audit)                                  |

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

### Decision 1: the time bucket in `event_correlation_id` (DECIDED, PO 2026-10-04)

ADR-010 defines `event_correlation_id = hash(venue + uec_code + time_bucket)`. The bucket has to keep one league night as one id, and keep two different nights apart.

| Option                                                                                       | A league night that runs past midnight                                 | Two leagues, same venue, same type, Tuesday and Thursday | Verdict    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| Calendar day, UTC                                                                            | splits when UTC midnight falls mid-event (any evening event in the US) | kept apart                                               | no         |
| Calendar day, event local time                                                               | splits if the event crosses local midnight                             | kept apart                                               | close      |
| **Local day with a 04:00 rollover** (a start before 04:00 local belongs to the previous day) | stays one night                                                        | kept apart                                               | **chosen** |
| ISO week                                                                                     | one id                                                                 | **merged**, wrong                                        | no         |

Decision: **the local date of `starts_at` in the event's own IANA zone, minus one day when the local start time is before 04:00.** Written `YYYY-MM-DD`. The rule works on the wall clock, not on a subtraction of 4 hours from the instant, because the two disagree by an hour on a daylight-saving day and OSE and OW must compute the same id. `starts_at` and the zone already exist (OSE-1313); `zonedDatePart` and `zonedTimePart` in `lib/event-datetime.ts` give the local date and time. A date-only event (no `starts_at`) uses `start_date`. The id is recomputed when the start changes, so adding a start time to a date-only event can move its bucket. The hash input is versioned (`v1`), so a later change to the rule is visible rather than silent.

Test vectors (zone `America/Chicago`), the cases OSE-1615 must pass and OW should run too:

| Start (UTC)            | Local start                       | Bucket       |
| ---------------------- | --------------------------------- | ------------ |
| `2026-10-22T23:30:00Z` | Oct 22, 18:30                     | `2026-10-22` |
| `2026-10-23T06:30:00Z` | Oct 23, 01:30 (a late night)      | `2026-10-22` |
| `2026-10-23T09:00:00Z` | Oct 23, 04:00 (exactly the edge)  | `2026-10-23` |
| `2026-11-01T09:30:00Z` | Nov 1, 03:30 (fall-back day)      | `2026-10-31` |
| `2026-11-01T10:30:00Z` | Nov 1, 04:30 (fall-back day)      | `2026-11-01` |
| `2026-03-08T09:30:00Z` | Mar 8, 04:30 (spring-forward day) | `2026-03-08` |

Known limit, accepted: two separate sessions of the same type at the same venue on the same night (a 7pm and a 10pm trivia) share one id. They are one night to a league or a chamber; if a buyer needs them apart, the bucket gains a session part in `v2`.

### Decision 2: where `venue_canonical_id` lives (DECIDED, PO 2026-10-04)

Today there is no canonical venue entity. An event carries free text (`location` and `where_address`), `lat`/`lon`, and the cells `h3_res9` / `h3_res7`.

Decision: **a new nullable column on `events`, computed by the server, not a new venue table.** It is `hash('v1' + normalised venue name (`location`) + h3_res7)`. Normalisation lower-cases, strips punctuation and leading "the", and collapses whitespace. No coordinates enter the hash. This is what OSE-1615 already assumes, and it avoids building a venue registry before there is a second consumer that needs one.

Known weakness, accepted for now: the same venue geocoded into two neighbouring res-7 cells gets two ids, and two same-named venues in one cell share one. Both are rare at the current scale and are visible in the data. If either shows up, the fix is a registry, and the column becomes its foreign key.

**Missing inputs mean no key.** `venue_canonical_id` is null when the event has no `location` or no `h3_res7`. `event_correlation_id` is null when `venue_canonical_id`, the event type (`event_type_id`, which gives `uec_code` through the type registry) or the start date is missing. A key is never computed from part of its inputs, so an untyped event never joins an `unknown` bucket with other untyped events. (Exports today write `uec_code` as `'unknown'` for such rows, `handlers/bigquery.ts:143`; the key stays null.)

Per ADR-010 the normalisation is a shared contract between OSE and OW, so "hash" and "normalise" must be exact. OSE-1615 pins and publishes the following, with fixtures (names in, id out) the OW side can run. These are the proposed defaults:

- **Normalised name:** Unicode NFKC, lower-cased; `&` becomes `and`; every character that is not a letter or digit becomes a space; a leading `the ` is dropped; runs of spaces collapse to one and the ends are trimmed. ("Joe's Tavern" and "Joes Tavern" agree; "Tom & Jerry's" and "Tom and Jerrys" agree; "St." and "Street" do not, and that is accepted.)
- **Hash:** SHA-256 over the UTF-8 bytes of the joined string, fields separated by `|`, written as the first 32 lower-case hex characters. Venue: `v1|<normalised name>|<res-7 cell, lower case>`. Event: `v1|<venue_canonical_id>|<uec_code>|<bucket>`.
- **No secret key.** OSE and OW must agree without sharing a secret (section 6 gives the consequence).

Until OSE-1615 publishes the fixtures, no other repository should compute these keys.

### Decision 3: do the keys reach OW? (SETTLED, PO 2026-10-04)

**Leagues, chambers and the OW side must all be supported** by the spine keys. OW receives the keys, never person-level rows. Section 5 gives one recipe per buyer.

### Decision 4: do venue-grain keys cross the BigQuery boundary? (OPEN, needs PO)

Decision 3 says OW receives the keys on the pool it reads. That collides with three statements in force today:

- `OCR_ARCHITECTURE_oerAggregationBoundary.md` (OCR-docs, line 57): location is "corridor-level only (`corridor_id`)" for what OSE emits.
- `lib/export-geography.ts` (header): "every row that crosses the D1 to BigQuery boundary is at corridor grain or coarser". `assertCorridorGrainRow` does not list `venue_canonical_id` as forbidden, so it would not stop the key, but the header is the contract it enforces.
- OSE-1460 (PO, 2026-10-01), in `lib/shared-report-export.ts:289`: "The venue never leaves"; the exports carry `venue_id = 'corridor-aggregate'`.

ADR-010 (Proposed) section 3 assumes the opposite: that data meets in BigQuery keyed on the spine. So a Proposed ADR and an implemented boundary disagree, and this plan cannot settle it. The three options:

| Option                                    | What crosses                                                                                                                                                                                                                                                      | Cost                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Keys cross, narrowly** (recommended) | `venue_canonical_id` and `event_correlation_id` for listed events, on the scan, impression and density exports only. The returns export stays corridor x event type, because it is derived from anonymous ids. Counts keep the floor and the no-subtraction rule. | PO amends the boundary doc and OSE-1460's sentence; `export-geography.ts` gets an allowlist for exactly two key names, with a gate that fails on any other venue-grain field. |
| B. Keys stay inside OSE                   | Nothing finer than corridor x type x week. League, chamber and OW roll-ups needing a venue or an event run in OSE (admin, SharedReport).                                                                                                                          | OW cannot join on events in BigQuery; Decision 3 is met only at corridor grain.                                                                                               |
| C. A separate dataset for keyed rows      | Keys cross into their own dataset with its own floor and access list, apart from `oureventring_general`.                                                                                                                                                          | A new pool and dataset, and the pool contract changes.                                                                                                                        |

Until this is decided OSE-1617 must not build the export. The recipes in section 5 are written for option A and say where B changes them.

## 5. Roll-up recipes, one per buyer

Each recipe states the key it joins on and what the buyer may see. All of them stay inside the K=5 floor and the 90-day window rules of OSE-1460: a key never makes a withheld count visible.

**No back door by subtraction.** A roll-up returns the cells that clear the floor and the sum of those cells. It never returns an independent total, a count of events, or a share that would let a withheld cell be worked out by subtraction. If any cell is withheld the response says "some not shown", and does not say how many. The same applies to a league across its nights and a chamber across its venues.

### Chamber of commerce

- **Joins on:** `corridor_id` (the res-7 cell), and `venue_canonical_id` for venues that opted in.
- **May see, without any consent step:** floored counts per corridor and event type over the window, for **listed events only** (`is_published` and past the publish grace window, `listedSql()` in `lib/publish-grace.ts`). This is the grain the landing map and the corridor dashboard already publish.
- **May see only for a venue that opted in:** that venue's own floored counts. A venue is a separate tenant, so a chamber reading it per venue is a cross-tenant read and needs the venue owner's consent, recorded and audited in the same way as the league mapping below. A venue that only has draft or unlisted events never appears.
- **May not see:** anything below K=5, any per-event row for an event under the floor, any anonymous id, a venue that did not opt in.
- **Shape:** `GROUP BY corridor_id, uec_code` for everyone; `GROUP BY corridor_id, venue_canonical_id, uec_code` for opted-in venues. Each count is floored before it is summed. Under option B of decision 4 only the first shape exists outside OSE.

### League

- **Joins on:** `brand_id` (the league as a tenant, with its events as children) and `uec_code`, over a date range. It does **not** join on `event_correlation_id`.
- **May see:** floored counts per night and for the season, across the venues where its teams played.
- **May not see:** another league's events at a shared venue; an attendee, or a team member, by identity.
- **Two cases.**
  - **A. The league owns its events** (the founding case: the league creates its Thursday nights and names the bar in `location`). Every event already carries the league's `brand_id`. No mapping is needed, and no consent step applies, because there is no other brand.
  - **B. The venues own the events** (each bar creates its own league night under its own brand). The league's `brand_id` is on none of them, so a mapping is needed: rows of (league brand, member event or venue brand, season start, season end). ADR-023 treats a venue and a league as separate private tenants, so a venue owner exists to consent. Whether a venue is a tenant in the code today is not verified; case A does not depend on it.
- **The mapping, where needed (case B), is held to these rules**, anonymity first:
  - **Identifiers of organisations and events only.** No person, team roster, player name, email, anonymous id or hash of one. A column outside the allowed set fails the gate OSE-1616 adds (its denylist covers `*_person*`, `email`, `ip`, `lat`, `lon`).
  - **Two-sided consent.** The league's owner proposes a member; the venue's brand owner accepts. Until both agree the row has no effect (the same rule as sponsor placements, ADR-019). Either side can remove it.
  - **Tenant isolation (invariant #9).** A league reads only events whose brand accepted the mapping, and only listed ones. A venue never sees another member's numbers.
  - **Audited writes.** Every add, accept and remove goes to `admin_audit_log` with the actor.
  - **The floor is applied per event before any sum**, and the no-subtraction rule above applies, so the mapping cannot be used to narrow a league down to a group under 5. A mapping that selects one night at one venue returns "not shown", not a small number.
  - **Held as tenant data, not a committed file.** Membership is a business fact with consent and an audit trail, so it belongs in a D1 table behind an admin route. A file in the repository is fine for test fixtures and for seeding the founding league, and nowhere else.

**Finding (resolved).** OSE-1617 words the league recipe as "by `event_correlation_id` across venues in a season". With the ADR-010 definition the venue is inside the hash, so a league night played at two venues yields two correlation ids. They cannot be joined by that key. `event_correlation_id` answers "is this the same event" (the same venue, type and night, entered once by OSE and once by OW). A season across venues is a tenant question, so it joins on `brand_id` plus `uec_code` plus dates. The PO agreed on 2026-10-04 and OSE-1617 was reworded to match.

### OW

- **Joins on:** all five keys, through the pool dataset OW reads (`oureventring_general`, per-environment names per OSE-1416). OW is to stamp the same `venue_canonical_id` and `event_correlation_id` at write time from the shared normalisation, so the halves agree by construction (ADR-010 section 1). That is design intent: no code in `ourWKRP` reads or writes either key today (searched 2026-10-04). There is no cross-database join. Everything here is subject to decision 4; under option B OW joins at corridor x event type only.
- **May see:** the keys plus floored, windowed aggregates (the `corridor_returns_export`, `corridor_density_baseline_export` and `event_series_export` shapes).
- **May not see:** `anon_id`, its hash, a per-person row, a count below K=5. Person-level participation on the OW side is the person's own opt-in declaration (the covenant in ADR-010 section 2), never inferred from a scan.

## 6. Dr of Security review

Claim to be checked: no key can single out a person.

- `venue_canonical_id` is derived from a venue name and an area cell. `event_correlation_id` adds an event type and a day. None of the inputs is about a person. The keys are unkeyed hashes (they must agree across OSE and OW), so anyone who knows a venue and a night can compute the id and test whether an event exists. For a listed event that reveals nothing the public page does not say. For a draft, unlisted or archived event it would confirm something that is not public. So: the keys are stored for every event, but **exports and roll-ups carry them only for listed events** (OSE-1617 acceptance, to be added), and no public surface shows them.
- A one-person event is the edge case: its id plus any exact count would identify that attendee's presence. The defence is the floor (`lib/count-floor.ts`), applied today by the SharedReport read, the dashboards, event stats, poster reach and the corridor map. This plan does not claim that every existing surface applies it; the rule is that any surface or export that shows a count next to a key must. A key never relaxes it (OSE-1617 acceptance), and exports also follow the no-subtraction rule of section 5.
- The hash input must not contain coordinates or res-9 cells (OSE-1615 security test).
- Keys are server-computed and never client-supplied (400 on a supplied value, as for `starts_at`).

**Sign-off: PENDING.** This section is the analysis. The story's acceptance needs the Dr of Security to sign it, and that has not happened.

## 7. Changes this plan implies

| Where                                          | Change                                                                                                                    | Story                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| ADR-010 (OCR-docs repo, status Proposed)       | record the chosen bucket and that `venue_canonical_id` is a stored column; record that league roll-ups join on `brand_id` | this story; OCR-docs#156           |
| `events`                                       | `venue_canonical_id`, `event_correlation_id`, indexes                                                                     | OSE-1615                           |
| `lib/pool-contract.ts`, exports                | carry both keys, joined from `events` at export time, **only after decision 4**                                           | OSE-1617                           |
| league mapping (new table, admin route, audit) | league roll-up of section 5                                                                                               | to be written: not in the epic yet |
| `lib/measurement-registry.ts` and a gate       | the seven measures declared; regenerates `.telemetry/current-state.yaml`                                                  | OSE-1616                           |
| alerts                                         | a measure that stops writing                                                                                              | OSE-1618                           |

## 8. Still open

1. PO: decision 4, the boundary. OSE-1617 waits on it.
2. Dr of Security: the sign-off in section 6.
3. ADR-010 is in the OCR-docs repo, so its update is a second pull request there. It records decisions 1 and 2 and the league join.
