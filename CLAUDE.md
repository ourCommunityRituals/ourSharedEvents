# CLAUDE.md — Persistent Brain for ourSharedEvents

> **Session protocol**: Read this file → Read STORIES.md → Find next unstarted story → Implement complete solution → Create PR. No other instruction needed.

---

## 1. Architecture Decisions

### Phase Model (3 Phases)

| Phase | Stack | Status |
|---|---|---|
| **Phase 1** | Cloudflare Worker + Google Sheets | Build ✅ / Ops 📋 |
| **Phase 2** | Cloudflare Worker + D1 (edge SQLite) | Foundation laid |
| **Phase 3** | Firebase Auth + React/Tailwind on Firebase Hosting | Not started |

**Key principle**: Code is written and tested NOW, infrastructure is the last step. CC writes Worker routes, tests, migrations, and PRs without needing a live staging URL. CI validates. Infrastructure deployment happens when ready.

### Triangle Framework

Three-vertex data model: **Events ↔ Sponsors ↔ Customers**

- **Events**: Gatherings/occasions — the core entity
- **Sponsors**: Brands supporting events — placement + tracking
- **Customers**: Attendees — represented by QR codes and shortlinks

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
├── index.ts           # Entry point
├── router.ts          # Route table
├── auth/admin.ts      # Admin auth guard
├── handlers/
│   ├── health.ts      # Health check
│   ├── events.ts      # Events API
│   └── pages.ts       # HTML pages
└── lib/
    ├── google-auth.ts # Google JWT (Phase 1)
    ├── sheets.ts      # Google Sheets client (Phase 1)
    └── d1.ts          # D1 client (Phase 2 — planned)
```

---

## 2. Privacy Model

<!-- TODO: Fill from your privacy framework -->
<!-- Include: data handling principles, what's collected, what's not, -->
<!-- consent model, data retention, anonymization rules -->

---

## 3. NCR Methodology

<!-- TODO: Fill from your NCR framework -->
<!-- Include: what NCR stands for, core principles, how it applies -->
<!-- to community event management, decision-making framework -->

---

## 4. UEC System

<!-- TODO: Fill from your UEC event type definitions -->
<!-- Include: all event type codes, what each represents, -->
<!-- how they map to Worker routes and data schemas -->
<!-- Reference: "47 event types" mentioned in system design -->

---

## 5. Beverly Study Baseline

<!-- TODO: Fill from your Beverly Study research -->
<!-- Include: baseline metrics, Thursday observation methodology, -->
<!-- how findings feed back into product decisions -->
<!-- Update cycle: weekly after Thursday observations -->

---

## 6. Blackboard Covenant

<!-- TODO: Fill from your Blackboard Covenant principles -->
<!-- Include: the covenant rules, how they govern the system, -->
<!-- what they mean for data, privacy, and community trust -->

---

## 7. ourCommunityRituals Ecosystem

| Product | Repo | Purpose |
|---|---|---|
| **ourSharedEvents** | `ourCommunityRituals/ourSharedEvents` | Core platform — event infrastructure, API, admin |
| **ourRecNights** | `ourCommunityRituals/ourRecNights` | Recreational night leagues |
| **OurRecordNights** | — | Record-night social events |
| **OurOpenTables** | — | Open-table community dinners |
| **ourEventRings** | — | Research/data analysis from ourSharedEvents |
| **OurMagnets** | — | Technical infra (Cloudflare setup) |
| **OurPulse** | — | Consulting/manual league onboarding |

---

## 8. Scrum Team — Role POVs

Every story is implemented from all six POVs simultaneously. CC reads all six and writes code that satisfies all six.

### Product Owner (PO) — You
- Defines acceptance criteria
- Prioritizes backlog
- Reviews sprint progress in Linear
- Accepts/rejects completed stories
- **Current state**: Phase 1 Build complete, Phase 1 Ops next

### Backend Engineer (BE)
- Writes Worker route handlers
- Implements D1 queries (Phase 2)
- Writes Hono middleware
- **Current state**: Worker routes complete, D1 migrations laid

### Frontend Developer (FD)
- Builds React/Tailwind components (Phase 3)
- Maintains 5 MVP surfaces
- **Current state**: HTML templates embedded in Worker (Phase 1)

### QA Engineer (QA)
- Writes Jest unit tests
- Writes Playwright E2E tests
- Validates acceptance criteria
- **Current state**: Test suites exist, schema verification in place

### SDET (Performance)
- Writes load tests
- Monitors latency (Sheets: 200-800ms → D1: <5ms target)
- Performance gates in CI
- **Current state**: Performance notes documented, no automated load tests yet

### DevOps
- Manages CI/CD pipeline (GitHub Actions)
- Manages Cloudflare deployment (wrangler)
- Manages secrets and environment config
- **Current state**: CI pipeline complete, infra provisioning not started

---

## 9. Known Constraints

- **Google Sheets latency**: 200-800ms per request (Phase 1 limitation, fixed in Phase 2)
- **Single admin token**: Shared Bearer token (Phase 1 limitation, fixed in Phase 3)
- **HTML in Worker bundle**: ~200KB embedded templates (Phase 1, moved to CDN in Phase 3)
- **No live infrastructure yet**: CF zone, D1, Firebase not provisioned — code-first approach
- **Multi-brand isolation**: Dual-key pattern (id + brandId) already in schema

---

## 10. The Loop — Session Protocol

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
│  8. Update CLAUDE.md §8   → role current states     │
│                                                     │
│ AFTER MERGE                                         │
│  9. Update STORIES.md     → mark DONE               │
│ 10. Update CLAUDE.md §8   → new current states      │
│ 11. Next story begins     → context compounds       │
└─────────────────────────────────────────────────────┘
```

### What this unlocks

**Unlock 1 — Decouple from infrastructure**: Code is written and tested now. No CF zone, D1, or Firebase needed. Infrastructure is deployed last with finished code, not skeleton code. Cuts 2-4 weeks off timeline.

**Unlock 2 — Context never resets**: CLAUDE.md = project layer. STORIES.md = work queue. Session memory = session layer. Three layers, zero information loss. Every session starts at full speed.

**Unlock 3 — Complete implementations**: Each story includes all 6 role POVs. One story → Worker route + middleware + D1 query + tests + Newman collection + PR. One morning per story. 60 stories at this pace = 60 mornings.

---

## 11. Story Format (for STORIES.md)

Each story should include:

```markdown
### OSE-XXX: [Title]
**Status:** 📋 BACKLOG | 🔄 IN PROGRESS | ✅ DONE
**Prerequisite:** OSE-YYY
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

## 12. File Map

| File | Purpose | Update Frequency |
|---|---|---|
| `CLAUDE.md` | This file — persistent brain | After each merged PR |
| `STORIES.md` | Work queue — story registry | Each story state change |
| `.claude/inputs/` | New story intake (CoWork/phone) | Anytime |
| `.claude/knowledge/` | Session context supplements | As needed |
| `.claude/skills/` | Reusable capabilities | As needed |
| `.claude/sync/LINEAR-MAP.md` | Story ↔ Linear mapping | After Linear import |
| `docs/migration/PHASE-*.md` | Phase implementation guides | Per phase |
| `docs/stories/*.md` | Detailed story specs | Per story |
