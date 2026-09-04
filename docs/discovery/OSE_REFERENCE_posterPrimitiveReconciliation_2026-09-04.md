# Poster primitive — reconciliation against the real schema

**Date:** 2026-09-04
**Repo:** ourSharedEvents
**Reconciles:** the proposed "ADR-004: The Poster Primitive" draft (2026-09-04)
**Status:** Verification report. No code, no migration, no Linear issues created.

> The draft ADR asked for this explicitly: _"I have not read the migrations
> directory. Section 1.1 is assembled from search results, not from the schema.
> The first task of any implementing session is to verify the current state
> against the actual files and correct this ADR where it is wrong."_
>
> This is that correction. It was written by reading `migrations/`,
> `migrations-forms/`, and the handlers that touch them.

---

## 1. Headline

**Most of the poster primitive already exists.** `poster_deployments` has been in
the schema since migration **0003** — one of the first six tables in the
platform. It already carries an immutable-in-practice `qr_token`, a placement
label, lat/lng, and H3 res7/res9 cells. `scans` (migration 0004) already records
one row per scan per poster in a privacy-bucketed time grain.

The draft's §1.1 lists five things the model "cannot express." **Three of the
five it already expresses today.** Two are real gaps, and both are narrower than
the draft assumes.

The draft proposes four new tables. After reconciliation, **one of them
duplicates an existing table**, one is unnecessary, one collides with existing
vocabulary, and the genuinely new work is a handful of additive columns.

---

## 2. Task 1 — §1.1, claim by claim

| §1.1 claim                                           | Verdict                      | Evidence                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Every QR belongs to an event"                       | **Correct**                  | `poster_deployments.event_id TEXT NOT NULL`, FK → `events(id)` (0003)                                                                                                                                                                                                 |
| "A QR that outlives any single event" — impossible   | **Partly wrong**             | The QR already outlives the event's _dates_ (no time-based expiry exists — see §3). What it cannot do is be _repointed_ to a different destination. That is the real coupling.                                                                                        |
| "Many QRs pointing at one destination" — impossible  | **Wrong — already possible** | `poster_deployments` is many-rows-per-`event_id`; `idx_poster_deployments_event_id` (0007) exists precisely for that read.                                                                                                                                            |
| "Placement as a tracked property" — impossible       | **Partly wrong**             | `placement_label`, `location_desc`, `latitude`, `longitude` (0003) plus `h3_res9`/`h3_res7` (0047). Placement is tracked. What is missing is a _reusable venue entity_ and `consented_at`. The gap is consent and reuse, not tracking.                                |
| "Segment as a tracked property" — impossible         | **Correct**                  | No `segment` column anywhere on `poster_deployments`. This is a real gap.                                                                                                                                                                                             |
| "A destination with no end date at all" — impossible | **Wrong — already possible** | `events.end_date` is **nullable** (0001). `domain/event-phase.ts` holds an active event with `start_date` set and `end_date` NULL in the `'event'` phase **indefinitely**, until an admin archives it. That is a perpetual destination, today, with no schema change. |

### 2.1 The three specific questions the brief asked

**"Does any QR token today survive its event?"**
Yes, in the sense that matters. Nothing expires a `qr_token` on a clock. It is
retired only by an explicit admin write setting `is_active = 0`
(`handlers/poster-deployments.ts`), and the scan lookup requires `is_active = 1`
(`handlers/qr-scan.ts`). A token cannot, however, be _moved_ to another event —
`event_id` is `NOT NULL` and is not in the update handler's allowlist.

**"Is the destroy job keyed to `end_date` or to `phase`?"**
**Neither. There is no destroy job for posters or scans at all.** See §3 — this
is the draft's largest factual error, and it removes one of its seven proposed
invariants.

**"What is the actual highest migration number in the repo?"**
**0068** (`0068_sponsor_lifecycle_and_acceptance.sql`) — 68 main-DB migrations,
plus 13 in `migrations-forms/`. The draft says the code floor is 67. It is 68.

---

## 3. The destroy job does not exist

The draft's §7 and its **PST-06 (perpetual_no_destroy)** both rest on:
_"The destroy job is keyed to an event ending."_

It is not. The scheduled handler (`src/index.ts`) runs six jobs, and the only
deletions any of them perform are:

```
DELETE FROM form_registrations WHERE expires_at IS NOT NULL AND expires_at < ?
DELETE FROM email_signups      WHERE retention_expires_at < ?
DELETE FROM subscribers        WHERE created_at < datetime('now', ?)
```

All three are **FORMS_DB PII lifecycle**, keyed to a per-row retention column —
never to an event's `end_date`, never to `phase`. They do not touch
`poster_deployments`, `scans`, or `scan_aggregates`.

The **only** code path that deletes poster or scan rows is the admin
`DELETE /events/:id` cascade (`handlers/events.ts`). That path is **guarded**:
if any `scan_node_returns`, `scan_placement_events`, or `sponsor_impressions`
rows exist for the event it returns **409 `EVENT_HAS_ACTIVITY`** and directs the
admin to archive instead.

**Consequence:** once a poster has been scanned, its data is already
undeletable through the API, and already has no expiry. That is Invariant 4
working as designed (no PII ⇒ no TTL ⇒ permanent).

**PST-06 would guard a job that does not exist.** Drop it. §7's retention
question is still worth putting to Tom as _policy_, but it is not blocking, it
is not a schema question, and the current default is already the one §7
proposes.

---

## 4. `poster_scans` duplicates `scans`

The draft proposes:

```sql
CREATE TABLE poster_scans (
  id, poster_id, scanned_at, week_bucket, data_class
);
```

Migration 0004 already shipped:

```sql
CREATE TABLE scans (
  id, event_id, poster_deployment_id NOT NULL, scan_bucket NOT NULL,
  user_agent_hash, referrer_domain, country_code, region_code, created_at
);
```

`scan_bucket` is `YYYY-MM-DDTHH:00` — hour-granularity UTC, deliberately _not_ an
exact timestamp ("Privacy by schema: NO exact timestamp stored"). Weekly rollup
is a read-time derivation from that; storing a `week_bucket` column would be
both redundant and lossier than what exists.

**Do not create `poster_scans`.** The per-poster, per-time-bucket series the
whole campaign depends on is already being written on every scan.

One caveat: `scan_aggregates` (0006) rolls up to **`event_id` + `bucket_date`**
and therefore _drops the poster dimension_. Per-variant weekly counts must read
`scans` directly, not the pre-computed aggregate. That is the one genuine
reporting gap, and it is a query, not a table.

---

## 5. Vocabulary collisions

**`placements` collides head-on, and badly.** OSE already has
`sponsor_placement` (migration 0067), where "placement" means _the sponsor↔event
attachment join_ — explicitly **not** a physical location. `scan_placement_events`
uses the same sense. Introducing a `placements` table meaning "a bar, a hall"
would make one word mean two incompatible things in one schema.
→ **Recommend `venues`.**

**`poster` partially collides.** `poster_deployments` already _is_ the poster
row. A second `posters` table would split the concept.
→ **Recommend extending `poster_deployments`.**

**`destination` is free.** No collision found.

### 5.1 ADR cross-references that do not resolve

- **ADR-004 is occupied.** `OCR-docs/docs/adr/ADR-004-role-ready-invariants.md`.
  OSE keeps its own series (001, 002, 006, 009–016); the next free sequential
  number here is **ADR-017**.
- **"ADR-002 (OSG-hybrid architecture)" and "ADR-003 (per-night identity and
  operator role)" do not exist** in either repo, under those numbers or those
  titles. OSE ADR-002 is _Static-invariant gates_; OCR-docs ADR-002 is _Key
  architectural invariants to identity profile_.
- Invariants **22** (`cross_repo_import_isolation`) and **25**
  (`sponsor_share_covenant`) — **both verified correct** against
  `ocr-docs-brain/architectural-invariants.yaml`.

---

## 6. Invariant 25 and poster placements — what the code already says

The draft leaves this open and calls it the founder's decision. It is. But the
code is less ambiguous than the draft assumes. Migration 0067's own header:

> "**#25** (sponsor_share_covenant, LIVE): money buys frequency-share and report
> depth only — never size, slot, position, or is_local status. So there is
> deliberately **NO `placement_formats` column** here (buying a named slot is
> the #25 violation the resolver already retired)."

Selling _"your logo on the Open Outcry poster"_ is buying a named slot. Under
the invariant **as currently coded**, that fires #25. The escape the draft hopes
for — "a poster is inventory OCR controls, so it is a different transaction" —
is written nowhere, and #25 is scoped to what the sponsor _buys_, not to which
surface renders it.

**The honest reading of the current code is that it conflicts.** If the intent
is that poster inventory sits outside #25, that carve-out has to be written into
the invariant itself before any poster carries a sponsor — not asserted in an
ADR that #25 does not reference.

---

## 7. What a migration would actually have to touch

Far less than four tables.

**Already sufficient, no change needed:**

- perpetual destination → an active event with `end_date = NULL`
- many QRs → one destination → `poster_deployments` many-per-`event_id`
- per-poster scan series → `scans.poster_deployment_id` + `scan_bucket`
- geo → `h3_res9` / `h3_res7` on both `poster_deployments` and `scan_aggregates`
- demo isolation → existing `data_class` doctrine

**Genuinely new, additive only:**

- `poster_deployments`: `segment`, `surface`, `variant_label`, `print_run`,
  `season_start`, `season_end` — six `ALTER TABLE ADD COLUMN`, one migration
- `venues` (+ `consented_at`) and a nullable `venue_id` on `poster_deployments`
- a weekly per-poster reporting query reading `scans`, K=5 suppressed

**Only if a non-event destination is genuinely required:**

- `destinations`, and relaxing `poster_deployments.event_id` to nullable

That last item is the only structurally invasive change in the whole proposal,
and **Harbor Country Cabins does not need it** — a perpetual event row serves.

### 7.1 The invariants, re-scored

| Draft                             | Verdict                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PST-01 poster_single_destination  | Already true — `event_id NOT NULL`, single FK                                                                                                                                                                                                                       |
| **PST-02 poster_token_immutable** | **Real, cheap, and the best item in the list.** True in practice (the update handler builds its SET from an explicit allowlist that excludes `qr_token`) but **ungated** — nothing stops a future field being added. Born-red static gate, same pattern as OSE-322. |
| PST-03 no_scan_reservation_join   | Real and new. The constitutional rule.                                                                                                                                                                                                                              |
| PST-04 poster_reporting_k5        | Extends existing K=5, does not invent it                                                                                                                                                                                                                            |
| PST-05 placement_requires_consent | Real, but depends on the `venues` entity existing first                                                                                                                                                                                                             |
| PST-06 perpetual_no_destroy       | **Drop — guards a job that does not exist** (§3)                                                                                                                                                                                                                    |
| PST-07 no_client_storage_on_scan  | Already covered by the existing born-red E2E; extend its surface list                                                                                                                                                                                               |

---

## 8. Task 3 — proposed sizing (not created)

Ordered. All of it lands **after OSE-802**, per the draft's own sequencing
verdict, which this reconciliation agrees with.

| #   | Story                                             | Size | Notes                                                                                                   |
| --- | ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| 1   | Static gate: `qr_token` is never updated (PST-02) | S    | No migration. Pure CI gate. **Shippable before OSE-802** — it touches no schema.                        |
| 2   | Weekly per-poster scan series, K=5 suppressed     | M    | Query + surface. Reads `scans`, not `scan_aggregates`. No migration. **Also shippable before OSE-802.** |
| 3   | `poster_deployments` +6 campaign columns          | S    | One additive migration. After OSE-802.                                                                  |
| 4   | `venues` entity + `consented_at` + PST-05         | M    | After 3.                                                                                                |
| 5   | Variant generator (N posters from one CONFIG)     | S    | After 3.                                                                                                |
| 6   | PST-03 no-scan-join negative assertion            | S    | Independent; can land any time.                                                                         |
| 7   | `destinations` + nullable `event_id`              | L    | **Defer.** Not needed for season one or two. Open until a non-event destination actually exists.        |

Items 1, 2 and 6 need no migration at all and are not blocked by OSE-802.

---

## 9. What this changes about season one

The draft recommends running season one manually on paper, with the platform
built in parallel for season two. This reconciliation **strengthens that
recommendation from a different direction**: season one does not need the
manual fallback _because the platform is missing the capability_ — it can run on
the platform as it stands today, with zero migrations.

A perpetual event row (`end_date = NULL`), ten to twelve `poster_deployments`
rows with distinct `qr_token`s, and the segment carried in `placement_label`
produces exactly the Series A the campaign needs. The only missing piece is the
weekly read (item 2 above), which is a query.

Whether to run season one on paper or on the existing platform is now a choice
about operational risk, not about capability.

---

_Verified against: `migrations/0001,0003,0004,0006,0007,0038,0047,0064,0067,0068`,
`migrations-forms/`, `src/index.ts`, `src/handlers/events.ts`,
`src/handlers/poster-deployments.ts`, `src/handlers/qr-scan.ts`,
`src/domain/event-phase.ts`, `src/lib/shared-report.ts`,
`OCR-docs/ocr-docs-brain/architectural-invariants.yaml`._
