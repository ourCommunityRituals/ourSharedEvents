# E2E Lifecycle Flow — poster → pre-event → event → post-event

> **Status:** flow specification. Written to be executable — every stage names the
> surface, the actor, the mutation, the DB rows to assert, and the SharedReport
> checkpoint. Companion to `frontend-principles.md` (OSE-653), which governs *how*
> these surfaces are built; this doc governs *what the flow proves*.
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
the claim is about the *handoffs*: the QR token minted at creation must be the one
scanned three weeks later, the deployment scanned must be the one attributed in the
report, and the figure the sponsor reads must be the figure the host reads.

So this runs as one ordered flow over one seeded event, asserting continuity at each
boundary.

### The wall that shapes the whole flow

The scan write is **split** (OSE-798). One tap produces two rows in two tables, and
they are deliberately un-joinable:

| Table | Carries | Answers |
|---|---|---|
| `scan_placement_events` | `event_id`, `poster_deployment_id`, `scan_bucket` | **WHERE** — which physical placement drove scans |
| `scan_node_returns` | `event_id`, `anonymous_id`, `user_agent_hash`, `country_code`, `scan_bucket` | **WHO-shaped** — returns and reach, never identity |

No durable row carries both a placement id and a session-derived value. That is
doctrine rule 6, and it is the reason the heat map and the reach number are two
separate questions that cannot be joined into "this poster brought back these people."

**A test that tries to join them is asserting a breach, not a feature.** Any flow
step below that appears to need that join is written to the two questions separately.

---

## 2. Stage 0 — Event create

**Actor:** event manager · **Surface:** manager console · **Mode:** wizard *or* deep dive

Both modes are the same flow at two disclosure depths (see §7). Both end in exactly
one mutating call.

**Mutation:** `POST /api/v2/admin/events` (admin auth: CF Access JWT or Bearer)

**Assert — `events` row exists with the authored columns:**

| Group | Columns |
|---|---|
| identity | `id`, `brand_id`, `slug`, `status` |
| when | `start_date`, `end_date`, `timezone` |
| 5W | `what_short`, `who_host`, `why_purpose`, `how_details`, `where_address` |
| how much | `price_cents`, `price_model` ∈ `free·fixed·sliding·donation·varies`, `price_note` |
| rich WHO | `who_story`, `who_image_url`, `what_video_url` |
| geo | `lat`, `lon`, `corridor_id`, `h3_res9`, `h3_res7` |
| clearance | `legal_clearance_tier` |

**Assert — derived, not supplied:** `h3_res9` / `h3_res7` are server-derived from the
geocoded address. A request body that supplies them directly must not be honored.

**Assert — computed on read:** `GET /api/v2/events/:id` returns `phase`, `name`,
`startDateISO`, `venue` on top of the projected columns (`public-events.snapshot.json`
v1.1.0). A missing computed field is a contract break, not a rendering bug.

---

## 3. Stage 1 — Poster creation and deployment (3–4 weeks out)

**Actor:** event manager · **Surface:** poster

One event yields **many** poster deployments. Each physical placement is its own row
with its own QR token — that is what makes the heat map resolve to a corner rather
than to the event.

**Assert — one `poster_deployments` row per placement:**

| Column | Meaning in the flow |
|---|---|
| `qr_token` | unique; the token embedded in the printed QR. Resolves at `/q/<qr_token>` |
| `placement_label` | human name — "Beverly Records front window" |
| `location_desc` | free-text placement note |
| `latitude` / `longitude` | the physical coordinates |
| `h3_res9` | **NCR Node (~174 m²)** — the specific corner or block |
| `h3_res7` | **NCR Corridor (~5 km²)** — the commercial corridor |
| `is_active` | inactive deployments never resolve |

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

**GAP.** The intended signal is "a forwarded link shows corridor activity and reach."
Today the `shortlinks` table stores a click counter and nothing else — its schema
comment is explicit: *"Anonymous: the count is the only datum collected. No IP, no
anon_id, no session."* So `/s/<code>` resolution yields a count, not an `h3_res7`.

What **is** measurable today, and what the flow should assert instead:

- **Corridor activity** — from `scan_placement_events` joined to
  `poster_deployments.h3_res7`. Real, per-corridor, per-placement.
- **Return / reach behavior** — from `scan_node_returns` distinct `anonymous_id`,
  which is what `return_rate` in the SharedReport is built from.
- **Off-poster arrival** — `referrer_domain` on the legacy `scans` path.

Attributing an `h3_res7` to a shortlink resolution would require a back-end change,
and it is not a free one: the current design collects nothing per-resolution on
purpose. Adding a coarse geo to that path is a deliberate anonymity trade, not an
oversight to patch. **Raised, not assumed** — see §9.

---

## 5. Stage 3 — Event live

**Actor:** attendee, venue staff · **Surfaces:** public mobile, TV display

Two scan populations converge in the room:

**Attendance** — QR at the door, same `/q/` path, same split write, same dedup. The
`type=checkin` variant lands the attendee on the check-in form.

**Sponsor interest from the TV** — the display carries sponsor QR codes. Scanning one
records a `sponsor_impressions` row (which carries `h3_res9`/`h3_res7` per migration
0048). Run this across all three share-of-voice tiers:

| Tier | DB `tier` values | Weight | Per-sponsor cap |
|---|---|---|---|
| `base` | bronze, primary | 1 | none (pool-bounded) |
| `mid` | gold, silver | 3 | 20% |
| `premium` | title, platinum | 7 | 40% |

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

**Depth filters by OMISSION only.** From `report-depth.ts`: *"no value is ever
transformed, rounded, or degraded per tier. Same pipeline, same numbers, fewer
sections."*

| Depth | Who gets it | What it buys |
|---|---|---|
| `local` | sponsor (legacy default) | proof — "I was there": headcount + own logo counts |
| `mid` | — | + intermediate sections |
| `premium` | admin / bar_owner (legacy default) | full report |

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

## 8. Mutation matrices

### 8.1 Event manager — wizard and deep dive

**The invariant, stated once:** the wizard performs **exactly one mutating network
call, at publish.** There is no event draft table — `sponsor_business_draft` and
`sponsor_asset_draft` exist, the event side has nothing — so any step-transition
write would be an unrecoverable commit. Draft state lives in `sessionStorage` under
`ose:v1:manager:*` per the storage contract.

This makes the fat-finger requirement mechanically testable: **count the mutations.**

| # | Scenario | Assert |
|---|---|---|
| M1 | Create through **wizard**, accepting every default | One `POST`. `events` row matches §2. Every default that was accepted is traceable to a stated rule. |
| M2 | Create through **deep dive**, overriding every panel | One `POST`. Same row shape as M1. Wizard and deep dive produce structurally identical rows. |
| M3 | Advance three steps, go **back two**, change an answer, go forward | Zero mutations before publish. The changed answer wins. No orphaned draft server-side. |
| M4 | Enter a wrong value, advance, realize it, navigate back, fix it | Zero mutations. **No QR token minted, no poster deployment created, no shortlink generated, no sponsor resolution run.** |
| M5 | Add three items to a repeating card, remove the middle one, add two more | Order stable and predictable. Removal targets the intended row — never index drift. |
| M6 | Abandon mid-flow, close the tab, return | Draft restores from `sessionStorage`. Nothing was committed. |
| M7 | Abandon mid-flow with storage **disabled** (private browsing) | The flow still completes. Storage is an optimization, never a requirement. |
| M8 | Double-submit publish (double-tap the button) | Exactly one `events` row. Idempotent or guarded — never two events. |
| M9 | Publish with a server error | The draft survives. The user retries without re-entering anything. |
| M10 | Switch wizard ↔ deep dive **mid-flow** | Answers carry across. Same flow, different disclosure — not a restart. |

M4 is the load-bearing one. Assert it by counting non-`GET` requests across the whole
back-and-forth and expecting **zero** until publish is pressed.

### 8.2 Sponsor — category and event-type variation

Tables in play: `event_type_registry`, `template_event_types`, `sponsor_event_types`,
`sponsor_areas`, `sponsor_business`, `sponsor_placement`, `sponsor_asset`.
Draft entry: `POST /api/v2/sponsors/draft`.

| # | Scenario | Assert |
|---|---|---|
| S1 | Subscribe to a whole category | `sponsor_event_types` resolves to the full type union for that category via `template_event_types`. |
| S2 | Subscribe, then **uncheck** two types | The union recomputes. Bundle-vs-custom intent persists — the flat join is lossy, so intent must survive reload. |
| S3 | Uncheck every type in a category | Rejected with an explanation, not a silent empty subscription. |
| S4 | Re-check all types after a custom edit | Returns to whole-bundle state; the "edited" marker clears. |
| S5 | Subscribe to a **restricted / kid-adjacent** cluster | Cannot be bulk-selected. Each restricted type must be individually, consciously checked. |
| S6 | Change service area (zip / radius) | Path-2 resolution changes accordingly. `is_local` recomputes from the corridor match — **never from the request body**. |
| S7 | Organizer rejects a sponsor for one event | Durable. Path 2 does not re-propose that business for that event. |
| S8 | Sponsor rejects a placement | Hidden. `accepted = NULL` means unanswered and does **not** hide — rejection is the operative action. |
| S9 | Deactivate the business | Both resolution paths drop it. `is_active = 0` on the business, not just cascaded onto placements. |
| S10 | Supply only one asset format | The sponsor still renders on **all** surfaces at identical frequency, via the server COALESCE chain (override → derived → logo → UEC monogram). |

S10 is the covenant's honesty test: what formats a sponsor uploaded must never become
a de-facto slot advantage.

---

## 9. Gaps and open questions

**GAP-1 · Shortlink reach has no geo.** `shortlinks` records a click counter only, by
explicit design. "Resolve to r7 to show activity and reach" is not measurable on that
path today. Corridor activity is available via `scan_placement_events` →
`poster_deployments.h3_res7`. Adding coarse geo to shortlink resolution is a
deliberate anonymity trade requiring a back-end decision — **not** a front-end change.

**GAP-2 · No event draft table.** Fine, and arguably correct — it forces the
one-mutation-at-publish rule. Flagged so it is a decision on record rather than an
accident. If server-side resume across devices is ever wanted, that needs an
`event_draft` table mirroring the sponsor draft pattern.

**GAP-3 · Heat map and reach cannot be joined.** By design (OSE-798, doctrine rule 6).
Any report or test phrased as "which poster brought back returning visitors" is
asking for a breach. Both questions are answerable separately; the join is not.

**GAP-4 · No calendar feed.** No `.ics`, no `text/calendar`, no VCALENDAR anywhere.
Any "follow this node" step in the flow has nothing to point at yet.

**GAP-5 · No performance budget gate.** No CI check enforces the per-surface budgets.
The long-run TV memory test and the JS-off poster test likewise have no home yet.

**OPEN-1 · Sponsor tier vocabulary is ambiguous across three axes.** `sponsors.tier`
(title…primary, display), flags tiers (free/mid/enterprise, features), and report
depth (local/mid/premium, what a viewer sees) are three different things that share
words. Any UI copy naming a "tier" must say which one. Brand voice says **`Pro plan`,
never "Mid"** customer-facing.

**OPEN-2 · `--status-live` color.** Teal in OSE (red/green as semantic opposites is
the primary colorblind failure) vs `#FF4136` in OW (broadcast convention). Product
call, encoded per-brand so either answer is a one-line change.
