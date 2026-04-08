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

Admin (Bearer token):
  GET /admin                 → 200 HTML (dashboard)
  GET /api/v2/admin/events   → { ok, items[] } (includes archived)
```

### Worker Structure

```
workers/oursharedevents/src/
├── index.ts              # Entry point + scheduled PII lifecycle job
├── router.ts             # Route table (30+ endpoints)
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
| OWL  | OurWhiteList            | `ourCommunityRituals/ourWhiteList`     | Deployment and white label layer. Client fork template.         |

---

## 3. Scrum Team — Role POVs

Every story is implemented from all six POVs simultaneously. CC reads all six and writes code that satisfies all six.

### Product Owner (PO) — You

- Defines acceptance criteria
- Prioritizes backlog
- Reviews sprint progress in Linear
- Accepts/rejects completed stories
- **Current state**: Phase 1 Build complete, Phase 1 Ops blocked on infra (INFRA-1,2,3). Phase 2 (D1 database) complete — data layer is D1-native, no Sheets code remains. 3-tier feature flags implemented. Forms system implemented (4 types). A11Y-1 done. 65 stories across 8 epics tracked. MVP readiness 6.5/10 — staging ready, production blocked.

### Lead Backend Architect (BE)

- Writes Worker route handlers
- Implements D1 queries (Phase 2)
- Owns DB design, API contracts, auth, feature flags, testing pyramid
- **Current state**: 30 routes implemented, 13 D1 migrations (main DB) + forms DB migrations, 3-tier feature flags working, forms handler with PII encryption/scrubbing. Phase 2 D1 swap complete — all handlers query D1 directly, no Sheets dependency. Gaps: anonymous ID (BE-1), rate limiting (BE-2), PII audit log (BE-3), 5 admin endpoints unimplemented.

### Lead FE Integration (FD)

- Coordinates 5 MVP surfaces + forms QR routing
- Integration testing between front and back
- **Current state**: All 5 surfaces render with CSP + CORS. Forms QR handler exists (`form-pages.ts`, 32 test-IDs). Gaps: admin Card 3 not wired to form handler, QR codes don't route to native forms, no cross-surface E2E test.

### Sr Design FE

- Mobile-first form UX, Kaizen, uniform design, color palette
- Dedication to test-ids and automation-friendly selectors
- **Current state**: 34 design tokens defined (85% color adoption). Touch targets 44px+. A11Y foundation done. Gaps: 345 admin inline styles, 58 wrong-direction breakpoints, test-ID coverage 3-80% by surface (forms best at 80%, poster worst at 3%).

### Sr Automation QA

- API tests, Playwright E2E per form type, PII scrub verification
- **Current state**: 237 test files across 6 frameworks. 7 Vitest files target deployed Worker. PII scrub verified in unit tests. Gaps: zero form endpoint smoke tests in CI, zero E2E flows per form type, zero contract tests (Pact).

### SRE/SDET (Performance + Observability)

- CI/CD gates, observability, form submission monitoring, destruction job monitoring
- **Current state**: 8 CI gates working (typecheck, schema verify, migration apply, table verify, health check, API smoke, UI smoke, prod isolation). Structured logging in place (FORM_EVENT, FLAG_EVENT, LIFECYCLE). k6 scripts exist (5 scenarios). Gaps: zero dashboards, zero alerting, load tests not wired to CI, no performance baselines measured.

### DevOps

- DB provisioning, service config, CI/CD pipeline, secrets management
- **Current state**: CI pipeline mature (5-stage, staging+prod). Secrets documented in `.github-secrets-required.json` + `CLOUDFLARE_SECRETS.md`. Environment parity verified. Gaps: D1 not provisioned (placeholder IDs), CF zone not active, GCP not set up, FORMS_ENCRYPTION_KEY undocumented, no gitleaks scanning.

---

## 4. Known Constraints

- **Single admin token**: Shared Bearer token (Phase 1 limitation, fixed in Phase 3)
- **HTML in Worker bundle**: ~200KB embedded templates (Phase 1, moved to CDN in Phase 3)
- **No live infrastructure yet**: CF zone, D1, Firebase not provisioned — code-first approach
- **Multi-brand isolation**: Dual-key pattern (id + brandId) already in schema

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
│     - All 6 role POVs satisfied                     │
│  6. Create PR             → CI runs automatically   │
│  7. Update STORIES.md     → mark IN PROGRESS        │
│  8. Update CLAUDE.md §3   → role current states     │
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

**PO Acceptance Criteria:**

- [ ] Criterion 1
- [ ] Criterion 2

**BE Route Spec:**

- Endpoint: `METHOD /path`
- Request/response contract

**FD UI Spec:**

- Which surface(s) affected
- Component behavior

**QA Test Matrix:**

- Unit tests (Jest)
- E2E tests (Playwright)
- Edge cases

**SDET Load Test:**

- Latency target
- Throughput target

**DevOps Deploy Gate:**

- CI checks required
- Secrets/config needed
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
