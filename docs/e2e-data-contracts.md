# E2E Data Contracts

> **Step 1 of the gated build. Nothing gets built until this is confirmed.**
>
> Every column below was **read** from `workers/oursharedevents/migrations/*.sql` at the
> commit this landed on, not inferred from what the code happens to emit. Anything I am
> inferring rather than reading is tagged **[INFERRED]** and needs your ruling.
>
> Four flows in the prompt **cannot pass as written**. Those are in §7, before the
> contracts, because two of them are contradicted by shipped invariants and no amount of
> front-end work will make them green. Reporting them as defects in the spec is what the
> prompt asks for.

---

## 1. `events` — E2E-01, E2E-02 column contract

Main DB (`DB`). Base table migration 0002; columns added through 0053.

| Column                                        | Type              | Null | Assertion                                                        |
| --------------------------------------------- | ----------------- | ---- | ---------------------------------------------------------------- |
| `id`                                          | TEXT PK           | no   | matches `^evt_`                                                  |
| `brand_id`                                    | TEXT              | no   | equals the seeded brand (`root` unless scoped)                   |
| `title`                                       | TEXT              | no   | equals input, trimmed, ≤200 chars                                |
| `slug`                                        | TEXT UNIQUE       | no   | slugified from title unless supplied                             |
| `slug_locked`                                 | INTEGER           | no   | default `0`                                                      |
| `status`                                      | TEXT              | no   | **`'draft'` on create.** `'active'` only after publish           |
| `description`                                 | TEXT              | yes  | ≤2000                                                            |
| `location`                                    | TEXT              | yes  | ≤500                                                             |
| `start_date` / `end_date`                     | TEXT              | yes  | ISO-8601                                                         |
| `timezone`                                    | TEXT              | yes  | default `America/New_York`                                       |
| `what_short`                                  | TEXT              | yes  | ≤300; `''` → `NULL`                                              |
| `who_host`                                    | TEXT              | yes  | ≤200; `''` → `NULL`                                              |
| `why_purpose`                                 | TEXT              | yes  | ≤2000; `''` → `NULL`                                             |
| `how_details`                                 | TEXT              | yes  | ≤2000; `''` → `NULL`                                             |
| `where_address`                               | TEXT              | yes  | ≤500; `''` → `NULL`                                              |
| `who_story`                                   | TEXT              | yes  | ≤4000, stored raw, escaped on render                             |
| `who_image_url`                               | TEXT              | yes  | http(s) only — `javascript:`/`data:` rejected `INVALID_URL`      |
| `what_video_url`                              | TEXT              | yes  | http(s) only, same guard                                         |
| `price_cents`                                 | INTEGER           | yes  | `0` = free; `NULL` = unset                                       |
| `price_model`                                 | TEXT              | yes  | one of `free·fixed·sliding·donation·varies`                      |
| `price_note`                                  | TEXT              | yes  | qualifier for sliding/varies                                     |
| `lat` / `lon`                                 | REAL              | yes  | from server geocode                                              |
| `h3_res9`                                     | TEXT              | yes  | **server-derived** via `maybeTag()`; body-supplied value ignored |
| `h3_res7`                                     | TEXT              | yes  | same — this is the corridor cell                                 |
| `corridor_id`                                 | TEXT              | yes  | TEXT to match `corridors.id`                                     |
| `legal_clearance_tier`                        | INTEGER           | yes  | —                                                                |
| `event_type_id` / `template_id` / `series_id` | TEXT              | yes  | —                                                                |
| `zip_code` / `data_class` / `qr_verified`     | TEXT/TEXT/INTEGER | yes  | —                                                                |
| `created_at` / `updated_at`                   | TEXT              | no   | `datetime('now')`                                                |

**Blank vs never-set is load-bearing.** `trimOrNull()` persists empty-after-trim as
`NULL`. An assertion treating `''` and `NULL` as equal hides a real authoring bug.

**E2E-02 equivalence assertion:** the wizard row and the deep-dive row must satisfy this
same contract. They are one flow at two disclosure depths, so a structural difference is
a defect, not a mode difference.

---

## 2. `shortlinks` — E2E-01

| Column            | Type                | Null | Assertion                            |
| ----------------- | ------------------- | ---- | ------------------------------------ |
| `code`            | TEXT PK             | no   | 6 chars, base62 (`isValidCodeShape`) |
| `event_id`        | TEXT FK→`events.id` | no   | matches the created event            |
| `created_at`      | TEXT                | no   | —                                    |
| `clicks`          | INTEGER             | no   | default `0`                          |
| `last_clicked_at` | TEXT                | yes  | `NULL` until first resolve           |

Minted unconditionally by `createShortlink()` inside `handleCreateEvent`, **including for
drafts**. Failure is non-fatal: logs `SHORTLINK_CREATE_FAILED`, returns `201` with a
`warnings[]` entry. Assert both paths.

`GET /s/:code` → `302 /events/:id`. Unknown and malformed codes return an **identical
404** so probing reveals nothing.

---

## 3. `poster_deployments` — E2E-03

**This resolves the prompt's open question.** Each physical placement is its **own row
with its own `qr_token`** — not a shared code with a site parameter. The heat map works.

| Column                      | Type        | Null | Assertion                                                             |
| --------------------------- | ----------- | ---- | --------------------------------------------------------------------- |
| `id`                        | TEXT PK     | no   | —                                                                     |
| `event_id`                  | TEXT FK     | no   | —                                                                     |
| `qr_token`                  | TEXT UNIQUE | no   | the token in the printed QR; resolves at `/q/<token>`                 |
| `placement_label`           | TEXT        | yes  | human name — "Beverly Records front window"                           |
| `location_desc`             | TEXT        | yes  | free-text placement note                                              |
| `latitude` / `longitude`    | REAL        | yes  | physical coordinates                                                  |
| `h3_res9`                   | TEXT        | yes  | **NCR Node ≈174 m² — the specific corner.** Per-placement attribution |
| `h3_res7`                   | TEXT        | yes  | **NCR Corridor ≈5 km²**                                               |
| `is_active`                 | INTEGER     | no   | default `1`; inactive tokens never resolve                            |
| `created_at` / `updated_at` | TEXT        | no   | —                                                                     |

Created by `POST /api/v2/admin/poster-deployments`, a **separate admin action** from
event create. It never reads `events.status` — see §7 defect D-4.

---

## 4. The scan path — E2E-03, E2E-04

**There is no `scans_table`.** The prompt's `<<scans_table>>` placeholder assumes one
table. The write was split (OSE-798) into two rows in two tables, written in one
`DB.batch()` so both land or neither does.

### 4a. `scan_placement_events` — the WHERE

| Column                 | Type    | Null | Assertion                           |
| ---------------------- | ------- | ---- | ----------------------------------- |
| `id`                   | TEXT PK | no   | `spe_` prefix                       |
| `event_id`             | TEXT FK | no   | —                                   |
| `poster_deployment_id` | TEXT FK | no   | **the site attribution**            |
| `scan_bucket`          | TEXT    | no   | coarse time bucket, not a timestamp |
| `created_at`           | TEXT    | no   | —                                   |

### 4b. `scan_node_returns` — the return signal

| Column            | Type    | Null | Assertion                                          |
| ----------------- | ------- | ---- | -------------------------------------------------- |
| `id`              | TEXT PK | no   | `snr_` prefix                                      |
| `event_id`        | TEXT FK | no   | —                                                  |
| `anonymous_id`    | TEXT    | yes  | from the HttpOnly `ose_anon` cookie                |
| `user_agent_hash` | TEXT    | yes  | **hash only** — raw UA never stored                |
| `country_code`    | TEXT    | yes  | `CF-IPCountry`; **no IP, no region below country** |
| `scan_bucket`     | TEXT    | no   | —                                                  |
| `created_at`      | TEXT    | no   | —                                                  |

**No durable row carries both a placement id and a session-derived value.** That is
doctrine rule 6, and it is why E2E-03's "site attribution _and_ scan-source
classification" in one assertion is not satisfiable — see §7 defect D-3.

**Dedup:** KV `scan:dedup:{anonId}:{deploymentId}:{5min_bucket}`, TTL 300s. Same person,
same poster, same window → exactly one row pair. Assert by scanning twice inside five
minutes.

**Dead tables — do not assert against these:** `scans`, `checkins`, `registrations`.
Neither written nor read anywhere in `src/`. `checkins`/`registrations` still carry
`attendee_name` and `attendee_email_hash` **in the main DB** — see §7 defect D-5.

---

## 5. `sponsor_impressions` — E2E-04, E2E-05

One table serves both the in-event scan and the post-event click; `event_type`
distinguishes them, which answers E2E-05's "distinguishable from an in-event scan."

| Column       | Type    | Null | Assertion                                                |
| ------------ | ------- | ---- | -------------------------------------------------------- |
| `id`         | TEXT PK | no   | —                                                        |
| `sponsor_id` | TEXT    | no   | —                                                        |
| `event_id`   | TEXT    | no   | —                                                        |
| `surface`    | TEXT    | no   | which surface produced it (tv / mobile / poster)         |
| `placement`  | TEXT    | no   | —                                                        |
| `event_type` | TEXT    | no   | **`'impression'` or `'click'`** — default `'impression'` |
| `h3_res7`    | TEXT    | yes  | corridor cell                                            |
| `created_at` | TEXT    | no   | —                                                        |

Routes: `POST /api/v2/events/:id/sponsors/:sid/impression` and `.../click`
(`sponsors.ts:1273`).

**[INFERRED]** The prompt's "sponsorship-interest rows, one per tier scanned" maps onto
`sponsor_impressions` rows whose sponsor resolves to each tier — there is no separate
interest table. Confirm that reading.

---

## 6. SharedReport — E2E-03, E2E-04, E2E-05

`GET /api/v2/events/:id/shared-report`. Signed-link bearer binding `(event_id, role, exp)`
plus optional `depth` and `sponsor_id`. Roles: `bar_owner | sponsor | admin`.

Fields (`shared-report.snapshot.json` v1.0.0): `event_id`, `event_title`,
`event_start_date`, `event_end_date`, `unique_gatherings`, `return_rate`,
`corridor_density`, `sponsor_impressions[]`, `campaign_summary`, `poster_attribution`,
`headcount_trend`, `corridor_map`, `_meta`.

**The cross-check the prompt calls the whole point works, and here is why:** the read API
is a straight readout with **no field-stripping**. Depth filters **by omission only** —
"no value is ever transformed, rounded, or degraded per tier. Same pipeline, same
numbers, fewer sections." So a figure present in both roles must be **byte-identical**.

**Scoping negative case:** `role=sponsor` sees only its own `sponsor_impressions` rows.
Seed two sponsors, assert each sees exactly one slice. Assert `403` when the token's
`event_id` claim does not match the path.

**Suppression:** `CORRIDOR_MAP_MIN_COUNT = 5`. A floored cell renders a **suppression
label, never a number** — and its loading state must be a neutral text/em-dash loader,
because a numeric skeleton that snaps to "suppressed" is a wall trap.

---

## 7. Defects in the flow spec — these cannot pass as written

### D-1 · E2E-01 sponsor slate rule contradicts the shipped covenant — **blocker**

The prompt requires the UI to enforce "at least one local, one mid, and one premium" and
to **block submission** when a tier is available but unselected. Three problems, all
verified in code:

1. **`local` is not a tier.** Tiers are `base | mid | premium` (`sovTierOf`, mapped from
   the six DB pricing tiers). `is_local` is an orthogonal **geo-derived boolean** — the
   sponsor↔event `h3_res7` corridor-cell match. `handleAdminUpdateSponsor` does not even
   include it in `allowedFields`; a body supplying `is_local` is ignored.
2. **Managers do not curate a slate.** Sponsors resolve automatically: direct placement
   (organizer-initiated) _or_ template+geo subscription (sponsor-initiated). The resolver
   header states the locals-first display sort is **retired** under Invariant #25.
3. **A tier-gating control would violate §3.1's own rule** that no UI may imply a local
   sponsor can be pushed off the floor. The covenant is a rotation-**frequency** floor
   (locals collectively ≥30%), not a slate composition requirement.

**Cannot be built without contradicting Invariant #25.** Needs your ruling on what the
manager's real job is: (a) accept/reject resolved placements — two-sided acceptance
exists in the API; (b) a read-only resolved-slate view with the covenant explained; or
(c) something else.

### D-2 · "r7" is not a redirect hop — **spec error, resolved**

The prompt asks to define r7 as "a redirect service, a route prefix, or a Worker route."
It is none. **r7 = `h3_res7`**, the NCR Corridor H3 cell (~5 km²) — a geospatial
resolution, not a hop. The redirect chain is `/s/:code → 302 → /events/:id`, full stop.

### D-3 · E2E-03 reach and site attribution cannot be asserted together — **blocker**

The flow wants scan rows carrying "site attribution and scan-source classification," and
reach distinguishable from direct scan. The split write makes placement and
session-derived data **structurally un-joinable**. Both questions are answerable
separately; the join is a breach, not a feature.

Worse for the flow as written: **the shortlink path records neither.** `incrementClick()`
writes `clicks` and `last_clicked_at` only, and `handleShortlinkResolve` is a gated
handler in `anonymity-gate.spec.ts` that fails on seven identity reads. There is also no
distinct-person column, so shortlink data yields **clicks, not reach** — 40 clicks could
be 40 neighbors or one person opening a link 40 times.

**Rewrite proposal:** assert corridor activity from `scan_placement_events` →
`poster_deployments.h3_res7`, and returns from `scan_node_returns` distinct
`anonymous_id`. Drop "reach via shortlink" until the doctrine question in GAP-1 is
decided.

### D-4 · Draft events mint live QR tokens — **needs a ruling**

`handleAdminCreatePosterDeployment` never reads `events.status`. A draft event can mint a
`qr_token` with `is_active = 1`; `/q/<token>` checks only the **deployment's** flag, so a
scan **writes both split rows** before the destination forwards the scanner away. Render
paths are all gated (404 / stale-forward); the write path is not. Possibly wanted
(pre-launch interest), possibly a leak into SharedReport aggregates.

### D-5 · Dead PII columns in the main DB — **hygiene, not blocking**

`checkins` and `registrations` (migration 0005) carry `attendee_name` and
`attendee_email_hash` in `DB`, not `FORMS_DB`. Both tables are dead — no reads, no writes
anywhere in `src/`. They should be dropped so the anonymity assertion cannot pass
vacuously against a table nobody uses.

### D-6 · "No email capture" contradicts the shipped Forms subsystem — **spec regression**

The prompt states no email capture, no PII. That was corrected earlier: the flagged Forms
subsystem is real, consented, and destroyed on a clock — `FORMS_DB` is a physically
separate database, `EMAIL_RETENTION_MS` is 30 days, `REGISTRATION_TTL_MS` is 90 days, a
daily cron at `0 3 * * *` runs in all three environments, and every phase writes
`pii_audit_log`. The anonymity assertion should read **"no PII outside `FORMS_DB`, and
nothing in `FORMS_DB` without consent and a destruction clock"** — not "no PII anywhere."

---

## 8. Unresolved placeholders

| Placeholder                     | Status                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `<<TARGET_MS>>`                 | **needs your number.** Suggest LCP < 1.5 s mid-tier Android / 4G                             |
| `<<TARGET_KB>>`                 | **needs your number.** Suggest 60 KB public mobile, 150 KB TV, 120 KB consoles, 30 KB poster |
| `<<throttled network profile>>` | **needs your number.** Suggest Slow 4G: 400 kb/s down, 400 ms RTT                            |
| `<<events_table>>`              | resolved → `events` (§1)                                                                     |
| `<<scans_table>>`               | resolved → **two** tables (§4); see D-3                                                      |
| physical placement codes        | resolved → per-placement `qr_token` (§3)                                                     |
| `<<r7>>`                        | resolved → `h3_res7`, not a hop (D-2)                                                        |

---

## 9. What I need before step 2

1. **D-1** — the manager's real sponsor job. Blocks E2E-01 and E2E-02.
2. **D-3** — accept the rewrite, or rule on the GAP-1 doctrine question.
3. **D-4** — should a draft event's QR record scans?
4. The three performance numbers in §8.
5. Confirmation of the one **[INFERRED]** item in §5.
