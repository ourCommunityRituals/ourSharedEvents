# CLAUDE.md — Persistent Brain for ourSharedEvents

> **Org-level vision lives in `OCR-docs/docs/VISION.md`.** This file governs OSE only. OSE is one product in the OCR product line — not the org brain.

> **Session protocol**: Read this file → Read STORIES.md → Find next unstarted story → Implement complete solution → Create PR. No other instruction needed.

> **Current reconciliation rule (2026-09-22)**: Do not treat the backlog table as the source of truth. The current code-vs-Linear audit in `docs/audits/LINEAR_BACKLOG_RECONCILIATION_2026-09-22.md` shows 23 items in the audited 99-ticket slice are already **DONE_IN_CODE**, 17 are **PARTIAL**, 7 are **UNCLEAR**, and 52 are still **NOT_STARTED**. For any new story or story update, confirm the repo has direct source + test evidence first; close only when the behavior is implemented and tests validate it, not merely because Linear/admin state says so.

> **ADR alignment rule**: ADRs are the decision rationale; the implemented code is the system-of-record. Read the ADR first for intent, then verify the live implementation. If the code and the ADR differ, update the ADR in the same change set or mark it as superseded/deprecated. See `docs/adr/ADR-RECONCILIATION-PROCESS.md` and `docs/adr/README.md` for the repo-wide reconciliation workflow.

---

## 1. Architecture Decisions

### Phase Model (3 Phases)

| Phase       | Stack                                                | Status             |
| ----------- | ---------------------------------------------------- | ------------------ |
| **Phase 1** | Cloudflare Worker + D1 (migrated from Google Sheets) | Build ✅ / Ops 📋  |
| **Phase 2** | Cloudflare Worker + D1 (edge SQLite)                 | Code ✅ / Infra 📋 |
| **Phase 3** | Firebase Auth + React/Tailwind on Firebase Hosting   | Not started        |

**Key principle**: Code is written and tested NOW, infrastructure is the last step. CC writes Worker routes, tests, migrations, and PRs without needing a live staging URL. CI validates. Infrastructure deployment happens when ready.

### Brand Motif: Rings and Triangles

Two visual/conceptual frameworks define the platform. These are the signature brand elements.

#### Triangle Framework

```
         Events
        ╱  ·   ╲
       ╱   ·    ╲
      ╱  Shared  ╲
     ╱  Reports   ╲
    ╱       ·      ╲
Sponsors ──────── Customers
```

- **Events** (apex): Gatherings/occasions — the core entity, always on top
- **Sponsors** (bottom-left): Brands supporting events — placement + tracking
- **Customers** (bottom-right): Attendees — represented by QR codes and shortlinks
- **SharedReports** (center): The proof layer — validates value for all three vertices

#### Ring Framework (NCR: Node, Corridor, Ring)

```
          Ads
        ↙     ↘
SharedReports  Pre-Events
      ↑            ↓
 Post-Events ← Events
```

Five lifecycle stages in a clockwise flywheel — Ads at 12 o'clock:

- **Ads**: Visibility — getting the word out (starts the cycle)
- **Pre-Events**: Incubation — registration, QR generation, sponsor setup
- **Events**: Engagement — check-ins, scans, live interaction
- **Post-Events**: Analytics — surveys, email signups, data collection
- **SharedReports**: Proof — aggregate results feed back into the next Ads cycle

### 5 MVP Surfaces

1. `admin.html` — Event management control room
2. `public.html` — Mobile-first public event page
3. `display.html` — TV/kiosk live event display
4. `poster.html` — Printable poster with QR codes
5. `sharedReport.html` — Shareable analytics dashboard

### API Contract

```
Public:
  GET /health                → { ok, env, version }
  GET /api/v2/events         → { ok, items[] }
  GET /api/v2/events/:id     → { ok, item }
  GET /                      → 200 HTML (public page)

Admin (CF Access JWT; X-OCR-Internal / Bearer fallbacks are env-gated):
  GET /admin                 → 200 HTML (dashboard)
  GET /api/v2/admin/events   → { ok, items[] } (includes archived)
```

### Worker Structure

```
workers/oursharedevents/src/
├── index.ts              # Entry point + scheduled PII lifecycle job
├── router.ts             # Route table (~80 method+path pairs)
├── auth/admin.ts         # Admin auth guard (CF Access JWT + Bearer fallback)
├── handlers/
│   ├── health.ts         # Health check
│   ├── events.ts         # Events API (D1 queries)
│   ├── pages.ts          # HTML pages (public, admin, landing)
│   ├── forms.ts          # Form submissions (register, checkin, survey, email)
│   ├── form-pages.ts     # Mobile-first QR form landing pages
│   └── feature-flags.ts  # Admin flag management (8 endpoints)
└── lib/
    ├── forms-db.ts       # Privacy utilities (hash, encrypt, bucket)
    ├── feature-flags.ts  # Flag resolution (3-tier: free/mid/enterprise)
    └── cors.ts           # CORS allowlist
```

---

## 2. ourCommunityRituals Ecosystem

> **Source of truth**: `OCR-docs/docs/VISION.md` — all product repos derive from that document.

| Code | Product                 | Repo                                   | Purpose                                                         |
| ---- | ----------------------- | -------------------------------------- | --------------------------------------------------------------- |
| OCR  | OurCommunityRituals LLC | `ourCommunityRituals/OCR-docs`         | Holding company. Org brain. Governance.                         |
| OSE  | OurSharedEvents         | `ourCommunityRituals/ourSharedEvents`  | **This repo.** Core platform — event infrastructure, API, admin |
| OW   | OurWKRP                 | `ourCommunityRituals/ourWKRP`          | Community music curation. Named identity. White label tiers.    |
| OSG  | OurSharedGames          | `ourCommunityRituals/ourSharedGames`   | Founding activation format. Anchor game nights.                 |
| OSR  | OurSharedRecords        | `ourCommunityRituals/ourSharedRecords` | Music, story, and archive layer. Oral history.                  |
| OSP  | OurSharedPulse          | `ourCommunityRituals/ourSharedPulse`   | Pre-platform consulting. Human-delivered entry point.           |
| OSM  | OurSharedMagnets        | `ourCommunityRituals/ourSharedMagnets` | Developer and franchise layer. API and white label support.     |
| OER  | OurEventRings           | —                                      | Intelligence and analytics. Long horizon.                       |
| OA   | OurAirwaves             | `ourCommunityRituals/ourAirwaves`      | Deployment and white label layer. Client fork template.         |

---

## 3. Scrum Team — Role POVs

Every story is implemented from all six POVs simultaneously. CC reads all six and writes code that satisfies all six.

### Product Owner (PO) — You

- Defines acceptance criteria
- Prioritizes backlog
- Reviews sprint progress in Linear
- Accepts/rejects completed stories
- **Current state**: Phase 1 Build complete. INFRA-1 (D1) and INFRA-2 (CF zone + DNS) ✅ DONE; remaining infra: INFRA-3 (GCP SA) and INFRA-4 (FORMS_ENCRYPTION_KEY rotation doc). P1-7 (secrets + first staging deploy) 🔄 IN PROGRESS; P1-8/9/10 backlog. Phase 2 (D1 database) complete — data layer is D1-native, no Sheets code remains. 3-tier feature flags implemented. Forms system implemented (4 types). A11Y-1 done. Production gate: OSE-540 CCR promotion criteria (staging green + live T4 run + score ≥85%).

### Lead Backend Architect (BE)

- Writes Worker route handlers
- Implements D1 queries (Phase 2)
- Owns DB design, API contracts, auth, feature flags, testing pyramid
- **Current state**: ~81 routes implemented (OSE-1242 added `GET /api/v2/events/map` — cell-scoped attendee map; it **refuses coordinate-shaped params with 400** and pins H3 resolution to 7, so Invariant #1 holds by construction rather than by policy). **Public reads are rate-limited by default** (`lib/public-read-limit.ts`, OSE-1247): the wrapper is applied at the route, so an unlimited public read is visibly unlimited when you read the router. **The public event response is an allowlist**, not `...row` spreading (`lib/public-event-projection.ts`) — `h3_res9` is no longer published, because the map refuses to _accept_ res-9 precision and the endpoints were _emitting_ it. Snapshot at v1.3.0 (OSE-1313 added `starts_at`). **`events.is_published`** (migration 0070) is the "listed" half of §6.2c; filtered on map + list, deliberately not on fetch-by-id. **93 D1 migrations** (main DB, `0001`–`0093`) + 15 forms DB migrations (`ls migrations/*.sql | wc -l`, `ls migrations-forms/*.sql | wc -l` in `workers/oursharedevents`, 2026-10-02), 3-tier feature flags working (extracted to `@ocr/flags`), forms handler with PII encryption/scrubbing. Phase 2 D1 swap complete — all handlers query D1 directly, no Sheets dependency. Formerly-listed gaps now ✅ DONE: anonymous ID (`lib/anonymous-id.ts`, ADMIN-6), rate limiting (KV-backed + in-isolate, `lib/rate-limit.ts`), PII audit log (`pii_audit_log`, migrations-forms/0009). Known gap: brand scoping is list-level only — `getEvent`/`handleUpdateEvent` are id-only (object-level scoping tracked in OSE-1080). **2026-09-16 (Epic TRIANGLE, Cowork slice):** migration **0075** adds `events.created_by` (server-verified admin actor; same identity vocabulary as `admin_audit_log.actor`) + `idx_events_status_updated` / `idx_events_created_by` — `REQUIRED_DB_MIGRATION` = 75. `GET /api/v2/admin/events` takes allowlisted `?status=` and `?mine=1` (a filter inside brand scope, never a widening; echoed back as `filters`). `PUT /admin/events/:id` with `status` now enforces `VALID_TRANSITIONS` → 409 `INVALID_TRANSITION {from,to,allowed}` — before this it was a second door around the state machine verify-qr enforced. **CCR-PR567 re-run item 2:** `PUT status` now also couples `qr_verified` to the target state (active→1, else→0) on every lifecycle write, so `active ⟺ qr_verified=1` holds through PUT too — verify-qr is **not** the single door into `active` (the L1 archived→active "Go live again" edge routes through PUT). New cron phase `runDraftExpiry` (`lib/draft-expiry.ts`): archives (never deletes) drafts untouched ≥ `DRAFT_EXPIRY_DAYS` (default 30; 0 = off), skips future-dated, audits `DRAFT_EXPIRY`. **Sponsor corner:** `lib/sponsor-home-auth.ts` (HMAC signed link, distinct `kind`, 30d) + `handlers/sponsor-home.ts`: `POST /api/v2/admin/sponsors/:id/home-link` (mint, brand-scoped, rate-limited, audited), `GET /sponsor?t=` (server-rendered), `POST /api/v2/sponsor/placements/:id/respond` (sets `sponsor_placement.sponsor_accepted` — the 0068 column finally has a writer). INV9 exemption re-keyed `events.ts:256→301`. **OSE-1344 (same day):** migration **0076** — `event_type_category_registry` (15 UEC clusters) + `event_type_registry.category_code` (backfilled from the prefix); `REQUIRED_DB_MIGRATION` = 76. `GET /api/v2/admin/event-types` returns the Category → Type catalog (`lib/event-type-catalog.ts`; unmapped types → "Other", never dropped, `orphans` counted — 0 on the seed). `event_type_id` is now accepted on create/update (registry-validated, 400 `INVALID_EVENT_TYPE`) — the 0023 column finally has a writer. It deliberately does NOT derive `legal_clearance_tier` (Invariant #4 / OSE-380 caught the first draft). NB `category_registry` (0058) is the layout-template axis, not the type taxonomy. INV9 exemption re-keyed again `301→335`. **OSE-1313 (2026-09-28):** event start **time + zone** → canonical UTC `events.starts_at` (migration **0078**, `REQUIRED_DB_MIGRATION` = 78; math in `lib/event-datetime.ts`, pure Intl). Create AND update accept `start_time` (HH:MM) + IANA-validated `timezone` (400 `INVALID_TIME`/`INVALID_TIMEZONE`); `starts_at` is always server-computed, never client-supplied. A partial update carries the stored wall time across a date/zone change; `start_time: null` → date-only again. `starts_at` is in the public projection (snapshot **v1.3.0**), and `.ics` DTSTART prefers it over the date-only `start_date`. **OSE-1417 (2026-09-30):** the CORS allowlist is per env — `lib/cors.ts` keeps production origins in `ALLOWED_ORIGINS` and `stg.oursharedevents.com` in `STAGING_ONLY_ORIGINS`, honoured only when `WORKER_ENV === 'staging'`. `route()` calls `bindCorsEnv(request, env)` once, so handlers keep `corsHeaders(request)`; an unbound request fails closed to the production set. Gates: `tests/cors-env-allowlist.spec.ts` + an added INV15 assertion. **Sponsor public card (2026-09-30, migration 0083 — renumbered after main took 0082 for poster placement_type, `REQUIRED_DB_MIGRATION` = 83):** `sponsor_business.display_name` / `address_line` / `contact_phone` / `contact_email` are all optional and public by the sponsor's choice. They are validated in `lib/sponsor-card.ts` (400 `INVALID_DISPLAY_NAME`/`INVALID_ADDRESS_LINE`/`INVALID_CONTACT_PHONE`/`INVALID_CONTACT_EMAIL`), and `''`/null clears one. The resolver's public seam adds `title` (display name, else business name) + `card_url`; contact never enters the bundle. `GET /sponsors/:id` is the public card: it renders only a sponsor that is on show (active + accepted placement), and is rate-limited. `GET /sponsor-default-logo.svg` is the OSE default image. The logo proxy takes `?slot=sidebar`, is edge-cached keyed by the upstream URL, and its cache misses are rate-limited (`SPONSOR_LOGO_READ_MAX` = 300). **OSE-1438 (2026-10-01):** `card_url` is set only when the card renders. The card's on-show rule is one SQL fragment, `SPONSOR_ON_SHOW_SQL` (`lib/sponsor-card.ts`), read by both `GET /sponsors/:id` and the resolver, so a link can't point at a 404 (the Path 2 case). Its organizer side is source-aware like the resolver: a `sponsor_request` needs `organizer_accepted = 1`. **OSE-1433 (2026-10-01):** the logo proxy uses the same source-aware organizer check. A logo host must be a public DNS name (`validateProxiedLogoUrl` / `isBlockedLogoHost`, `lib/sponsor-logo.ts`), checked on sponsor-logo write and at fetch. `validateLogoUrl` keeps no host rule, because event media and the WHAT link are loaded by the visitor's browser, not the Worker. Redirects are manual, at most `LOGO_MAX_REDIRECTS` = 3, each hop re-checked. The body is read with a streaming 2 MB cap (`readCapped`). A failed fetch is cached for `SPONSOR_LOGO_NEGATIVE_TTL_S` = 60. Upstream logo fetches in flight are capped per isolate inside the shared fetcher (`LOGO_MAX_IN_FLIGHT` = 16), so the logo proxy (503 → default image) and `GET /api/v2/sponsors/:id/asset/:format` (monogram) share one bound; the caches dedupe repeat views but cannot coalesce simultaneous cold misses. The miss limiter stays fail-open by decision: admin-set URLs; at most 1 + `LOGO_MAX_REDIRECTS` = 4 sequential upstream fetches per request inside one 5 s budget; the in-flight cap. The sponsor draft path (capture and promotion) applies the same host rule. INV9 exemptions moved with it (`handlers/sponsor-card.ts:64` → `lib/sponsor-card.ts:128/132`; resolver `272→277`). **2026-09-30 (TRIANGLE next slices, PR #700):** `GET /api/v2/admin/events?sort=upcoming` ("Soonest first": upcoming soonest → undated → past most-recent; floor = "today somewhere", UTC date 12h ago; own opaque `u1.` cursor carrying its floor; bad sort/cursor → 400; `lib/admin-events-upcoming.ts`); `filters` echo gains `sort`. **Sponsor discovery** (`lib/sponsor-discovery.ts`): `POST /api/v2/sponsor/requests` (token in body, brand from the signed claim, max 5 waiting, route-rate-limited, audited `sponsor:<id>`) stores a placement `source='sponsor_request', sponsor_accepted=1, is_active=0, organizer_accepted=NULL` — **switched off on every public surface** until `POST /api/v2/admin/sponsor-requests/:id/respond` approves (is_active=1, organizer_accepted=1; ADR-019 two-sided consent). Admin sponsors list exposes `placement_id/placement_active/placement_source`. INV9 exemption re-keyed again `events.ts:336→370`. Migration **0084** `corridor_readiness_latch` (renumbered twice: main took 0082 and 0083) — `REQUIRED_DB_MIGRATION` = 84. **OSE-1416 (2026-09-30): BigQuery is scoped per environment.** Staging and production share one GCP project, so `datasetForPool(pool, env.WORKER_ENV)` (`lib/pool-contract.ts`) returns the bare `BIGQUERY_DATASETS` name (the one OER reads) **only** for `WORKER_ENV === 'production'`; staging gets `_stg`, and every other value (development, test, unset, miscased) gets `_dev`. The flat backup dataset fails closed the same way: `getDatasetId` (`cloud/config.ts`) defaults to `oursharedevents_backup` only on production, refuses that name everywhere else, and `bigQueryInsertRows` turns the refusal into `NOT_CONFIGURED` before any network call. `wrangler.toml`: dev `oursharedevents_backup_dev`, staging `oursharedevents_backup_stg`, production `oursharedevents_backup`. Gates: `tests/bigquery-env-isolation.spec.ts`, plus staging cases in `oer-boundary.spec.ts` and `shared-report-bigquery-export.spec.ts`. DS-02 (raw-row backup bypassing the pool contract) was already closed in code: the backup routes through `phaseToPool` and pool datasets. The GCP project held only `oursharedevents_backup.events_backup` with 0 rows on 2026-09-30, so nothing needed purging. **OSE-1419 (2026-09-30): a fresh database starts with zero events.** Migration 0013 seeds `test-event-001` into every DB, production included. Migration **0086** deletes it wherever no row references it (every FK to `events(id)`; `anon_id_returns`/`event_series` key it as `venue_id`), so `REQUIRED_DB_MIGRATION` = 86. Production (0 events) is a no-op; staging keeps it (a shortlink points at it). Staging CI no longer depends on 0013: `tests/ui/smoke/fixtures/test-event-001.sql` seeds it before T3 and T4, and that step is not continue-on-error. `launch-story-local.sql` seeds it too. Gate: the OSE-1419 block in `tests/migration-smoke.spec.ts` (born-red: 1 event without 0086). **QR Path rung 2 (OSE-867/869, PR #701, 2026-09-30):** `GET /api/v2/events/:id/poster-bundle` now carries `event` (the same `toPublicEvent` allowlist as `GET /events/:id`), `sponsors` (poster top tier; a sponsor-query error logs `DB_ERROR` and returns `[]` rather than failing the poster) and resolved `settings`; `eventName` is gone. Migration **0085** adds `events.settings_json` (default `'{}'`), read and validated only by `lib/event-settings.ts` (OSE-851 extends that module; absent means on; strict writes, 400 `INVALID_SETTINGS`; PUT merges with `json_patch`). **AUD-3 Phase B + R-5 (2026-10-01):** migration **0088** adds `admin_audit_log.brand_id` (renumbered after main took 0087 for `scan_cell_aggregates`), resolved inside the one INSERT in `lib/audit-log.ts` (`AUDIT_BRAND_RESOLVE_SQL`: event / per-event flag / sponsor / placement; anything else NULL = platform-only) and backfilled with the same mapping. `GET /api/v2/admin/audit-log?scope=brand` returns only rows of brands the caller holds `brand_owner` in (interim until R-0 / OSE-1446), never NULL-brand rows, IPs masked /24 or /48 (`lib/ip-mask.ts`) except for a `key:` actor, and another tenant's operator shown as `null`; without `scope` the route stays platform-only. Filters and cursor are validated (400 `INVALID_SCOPE`/`INVALID_CURSOR`/`INVALID_FILTER`), D1 errors are 503. `PUT /api/v2/admin/flags/:key` and `POST /api/v2/admin/flags/apply-tier` are key-actor only (`requireKeyActor`, 403 `KEY_ACTOR_ONLY` for every email actor, platform brand included; works without `ADMIN_SCOPE_ALL`). Gates: `tests/audit-log-brand-scope.invariant.spec.ts` (59) and `tests/global-flags-key-actor.invariant.spec.ts` (18), each mutation-checked. **OSE-1460 (same day, PO decision):** the returns export sends k-floored counts per corridor × event type × pool over 90 days (`people_count`, `returned_2plus/3plus/5plus`, below 5 → withheld or `null`) to `corridor_returns_export`. No `anon_id_hash` or real venue crosses (`venue_id` = `'corridor-aggregate'`). The scan path no longer reads `CF-IPCountry`, `top_country` is always NULL, and migration **0089** clears both; **0090** indexes `anon_id_returns(last_seen_at)` for the rolling window and `(computed_at)` for the watermark probe; **0091** adds `anon_id_returns.pepper_epoch`, the export counts only the current pepper, and the nightly materializer deletes rows of any other pepper (up to 50,000 a run, then `ANON_ID_RETURNS_PEPPER_PURGE_INCOMPLETE`), so a rotation resets returns instead of double-counting one browser; the runbook's full purge after 0091 and after every rotation leaves no row erasure cannot reach; **0092** indexes `pepper_epoch` so that purge and the export's epoch filter do not scan the table (`REQUIRED_DB_MIGRATION` = 92). Published export counts are rounded down to multiples of 5 and the returns snapshot is weekly (PO decision 2026-10-01, against differencing across snapshots). Gate 8b now forbids every `CF-IP*` header. ADR-001 and the docs say hourly, which is what the code has always done. **#707:** `lib/pii.ts` caches each derived AES key per isolate instead of re-running PBKDF2 per decrypt (the admin registrations list hit 16 s on staging); a failed derivation is never cached. The registrations list is still unbounded (OSE-1442). **OSE-1468 slice 1 (2026-10-02):** the governed dashboards read one registry, `lib/dashboard-contract.ts` (`DASHBOARD_CONTRACT_VERSION` 1.0.0). Each metric is one value with one privacy class (entity / anonymous_exact / floored K=5, floored per event before any sum) and a response `path` the tests resolve. Every response also carries a `not_measured` list. Sponsor counts use `PLACEMENT_ON_SHOW_SQL` (`lib/sponsor-card.ts`, the per-placement twin of `SPONSOR_ON_SHOW_SQL`), a failed read is a 503 `DB_UNAVAILABLE`, never zeroes, and scans per cell and flows are floored per brand × data class × cell before any merge. Endpoints: `GET /api/v2/admin/dashboards/{operations,corridor}` (brand set server-derived, one `brand_id = ?` query per brand; a key actor in `all` scope must pass `?brand_id=` and gets 400 `BRAND_REQUIRED` without it; `?data_class=all` includes demo/synthetic events) and `GET /api/v2/admin/events/:id/dashboard`. `handlers/dashboards.ts` is an authorised FORMS_DB reader for per-event COUNTs only (`tests/architecture.spec.ts`). Gate: `tests/dashboards.spec.ts`. **See before you publish (PR #754, 2026-10-02):** admin-only draft previews: `GET /api/v2/admin/events/:id/preview` (the real event page) and `/poster-preview` (the real poster, fed by `GET /api/v2/admin/events/:id/poster-bundle`, which allows draft/ready/active and refuses archived). `no-store` + `noindex`; previews mint no shortlinks (`previewSlotShortlinks`, read-only) and write no audit rows. A live, listed event 303s to its public page; live but unlisted renders the preview with a note. **Publish grace window (PO 2026-10-02):** migration **0093** adds `events.listed_from` (`REQUIRED_DB_MIGRATION` = 93). A move into `active` (verify-qr or PUT status) stores now + `PUBLISH_GRACE_MINUTES` (wrangler.toml `10`, capped at 60, `0` = off). Until then the event is live by link but off the list (incl. the TV's "coming up"), map, sitemap and sponsor discovery, one SQL fragment `listedSql()` (`lib/publish-grace.ts`); a move out clears it, so Undo inside the window leaves no public trace. The fast vitest pool runs it OFF; `wrangler dev`, the phone audit (1 minute) and deployed envs run it ON. Every move into `active` and every create-as-active records `listed_from` (with the window off it is "now"), so the latch rule below applies to all new publications; only pre-0093 rows are NULL. The recap's "next at this venue" list filters on `is_published` and the window too. **OSE-1508 decisions:** the corridor latch counts only events listed ≥ `LATCH_SETTLE_HOURS` (24); the admin poster-bundle is rate-limited per caller (`PUBLIC_READ_MAX`, after auth); a printed draft poster carries a print-only DRAFT mark, `position:fixed` so it never adds a sheet. Status writes (PUT status, verify-qr, unverify-qr) only land on the status they read (409 `STATUS_CONFLICT`), so a concurrent Undo is never reversed. Gates: `tests/publish-grace.spec.ts` (20), `admin-poster-preview.spec.ts` (11), each mutation-checked (counts: `grep -c "^  test(" tests/<file>`).

### Lead FE Integration (FD)

- Coordinates 5 MVP surfaces + forms QR routing
- Integration testing between front and back
- **Current state**: All 5 surfaces render with CSP + CORS. Forms QR handler exists (`form-pages.ts`, 32 test-IDs). **`/events` is server-rendered as of 2026-09-05 (OSE-1243)** — the Worker reads the events through the same DataProvider seam as `GET /api/v2/events` and puts them in the HTML it sends; there is no client fetch and no loading state on the discovery surface. Card markup lives in `src/lib/event-list.ts`, injected at `<!--OCR_EVENT_LIST-->`. Escaping is one function (`src/lib/html-escape.ts`) rather than the four near-copies it replaced, one of which did not escape quotes while interpolating into attributes. **The poster Print control is gated on QR readiness (OSE-286, PR #507, 2026-09-09)**: it is a real `<button>` that starts `disabled` and re-enables only after all four QR `<img>`s settle (load or error), and `@media print` drops the whole `.qr-section` while any `.qr-loading` placeholder remains (`:has(.qr-loading)`) — a poster can no longer be printed with empty QR boxes. The old `javascript:window.print()` anchor (CSP-blocked, undisableable) is gone, closing the OSE-R-020/OSE-285 tie-in; born-red coverage in `poster-print-gate.spec.ts` (worker) + the component-tier `poster-print.spec.ts`. **The SharedReport corridor_map SVG is now composed into a user-visible surface (OSE-628, PR #510, 2026-09-09)**: the signed-link view injects `report.corridor_map.svg` (unescaped — trusted, CSP-clean `renderCorridorMap` output) into `section#corridor-map-container` (`data-testid="corridor-map-section"`, `aria-labelledby="section-corridor-map"`), with a `cell_count` stat chip, a `source==='suppressed'` copy path, and the field-level suppression fallback preserved. `renderCorridorMap` was production-grade but had **never been rendered on any page** until now. The section is mobile-first responsive (base phone → `@media (min-width:700px)` tablet → `@media (min-width:1024px)` laptop) **scoped to that section** — the surface-wide `/sharedReport` table breakpoints stay `max-width` so the OSE-295 mobile-workability gate is untouched. Gate: `corridor-map-render.spec.ts` (9 tests). **The public event page now follows one canonical order across pre + live (2026-09-13):** sponsor strip → title/when → **What → Where → Who → How much → CTA → Why → How** → anonymity. The facts (what/where/who/cost) come first, then the ask (share + RSVP/check-in), with **Why/How as deeper detail BELOW the CTA**. The sponsor strip moved to the TOP of both phases (was mid/low), the `event-how-much` section was added to the live render, and the live CTA moved from near-top to after How much — so pre and live are identical in order. This **supersedes** OSE-655's "WHO leads WHERE — conversion-engine" funnel sequence (the platform is a discovery map, not a persuasion funnel — it leads with the event's facts; see brain memory `project_report_not_your_data`). The WHAT card now falls back to `events.description` when `what_short` is null (og:description inherits it), so the card is never empty when a description exists — `description` was already on `PublicEventRow` + SELECTed, just never read. Born-red gates: rewrote `pre-event-funnel-order.spec.ts` (asserts WHO→HOW-MUCH→CTA→WHY + the description fallback) and added live-order + sponsor-at-top assertions to `public-event-stakeholder-surfaces.spec.ts` (both verified red against the pre-reorder render). Post-event was NOT reordered by FE-13; it is now brought under the same canonical table, past-tense, by **OSE-1136 (#546, 2026-09-13)**: `renderPostEventHtml` renders **WHAT → WHERE → WHO → HOW MUCH → By-the-numbers → sponsor thanks → (share + return-loop aside) → WHY → anonymity**. WHERE (venue+map) and HOW MUCH (display-only price) were restored as their own cards, WHAT falls back to `events.description`, HOW is dropped (nothing to "join" once it is over), and WHY moves below the ask — mirroring pre/live's facts→ask→detail. The OSE-657 recap-first invariant still holds (the recap-primary region precedes the suggestions `<aside>`; share moved into that margin); OSE-1201 lexicon + spend-blind sponsors preserved. Born-red: canonical-order test in `post-event-recap-first.spec.ts`. Gaps: admin Card 3 not wired to form handler, QR codes don't route to native forms, no cross-surface E2E test. **2026-09-16 (Epic TRIANGLE):** the state machine has a driver — front door gains **Your events**; the list is filterable (Drafts/Ready/Live/Archived, Only mine, Show more via cursor); a **status panel** (Mark ready / Go live / Take offline / Archive / Reopen) hydrates from `ose:event-selected` and routes ready↔active through verify-qr/unverify-qr, everything else through `PUT status`; wizard step 5 is honest ("saved as a draft") with **Go live now**; an **event timeline** card shows Set up → Live → Poster out → People scanning → Sponsors on → Report with one **Next:** link; sponsors rows gain **Sponsor link**. New surface `templates/sponsor-home.html` (own template on purpose — not bolted into admin). `/events` gains server-rendered discovery (search + when chips, `lib/event-discovery.ts`; URL is the state; default view unchanged). Screen map: `workers/oursharedevents/docs/ops/TRIANGLE-SCREEN-MAP-2026-09-16.md`. **OSE-1344:** Create Event finally asks _what kind_ — a Category → Type two-level select ("Sports > Bocce") on BOTH the advanced form and wizard step 2 (ahead of the copy-prefill cards, which were never a type picker), fed by one cached loader (`window.oseTypePicker`), built with createElement/textContent, degrading honestly when the catalog fails to load. Selects inherit `.create-form select` (44px / 16px) so the mobile-workability gate holds. **OSE-1313:** both create paths gain a `type="time"` input + a curated IANA zone `<select>` (default America/Chicago, editable); the public event page's `event-when` line renders the start in the **event's** zone with its abbreviation ("Saturday, October 24, 2026 · 6:00 PM CDT"), never the viewer's; date-only events keep "date · zone". Gate: `tests/event-start-datetime.spec.ts` (workers) + `tests/event-datetime.spec.ts` (node matrix). **Sponsor presentation (2026-09-30):** every sponsor surface (display top + side rail, `/events` banner, poster, form pages) now shows an image: the sponsor's logo through the same-origin proxy, or the OSE default. A failing logo swaps to the default instead of hiding; on the display side rail the sponsor keeps its rotation slot. Before this, display/public/poster put the external URL in `<img src>`, which CSP + COEP block, so **no logo had ever rendered on those three**. Titles come from `title`, and attribute values go through a quote-safe escaper. On the public event page, a sponsor with no website now links to its card and shows its location. The admin form gains an **Image** select (OSE default / our own logo; the logo fields appear only for "own", and choosing default on an edit clears both logos), plus display name, location, phone and email. New template `sponsor-card.html` (/ui.css classes, page style under the 400-char budget, 0 raw hex). **2026-09-30 (PR #700):** the landing's map view is a real **attendee map** (`lib/attendee-map.ts`: inline-SVG H3 res-7 hexes + legend, drawn from `h3_res7` only — never lat/lon — and gated on `CORRIDOR_READY_MIN_EVENTS` over exactly what it draws); the Event checklist has an **organizer inbox** ("Needs your attention": not answered / declined / asked to join, via `oseEventView`'s `inbox`); the admin list has **Soonest first**; `/sponsor` has **Events you could back** + **Your requests**, and the sponsors card **Approve / Decline** for requests. **2026-09-30 (PR #701):** the scoped poster (`/poster?event=`) makes **one** data call (`loadPosterBundle`) instead of three, and admin has a per-event **Print QR codes on this poster** switch (`poster-show-qr`); off removes the QR grid from the **printed** poster only (the digital poster keeps its links) with no gap left in print. **2026-10-01: `/display` rotates screens ("panes")**, ported from the GAS display's rotation engine (MVP-EVENT-TOOLKIT `startRotationEngine`): featured event → also coming up → sponsors (each sponsor once, tier-blind, no extra impression beacons), only panes with content join, one pane = no timer. The kiosk URL is the config: `?panes=` (allowlisted order) and `?dwell=` (seconds, clamped 5–120, default 15). Space pauses, arrows step, a hidden tab holds. The engine is a pure DOM-free function; `tests/display-pane-rotation.spec.ts` (node project) runs it with fake timers plus the page script in jsdom, and was mutation-checked (ignore pause / never hide / no clamp / no dedupe / no `aria-live="off"` each turn it red). **Same day, saved per event:** `lib/event-settings.ts` gains `displayPanes` (allowlisted, ordered; adds `league`), `displayDwellSeconds` (5–120) and `leagueLinks` {schedule, standings, bracket} (https only, no credentials, at most `MAX_LINK_BYTES` = 154 UTF-8 bytes of the normalised URL so it fits the TV's QR (`lib/qr.ts` v7/L); strict write → 400 `INVALID_SETTINGS`, tolerant read, `null` clears; `showQRSection` unchanged). The admin **TV display** card (screen on/off + Move up/down, seconds, league links; saves via `PUT /api/v2/admin/events/:id {settings}`) reads `GET /api/v2/admin/events/:id/display-config` (any status). The TV reads the public `GET /api/v2/events/:id/display-config` (live only, `publicReadLimited`), which returns a strong `ETag` + `Cache-Control: no-cache` and a bodiless 304 on a matching `If-None-Match` (ported from the GAS bundles' ETag + `swr()`). The display re-checks it every minute, and the same ETag means no re-render. URL `?panes=`/`?dwell=` still override. **League pane = links out** (PO): each saved link gets a label, a short link and a QR in the UEC 07 UTILITY colour. Leagues keep their own tools (Google Sheets, Excel); drawing standings/schedules/brackets as tables is planned as a **separate product**, not OSE. Tests: `display-settings.spec.ts` (node, 23), `display-config.spec.ts` (workers, 13), `admin-tv-display-card.spec.ts` (node, 10), `display-config-etag.spec.ts` (node, 5: the ETag is computed before any QR is drawn, so a 304 generates none; the admin read draws none; the QR colour is in the hash), `display-pane-rotation.spec.ts` 20 → 42 (counts from `npx vitest list tests/<file>`). **Wizard (PR #754 + 2026-10-02):** step 4 shows a one-line TV summary ("This event → Coming up next → Sponsors · 15 seconds each"), screen checkboxes and three speeds, an optional 5x demo ("Show me"), and Preview links to the draft page and poster; saves are serialized. Step 5 → Back → step 4 is allowed after saving, and Publish / Undo repeat. Publish now says when the event goes on the map and list (`window.graceNote`). Browser journey: `tests/playwright/publish-loop-journey.spec.ts` in the blocking phone audit on Chromium **and** WebKit (`mobile-webkit` project, this spec only). Flows still to cover: `workers/oursharedevents/docs/ops/E2E-FLOWS-MAP-2026-10-02.md`.

### Sr Design FE

- Mobile-first form UX, Kaizen, uniform design, color palette
- Dedication to test-ids and automation-friendly selectors
- **Current state**: **`@ocr/ui` lives in the hub, not here (ADR-008 Phase 0, 2026-09-29).** The in-repo `packages/ui` fork was merged into the hub's `packages/ui` (ourCommunityRituals/ourCommunityRituals, incl. the light-theme contrast fix) and deleted; the Worker depends on `file:../../../packages/ui`, which `scripts/ci-stage-ocr-workspace.sh` stages from the exact hub commit in **`.ocr-hub-ref`** (never hub main — bump the pin in a PR to take a design-system change). Staging is **required** for every job that installs/builds/tests/deploys the Worker. @ocr/ui's own contrast + unit suites run in the hub CI; this repo's lint shard runs the hub's `check-spoke-styles.mjs` (at the pin) against `.ocr-design-check.json` — own tokens, own stylesheet over the 400-char inline budget, raw hex and non-`/ui.css` stylesheet links may only shrink from the recorded baseline (13 files carry debt, 2026-09-29). **Pinned at hub `b96b2c8` (2026-09-29, CCR OSE-1393):** the stager refuses a pin that is not on hub `main` (`tests/integration/hub-pin-ancestry.test.js`); the lint step passes `--base-config` (main's `.ocr-design-check.json`) so a PR can lower but never raise the baseline, and a shrunk count fails until the baseline follows; `var(--x, #hex)` fallbacks count as raw hex unless `--x` is an `@ocr/ui` token; `tests/integration/adr008-wiring.test.js` locks that every Worker-building job stages the pin first. `/ui.css` revalidates by ETag (no 24h stale window after a bump). The check does NOT measure rgb()/hsl(), CSS in TS constants (`FORM_CSS`) or font sizes — it is a ratchet, not a proof of zero. (The earlier "34 design tokens / 85% color adoption" figure had no script behind it and is withdrawn.) **Touch targets 44px+ and input font-size 16px+ are now MEASURED and gated**, not asserted — the mobile-workability audit blocks on PR code across all 11 surfaces (OSE-1236, 2026-09-05). Getting there closed real violations this line had been claiming were absent: `@ocr/ui`'s `.input` was 41px at 13.6px (every form partial inherited it) and `admin.html`'s create form was 34px at 14.4px, with its two textareas on the UA default of 13.3px. They were unmeasurable because `/admin` was skipped on every run (OSE-302's bearer, unset since May) and the component showcase rendered nothing (a class collision with `@ocr/ui`'s file-upload family). `@ocr/ui` has **15** partials; `footer()` is adopted on 5 surfaces (OSE-1232), the rest are not. A11Y foundation done. Gaps: **17** admin inline styles and **9** `max-width` breakpoints across all 7 templates (both drained since the 2026-08 figures of 345/58 — measured 2026-09-04); test-ID coverage 3-80% by surface (forms best at 80%, poster worst at 3%). **2026-09-16:** `sponsor-home.html` is token-driven (dark-native, 48px targets) but hand-rolled on `/ui.css` tokens rather than `@ocr/ui` partials — tracked as TRI-2 drift to close; the timeline card + status panel + discovery bar all use tokens and 44px+ targets. testids registry regenerated (425 ids after OSE-1344: create-category / create-event-type / wizard-category / wizard-event-type + picker msgs).

### Sr Automation QA

- API tests, Playwright E2E per form type, PII scrub verification
- **Current state**: 237 test files across 6 frameworks; the worker suite alone is **220 spec files / 3276 tests**, root **1893 passed / 322 skipped**. **Adversarial coverage now runs in CI where it matters**: OSE-1243 added a renderer corpus suite (26 payloads x 3 fields) and OSE-1242 added endpoint red-team (16) — both in the worker suite. `tests/red-team/` now runs too, as T5 (`red-team-adversarial.yml`) against staging, but only after a fully green push run on `main`; a run cancelled by the next merge gets no red-team pass (OSE-1506 proposes a nightly schedule). Every guard added in this line was verified by reverting it and watching the intended tests go red; a suite that cannot fail is not coverage. 7 Vitest files target deployed Worker. PII scrub verified in unit tests. **Known-dead E2E: CI runs an explicit allowlist through `playwright.e2e-smoke.config.ts`, so any `tests/e2e/` spec not named in a workflow never executes** — `npm run test:e2e:negative` and `test:e2e:all` exist and nothing calls them. Measured 2026-09-05 (OSE-1243): four public-surface suites totalling 98 tests had never run, proven by five assertions demanding behaviour OSE-871 deleted months earlier. They were rewritten against the server-rendered surface (98 → 44) with their data-dependent cases moved to `tests/unit/public-events-phase.test.ts` (4 → 27, on the path CI does run). **Do not read a `tests/e2e/` spec as coverage without first checking it is named in `.github/workflows/`.** Tracked in OSE-1244. **`refreshCorridorBaselines`'s `COALESCE(h3_res7, corridor_id)` path is now behaviorally born-red-verified (OSE-631, PR #511, 2026-09-10)**: the three h3/legacy-key tests already existed (from the #302 epic integration) — I confirmed them real by inverting the COALESCE and watching "h3_res7 wins" fail — and added one window-count test (45-day event → `window_30d_count=0, window_90d_count=2`) that closes a **surviving mutant**: nothing had asserted the actual 30d/90d values, so pointing the 30d window at the 90d floor passed the whole suite. **Stryker does not reach this**: `shared-report.ts` is out of the constitution-first `mutate` scope (count-floor/report-depth/pii/admin), its specs run on the workers pool Stryker excludes, and the logic lives inside a SQL string literal (opaque to AST mutators) — so SQL-driven aggregation is guarded by hand-run behavioral mutation testing, not Stryker. Gaps: zero form endpoint smoke tests in CI, zero E2E flows per form type, zero contract tests (Pact). **2026-09-16:** +5 worker specs (`admin-events-lifecycle-list`, `draft-expiry`, `admin-event-lifecycle-ui`, `sponsor-home`, `event-discovery`; ~83 tests, born-red against the pre-change render); schema/constraints counts bumped (events 44 cols, 72 indexes). Local run: workers pool 2226/2235 (the 9 failures + 20 unloadable files are sandbox-only: `gitleaks-ci-gate` needs `.github/`, helpers/fixtures/jsqr not copied); node 840/840; structural 0-architecture gates 134/134 (deprecation-lock needs `scripts/guard-no-gas.js` which was not in the sandbox). NOT yet run: Bruno/Newman against staging, Playwright E2E, mobile-workability on `/sponsor` (not in the surface list — add it). **OSE-1344:** +`tests/event-type-catalog.spec.ts` (17: orphan acceptance criterion, pure grouping, endpoint auth/shape, create/update write + 400 + clear, both-paths UI shape); `regulatory-label-unavailable.spec.ts` went red on a draft that derived the tier from the type — kept red-proof, draft fixed. Full workers pool 2243/2252 (same sandbox-only failures), node 840/840, structural gates 135/140 (5 = deprecation-lock, sandbox-missing script). **2026-09-30 (PR #700):** `/sponsor` finally has **PR-gating browser E2E** — `tests/playwright/sponsor-home-flow.spec.ts` (8: open link → pending not public → Accept → public → Decline → gone, organizer inbox, tampered link 401, ask-to-join → approve → public) runs in the blocking phone audit (`playwright.mobile.config.ts`, which now carries a local signing secret + a `globalSetup` that seeds and mints a sponsor link, so the audit measures `/sponsor` instead of skipping it: 85/85 locally). Seeding goes through the admin API only (`tests/playwright/helpers/sponsor-home-seed.ts`). **Bruno assertions were partly dead (found 2026-09-30, CCR PR 700):** Bruno's `decomment` picks one line ending per merged script by majority, and the ex-Newman CRLF collection script made every `// comment` in an LF request script swallow the rest of it — 13 request scripts and the collection latency budget never asserted while reporting PASS. All Bruno YAML is LF now; `tests/integration/infra-consistency.test.js` fails on any `\r` in a Bruno script. **Do not read a Bruno PASS as coverage unless its `test()` names print in the run.** **The QR decode matrix is locked (OSE-1439, QR Path rung 4, 2026-10-01):** `tests/e2e/0-architecture/qr-decode-matrix.invariant.spec.ts` (T0 `invariants` shard) fails if `workers/oursharedevents/tests/qr-roundtrip.spec.ts`, the jsQR decode of real encoder output that found OSE-1127/1128, is deleted, skipped, weakened to "something decoded", narrowed below its 21 locked L/M/Q/H × v1–v7 cases, moved out of the workers pool, or no longer run by `worker-d1-schema`. Red-proof: 26/26 weakenings fail it. **Sponsor-signal never-who re-proven at every rung (OSE-1166 reconciliation, 2026-10-03):** the L0 gate `sponsor-signal-never-who.invariant.spec.ts` now derives its subjects from worker `src/` (every fetch to `/impression` or `/click` omits credentials, none uses `sendBeacon`, every outbound sponsor link is `noreferrer`); it had named `public.html` + `display.html` only. The T4a runtime test opened bare `/display`, which shows an unsponsored event on staging, so it had skipped on every run; it now opens `SMOKE_EVENT_SPONSORED` on `/display` and `/events` and fails when no impression fires. The Bruno rung the gate header claimed did not exist; it is now in `bruno/ose-api` folder 11. Mutation-checked: 6/6 injected faults red at L0. No client sends `/click` today (the handler has no caller).

### SRE/SDET (Performance + Observability)

- CI/CD gates, observability, form submission monitoring, destruction job monitoring
- **Invariant-gate shape (OSE-1246, audited 2026-09-05)**: all 26 gates in `tests/e2e/0-architecture/` are classified in that directory's README as _property-asserting_ (derives its subject list) or _subject-naming_ (hardcodes a path). **Both are legitimate** — which is correct depends on whether the invariant is about a class or one artifact. `deprecation-lock` is the pattern to copy: it names seven paths and is the best gate there, because it is a **meta-gate** asserting that `scripts/guard-no-gas.js` exists, is self-tested, has an allowlist and runbook, and is invoked by CI — the scanning is done by that script, which walks the tree. **Before writing a new gate, read that README.** Two gates were found unable to enforce their own stated rule and were rewritten (`tenant-isolation`, `pii-retention`); rewriting the first immediately exposed a live cross-brand leak on the public recap page that it had been green through for the leak's whole life.
- **Note for local runs**: 31 of 182 tests in `tests/e2e/0-architecture/` fail in the dev container on an environment mismatch — Playwright wants `chromium_headless_shell-1234`, the image ships `-1194`. All 31 are browser-launch failures in the four runtime gates; none is a code failure. The source-shape gates all pass.
- **Current state**: **9** CI gates working (typecheck, schema verify, migration apply, table verify, health check, API smoke, UI smoke, prod isolation, **mobile workability**). Mobile workability became the 9th on 2026-09-05 (OSE-1236): it now runs against **PR code** on a local worker and **blocks** — previously it audited deployed staging and was `continue-on-error`, so its verdict was uncorrelated with the diff under review, while the nightly failed every night since 2026-09-01 because three of four Playwright projects are WebKit and only chromium was installed. Structured logging in place (FORM_EVENT, FLAG_EVENT, LIFECYCLE). k6 scripts exist (5 scenarios). Gaps: zero dashboards, zero alerting, load tests not wired to CI, no performance baselines measured. **OSE-1418 (2026-09-30): production is monitored, not just staging.**
  - **CF Access Canary** (`cf-access-canary.yml`, every 6h) gained a credential-free `access-app-routing` job for staging and production. An unauthenticated request to `/admin` and `/api/v2/admin/sponsors` must be challenged by _that host's own_ Access app (`scripts/ci/cf-access-probe.sh --expect-challenge`: `access_ok` / `wrong_access_app` / `no_access`). Production stays red until OSE-1353 is fixed.
  - **`security-monitoring.yml`** checks production too once the repo variable `PRODUCTION_LIVE=true` is set (launch-day step in `docs/runbooks/RUNBOOK-DEPLOYMENT.md`), or when dispatched with `include_production`. A production failure opens an urgent Linear issue.
  - **T5 red-team / T6 finale** target the repo variable `RED_TEAM_BASE_URL` (default staging).
  - **`security-alert.ts`** runbooks name the env that raised the alert (`alertTarget`; gate `tests/security-alert-env.spec.ts`).

### DevOps

- DB provisioning, service config, CI/CD pipeline, secrets management
- **Current state**: CI pipeline mature (security → gate → deploy-staging → smoke/contract/functional-staging → deploy-production → smoke-production). Secrets documented in `.github-secrets-required.json` + `CLOUDFLARE_SECRETS.md`. Environment parity verified. D1 provisioned with real IDs for staging + production (both DBs), KV provisioned 2026-08-18 (OSE-813), R2 buckets bound, CF zone active with routes on `stg.oursharedevents.com` and `oursharedevents.com`; `scripts/check-binding-placeholders.mjs` gates CI against placeholder IDs. Gitleaks config present (`.gitleaks.toml`). Remaining gaps: GCP SA (INFRA-3), FORMS_ENCRYPTION_KEY rotation doc (INFRA-4), first staging deploy sign-off (P1-7/P1-8). Self-hosted runner pool (Bloodraven) retired 2026-09-02 (OSE-1194); all OSE jobs now use GitHub-hosted `ubuntu-latest`. OSE-1257 means applying the already-proven hosted staging deploy/smoke shape to production (`deploy-production` + `smoke-production`), not treating production as a separate runner design. OSE-1217 means production tag/dispatch starts with the same-SHA staging chain in the same workflow run; it does not rely on a previously-recorded staging run or only S0/T0. OSE-802/803 schema safety stays mirrored across staging and production: schema guard constants, remote migration state, and canonical D1 shape are checked before deploy in both environments. `tools/runner/` + `runner-env-validation.yml` are deleted and brain invariants #11/#12 are `retired`. This retirement is OSE-scoped, not org-wide (OSE-1287): OW is fully migrated to GitHub-hosted `ubuntu-latest`; OCR-docs still has its deliberate self-hosted composite-action self-test. The earlier "sibling repos are still 100% self-hosted" line was stale (corrected 2026-09-12, verified against `origin/main` of each repo, per the CCR choice-infra audit CHOICE-07 / DO findings — `.claude/outputs/CCR-CHOICE-INFRA-AUDIT-2026-09-12.md`).
- **Production is deployed (read live 2026-10-03):** `https://oursharedevents.com/health` returns `env: production`, `db: ok`. It reported `version: "main"` because the prod "Stamp build version" step used `${GITHUB_REF_NAME:-prod-<sha>}` and `GITHUB_REF_NAME` is always set. The step now stamps `prod-<shortSHA>-<YYYYMMDD>` like staging, so the next prod deploy names its commit; until then, which commit is live on prod is unknown. Production `/health` no longer returns `_debug` (`WORKER_ENV === 'production'` omits it). Still open before clients: the prod Access app (OSE-1353, runbook from #756), the founder membership row (OSE-1415), then `PRODUCTION_LIVE=true`.
- **Durable Objects are deferred**: do not pull Durable Object architecture into the current staging/production deploy-safety work unless a fresh story explicitly reopens it.
- **Reconciled 2026-10-01 (read live: Cloudflare `workers_get_worker oursharedevents-prod`; D1 `ocr-db-production` `SELECT COUNT(*) FROM d1_migrations`, `admin_brand_memberships`, `events`):** the `oursharedevents-prod` Worker now exists, production `DB` is at **77** migrations (latest `0077_node_hierarchy_disambiguate_legal_clearance_tier.sql`; main needs 91), production has **0 events**, and `admin_brand_memberships` holds **1** row (`root`, `brand_owner`). The next bullet holds the 2026-09-21 and 2026-09-30 readings, kept for history.
- **History — superseded by the 2026-10-03 and 2026-10-01 notes above.** **Production had never been deployed (verified live 2026-09-21)**: `oursharedevents-prod` Worker does not exist on the account (`wrangler secret list`/`deployments list --env production` both 404); `https://oursharedevents.com/` returns 522 (no origin). This is expected pre-launch state, not a regression — all deploy-safety tooling (staging-chain gate, schema/canonical-shape guards, required-secrets gate) is built and merged, and will run correctly the first time `deploy-production` actually executes. Production D1 was behind staging (`DB` 41/76 migrations applied, `FORMS_DB` 13/14) as a symptom of the never-deployed state, not a code defect; unlike the Worker deploy itself, D1 migrations don't require secrets or the Worker to exist (`wrangler d1 migrations apply` talks to the D1 API directly), so this was closed out ahead of launch by running the exact same commands CI's `deploy-production` job uses (`npx wrangler d1 migrations apply {DB,FORMS_DB} --env production --remote`). Both DBs are now at full parity with staging (39/39 tables on `DB`, 9/9 on `FORMS_DB`, verified table-set-identical). Remaining blocking step before first launch: provision production secrets via `bash scripts/set-secrets.sh production` (now includes `FORMS_HASH_PEPPER` per OSE-1343), then trigger `deploy-production` (tag push or manual `deploy_production=PRODUCTION` dispatch) while watching — that first deploy will re-run the migration-apply steps as a no-op confirmation before shipping the Worker. **One-time data step before launch (OSE-1415):** production `admin_brand_memberships` is empty (0 rows vs staging's 1, read 2026-09-30), and production deliberately has no `ADMIN_SCOPE_ALL`, so the founder's `/admin` is empty until the founder row is inserted. The idempotent SQL and its verification live in `docs/runbooks/RUNBOOK-DEPLOYMENT.md` → "First Production Launch — One-Time Data Steps". Run it after the prod Access app (OSE-1353). `tests/prod-admin-scope-config.spec.ts` fails if `ADMIN_SCOPE_ALL` ever enters `[env.production.vars]`.

---

## 4. Known Constraints

- **Admin auth**: CF Access JWT (JWKS-verified) + email allowlist; `X-OCR-Internal` and Bearer `ADMIN_KEY` fallbacks are env-flag-gated (staging). Phase 3 brings end-user auth.
- **HTML in Worker bundle**: 7 templates ship as separate Wrangler **text** modules (not inlined into `index.js`); upload is ~1.86 MB raw / ~413 KB gzip, of which `index.js` is 1.37 MB and `admin.html` 328 KB (measured 2026-09-30, `npm run measure:startup`). Served whole with per-request CSP nonces (Phase 1, moved to CDN in Phase 3). The older "carried on every invocation, so split it" argument is **superseded for startup CPU** — see the next bullet — but size, isolate memory and maintainability still argue for splitting admin.
- **The "three parallel frontend copies" line was wrong.** Only `src/templates/` holds templates. `web/shared/` is **live and load-bearing** — `testids.js` is generated by `scripts/gen-testids.mjs` (whose `--check` gates CI) and `assetState.js` is served over HTTP and asserted by smoke tests; **do not delete it**. `src/frontend/apiClient/` is 7 TS modules with no importer found — a retirement candidate, not a duplicate.
- **Infrastructure**: D1/KV/R2/zone provisioned (staging + production, real IDs in wrangler.toml); Firebase (Phase 3) not started. First staging deploy in flight (P1-7).
- **Multi-brand isolation**: `brand_id` in schema on core tables, but enforcement is list-level only today — object-level (get/update) scoping is a known gap tracked in OSE-1080.
- **`@ocr/ui` is external and pinned**: it is not in this repo. Local dev needs the hub's `packages/ui` at `../packages/ui` (sibling of the checkout — clone the hub and symlink/copy it, or run `scripts/ci-stage-ocr-workspace.sh`), at the commit named in `.ocr-hub-ref`. CI fails with an `::error::` if the pinned hub cannot be fetched (needs `OCR_PROPAGATE_TOKEN`; dependabot runs lack it).
- **`admin.html` keeps growing** (328 KB on 2026-09-30). **Startup cost measured (step 7a, `workers/oursharedevents/docs/ops/STARTUP-COST-2026-09-30.md`, `npm run measure:startup`): admin's effect on startup CPU is not measurable locally** (inside run-to-run noise; templates are text modules, never parsed as JS). **`h3-js` is ~85% of Worker startup CPU (≈20 of ≈25 ms locally) and requests a 32 MB heap at load** (local workerd; Cloudflare-side commit not verified). The cold-start lever is lazy-loading h3-js (a decision, pending) — it helps the QR-scan path, not the landing or `/api/v2/events/map`, which use h3. The admin split is argued on size, memory and maintainability, not startup CPU.

---

## 5. The Loop — Session Protocol

```
┌─────────────────────────────────────────────────────┐
│ EVERY SESSION                                       │
│                                                     │
│  1. Read CLAUDE.md        → full project context    │
│  2. Read STORIES.md       → find next unstarted     │
│  3. Read .claude/inputs/  → any new intake items    │
│  4. Pick next story       → respect prerequisites   │
│  5. Implement complete:                             │
│     - Worker route code                             │
│     - Tests (Jest + Playwright)                     │
│     - D1 migrations (if applicable)                 │
│     - CI/CD test ticket (REQUIRED for DONE)         │
│     - All 6 role POVs satisfied                     │
│  6. Create PR             → CI runs automatically   │
│  7. Update STORIES.md     → mark IN PROGRESS        │
│  8. Update CLAUDE.md §3   → role current states     │
│                                                     │
│ DONE GATE (mandatory — full test pyramid)            │
│  - CI/CD testing ticket must be attached to story   │
│  - No story reaches ✅ DONE without CI validation   │
│  - Full pyramid must pass:                          │
│    1. Security (XSS, injection, auth boundaries)    │
│    2. Lint (zero errors)                            │
│    3. Contract (API shape, D1 schema parity)        │
│    4. Unit (mock tests, privacy, validation)        │
│    5. Integration (Worker D1 + forms security)      │
│    6. API (Bruno collections against live stg)      │
│    7. E2E (Playwright — full surface flow)          │
│  - No partial pyramids — all 7 levels or not DONE   │
│                                                     │
│ AFTER MERGE  (MERGED ≠ DONE — see "Two stages")     │
│  9. Update STORIES.md     → mark MERGED             │
│ 10. Staging chain green   → mark DONE               │
│ 11. Update CLAUDE.md §3   → new current states      │
│ 12. Next story begins     → context compounds       │
└─────────────────────────────────────────────────────┘
```

### Two stages: Merged, then Done (OSE-1443, decided 2026-10-01)

This is the one definition of Done for this repo. `workers/oursharedevents/CLAUDE.md`
points here and does not restate it.

| Stage      | Means                                                                                                                                                                                                                                                                 | Linear state    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Merged** | On `main`, and a named CI job goes red if it regresses. Levels 1–5 ran on the PR.                                                                                                                                                                                     | **In Progress** |
| **Done**   | Merged, **and** the post-merge staging chain is green for the merge SHA, or for a later `main` SHA that contains it: `T1 Deploy → Staging`, `T2 Contract → Staging (Bruno)` (level 6), `T3 E2E Smoke → Staging (Playwright)` and `T4 Functional → Staging` (level 7). | **Done**        |

- **Why two stages:** levels 6–7 run against live staging and only run _after_ merge
  (`OurSharedEvents CI/CD` on push to `main`). They are skipped on PRs, so no story can
  be Done at merge time.
- **Staging only, for now:** production is deployed but not launched (no prod Access app yet, `PRODUCTION_LIVE` unset; §3 DevOps). Production
  deploy + smoke join the Done bar after first launch.
- **A merge never closes a story by itself:** move it to Done once the staging chain is
  green. The PR close-guard (`scripts/check-pr-linear-close.mjs`) keeps merges from doing
  that for you: use `Part of OSE-###` in PRs, keep the id out of the branch and title,
  and keep closing words (close, fix, resolve, complete, implement) away from ids in the
  description and commit messages.
- **Check it:** `gh run list --workflow "OurSharedEvents CI/CD" --branch main --event push`, then
  `gh run view <id> --json jobs` and confirm the four T1–T4 staging jobs are `success`.

### What this unlocks

**Unlock 1 — Decouple from infrastructure**: Code is written and tested now. No CF zone, D1, or Firebase needed. Infrastructure is deployed last with finished code, not skeleton code. Cuts 2-4 weeks off timeline.

**Unlock 2 — Context never resets**: CLAUDE.md = project layer. STORIES.md = work queue. Session memory = session layer. Three layers, zero information loss. Every session starts at full speed.

**Unlock 3 — Complete implementations**: Each story includes all 6 role POVs. One story → Worker route + middleware + D1 query + tests + Newman collection + PR. One morning per story. 60 stories at this pace = 60 mornings.

---

## 6. Story Format (for STORIES.md)

Each story should include:

```markdown
### P<phase>-<number>: [Title]

**Status:** 📋 BACKLOG | 🔄 IN PROGRESS | ✅ DONE
**Prerequisite:** P<phase>-<number>
**Sprint:** [cycle number or —]
**CI/CD Ticket:** [Link or ID — REQUIRED for DONE status]

**PO Acceptance Criteria:**

- [ ] Criterion 1
- [ ] Criterion 2

**BE Route Spec:**

- Endpoint: `METHOD /path`
- Request/response contract

**FD UI Spec:**

- Which surface(s) affected
- Component behavior

**QA Test Pyramid (all levels required for DONE):**

- [ ] Security: XSS, injection, auth boundary tests pass
- [ ] Lint: zero errors
- [ ] Contract: API shape + D1 schema parity
- [ ] Unit: mock tests (Vitest)
- [ ] Integration: Worker D1 + forms security
- [ ] API: Newman collections pass against live staging
- [ ] E2E: Playwright full surface flow pass

**E2E Surface Flow Coverage:**

- [ ] stg.oursharedevents.com loads, event types render
- [ ] Cross-surface: poster → pre-event → event → post-event
- [ ] All surfaces validated: admin, public, poster, display, sharedReport, sponsor
- [ ] Config integration verified

**SDET Load Test:**

- Latency target
- Throughput target

**DevOps Deploy Gate:**

- CI checks required
- Secrets/config needed

> **Standard Protocol:** No story reaches ✅ DONE without a CI/CD testing ticket attached.
> The ticket proves ALL 7 pyramid levels pass — not just written, but tested.
> No partial pyramids. If E2E is skipped, the story is not DONE.
```

---

## 7. File Map

| File                             | Purpose                                                                         | Update Frequency        |
| -------------------------------- | ------------------------------------------------------------------------------- | ----------------------- |
| `CLAUDE.md`                      | This file — persistent brain                                                    | After each merged PR    |
| `STORIES.md`                     | Work queue — story registry                                                     | Each story state change |
| `.claude/inputs/`                | Story intake (CoWork `C:\Users\mzdan\claude\Inputs\` / phone)                   | Anytime                 |
| `.claude/documents/`             | Specs, decisions (syncs with CoWork Documents/)                                 | As needed               |
| `.claude/outputs/`               | Claude-generated artifacts (syncs with CoWork Outputs/)                         | As needed               |
| `.claude/research/`              | Analysis, references (syncs with CoWork Research/)                              | As needed               |
| `.claude/skills/`                | Reusable skill definitions                                                      | As needed               |
| `.claude/skills/ccr-protocol.md` | CCR Protocol — standard for all assessments, reviews, test gating, code reviews | Reference               |
| `.claude/sync/LINEAR-MAP.md`     | Story ID ↔ Linear `OUR-XXX` mapping                                             | After Linear import     |
| `docs/migration/PHASE-*.md`      | Phase implementation guides                                                     | Per phase               |
| `docs/stories/*.md`              | Detailed story specs                                                            | Per story               |

---

## 8. CCR Protocol — Standard Review Methodology

**CCR (Critical, Conservative, Recursive) v3.0** is the standard protocol for all assessments, reviews, test gating, and code reviews in this project. When anyone calls for a "CCR", run the protocol defined in `.claude/skills/ccr-protocol.md`.

**When to invoke CCR:**

- Code reviews and PR assessments
- Production readiness reviews
- Test gating decisions
- Security assessments
- Architecture change evaluations
- Any request for "CCR", "confidence check", or "is this ready to ship"

**Core contract:** No AI-assisted output earns artifact status until it survives recursive confidence testing at or above 95%. Below that threshold, the loop pauses, findings are corrected (reactive correction), and the process surfaces to a human.

**Key v3.0 additions:**

- Reactive correction rule — findings drive fixes between loops, not just reports
- Governance artifact protection — CLAUDE.md, STORIES.md, protocol itself require 5+ loops
- Evidence-based verification — "Verified" requires citable evidence, not "I looked at it"
- Security Critical tier — no partial credit on security findings
- CCR Lite — 1-loop fast path for low-risk changes
- Escalation paths, time-boxing, peer review of worksheets
- Threshold advancement framework — path from 95% to 99% gated by infrastructure economics
- Transparency notes — honest framing of statistical claims and weight calibration

---

_Doc status: role current-states last fully verified 2026-08-03 (STORIES.md); corrected for known drift 2026-08-28 (OCR-111 — routes, migrations, infra provisioning, closed BE gaps). The canonical route list is the header comment in `src/router.ts`; the canonical schema is `migrations/` + `migrations-forms/`._
