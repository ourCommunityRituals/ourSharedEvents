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
label, lat/lng, and H3 res7/res9 cells. `scan_placement_events` (migration 0062, which
split and replaced the original `scans`) already records one row per scan per poster
in a privacy-bucketed time grain.

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
`poster_deployments`, `scan_placement_events`, `scan_node_returns`, or `scan_aggregates`.

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

## 4. `poster_scans` duplicates the split scan path

> **Corrected 2026-09-04 (later same day).** The first version of this section said
> the draft's `poster_scans` duplicates a table called `scans` (migration 0004).
> **`scans` does not exist.** Migration **0062** dropped it and split it in two. The
> substance of the finding holds — the per-poster, per-bucket row already ships —
> but it lives in a different table than named. Cause worth recording: that section
> was built from a `CREATE TABLE` grep across all migrations, which happily returns
> tables that were later dropped. Grep the head schema, not the migration history.

The draft proposes:

```sql
CREATE TABLE poster_scans (
  id, poster_id, scanned_at, week_bucket, data_class
);
```

Migration **0062** (`split_scan_path`) already shipped the same record, deliberately
split along the privacy boundary:

```sql
-- Placement side: WHICH poster, WHICH bucket. No session, no identity.
CREATE TABLE scan_placement_events (
  id, event_id, poster_deployment_id NOT NULL, scan_bucket NOT NULL, created_at
);

-- Return side: WHO returned to a node. No placement id, ever.
CREATE TABLE scan_node_returns (
  id, event_id, anonymous_id, user_agent_hash, country_code, scan_bucket, created_at
);
```

`scan_placement_events` **is** `poster_scans`. `scan_bucket` is `YYYY-MM-DDTHH:00` —
hour-granularity UTC, deliberately not an exact timestamp. Weekly rollup is a
read-time derivation; a stored `week_bucket` column would be redundant and lossier.

The split is the point and the draft should inherit it rather than re-merge it:
**placement and session never sit in the same row.** A table carrying both
`poster_deployment_id` and `anonymous_id` would make PST-03's "no scan-to-identity
join" a matter of query discipline instead of schema shape.

One caveat unchanged: `scan_aggregates` (0006) rolls up to `event_id` + `bucket_date`
and therefore **drops the poster dimension**. Per-variant weekly counts must read
`scan_placement_events` directly. That is a query, not a table.

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

## 6. Invariant 25 does NOT conflict — the poster is an instrument, not inventory

> **Corrected 2026-09-04 (founder, later same day).** The first version of this
> section concluded that "as coded, it conflicts." That was wrong, and it was wrong
> because it assumed the poster is an ad surface a sponsor buys space on.

**It isn't.** The poster carries no sponsor mark. It is a pre-event funnel and a
measurement instrument: scan or click → the five-W public page → the organiser's own
links → the share back out to friends and family. What the sponsor buys is the
**returning signal** in the SharedReport, not a position on the paper.

Invariant 25's own text puts that on the permitted list, by name:

> "Money buys **frequency-share and report depth** only — never size, slot, position,
> or is_local status."

A poster network that sells no logo, no slot and no position — only report depth — is
precisely what #25 says money _may_ buy. There is no conflict and no carve-out is
needed.

### 6.1 What to write down instead — a boundary, not an exemption

```
A poster is an instrument, not inventory. It carries no sponsor mark.
The moment a logo goes on one, it becomes a rotation surface and #25
applies in full.
```

One paragraph in #25's `protective_statement`. Stronger than a carve-out, because it
forecloses the drift rather than licensing it.

**Contingency only, if a mark is ever sold:** a print run _does_ have a frequency
dimension — not within one poster, but across the run. Uniform mark size and position
on every poster; locals hold >= LOCAL_FLOOR of poster-slots; no sponsor exceeds
PREMIUM_CAP of the run. `allocateShares()` runs unmodified with posters as the finite
pool. Note this makes the run-size decision load-bearing: at fifty variants a capped
sponsor still appears on twenty walls; at twelve the cap bites at five.

---

## 7. What a migration would actually have to touch

Far less than four tables.

**Already sufficient, no change needed:**

- perpetual destination → an active event with `end_date = NULL`
- many QRs → one destination → `poster_deployments` many-per-`event_id`
- per-poster scan series → `scan_placement_events.poster_deployment_id` + `scan_bucket`
- geo → `h3_res9` / `h3_res7` on both `poster_deployments` and `scan_aggregates`
- demo isolation → existing `data_class` doctrine

**Genuinely new, additive only:**

- `poster_deployments`: `segment`, `surface`, `variant_label`, `print_run`,
  `season_start`, `season_end` — six `ALTER TABLE ADD COLUMN`, one migration
- `venues` (+ `consented_at`) and a nullable `venue_id` on `poster_deployments`
- a weekly per-poster reporting query reading `scan_placement_events`, K=5 suppressed

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

| #   | Story                                                                                                     | Size | Notes                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Static gate: `qr_token` is never updated (PST-02)                                                         | S    | No migration. Pure CI gate. **Shippable before OSE-802** — it touches no schema.                                        |
| 2   | Weekly per-poster scan series, K=5 suppressed                                                             | M    | Query + surface. Reads `scan_placement_events`, not `scan_aggregates`. No migration. **Also shippable before OSE-802.** |
| 3   | `poster_deployments` +6 campaign columns                                                                  | S    | One additive migration. After OSE-802.                                                                                  |
| 4   | `venues` entity + `consented_at` + PST-05                                                                 | M    | After 3.                                                                                                                |
| 5   | Variant generator (N posters from one CONFIG)                                                             | S    | After 3.                                                                                                                |
| 6   | PST-03 no-scan-join negative assertion                                                                    | S    | Independent; can land any time.                                                                                         |
| 7   | Surface-resolution rule: `surface='digital'` implies `h3_res9 IS NULL` (§9)                               | S    | CHECK constraint + born-red gate. Lands with story 3.                                                                   |
| 8   | Digital deployment: hang `shortlinks` off a `poster_deployment` with `surface='digital'`, corridor-tagged | M    | The missing half of the instrument (§9.3). After 3.                                                                     |
| 9   | `destinations` vs `corridors.destination_node_id` — settle before migrating (§9.4)                        | —    | **Decision, not code.** Blocks 10.                                                                                      |
| 10  | `destinations` + nullable `event_id`                                                                      | L    | **Defer.** Not needed for season one or two, and possibly not at all — see 9.                                           |

Items 1, 2 and 6 need no migration at all and are not blocked by OSE-802. Item 9 is a decision, not work.

---

## 9. Surface determines resolution — proposed invariant

**Founder, 2026-09-04.** Geographic resolution is a property of **the deployment**,
never of the person. OCR does not geolocate anybody, at any point, on either surface.
No IP lookup, no third-party geolocation. The H3 cell on a record says _where the
marketing was put_, and it is read from OCR's own registered hierarchy
(`node_hierarchy`, `corridors` — migration 0010).

So the res9/res7 split is not measurement precision degrading. It is **the
granularity of the deployment itself**:

| Surface                           | Resolution                        | Why                                                                                       |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| **Physical** — QR on a wall       | **res9 (Node) + res7 (Corridor)** | The poster hangs at one registered place. You located _the wall_, and the wall consented. |
| **Digital** — shortlink in a feed | **res7 (Corridor) only**          | It was published into a corridor. It hangs nowhere. **There is no node to name.**         |

### 9.1 The rule

```
A deployment with surface = 'digital' has h3_res9 IS NULL.
```

Not a precaution about imprecision — a statement of fact. A digital deployment was
never placed anywhere physical, so a res9 cell would be fabricated. This makes
`surface` load-bearing: it decides which resolution fields are **legal to populate**.
Enforceable as a CHECK constraint plus a born-red gate, not a judgement at write time.

### 9.2 What this is NOT

Recording these because both were raised and both were wrong, and the next session
should not re-derive them:

- **Not IP geolocation.** An earlier draft of this section assumed digital res7 would
  come from Cloudflare's `cf.latitude`/`cf.longitude`. It does not. Nothing in this
  design consults a request's apparent location.
- **Not a collection expansion.** `shortlinks` (0030) stores `code`, `event_id`,
  `created_at` and a click counter — _"the count is the only datum collected. No IP,
  no anon_id, no session."_ That stays true. The cell lives on the deployment row OCR
  itself created, not on anything derived from a visitor.

### 9.3 Current state — the digital half is not built

`shortlinks` has no link to a `poster_deployment` and no H3 at all. So today the
physical path resolves to res9/res7 via the poster join, and the digital path
resolves to **nothing**. The rule is not being violated; the surface it governs does
not exist yet. That is the gap, and it matters — without it you cannot tell whether
social effort reached the corridor at all, only that somebody somewhere clicked.

### 9.4 `corridors` may already be the "destination"

The draft ADR proposes a new `destinations` table for the travel case (Door County,
the Driftless, Harbor Country). But `corridors` (0010) is already
`origin_node_id → destination_node_id`. Harbor Country is not "posters in Chicago
pointing at Michigan" — it is a **corridor** whose origin is the southwest-side
placement area and whose destination is Sawyer. Before anyone writes a migration,
settle whether `destinations` is a new entity or a `destination_node` that needs a
bookable face.

---

## 10. The three-layer SharedReport

**Founder, 2026-09-04.** This is the model the ADRs do not currently contain, and it
is what the poster primitive is _for_. A sponsor or organiser opens one SharedReport
and reads three layers, each clickable into its own picture, each rendered on the H3
layer.

| Layer              | Window         | What it measures                                   | Surfaces                                                                                                          |
| ------------------ | -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **1 — Poster**     | Pre-event      | Interest before the night. Did the marketing land? | Physical QR (res9) + digital shortlink (res7)                                                                     |
| **2 — Event**      | During         | Engagement in the room                             | Scans in-venue; sponsor QR funnels; the sponsor bar on the mobile public page; sponsor rotation on the TV/display |
| **3 — Post-event** | ~90 days after | The long tail                                      | Recap views, photos, captures, next-event and area promotion                                                      |

Individually each layer is a partial view. **Together they are the whole event**, and
the value is in reading them side by side: effort → room → tail.

### 10.1 The suppression is part of the story

The K=5 floor is usually described as a limitation. In a multi-week pre-event window
it is **narrative**: the report legitimately shows _nothing_ early, then crosses the
floor and begins to resolve, then compounds as the night approaches.

Week 1 below the floor → "too small alone." Week 2 clears → a count appears. Week 3
compounds. Then the event itself. Watching a corridor come alive is the product, and
the empty weeks are honest rather than broken.

**Design consequence:** the below-floor state is not an error state and must not be
styled as one. It is week one of a normal, healthy campaign. Empty and below-floor
states get designed _first_, not last.

### 10.2 Why the in-venue sponsor bar earns its clicks

At a tournament — bocce, darts, bags — attendees keep the public page open because
they genuinely need it: _what court am I on, who am I playing, what time, where do I
go next._ The sponsor bar rides at the top of information people already came for.

That is why a click there is worth something and is not an interruption. It also
means the two event-day surfaces are doing different jobs: the **TV/display** is
ambient rotation, the **phone** is the utility surface people return to all night.
The utility is what makes the sponsorship honest.

### 10.3 The post-event window is ~90 days

Long enough to send photos, name a tournament MVP, promote the next event and other
things happening in the area.

**This is the post-event _product_ window. It is not, by itself, an answer to the
scan-retention question in the draft ADR's §7** — that remains open with Tom. Do not
read one as settling the other.

---

## 11. The attendee layer — the ladder, and the one rung that is missing

**Founder, 2026-09-04.** The attendee side is not "a smooth UI." It is that **an
attendee can become a host**, at any scale, starting in a backyard — and can attach a
sponsor who is simply their friend with a local business.

The layers are not a hierarchy of who gets served. They are a **ladder anyone can
climb**, and the innovation is collapsing the friction to climb it. Event management
was slow to stand up, slower to manage, and getting a sponsor was harder still. The
product is removing that, _especially for the smallest actor_, economically.

This is the Triangle's corner-agnosticism made literal — "any entity plugs into any
corner… the Triangle enforces HOW entities participate, not WHAT they are." The
attendee is a Customer who becomes an Event; their friend is a Customer who becomes a
Sponsor. Every vertex benefits from the same transaction. And #5 Tier Equity already
states the floor in invariant form: pricing governs display priority only, **never
platform access** — same QR, forms, privacy and counts at every tier.

### 11.1 What the code can do today

| Rung                                      | Route                                         | Gate               | State                  |
| ----------------------------------------- | --------------------------------------------- | ------------------ | ---------------------- |
| Attach a sponsor (your friend's business) | `POST /api/v2/sponsors/draft`                 | **none** — public  | ✅ **built**           |
| Promote that sponsor to live              | `POST /api/v2/admin/sponsors/promote`         | `requireAdmin`     | ✅ built (review gate) |
| Upload a sponsor asset to a draft         | `POST /api/v2/sponsors/draft/:id/asset/:kind` | **none** — public  | ✅ built               |
| **Create the event to attach it to**      | `POST /api/v2/admin/events`                   | **`requireAdmin`** | ❌ **admin only**      |

**The ladder is half-built, and the missing rung is the first one.**

The sponsor half of "backyard host brings their friend" already works, and works
_well_ — a public draft, reviewed and promoted by a human. That is the right shape:
open to submit, gated to publish.

But there is **no self-serve event creation**. The only route that inserts an event is
admin-gated behind a CF Access JWT and an email allowlist. The backyard host — the
person the entire lowest-layer argument is about — cannot create the event they would
attach that sponsor to. Today they would have to be added to the admin allowlist,
which is not a ladder; it is a door with a list.

### 11.2 The architecture already contains the answer

The fix does not need inventing. **Mirror draft-then-promote from the sponsor path**:
`sponsor_business_draft` / `sponsor_asset_draft` (migrations 0065–0066) establish the
pattern — an unauthenticated submission lands in a draft table, a human promotes it.

An `event_draft` on the same shape gives the backyard host a front door without
handing anyone unauthenticated write access to the live events table. And the
automation half is already shipped: `event_templates`, `event_type_registry` and
`template_event_types` are what "automate creating the event types" means. **The
templates exist; the door doesn't.**

### 11.3 Consequences to record

- This is the highest-leverage gap between the stated vision and the shipped code
  found in this reconciliation. Everything else here is schema tidiness by comparison.
- It is **not** poster-primitive work and must not be folded into that epic. It
  belongs to whatever epic owns the front door.
- **#5 Tier Equity is 📋 proposed, not gated.** The invariant that says the lowest
  layer keeps full platform access has no mechanical enforcement. An `event_draft`
  path is what would make it testable rather than aspirational — the gate would assert
  that a tier-free, unauthenticated submitter can reach event creation at all.
- **OCR-116 copy implication.** The relief section currently names three
  beneficiaries — the host, the barber, the block. The fourth is **the attendee who
  becomes the host**, and it is the strongest of the four because it is the only one
  that is a _change in what the reader can do_ rather than a service performed for
  them. It is currently absent from the copy draft.

---

## 12. What this changes about season one

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
