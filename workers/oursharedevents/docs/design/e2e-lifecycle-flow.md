# E2E Lifecycle Flow — poster → pre-event → event → post-event

> **Status:** flow specification. Written to be executable — every stage names the
> surface, the actor, the mutation, the DB rows to assert, and the SharedReport
> checkpoint. Companion to `frontend-principles.md` (OSE-653), which governs _how_
> these surfaces are built; this doc governs _what the flow proves_.
>
> **Grounded, not aspirational.** Every table, column, route, and test ID below was
> read out of the code at the commit this doc landed on. Where the intended flow
> outruns what is currently measurable, it is marked **GAP** rather than assumed —
> see §9.

---

## 1. Why this flow is one test and not four

The product's claim is that a poster on a telephone pole in Evergreen Park turns into
a body in a room and then into a number a sponsor trusts. Every stage of that is
already testable in isolation. None of the isolated tests prove the claim, because
the claim is about the _handoffs_: the QR token minted at creation must be the one
scanned three weeks later, the deployment scanned must be the one attributed in the
report, and the figure the sponsor reads must be the figure the host reads.

So this runs as one ordered flow over one seeded event, asserting continuity at each
boundary.

### The wall that shapes the whole flow

The scan write is **split** (OSE-798). One tap produces two rows in two tables, and
they are deliberately un-joinable:

| Table                   | Carries                                                                      | Answers                                            |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `scan_placement_events` | `event_id`, `poster_deployment_id`, `scan_bucket`                            | **WHERE** — which physical placement drove scans   |
| `scan_node_returns`     | `event_id`, `anonymous_id`, `user_agent_hash`, `country_code`, `scan_bucket` | **WHO-shaped** — returns and reach, never identity |

No durable row carries both a placement id and a session-derived value. That is
doctrine rule 6, and it is the reason the heat map and the reach number are two
separate questions that cannot be joined into "this poster brought back these people."

**A test that tries to join them is asserting a breach, not a feature.** Any flow
step below that appears to need that join is written to the two questions separately.

---

## 2. Stage 0 — Event create

**Actor:** event manager · **Surface:** manager console · **Mode:** wizard _or_ deep dive

Both modes are the same flow at two disclosure depths (see §7). Both end in exactly
one mutating call.

**Mutation:** `POST /api/v2/admin/events` (admin auth: CF Access JWT or Bearer)

### The draft mechanism is a state, not a table

`handleCreateEvent` defaults `status` to **`'draft'`**. The lifecycle is a real state
machine (`domain/event-state.ts`):

```
draft ──> ready ──> active ──> archived
  ^         |         |           |
  +---------+---------+-----------+     (archived -> active | draft)
```

**INVARIANT: only `active` events render on public / display / poster.** `admin` sees
every state. This is what makes the wizard safe — see §8.1.

**Assert — `events` row exists with the authored columns:**

| Group     | Columns                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| identity  | `id` (`evt_<uuid>`), `brand_id`, `slug`, `status`                                 |
| when      | `start_date`, `end_date`, `timezone`                                              |
| 5W        | `what_short`, `who_host`, `why_purpose`, `how_details`, `where_address`           |
| how much  | `price_cents`, `price_model` ∈ `free·fixed·sliding·donation·varies`, `price_note` |
| rich WHO  | `who_story`, `who_image_url`, `what_video_url`                                    |
| geo       | `lat`, `lon`, `corridor_id`, `h3_res9`, `h3_res7`                                 |
| clearance | `legal_clearance_tier`                                                            |

**Assert — blank vs never-set is preserved.** `trimOrNull()` persists an
empty-after-trim string as `NULL`, so consumers can distinguish "intentionally blank"
from "never populated". A test that treats `''` and `NULL` as equivalent hides a real
authoring bug.

**Assert — derived, not supplied.** `h3_res9` / `h3_res7` come from `maybeTag(lat, lon)`
server-side. A body supplying them directly must not be honored.

**Assert — media URLs are scheme-validated at write.** `who_image_url` and
`what_video_url` go through `validateLogoUrl` — a `javascript:` or `data:` payload is
rejected with `INVALID_URL` and never reaches D1. Born-red: assert the rejection.

**Assert — the shortlink is minted here, unconditionally.** `createShortlink(env, id)`
runs on every create, including drafts. Failure is **non-fatal**: it logs
`SHORTLINK_CREATE_FAILED` and returns a `warnings[]` entry rather than failing the
event. Assert both paths — success populates `shortlinks`, and a forced failure still
returns `201` with the warning. `warnings` is always present (empty array on success)
so consumers need no null check.

Minting the code at creation is deliberate: the code is stable from the moment the
event exists, so a poster printed weeks early never points at a code that changes.

**Assert — computed on read:** `GET /api/v2/events/:id` returns `phase`, `name`,
`startDateISO`, `venue` on top of the projected columns
(`public-events.snapshot.json` v1.1.0).

## 3. Stage 1 — Poster creation and deployment (3–4 weeks out)

**Actor:** event manager · **Surface:** poster

One event yields **many** poster deployments. Each physical placement is its own row
with its own QR token — that is what makes the heat map resolve to a corner rather
than to the event.

**Assert — one `poster_deployments` row per placement:**

| Column                   | Meaning in the flow                                                       |
| ------------------------ | ------------------------------------------------------------------------- |
| `qr_token`               | unique; the token embedded in the printed QR. Resolves at `/q/<qr_token>` |
| `placement_label`        | human name — "Beverly Records front window"                               |
| `location_desc`          | free-text placement note                                                  |
| `latitude` / `longitude` | the physical coordinates                                                  |
| `h3_res9`                | **NCR Node (~174 m²)** — the specific corner or block                     |
| `h3_res7`                | **NCR Corridor (~5 km²)** — the commercial corridor                       |
| `is_active`              | inactive deployments never resolve                                        |

Two posters two blocks apart share an `h3_res7` and differ in `h3_res9`. That is the
resolution contract the heat map is built on (migration 0047).

**Digital and physical are the same mechanism.** A digital placement is a deployment
row whose QR is rendered on screen instead of printed. Nothing in the scan path
distinguishes them, so the comparison "did the window poster or the Instagram post
do more work" is a straight `poster_deployment_id` group-by.

**Assert — print correctness:** the poster renders with JavaScript disabled, and the
QR clears its quiet zone at photocopy contrast. Print is the surface where a
regression is discovered by a volunteer at a copy shop, not by CI.

---

## 4. Stage 2 — Pre-event: scan, land, share

**Actor:** attendee · **Surface:** public mobile

**Action:** scan a printed QR → `GET /q/<qr_token>`

**Assert — the resolve path, in order:**

1. Deployment resolved by `qr_token` where `is_active = 1`. Unknown or inactive token
   → `302 /` (never a 404 — a stranded attendee is a product failure).
2. Anon ID read from the `ose_anon` HttpOnly cookie, or minted. **The front end never
   reads this value** — it is HttpOnly by design, so the browser passes it and the
   client never touches it.
3. **5-minute dedup:** KV key `scan:dedup:{anonId}:{deploymentId}:{5min_bucket}`.
   Same person, same poster, same window → no second row. Assert this explicitly:
   scan twice inside five minutes, expect exactly one row pair.
4. Split write, batched so both land or neither does:
   - `scan_placement_events` ← `event_id`, `poster_deployment_id`, `scan_bucket`
   - `scan_node_returns` ← `event_id`, `anonymous_id`, `user_agent_hash`, `country_code`, `scan_bucket`
5. `302 → /forms/{eventId}?type={register|checkin|survey|email-signup}&deployment={id}`
   with `Cache-Control: no-store`. An unrecognized `type` falls back to `register`.
6. Cookie set on the redirect only when the visitor is new.

**Assert — a scan write failure never strands the attendee.** The redirect happens
regardless; the error is logged as `SCAN_WRITE_ERROR`. Simulate a DB failure and
assert the attendee still lands on the form.

**Assert — the pre-event page funnel order.** Locked by
`tests/pre-event-funnel-order.spec.ts`:

```
event-what → event-who → event-where → event-how-much → event-how
```

WHO precedes WHERE because interest in a person is what converts a forwarded link
into a body in the room. HOW MUCH precedes HOW because cost gates commitment. These
test IDs are grandfathered — do not rename them.

**Assert — sponsor presence is an ambient band, never modal:** `pre-sponsor-strip`
renders when active sponsors exist, is absent when none do, and excludes inactive
sponsors.

### Reach and sharing — what is actually measurable

**GAP-1 (see §9).** The intended signal is "a forwarded link shows corridor activity
and reach." Read at the implementation level, the shortlink path cannot produce
either today, and the reasons are different for each.

**What the path actually does** (`lib/shortlinks.ts`, `handlers/shortlink-resolve.ts`):

1. `createShortlink()` mints a 6-char base62 code at event creation. Same code path
   as the `events` row, so both commit or neither does.
2. `GET /s/:code` → `isValidCodeShape()` rejects malformed codes **before touching
   D1**, so probing costs nothing.
3. Unknown and malformed codes return the **identical 404 shape**, so probing reveals
   nothing about which codes exist.
4. `incrementClick()` performs the only mutation: `clicks = clicks + 1` and
   `last_clicked_at`. It swallows D1 errors — the redirect is the user contract, the
   counter is not.
5. `302 → /events/:id`, `Cache-Control: no-store`.

The whole table is five columns: `code`, `event_id`, `created_at`, `clicks`,
`last_clicked_at`.

**Corridor activity — blocked by an enforced gate, not by an omission.**
`handleShortlinkResolve` is registered in `tests/anonymity-gate.spec.ts` as a gated
public handler. The test greps the function body and fails on any of seven reads:

```
Cf-Connecting-Ip · X-Forwarded-For · headers.get('Cookie')
getOrCreateAnonId · setAnonCookie · headers.get('Referer') · headers.get('User-Agent')
```

So this is not "nobody built it yet." Adding geo here means amending a named
anonymity gate backed by ADR-001. **One path would not trip the gate today:**
`request.cf` (Cloudflare's IP-derived `latitude`/`longitude`) is neither used nor
listed in `FORBIDDEN_READS`, so `request.cf → maybeTag() → h3_res7` is technically
available. Whether that honors the doctrine or merely evades its literal wording is a
**product and doctrine decision, not an engineering one** — the module comment states
the counter is "the ONLY mutation the resolve flow performs," which reads as intent,
not just description. Flagged for a decision; not implemented.

**Reach is a deeper problem than geo.** Even with a corridor tag, `shortlinks` has no
distinct-person column and cannot get one without the cookie the gate forbids. So the
path yields **clicks, not reach** — 40 clicks could be 40 neighbors or one person
opening a link 40 times. "Friends and family sharing" is a distinct-person question,
and the shortlink path is structurally incapable of answering it.

**What the flow asserts instead, from real data:**

| Question                    | Source                                                      | Real today             |
| --------------------------- | ----------------------------------------------------------- | ---------------------- |
| Which placement drove scans | `scan_placement_events` → `poster_deployments.h3_res9`      | ✅ per-corner          |
| Which corridor is active    | same → `poster_deployments.h3_res7`                         | ✅ per-corridor        |
| Distinct people / returns   | `scan_node_returns` distinct `anonymous_id` → `return_rate` | ✅                     |
| A forwarded link's corridor | —                                                           | ❌ gate-blocked        |
| A forwarded link's reach    | —                                                           | ❌ structurally absent |

Note the asymmetry the split write creates: the `/q/` poster path _does_ carry both a
placement and an anon id — in two un-joinable tables. The `/s/` path carries neither.
A shortlink is deliberately the thinnest touchpoint in the system.

## 5. Stage 3 — Event live

**Actor:** attendee, venue staff · **Surfaces:** public mobile, TV display

Two scan populations converge in the room:

**Attendance** — QR at the door, same `/q/` path, same split write, same dedup. The
`type=checkin` variant lands the attendee on the check-in form.

**Sponsor interest from the TV** — the display carries sponsor QR codes. Scanning one
records a `sponsor_impressions` row (which carries `h3_res9`/`h3_res7` per migration
0048). Run this across all three share-of-voice tiers:

| Tier      | DB `tier` values | Weight | Per-sponsor cap     |
| --------- | ---------------- | ------ | ------------------- |
| `base`    | bronze, primary  | 1      | none (pool-bounded) |
| `mid`     | gold, silver     | 3      | 20%                 |
| `premium` | title, platinum  | 7      | 40%                 |

**Assert — the covenant walls hold** (`allocateShares`, Invariant #25):

- `sum(sharePct) === 100` for any non-empty input.
- The `is_local` class collectively holds ≥ **30%** whenever any local sponsor exists.
- No premium/mid sponsor exceeds its cap **when the cap is satisfiable**. With few
  sponsors the cap is not binding — one sponsor is necessarily 100%. Assert the
  sparse regime explicitly so a future "fix" does not break it.
- An unknown tier **throws** (fail-closed), never silently maps to premium.
- The returned object has **no size, slot, or position field**. Wall 3 holds by
  construction: uniform placement cannot be violated by a value that does not exist.

**Assert — `is_local` is geo-derived and unbuyable.** `POST`/`PUT` a sponsor with
`is_local: true` in the body and assert it is ignored; the value comes from the
sponsor↔event `h3_res7` corridor-cell match only.

**Assert — the TV display survives the event.** Flat memory across an 8-hour run, no
timer drift, deterministic rotation on a stated schedule, last-known-good state on a
dropped connection (never a browser error page), and `prefers-reduced-motion`
respected.

---

## 6. Stage 4 — Post-event

**Actor:** attendee, event manager, sponsor · **Surface:** public mobile, TV display

**Assert — recap-first by layout.** Per `frontend-principles.md` A3, the recap area
dominates and future-event suggestions are marginal. This is a layout-invariant
assertion (recap area ≥ N× suggestions), not a copy check.

**Assert — `post-sponsor-thanks` renders** when sponsors exist, absent when none.

**Sponsor click-through:** clicking a sponsor records the interaction and resolves to
the sponsor's URL. Assert the XSS wall holds — a `javascript:` sponsor URL renders
**name-only with no `href` emitted**; a valid HTTPS URL renders as an anchor
(`public-event-stakeholder-surfaces.spec.ts`).

---

## 7. SharedReport checkpoints — the same numbers, twice

Run after each of stages 2, 3, and 4.

**One API, two views.** `GET /api/v2/events/:id/shared-report` is a **straight
readout with no field-stripping**. The signed-link bearer token binds
`(event_id, role, exp)` with optional `depth` and `sponsor_id`. Roles:
`bar_owner | sponsor | admin`.

**Depth filters by OMISSION only.** From `report-depth.ts`: _"no value is ever
transformed, rounded, or degraded per tier. Same pipeline, same numbers, fewer
sections."_

| Depth     | Who gets it                        | What it buys                                       |
| --------- | ---------------------------------- | -------------------------------------------------- |
| `local`   | sponsor (legacy default)           | proof — "I was there": headcount + own logo counts |
| `mid`     | —                                  | + intermediate sections                            |
| `premium` | admin / bar_owner (legacy default) | full report                                        |

`sponsor_class_breakdown` is present at **every** depth (OSE-719) — class-level
aggregate, never per-competitor. Competitive context is not a paid feature.

**Assert the fields** (`shared-report.snapshot.json` v1.0.0): `unique_gatherings`,
`return_rate`, `corridor_density`, `sponsor_impressions[]`, `campaign_summary`,
`poster_attribution`, `headcount_trend`, `corridor_map`, `_meta`.

**Assert — sponsor slice isolation.** `role=sponsor` sees only their own
`sponsor_impressions` rows. Cross-contamination is a critical bug, not a leak of
convenience. Seed two sponsors, assert each sees exactly one slice.

**Assert — suppression is honest.** The corridor map floors at
`CORRIDOR_MAP_MIN_COUNT = 5`. A floored cell renders a **suppression label**, never a
number. Per principle A1, a numeric animated skeleton on a suppressible cell is a
wall trap — it promises a number and snaps to "suppressed". Assert the loading state
of a suppressible cell is a neutral text/em-dash loader.

**Assert — the side-by-side property.** This is the point of the design. Fetch the
same event as `role=sponsor` and as `role=bar_owner`. Every figure present in both
must be **byte-identical**, and must be **visually identifiable as the same figure**
in both renders. A sponsor and a host comparing screens across a table is the
intended use.

**Assert — no client-recomputed values.** Per principle B1, optimism is boolean or
visual state only. No count changes before its fetch resolves; share-of-voice is
never recomputed in the browser.

---

## 7b. Surface deep-link addressing

Every event-scoped surface link an organizer copies out of the dashboard must address
_that_ event. `?event=<id>` is the canonical param on both sides as of OSE-1081:

| Surface      | Reads                                          | Behavior                                                                                                                                                   |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| poster       | `?event=`                                      | resolves against the fetched list, **and moves the `<select>` to the same index** — the picker is the page's source of truth for "which event is showing"  |
| display      | `?event=`                                      | requested event takes the featured slot; the rest of the board keeps its original order, so a scoped link narrows focus without hiding what else is coming |
| sharedReport | `?event=`, falling back to `?eventId=`, `?id=` | back-compat retained                                                                                                                                       |

**Assert — the producer/consumer agreement.** `admin.html`'s `scopedSurfaceUrl()` emits
the param and each surface reads it. Before OSE-1081 the producer emitted `?event=` and
no consumer read it, so every scoped link silently showed _some other_ event. That is a
handoff bug invisible to any per-surface test — it only appears when you follow the link
the dashboard actually produces. Assert by generating the link from admin and following
it, never by constructing the URL in the test.

**Assert — a scoped link works standing alone** (§4): opened cold, in a new session,
with no referrer.

## 8. Mutation matrices

### 8.1 Event manager — wizard and deep dive

**The invariant, stated once — corrected against the code.** An earlier draft of this
doc claimed the wizard must make exactly one mutating call at publish "because there is
no event draft table." That premise was wrong, and the rule it produced was over-strict.

There **is** a draft mechanism: `events.status`, defaulted to `'draft'` by
`handleCreateEvent`, governed by the state machine in §2. Every public render path
gates on it:

| Path          | Draft / ready behavior                                                         | Source                 |
| ------------- | ------------------------------------------------------------------------------ | ---------------------- |
| `/events/:id` | **404**, not 403 — "so an attacker can't probe to discover unpublished events" | `pages.ts`             |
| `/forms/:id`  | forwarded to `/events` discovery — "a poster must never rot" (OSE-291)         | `form-pages.ts`        |
| `/s/:code`    | resolves, then 404s at the redirect target                                     | `shortlink-resolve.ts` |

So the wizard **may** save server-side freely as `status='draft'`, which buys
resume-across-devices for free. The real rule is narrower and stronger:

> **No transition to `active` until publish**, and no artifact whose effects outlive a
> discarded draft.

**Two things are NOT state-gated, and the flow must assert them deliberately:**

1. **`createShortlink` fires on every create, including drafts.** Safe — the code
   resolves to a 404 while draft — and deliberate: the code is stable from creation so
   an early-printed poster never goes stale.
2. **Poster deployments are not gated on event status.**
   `handleAdminCreatePosterDeployment` never reads `events.status`, so a draft event can
   mint a `qr_token` with `is_active = 1`. `/q/<token>` checks only the _deployment's_
   `is_active` — so **a scan of a draft event's QR still writes both split rows** before
   the destination forwards. Render is gated; the write path is not.

Whether (2) is correct is a product question — counting pre-launch scans may be wanted —
but it must be an assertion either way, not an accident. **Raised in §9 as GAP-2.**

| Scenario                              | What the tester does                                                     | Assert                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **wizard-happy-path**                 | Create through the wizard, accepting every default                       | `events` row matches §2. Every accepted default traces to a stated rule (§2.7) — no default exists that a comment cannot justify in one sentence.                                                                                                           |
| **deep-dive-override-all**            | Create through deep dive, overriding every panel                         | Same row _shape_ as wizard-happy-path. The two modes are one flow at two depths, so they cannot produce structurally different rows.                                                                                                                        |
| **back-step-change-answer**           | Advance three steps, go back two, change an answer, go forward           | The changed answer wins and the forward steps reflect it. Status still `draft`.                                                                                                                                                                             |
| **fat-finger-correct-before-publish** | Enter a wrong value, advance, realize it, navigate back, fix it, publish | Status never leaves `draft` until publish. **No poster deployment created, no sponsor resolution run.** Throughout, `/events/:id` 404s and `/forms/:id` forwards. The published row carries the corrected value, never the mistake.                         |
| **repeating-card-add-remove-add**     | Add three items to a repeating card, remove the middle one, add two more | Removal targets the intended row — never index drift. Order stable and predictable across the whole sequence.                                                                                                                                               |
| **abandon-and-resume**                | Abandon mid-flow, close the tab, return                                  | The draft is still there. Under the state model this may resume from the server (`status='draft'`), which also gives resume on a _different device_ — assert whichever the build chooses, and assert it does not silently lose answers.                     |
| **abandoned-draft-lifecycle**         | Abandon a wizard permanently; never publish                              | The orphan is accounted for. Nothing renders publicly (already gated), but drafts accumulate in `events` with no cleanup path today. Assert the intended behavior — expire, list-for-cleanup, or keep forever — rather than discovering it as table growth. |
| **storage-disabled-completes**        | Run the whole flow in private browsing with storage unavailable          | The flow completes. Storage is an optimization, never a requirement (§6).                                                                                                                                                                                   |
| **double-tap-publish**                | Double-tap the publish button                                            | Exactly one `events` row, and exactly one `shortlinks` row. Idempotent or guarded — never two events.                                                                                                                                                       |
| **publish-error-preserves-work**      | Publish while the server returns 5xx                                     | The draft survives and the user retries without re-entering anything.                                                                                                                                                                                       |
| **switch-mode-mid-flow**              | Switch wizard ↔ deep dive halfway through                                | Answers carry across. Same flow, different disclosure — not a restart.                                                                                                                                                                                      |
| **shortlink-failure-is-non-fatal**    | Force `createShortlink` to fail during publish                           | Event still created, `201` returned, `warnings[]` carries `SHORTLINK_CREATE_FAILED`. The organizer sees a retry affordance, not a lost event.                                                                                                               |

**fat-finger-correct-before-publish is the load-bearing one.** Assert it on _state and
artifacts_, not on request count: `SELECT status FROM events` never reads `active`
before publish, `poster_deployments` for the event stays empty, and every public path
still refuses. Counting requests was the earlier — and wrong — formulation; a
server-side draft is legitimate, so a mutation count of zero is neither required nor
desirable.

### 8.2 Sponsor — category and event-type variation

Tables in play: `event_type_registry`, `template_event_types`, `sponsor_event_types`,
`sponsor_areas`, `sponsor_business`, `sponsor_placement`, `sponsor_asset`.
Draft entry: `POST /api/v2/sponsors/draft`.

| Scenario                             | What the tester does                                   | Assert                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **subscribe-whole-category**         | Subscribe to an entire category                        | `sponsor_event_types` resolves to the full type union for that category via `template_event_types`.                                                         |
| **uncheck-two-types**                | Subscribe, then uncheck two types                      | The union recomputes. Bundle-vs-custom intent persists — the flat join is lossy, so intent must survive a reload.                                           |
| **uncheck-everything**               | Uncheck every type in a category                       | Rejected with an explanation, not a silent empty subscription.                                                                                              |
| **recheck-all-clears-edited**        | Re-check all types after a custom edit                 | Returns to whole-bundle state and the "edited" marker clears.                                                                                               |
| **restricted-cluster-needs-consent** | Try to bulk-select a restricted / kid-adjacent cluster | Bulk-select refused. Each restricted type must be individually, consciously checked.                                                                        |
| **change-service-area**              | Change the service area (zip or radius)                | Path-2 resolution changes accordingly. `is_local` recomputes from the corridor match — **never from the request body**.                                     |
| **organizer-rejects-sponsor**        | Organizer rejects a sponsor for one event              | Durable. Path 2 does not re-propose that business for that event.                                                                                           |
| **sponsor-rejects-placement**        | Sponsor rejects a placement                            | Hidden. `accepted = NULL` means unanswered and does **not** hide — rejection is the operative action, so existing placements keep working with no backfill. |
| **deactivate-business**              | Deactivate the sponsor business                        | Both resolution paths drop it. `is_active = 0` on the business itself, not merely cascaded onto placements.                                                 |
| **single-asset-renders-everywhere**  | Supply only one asset format                           | The sponsor still renders on **all** surfaces at identical frequency via the server COALESCE chain (override → derived → logo → UEC monogram).              |

**single-asset-renders-everywhere is the covenant's honesty test:** what formats a sponsor uploaded must never become
a de-facto slot advantage.

---

### 8.3 Mutation testing — measured, not proposed

The scenario matrices above vary _user input_. This varies _the source_, to answer a
different question: when a test passes, is it because the behavior is right, or because
the test is weak? "Born-red" already asks that per-test by hand. This generalizes it.

**Method** (deliberately cheap — no Stryker, no new dependency): back up a pure module,
`sed` one value, run its specs, restore. A mutant that survives is a claim nobody is
checking.

**What was actually run**, against `src/lib/sponsor-allocation.ts` — the covenant walls,
the highest-stakes pure function in the system:

| Mutant                               | Behavioral spec alone | With the brain layer |
| ------------------------------------ | --------------------- | -------------------- |
| `local_floor_pct` 30 → 29            | **SURVIVED**          | killed               |
| `premium_cap_pct` 40 → 41            | **SURVIVED**          | killed               |
| `mid_cap_pct` 20 → 25                | —                     | killed               |
| weights `premium` 7 → 1              | **SURVIVED**          | killed               |
| `min_presence_pct` 2 → 0             | —                     | killed               |
| unknown tier → `premium` (fail-open) | killed                | killed               |

**The finding.** `sponsor-share-rotation.spec.ts` pins the covenant's _structure_ —
shares sum to 100, ordering is stable, an unknown tier throws — but **not one of its
numbers.** Every wall value is pinned solely by `sponsor-allocation-drift-check.spec.ts`
asserting byte-equivalence against `ocr-docs-brain/sponsor-allocation.yaml`.

That is a sound design: the brain is the source of truth and the mirror is checked
against it, so the numbers live in exactly one place. **The brain is load-bearing for
correctness, not just for documentation.**

**The risk it creates.** The drift check _skips silently_ when the brain is absent:

```
[vitest config] brain sponsor-allocation artifact not found — drift check will skip.
      Tests  16 passed | 1 skipped (17)
```

A developer without the sibling clone gets a green suite while every covenant number is
unpinned — 3 of 4 mutants survive and nothing goes red. CI is safe (`oursharedevents-ci.yml`
checks out `ourCommunityRituals/OCR-docs` and sets `BRAIN_DIR`), so this is a local-only
false-green. But it is the precise shape the consistency audit named as red-team theater:
a gate that reports success when it did not run. **Recommend: make the local skip loud,
or fail the run outright when the brain is missing.** Tracked as GAP-6.

**Where to extend it, within reason.** Mutation testing earns its cost on pure,
invariant-critical functions with fast specs — not across a 25k-line Worker. Each of
these runs in about a second:

| Module                  | Why it is worth mutating                               |
| ----------------------- | ------------------------------------------------------ |
| `sponsor-allocation.ts` | the covenant walls — done above                        |
| `report-depth.ts`       | omission-only filtering; a weak test hides a tier leak |
| `event-state.ts`        | the draft→active gate the whole wizard flow rests on   |
| `event-phase.ts`        | drives what every one of the five surfaces renders     |
| `event-staleness.ts`    | the "poster must never rot" forward                    |
| `event-price.ts`        | HOW MUCH formatting across five price models           |
| `shortlinks.ts`         | code shape validation and collision retry              |

Useful operators for this codebase, in rough value order: change a numeric literal;
flip a comparison (`>=` → `>`); negate a boolean guard; swap `&&` / `||`; change a
fail-safe default (`?? 'base'` → `?? 'premium'`); drop one branch of an `||` in a state
gate (e.g. `status === 'draft' || status === 'ready'`).

Run it as a periodic audit, not a per-PR gate — a surviving mutant is a conversation
about what a test is for, and that is worth a human reading it.

## 9. Gaps and open questions

**GAP-1 · Shortlink yields clicks only — and it is defended, not merely absent.**
Two separate blockers, verified in code. (a) _Corridor:_ `handleShortlinkResolve` is a
gated handler in `tests/anonymity-gate.spec.ts`; adding geo means amending an
anonymity gate backed by ADR-001. The one non-tripping path is `request.cf`
(IP-derived lat/lon, neither used nor listed in `FORBIDDEN_READS`) — available, but
whether it honors the doctrine or evades its wording is a decision to make
deliberately. (b) _Reach:_ the table has no distinct-person column and cannot get one
without the forbidden cookie, so clicks ≠ reach regardless of geo. Corridor activity
and distinct returns are both available from the `/q/` poster path instead. **Needs a
product decision before any code.**

**GAP-2 · The QR write path is not state-gated.** Render paths all gate on
`events.status` (404 on `/events/:id`, stale-forward on `/forms/:id`). Poster-deployment
creation does not: `handleAdminCreatePosterDeployment` never reads `events.status`, so a
draft event can mint a live `qr_token`, and `/q/<token>` — which checks only the
deployment's own `is_active` — writes `scan_placement_events` + `scan_node_returns`
before the destination forwards the scanner away. Result: scan rows accrue for an event
no surface will render. Possibly desirable (pre-launch interest), possibly a leak into
SharedReport aggregates. **Needs a decision; assert it either way.**

**GAP-3 · Heat map and reach cannot be joined.** By design (OSE-798, doctrine rule 6).
Any report or test phrased as "which poster brought back returning visitors" is
asking for a breach. Both questions are answerable separately; the join is not.

**GAP-4 · No calendar feed.** No `.ics`, no `text/calendar`, no VCALENDAR anywhere.
Any "follow this node" step in the flow has nothing to point at yet.

**GAP-5 · No performance budget gate.** No CI check enforces the per-surface budgets.
The long-run TV memory test and the JS-off poster test likewise have no home yet.

**GAP-6 · The brain drift check skips silently when the brain is absent.** Measured in
§8.3: without `ocr-docs-brain/`, 3 of 4 covenant mutants survive and the suite still
reports green (`16 passed | 1 skipped`). CI is safe — it checks out OCR-docs and sets
`BRAIN_DIR` — so the exposure is local development, where a contributor can change a
covenant wall and see nothing go red. Make the skip loud, or hard-fail without the brain.

**OPEN-1 · Sponsor tier vocabulary is ambiguous across three axes.** `sponsors.tier`
(title…primary, display), flags tiers (free/mid/enterprise, features), and report
depth (local/mid/premium, what a viewer sees) are three different things that share
words. Any UI copy naming a "tier" must say which one. Brand voice says **`Pro plan`,
never "Mid"** customer-facing.

**OPEN-2 · `--status-live` color.** Teal in OSE (red/green as semantic opposites is
the primary colorblind failure) vs `#FF4136` in OW (broadcast convention). Product
call, encoded per-brand so either answer is a one-line change.
