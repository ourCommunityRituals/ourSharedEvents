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

> **Scoped by §12.4.** This section governs deployments with a **fixed registered
> location**. A mobile item — a belt, a library book — has none and must not inherit one.

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

## 12. Items, not people — the standard that makes anonymous collection portable

**Founder, 2026-09-04.** The item destination is not a feature for trophies. It is the
mechanism by which anonymous collection **generalises across institutions** — libraries,
rec centres, schools — because in every one of them the thing being measured is an
**item**, never a person.

A librarian running a summer reading programme does not care whether the borrower is a
child or an adult. They are measuring circulation. Anonymity is not a compromise there;
it is the correct instrument for the question.

### 12.1 The boundary, in the founder's words

> "They will have to use their cards to take out the items. But the library cards are on
> them. The items are on me."

That is the two-database split, **externalised across an organisational boundary**:

| Side                                              | Holds                                                | Governed by                                   |
| ------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| **The institution** (ILS, SIS, membership system) | The person. The card, the enrolment, the membership. | Their existing legal mandate and duty of care |
| **OCR**                                           | The item's travel. Item X, node Y, hour Z.           | Zero-PII by construction                      |

**OCR never performs the join. The institution does** — on their side, in their system,
under their own governance, because they are the party with both the authority and the
obligation for identity data. OCR ships the item-side series; they correlate it against
whatever they legitimately hold.

This is ADR-004 §6's two-independent-time-series model generalised from one client to a
whole class of counterparty. Series A is ours and anonymous; Series B is theirs and never
ingested.

### 12.2 Why this is the standard and not just a nice property

**The sensitivity of the vertical does not increase OCR's exposure**, because OCR's side
of the boundary is byte-identical in every vertical. A school is a far more dangerous data
environment than a bocce league — but OCR holds the same thing in both: an item, a node, an
hour. There is no student record to leak because there is no student record.

That is what makes the standard portable. Each new vertical is a new _counterparty_, not a
new privacy posture.

It also means **PST-03 stops being a good idea and becomes the thing that makes the vertical
possible.** "No table, view, query, or export joins scan data to any external booking,
reservation, guest, or named record" is not hygiene here — it is the reason a library can
adopt this at all. The temptation to join is enormous: _which patrons read the most_ is the
first question anyone will ask. The answer has to be structurally unavailable, not
declined by policy.

### 12.3 Where the type belongs — a registry row, not a table

Verified 2026-09-04: **no `destination_type` and no `'item'` exists anywhere** in the
schema or source. But the _mechanism_ ships today, with zero migrations — a perpetual
event (`end_date = NULL`, held in phase indefinitely by `event-phase.ts`) plus a
`poster_deployments` row carrying the `qr_token`. The object is the destination; the QR is
the deployment.

And `event_type_registry` (0023) is the natural home for the type itself: it already
carries `uec_code`, `phase`, `legal_clearance_tier` and `regulatory_notes`. A
library-item type is a **registry row**, not a schema change — and `legal_clearance_tier`
is exactly the right hook, because these verticals carry statutory obligations beyond the
ones OSE was designed against.

### 12.4 Correction to §9 — it governs FIXED deployments only

§9 states that geographic resolution is a property of the deployment, because a poster
hangs at one registered wall. **A mobile item breaks that.** A challenge belt travels
between holders; a library book goes home with whoever borrowed it. There is no fixed
wall, so there is no cell to inherit.

§9 is therefore scoped, not universal:

```
§9 governs deployments with a fixed registered location.
A mobile item has no such location, and MUST NOT inherit one.
```

Two honest options for an item scan, and this is a real design choice:

1. **No cell at all** — we do not know where the item is, and recording nothing is the
   accurate answer.
2. **A cell only when the scan occurs at a registered node** — at the library, at the
   tournament venue — and null everywhere else.

Option 2 is richer and still honest, because the cell then describes a _place OCR
registered_, not a place a person was inferred to be. Either way, an item must never
inherit a res9 cell from a deployment that does not physically hang anywhere.

### 12.5 Flagged for legal review — NOT asserted here

These verticals carry statutes OSE has not been reviewed against. Recording the flag, not
an opinion:

- **Library circulation records** are separately protected in most US states, independent
  of BIPA.
- **Schools** bring FERPA, and minors bring COPPA.

The architecture's answer in each case is the same — OCR holds no person, so there is no
protected record on our side — but _"we believe there is nothing to protect"_ is a claim
that needs counsel behind it before it is said to a school district. Route with the §7
retention question.

---

## 13. The 47 event types — a clearance frontier, and the half-wired lattice

**Founder, 2026-09-04:** _"The clearance review comes into the layers — where is it being
placed, and how is it coming through. That's how it's been set up from the very beginning."_

Verified. It is, and it is older than the poster work.

### 13.1 There was never a technical ceiling

`event_type_registry.uec_code` holds `'REC-BOCCE-001'` — a **namespaced semantic string**,
not a slot in the 7-colour UEC enumeration. Nothing stops the 48th type or the 480th. The
47 was never a capacity limit.

**47 is a clearance frontier**: the count of types that have been legally reviewed and
assigned a tier. Bocce is tier 1, `'LLC + ToS only'`.

### 13.2 Clearance is a lattice, not a property

Migration **0023** creates both halves in one file, on the same 1–5 scale, because they
are one idea:

| Dimension                 | Column                                               | Question                       |
| ------------------------- | ---------------------------------------------------- | ------------------------------ |
| **What kind of thing**    | `event_type_registry.phase` / `legal_clearance_tier` | Is this type cleared?          |
| **Where it is happening** | `corridor_regulatory_status.phase_unlocked`          | Is this corridor ready for it? |

Clearance is the **intersection**. The migration's own comment: _"legal_clearance_tier
mirrors the phase ceiling for quick query filtering."_

**This supersedes an earlier proposal in this session.** A "type proposal → human clearance
review → registry row" pipeline was drafted as the answer to unlimited types. It is
unnecessary — it reinvents as a workflow what already exists as a computed property. There
is no review queue to build. A type carries a phase; a corridor unlocks a phase; the type
surfaces where the corridor has caught up.

### 13.3 So the list can grow safely — an uncleared type is inert, not dangerous

A new type at a higher tier is not a free-text hole. It is **registered and inert** until a
corridor earns it — the same "inert until earned" discipline as the monetisation hooks
(#6). That answers the expansion question: add types freely; the layers decide where they
appear.

Two options considered and rejected, with their specific failure modes:

- **Unlimited free-text types.** Types would exist that never carried a tier;
  `legal_clearance_tier` degrades to an unset default and the regulatory posture silently
  becomes "assume it's fine." Survivable for bocce, not for libraries or schools.
- **A single custom bucket.** Worse. What tier is "custom"? And it collapses incompatible
  things into one reporting cell, so a book club and a boxing match aggregate together —
  counts that look robust and mean nothing, which is what the honesty lexicon exists to
  prevent.

### 13.4 Enforcement state — the WHAT axis is wired, the WHERE axis is not

| Axis            | Mechanism                                   | State                       |
| --------------- | ------------------------------------------- | --------------------------- |
| **Type / tier** | `lib/template-clearance.ts`                 | ✅ **enforced**             |
| **Corridor**    | `corridor_regulatory_status.phase_unlocked` | ❌ **zero reads in `src/`** |

The enforced half is good work and worth not re-deriving:

- **`NULL` is never selectable** — a template with no registry mapping cannot be chosen, and
  that is deliberately distinct from tier 1. Fail-safe by default.
- **The ceiling is config** (`ALLOWED_MAX_TIER`), never a literal inside the predicate, so
  raising it is a config change rather than a code change.
- **`LAUNCH_MAX_CLEARANCE_TIER = 1`**, with a tier-2 fixture proving the gate bites before
  any tier-2 data exists.

**The gap:** `phase_unlocked` is modelled since 0023 and consumed nowhere. The intersection
is never computed. What ships instead is a **single global ceiling**.

Consequence, stated precisely:

- **The safety holds.** A tier-2 type added today is inert _everywhere_. You cannot
  accidentally ship an uncleared type. It fails closed.
- **The granularity does not.** A corridor ready for tier 2 cannot have it without raising
  the ceiling for every corridor simultaneously. It fails closed **globally** rather than
  opening **selectively** — which is the whole point of layers.

Wiring `phase_unlocked` into the clearance predicate is the smallest change that makes the
lattice real. It is not poster work.

### 13.5 Partially answers §12.5's legal flag

`template-clearance.ts` states: _"only Phase-1 (tier 1) event types are offered at launch;
COPPA/HIPAA (higher tiers) are unavailable by construction."_

So COPPA is **already named in code and locked out structurally** — §12.5 raised it as an
open risk, and it is better covered than that implied. Counsel is still required to _raise_
a tier for a school or library vertical, but the lockout is real, tested, and not
aspirational. Library circulation statutes remain unaddressed either way.

---

## 14. The inverted pyramid — enablement at the bottom, MAX() when they combine

**Founder, 2026-09-04.** Picture a reverse pyramid. It starts at the **niche, at the very
bottom** — levels 0–3, the backyard, the block, the local sponsor. That is where the
friction gets removed and where the whole strategy aims. As you climb, entities get bigger
and better established, and **governance rightly gets heavier**.

At the low levels, rules are looser and flexibility is higher. At the mid and high levels
they mix into a **web** — and when levels combine, **the stricter regulation always wins.
That is not a compromise; that is how it works.**

The strategy follows from it: _"if you want that to happen, you have to enable. Public-private
partnership starts by enabling webs at the lowest level and working up."_

### 14.1 The pyramid is modelled

`node_hierarchy` (0010) carries `level` (1–7) with a human `level_label` — _'Community',
'District'_ — on a self-referential parent tree. Level 1 is the niche floor; level 7 the
established top. `corridors.level` mirrors the same 1–7 scale.

### 14.2 "Regulation wins" is already the right operator, and it is load-bearing

Migration **0057** implements it, and marks it so:

```sql
-- (LOAD_BEARING). MAX() over the mapped types; unmapped templates get NULL
SELECT MAX(r.legal_clearance_tier)
```

`MAX()` over everything a template maps to; unmapped yields `NULL`, which
`template-clearance.ts` treats as never-selectable. **Stricter wins, and absence fails
closed.** 0057 also notes this is the reusable statement the promotion path (OSE-736)
invokes, so it was built to be applied more than once.

The governance doctrine is therefore not aspirational. It is implemented, defensive, and
named load-bearing.

### 14.3 The gap — one axis of four

| Axis                                  | Question                                                                         | `MAX()` applied?                   |
| ------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| Template → its mapped event types     | Which tier does this template inherit?                                           | ✅ **yes** (0057)                  |
| Corridor readiness                    | Is this corridor unlocked for that tier?                                         | ❌ `phase_unlocked` unread (§13.4) |
| Node level                            | Does pyramid position raise the requirement?                                     | ❌ `level` never read in `src/`    |
| **Multi-party combination — the web** | **When a level-1 event partners with a level-5 institution, whose rules apply?** | ❌ **nothing computes this**       |

`corridors` is never queried from `src/` at all.

### 14.4 What combining actually constrains — category and disclosure, NOT the partnership

> **Corrected 2026-09-04 (founder, same session).** An earlier draft of this section said a
> low-governance event partnering with a high-governance institution was _"the scenario that
> ends a public-private partnership on day one."_ **That is wrong and it is alarmist.**

**There is no legal binding stopping public-private community promotion.** It is among the
most ordinary things in civic life: sponsored Little League jerseys, "brought to you by"
banners at the park district, a library summer reading programme backed by the grocery
store, ice cream shop coupons for finishing the reading challenge. Rec centres do this
constantly and have for decades.

The error was treating "higher governance" as **blocking the partnership**. It does not.
What it constrains is narrower and entirely tractable:

1. **Sponsor category.** A public entity typically cannot take alcohol, tobacco, cannabis,
   gambling or political sponsorship — especially where minors are present. The rule is
   about _which sponsor_, never _whether a private sponsor is allowed at all_.
2. **Disclosure and endorsement language.** How the sponsorship is labelled, and that it is
   not presented as a public endorsement. The entity already has this policy and already
   discharges it for its banners.
3. **Data.** Where OCR is already clean by construction — no PII, so no patron or student
   record can cross anything.

None of that stops the ice cream shop. All of it is category and wording.

**The determination is the entity's own policy and counsel, not OCR's to make.** OCR's job
is to make the constraint expressible so the rec centre's existing policy can be honoured
inside the product, not to adjudicate it.

### 14.5 Which means the modelling need is much smaller — and half-built

The right mechanism is not "compute MAX across participants and block the join." It is a
**sponsor-category constraint carried by the higher-governance participant**.

That machinery already exists in a neighbouring form:

- `sponsor_business.business_type` (0065)
- `business_type_category_map` (0059) — `business_type` x `category`, with `is_default`

Today that map is a **matching aid**: which categories a business type naturally fits. The
governance version is the same data read as an **exclusion**: at an event hosted by a
public entity, these business types are not offerable.

Same table, opposite direction. That is a far smaller change than the one §14.3 implied,
and it fails in the right direction — a category that is not permitted is simply not
offered, so the rec centre never has to decline it.

### 14.6 The structural finding still stands

The enforcement gap in §14.3 is real and unchanged: `MAX()` runs on one axis of four, and
`corridors` is never queried from `src/`. Combination genuinely computes nothing today.

What changed is the **characterisation of the risk**. It is not that partnerships are
dangerous and must be gated. It is that the product currently has no way for a
higher-governance participant to express _"not these sponsor categories at our events"_ —
so the rec centre has to police it manually, outside the tool, which is exactly the
friction the platform exists to remove.

Framing it as a safety gate would have misdirected the work toward blocking the web. The
actual work is enabling it correctly.

Not poster work. This is the third item this reconciliation has surfaced that belongs to
another epic — with the event-draft front door (§11) and wiring `phase_unlocked` (§13.4).

---

## 15. What this changes about season one

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
