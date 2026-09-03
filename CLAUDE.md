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

### 6 Surfaces

| # | Surface | Route | Template |
| - | ------- | ----- | -------- |
| 1 | Landing | `/` | `landing.html` |
| 2 | Public events | `/events`, `/events/:slug` | `public.html` |
| 3 | Admin | `/admin` (CF Access) | `admin.html` + `admin-signin.html` |
| 4 | Display (TV/kiosk) | `/display` | `display.html` |
| 5 | Poster | `/poster` | `poster.html` |
| 6 | Shared Report | `/sharedReport` | `shared-report.html` |

Landing + five MVP surfaces = six (matches `OCR-docs/docs/OCR_VISION.md` §7 and `docs/features/SURFACES.md`). Alias paths (`/tv`, `/posters`, `/report`, …) are listed in the `router.ts` dispatch, not here.

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

Canonical route table: the header comment of `workers/oursharedevents/src/router.ts` (≈75 method+path pairs plus surface aliases). The block above is the minimum contract, not the full list.

### Worker Structure

```
workers/oursharedevents/src/
├── index.ts              # fetch entry (schema guard, cost metric, X-Monetization-Inert) + scheduled crons
├── router.ts             # Route table (≈75 method+path pairs; header comment is canonical)
├── auth/admin.ts         # Admin auth guard (CF Access JWT verified vs JWKS + allowlist; env-gated fallbacks)
├── domain/               # event-state, event-phase
├── handlers/             # 30 files — health, events, pages, briefing, demo, forms, form-pages,
│                         #   feature-flags, sponsors, sponsors-draft, sponsor-asset-route,
│                         #   poster-bundle, poster-deployments, qr-scan, qr-verify, uec-resolve,
│                         #   shortlink-resolve, shared-report-{read,materialize,export}, event-stats,
│                         #   portfolio-rollup, subscribers, geocode, upload, bigquery, audit,
│                         #   data-subject, privacy
├── lib/                  # 50 files — forms-db, feature-flags (shim over @ocr/flags), cors,
│                         #   anonymous-id, rate-limit, admin-{allowlist,brand-scope,object-scope},
│                         #   audit-log, shared-report*, sponsor-*, uec/, geo, h3-tagging, schema-guard,
│                         #   schema-lexicon, cost-metric, count-floor, ai-sanitization (dormant seam)
├── cloud/ google/        # BigQuery + WIF (keyless GCP auth)
└── templates/            # 7 HTML templates, per-request CSP nonces
```

---

## 2. ourCommunityRituals Ecosystem

> **Source of truth**: `OCR-docs/docs/OCR_VISION.md` (vendored copy at `.ocr-standards/docs/OCR_VISION.md`) — all product repos derive from that document. OSE's product-level vision pointer is `docs/OCR_VISION.md`; the detail lives in `docs/features/VISION.md`.
>
> **identity_mode: anonymous** — OSE is the anonymous base layer (Invariant #1). OW is the named layer; the two never share a database.

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
- **Current state**: Phase 1 Build complete. INFRA-1 (D1) and INFRA-2 (CF zone + DNS) ✅ DONE; remaining infra: INFRA-3 (GCP SA) and INFRA-4 (FORMS_ENCRYPTION_KEY rotation doc). P1-7 ✅ DONE (OSE-12), P1-8 ✅ DONE (OSE-13; first staging deploy + health check OSE-548 closed 2026-08-25), P1-9 ✅ DONE (repo lives at `ourCommunityRituals/ourSharedEvents`); P1-10 production launch 📋 BACKLOG (OSE-15). Phase 2 (D1 database) complete — data layer is D1-native, no Sheets code remains. 3-tier feature flags implemented. Forms system implemented (4 types). A11Y-1 done. Production gate: OSE-540 CCR promotion criteria (staging green + live T4 run + score ≥85%).

### Lead Backend Architect (BE)

- Writes Worker route handlers
- Implements D1 queries (Phase 2)
- Owns DB design, API contracts, auth, feature flags, testing pyramid
- **Current state**: ~80 routes implemented, 68 D1 migrations (main DB) + 13 forms DB migrations, 3-tier feature flags working (extracted to `@ocr/flags`), forms handler with PII encryption/scrubbing. Phase 2 D1 swap complete — all handlers query D1 directly, no Sheets dependency. Formerly-listed gaps now ✅ DONE: anonymous ID (`lib/anonymous-id.ts`, ADMIN-6), rate limiting (KV-backed + in-isolate, `lib/rate-limit.ts`), PII audit log (`pii_audit_log`, migrations-forms/0009). Object-level brand scoping ✅ DONE (OSE-1080, #420): `lib/admin-object-scope.ts` runs at the single router dispatch point and 404s any `/api/v2/admin/events/:id/*` or `/api/v2/admin/poster-deployments/:id` request whose target `brand_id` is outside the caller's scope; the handlers themselves stay id-only behind that guard.

### Lead FE Integration (FD)

- Coordinates the 6 surfaces + forms QR routing
- Integration testing between front and back
- **Current state**: All 6 surfaces render with CSP + CORS. Forms QR handler exists (`form-pages.ts`); the admin forms panel links to `/forms/:eventId?type=…` (`admin.html`) and `/q/<qr_token>` records an anonymous scan then routes to the form page (OSE-625). Gap: cross-surface journeys (T4b/T4e) run only after a `main` deploy, never on a PR.

### Sr Design FE

- Mobile-first form UX, Kaizen, uniform design, color palette
- Dedication to test-ids and automation-friendly selectors
- **Current state**: 34 design tokens defined (85% color adoption). Touch targets 44px+. A11Y foundation done. Gaps: 345 admin inline styles, 58 wrong-direction breakpoints, test-ID coverage 3-80% by surface (forms best at 80%, poster worst at 3%).

### Sr Automation QA

- API tests, Playwright E2E per form type, PII scrub verification
- **Current state**: 237 test files across 6 frameworks. 7 Vitest files target deployed Worker. PII scrub verified in unit tests. Form endpoint smoke runs in T3 (4 types + admin + validation); per-form E2E in T4c / T4c-phase2 (blocking since OSE-1169); API contract via Bruno in T2 (OSE-1191 replaced Postman/Newman). Gaps: T2/T3/T4 run post-deploy on `main` only — PRs are gated by S0 + T0 alone; the red-team suite (`tests/red-team/`, 5 specs) is not invoked by any workflow (brain #23).

### SRE/SDET (Performance + Observability)

- CI/CD gates, observability, form submission monitoring, destruction job monitoring
- **Current state**: 8 CI gates working (typecheck, schema verify, migration apply, table verify, health check, API smoke, UI smoke, prod isolation). Structured logging in place (FORM_EVENT, FLAG_EVENT, LIFECYCLE). k6 scripts exist (5 scenarios). Gaps: zero dashboards, zero alerting, load tests not wired to CI, no performance baselines measured. Conformance Report workflow is red on `main` since 45b1894 — the refresh-PR push is refused (403) so `workers/oursharedevents/docs/security/CONFORMANCE.md` is frozen at 2026-08-03 and still counts 24 invariants with #11/#12 enforced (OSE-1031 follow-up).

### DevOps

- DB provisioning, service config, CI/CD pipeline, secrets management
- **Current state**: CI pipeline mature (security → gate → deploy-staging → smoke/contract/functional-staging → deploy-production → smoke-production). Secrets documented in `.github-secrets-required.json` + `CLOUDFLARE_SECRETS.md`. Environment parity verified. D1 provisioned with real IDs for staging + production (both DBs), KV provisioned 2026-08-18 (OSE-813), R2 buckets bound, CF zone active with routes on `stg.oursharedevents.com` and `oursharedevents.com`; `scripts/check-binding-placeholders.mjs` gates CI against placeholder IDs. Gitleaks config present (`.gitleaks.toml`). Remaining gaps: GCP WIF + Maps key provisioning (INFRA-3 → OSE-555; keyless WIF replaced the service-account plan), FORMS_ENCRYPTION_KEY rotation doc (INFRA-4). Staging is deployed and health-checked (OSE-548); production launch is OSE-15 behind the OSE-540 gate. Self-hosted runner pool (Bloodraven) retired 2026-09-02 (OSE-1194): all CI runs on GitHub-hosted ubuntu-latest, `tools/runner/` + `runner-env-validation.yml` deleted, brain invariants #11/#12 `retired`; `deploy-production`/`smoke-production` still declare `runs-on: self-hosted` pending their own rehearsed migration (OSE-1194 item 6).

---

## 4. Known Constraints

- **Admin auth**: CF Access JWT (JWKS-verified) + email allowlist; `X-OCR-Internal` and Bearer `ADMIN_KEY` fallbacks are env-flag-gated (staging). Phase 3 brings end-user auth.
- **HTML in Worker bundle**: ~253KB embedded templates across 7 files, served whole with per-request CSP nonces (Phase 1, moved to CDN in Phase 3). Three parallel frontend copies exist (`src/templates/`, `web/`, `src/frontend/`) — `src/templates/` is what actually serves.
- **Infrastructure**: D1/KV/R2/zone provisioned (staging + production, real IDs in wrangler.toml); Firebase (Phase 3) not started. Staging deployed (OSE-548, 2026-08-25); production launch pending (OSE-15, gate OSE-540).
- **Multi-brand isolation**: `brand_id` on core tables; list endpoints scope by brand and object-level admin routes are guarded at the router (OSE-1080). Brain #9 stays `partial` until the T4 cross-brand runtime spec exists.

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
│     - Tests (Vitest + Playwright)                   │
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
│ AFTER MERGE                                         │
│  9. Update STORIES.md     → mark DONE               │
│ 10. Update CLAUDE.md §3   → new current states      │
│ 11. Next story begins     → context compounds       │
└─────────────────────────────────────────────────────┘
```

### What this unlocks

**Unlock 1 — Decouple from infrastructure**: Code is written and tested now. No CF zone, D1, or Firebase needed. Infrastructure is deployed last with finished code, not skeleton code. Cuts 2-4 weeks off timeline.

**Unlock 2 — Context never resets**: CLAUDE.md = project layer. STORIES.md = work queue. Session memory = session layer. Three layers, zero information loss. Every session starts at full speed.

**Unlock 3 — Complete implementations**: Each story includes all 6 role POVs. One story → Worker route + middleware + D1 query + tests + Bruno collection + PR. One morning per story. 60 stories at this pace = 60 mornings.

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
- [ ] API: Bruno collections pass against live staging (T2)
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
| `.ocr-standards/skills/`         | CCR Protocol + skills propagated from OCR-docs (`ccr-protocol.knowledge.md`, `ccr-mvp.md`) | On propagation PR       |
| `.claude/sync/LINEAR-MAP.md`     | Story ID ↔ Linear `OUR-XXX` mapping                                             | After Linear import     |
| `docs/migration/PHASE-*.md`      | Phase implementation guides                                                     | Per phase               |
| `docs/stories/*.md`              | Detailed story specs                                                            | Per story               |

---

## 8. CCR Protocol — Standard Review Methodology

**CCR (Critical, Conservative, Recursive) v3.0** is the standard protocol for all assessments, reviews, test gating, and code reviews in this project. When anyone calls for a "CCR", run the protocol defined in `.ocr-standards/skills/ccr-protocol.knowledge.md` (propagated from `OCR-docs/skills/`).

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

_Doc status: role current-states last fully verified 2026-08-03 (STORIES.md); corrected for known drift 2026-08-28 (OCR-111 — routes, migrations, infra provisioning, closed BE gaps); reconciled against `main` @ 2159601 on 2026-09-03 (six surfaces, OSE-1080 closed, P1-7/8/9 done, Bruno replaces Newman, skills path). The canonical route list is the header comment in `src/router.ts`; the canonical schema is `migrations/` + `migrations-forms/`._
