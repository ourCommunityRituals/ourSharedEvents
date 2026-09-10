# CLAUDE.md — Persistent Brain for ourSharedEvents

> **Org-level vision lives in `OCR-docs/docs/VISION.md`.** This file governs OSE only. OSE is one product in the OCR product line — not the org brain.

> **Session protocol**: Read this file → Read STORIES.md → Find next unstarted story → Implement complete solution → Create PR. No other instruction needed.

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
- **Current state**: ~81 routes implemented (OSE-1242 added `GET /api/v2/events/map` — cell-scoped attendee map; it **refuses coordinate-shaped params with 400** and pins H3 resolution to 7, so Invariant #1 holds by construction rather than by policy). **Public reads are rate-limited by default** (`lib/public-read-limit.ts`, OSE-1247): the wrapper is applied at the route, so an unlimited public read is visibly unlimited when you read the router. **The public event response is an allowlist**, not `...row` spreading (`lib/public-event-projection.ts`) — `h3_res9` is no longer published, because the map refuses to _accept_ res-9 precision and the endpoints were _emitting_ it. Snapshot at v1.2.0. **`events.is_published`** (migration 0070) is the "listed" half of §6.2c; filtered on map + list, deliberately not on fetch-by-id. **70 D1 migrations** (main DB) + 13 forms DB migrations, 3-tier feature flags working (extracted to `@ocr/flags`), forms handler with PII encryption/scrubbing. Phase 2 D1 swap complete — all handlers query D1 directly, no Sheets dependency. Formerly-listed gaps now ✅ DONE: anonymous ID (`lib/anonymous-id.ts`, ADMIN-6), rate limiting (KV-backed + in-isolate, `lib/rate-limit.ts`), PII audit log (`pii_audit_log`, migrations-forms/0009). Known gap: brand scoping is list-level only — `getEvent`/`handleUpdateEvent` are id-only (object-level scoping tracked in OSE-1080).

### Lead FE Integration (FD)

- Coordinates 5 MVP surfaces + forms QR routing
- Integration testing between front and back
- **Current state**: All 5 surfaces render with CSP + CORS. Forms QR handler exists (`form-pages.ts`, 32 test-IDs). **`/events` is server-rendered as of 2026-09-05 (OSE-1243)** — the Worker reads the events through the same DataProvider seam as `GET /api/v2/events` and puts them in the HTML it sends; there is no client fetch and no loading state on the discovery surface. Card markup lives in `src/lib/event-list.ts`, injected at `<!--OCR_EVENT_LIST-->`. Escaping is one function (`src/lib/html-escape.ts`) rather than the four near-copies it replaced, one of which did not escape quotes while interpolating into attributes. **The poster Print control is gated on QR readiness (OSE-286, PR #507, 2026-09-09)**: it is a real `<button>` that starts `disabled` and re-enables only after all four QR `<img>`s settle (load or error), and `@media print` drops the whole `.qr-section` while any `.qr-loading` placeholder remains (`:has(.qr-loading)`) — a poster can no longer be printed with empty QR boxes. The old `javascript:window.print()` anchor (CSP-blocked, undisableable) is gone, closing the OSE-R-020/OSE-285 tie-in; born-red coverage in `poster-print-gate.spec.ts` (worker) + the component-tier `poster-print.spec.ts`. **The SharedReport corridor_map SVG is now composed into a user-visible surface (OSE-628, PR #510, 2026-09-09)**: the signed-link view injects `report.corridor_map.svg` (unescaped — trusted, CSP-clean `renderCorridorMap` output) into `section#corridor-map-container` (`data-testid="corridor-map-section"`, `aria-labelledby="section-corridor-map"`), with a `cell_count` stat chip, a `source==='suppressed'` copy path, and the field-level suppression fallback preserved. `renderCorridorMap` was production-grade but had **never been rendered on any page** until now. The section is mobile-first responsive (base phone → `@media (min-width:700px)` tablet → `@media (min-width:1024px)` laptop) **scoped to that section** — the surface-wide `/sharedReport` table breakpoints stay `max-width` so the OSE-295 mobile-workability gate is untouched. Gate: `corridor-map-render.spec.ts` (9 tests). Gaps: admin Card 3 not wired to form handler, QR codes don't route to native forms, no cross-surface E2E test.

### Sr Design FE

- Mobile-first form UX, Kaizen, uniform design, color palette
- Dedication to test-ids and automation-friendly selectors
- **Current state**: 34 design tokens defined (85% color adoption). **Touch targets 44px+ and input font-size 16px+ are now MEASURED and gated**, not asserted — the mobile-workability audit blocks on PR code across all 11 surfaces (OSE-1236, 2026-09-05). Getting there closed real violations this line had been claiming were absent: `@ocr/ui`'s `.input` was 41px at 13.6px (every form partial inherited it) and `admin.html`'s create form was 34px at 14.4px, with its two textareas on the UA default of 13.3px. They were unmeasurable because `/admin` was skipped on every run (OSE-302's bearer, unset since May) and the component showcase rendered nothing (a class collision with `@ocr/ui`'s file-upload family). `@ocr/ui` has **15** partials; `footer()` is adopted on 5 surfaces (OSE-1232), the rest are not. A11Y foundation done. Gaps: **17** admin inline styles and **9** `max-width` breakpoints across all 7 templates (both drained since the 2026-08 figures of 345/58 — measured 2026-09-04); test-ID coverage 3-80% by surface (forms best at 80%, poster worst at 3%).

### Sr Automation QA

- API tests, Playwright E2E per form type, PII scrub verification
- **Current state**: 237 test files across 6 frameworks; the worker suite alone is **220 spec files / 3276 tests**, root **1893 passed / 322 skipped**. **Adversarial coverage now runs in CI where it matters**: OSE-1243 added a renderer corpus suite (26 payloads x 3 fields) and OSE-1242 added endpoint red-team (16) — both in the worker suite, since `tests/red-team/` itself is unwired (OSE-1244). Every guard added in this line was verified by reverting it and watching the intended tests go red; a suite that cannot fail is not coverage. 7 Vitest files target deployed Worker. PII scrub verified in unit tests. **Known-dead E2E: CI runs an explicit allowlist through `playwright.e2e-smoke.config.ts`, so any `tests/e2e/` spec not named in a workflow never executes** — `npm run test:e2e:negative` and `test:e2e:all` exist and nothing calls them. Measured 2026-09-05 (OSE-1243): four public-surface suites totalling 98 tests had never run, proven by five assertions demanding behaviour OSE-871 deleted months earlier. They were rewritten against the server-rendered surface (98 → 44) with their data-dependent cases moved to `tests/unit/public-events-phase.test.ts` (4 → 27, on the path CI does run). **Do not read a `tests/e2e/` spec as coverage without first checking it is named in `.github/workflows/`.** Tracked in OSE-1244. **`refreshCorridorBaselines`'s `COALESCE(h3_res7, corridor_id)` path is now behaviorally born-red-verified (OSE-631, PR #511, 2026-09-10)**: the three h3/legacy-key tests already existed (from the #302 epic integration) — I confirmed them real by inverting the COALESCE and watching "h3_res7 wins" fail — and added one window-count test (45-day event → `window_30d_count=0, window_90d_count=2`) that closes a **surviving mutant**: nothing had asserted the actual 30d/90d values, so pointing the 30d window at the 90d floor passed the whole suite. **Stryker does not reach this**: `shared-report.ts` is out of the constitution-first `mutate` scope (count-floor/report-depth/pii/admin), its specs run on the workers pool Stryker excludes, and the logic lives inside a SQL string literal (opaque to AST mutators) — so SQL-driven aggregation is guarded by hand-run behavioral mutation testing, not Stryker. Gaps: zero form endpoint smoke tests in CI, zero E2E flows per form type, zero contract tests (Pact).

### SRE/SDET (Performance + Observability)

- CI/CD gates, observability, form submission monitoring, destruction job monitoring
- **Invariant-gate shape (OSE-1246, audited 2026-09-05)**: all 26 gates in `tests/e2e/0-architecture/` are classified in that directory's README as _property-asserting_ (derives its subject list) or _subject-naming_ (hardcodes a path). **Both are legitimate** — which is correct depends on whether the invariant is about a class or one artifact. `deprecation-lock` is the pattern to copy: it names seven paths and is the best gate there, because it is a **meta-gate** asserting that `scripts/guard-no-gas.js` exists, is self-tested, has an allowlist and runbook, and is invoked by CI — the scanning is done by that script, which walks the tree. **Before writing a new gate, read that README.** Two gates were found unable to enforce their own stated rule and were rewritten (`tenant-isolation`, `pii-retention`); rewriting the first immediately exposed a live cross-brand leak on the public recap page that it had been green through for the leak's whole life.
- **Note for local runs**: 31 of 182 tests in `tests/e2e/0-architecture/` fail in the dev container on an environment mismatch — Playwright wants `chromium_headless_shell-1234`, the image ships `-1194`. All 31 are browser-launch failures in the four runtime gates; none is a code failure. The source-shape gates all pass.
- **Current state**: **9** CI gates working (typecheck, schema verify, migration apply, table verify, health check, API smoke, UI smoke, prod isolation, **mobile workability**). Mobile workability became the 9th on 2026-09-05 (OSE-1236): it now runs against **PR code** on a local worker and **blocks** — previously it audited deployed staging and was `continue-on-error`, so its verdict was uncorrelated with the diff under review, while the nightly failed every night since 2026-09-01 because three of four Playwright projects are WebKit and only chromium was installed. Structured logging in place (FORM_EVENT, FLAG_EVENT, LIFECYCLE). k6 scripts exist (5 scenarios). Gaps: zero dashboards, zero alerting, load tests not wired to CI, no performance baselines measured.

### DevOps

- DB provisioning, service config, CI/CD pipeline, secrets management
- **Current state**: CI pipeline mature (security → gate → deploy-staging → smoke/contract/functional-staging → deploy-production → smoke-production). Secrets documented in `.github-secrets-required.json` + `CLOUDFLARE_SECRETS.md`. Environment parity verified. D1 provisioned with real IDs for staging + production (both DBs), KV provisioned 2026-08-18 (OSE-813), R2 buckets bound, CF zone active with routes on `stg.oursharedevents.com` and `oursharedevents.com`; `scripts/check-binding-placeholders.mjs` gates CI against placeholder IDs. Gitleaks config present (`.gitleaks.toml`). Remaining gaps: GCP SA (INFRA-3), FORMS_ENCRYPTION_KEY rotation doc (INFRA-4), first staging deploy sign-off (P1-7/P1-8). Self-hosted runner pool (Bloodraven) retired 2026-09-02 (OSE-1194): all CI runs on GitHub-hosted ubuntu-latest, `tools/runner/` + `runner-env-validation.yml` deleted, brain invariants #11/#12 `retired`; `deploy-production`/`smoke-production` still declare `runs-on: self-hosted` pending their own rehearsed migration (OSE-1194 item 6).

---

## 4. Known Constraints

- **Admin auth**: CF Access JWT (JWKS-verified) + email allowlist; `X-OCR-Internal` and Bearer `ADMIN_KEY` fallbacks are env-flag-gated (staging). Phase 3 brings end-user auth.
- **HTML in Worker bundle**: **331.4KB** embedded templates across 7 files (re-measured 2026-09-05 after the publication question landed; 324.8KB earlier that day, 297KB on 2026-09-04). Served whole with per-request CSP nonces (Phase 1, moved to CDN in Phase 3). **`admin.html` alone is 195.8KB — 59% of the bundle** — and is carried on every invocation including anonymous scans that can never reach it (CF Access). It grew 26.5KB across OSE-1238/1239/1240 (card reorder, CSP-safe dispatcher, front-door chooser), so **the case for splitting it (remediation plan step 7) got stronger, not weaker, while this line sat unmeasured.** `public.html` moved the other way: −3.8KB when OSE-1243 deleted its client list renderer.
- **The "three parallel frontend copies" line was wrong.** Only `src/templates/` holds templates. `web/shared/` is **live and load-bearing** — `testids.js` is generated by `scripts/gen-testids.mjs` (whose `--check` gates CI) and `assetState.js` is served over HTTP and asserted by smoke tests; **do not delete it**. `src/frontend/apiClient/` is 7 TS modules with no importer found — a retirement candidate, not a duplicate.
- **Infrastructure**: D1/KV/R2/zone provisioned (staging + production, real IDs in wrangler.toml); Firebase (Phase 3) not started. First staging deploy in flight (P1-7).
- **Multi-brand isolation**: `brand_id` in schema on core tables, but enforcement is list-level only today — object-level (get/update) scoping is a known gap tracked in OSE-1080.

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
│    6. API (Newman collections against live stg)     │
│    7. E2E (Playwright — full surface flow)          │
│  - No partial pyramids — all 7 levels or not DONE   │
│                                                     │
│ AFTER MERGE                                         │
│  9. Update STORIES.md     → mark DONE               │
│ 10. Update CLAUDE.md §3   → new current states      │
│ 11. Next story begins     → context compounds       │
└─────────────────────────────────────────────────────┘
```

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
