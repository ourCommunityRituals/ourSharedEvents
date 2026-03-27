# Director of Product Owners — Knowledge Base

> **Role:** Owns product direction for ourCommunityRituals ecosystem, ourSharedEvents infrastructure, and all child products
> **Last Reconciled:** 2026-03-27

---

## ourCommunityRituals Ecosystem — Product Map

### Infrastructure Platform

| Product | Repo | Purpose | Code Status |
|---------|------|---------|-------------|
| **ourSharedEvents** | `ourCommunityRituals/ourSharedEvents` | Core event platform — API, admin, surfaces | ✅ Active development |

### Consumer Products (all depend on ourSharedEvents)

| Product | Repo | Purpose | Code Status |
|---------|------|---------|-------------|
| **ourRecNights** | `ourCommunityRituals/ourRecNights` | Adult Recreation Night — Bocce anchor | ❌ No code yet |
| **OurRecordStories** | — | Record-night social events / storytelling | ❌ Concept only |
| **OurOpenTables** | — | Open-table community dinners | ❌ Concept only |
| **OurSharedRings** | — | Research/data analysis from ourSharedEvents | ❌ Concept only |
| **ourSharedMagnets** | — | Technical infra (Cloudflare setup) | ❌ Concept only |

### Services

| Product | Repo | Purpose | Code Status |
|---------|------|---------|-------------|
| **OurPulse** | — | Community consulting / manual league onboarding | ❌ Service (no code) |

---

## ourSharedEvents — Product Status

### Phase Progression

```
Phase 1 BUILD  ████████████████████ COMPLETE (P1-1 through P1-5 ✅)
Phase 1 OPS    ░░░░░░░░░░░░░░░░░░░ NOT STARTED (P1-6 through P1-10 📋)
Phase 2 D1     ▓▓▓░░░░░░░░░░░░░░░░ AHEAD (schema done, not tracked in stories)
Phase 3 FB     ░░░░░░░░░░░░░░░░░░░ NOT STARTED
```

### Story Status (from STORIES.md)

| Story | Title | Status | Notes |
|-------|-------|--------|-------|
| P0-1 | Trello board | 📋 | Tracking via Linear now |
| P1-1 | Worker code | ✅ | `workers/oursharedevents/` |
| P1-2 | CI/CD pipeline | ✅ | `oursharedevents-ci.yml` |
| P1-3 | README identity | ✅ | |
| P1-4 | STORIES.md | ✅ | |
| P1-5 | E2E launch checklist | ✅ | `E2E-LAUNCH.md` |
| P1-6 | Infra provisioning | 📋 | **Next up** — Google Cloud + Cloudflare |
| P1-7 | Secrets + first deploy | 📋 | Blocked by P1-6 |
| P1-8 | Staging sign-off | 📋 | Blocked by P1-7 |
| P1-9 | Repo migration | 📋 | Blocked by P1-8 |
| P1-10 | Production launch v1.0.0 | 📋 | Blocked by P1-9 |
| P2-1 | D1 schema | 📋 | **Actually partially done** — 7 migrations exist |
| P2-2 | Sheets → D1 migration | 📋 | |
| P2-3 | Swap data layer | 📋 | |
| P2-4 | Remove Google SA creds | 📋 | |
| P3-1 | Firebase Hosting + React | 📋 | |
| P3-2 | Firebase Auth | 📋 | |

### MVP Scope Lock (from docs/MVP_SCOPE.md)

**LOCKED — No new surfaces, no new QR slots, no sponsor dashboards.**

- 5 surfaces: admin, public, display, poster, sharedReport
- Unlimited backend QR flows
- 3 poster QR display slots max
- Events-only scope (no portfolio, no multi-event dashboards)

### Current Blockers

1. **P1-6 is the critical path:** No infrastructure provisioned yet (Google Cloud project, Cloudflare zone, DNS)
2. **Dual Worker needs resolution:** Product decision required — which Worker is the product?
3. **STORIES.md doesn't reflect D1 work:** Schema migrations done but story shows BACKLOG

---

## Triangle Framework — Product Model

```
        Events
       /      \
      /        \
Sponsors ──── Customers
```

- **Events:** Core entity — CRUD, templates, scheduling, branding
- **Sponsors:** Brands supporting events — placement tracking, click/impression tokens, monetization hooks
- **Customers:** Attendees — QR scan entry, check-in, registration, anonymized analytics

### D1 Schema maps to Triangle

| Vertex | Tables |
|--------|--------|
| Events | `events` |
| Sponsors | `sponsors` |
| Customers | `scans`, `checkins`, `registrations`, `poster_deployments`, `scan_aggregates` |

---

## Product Decisions Needed

### 1. Dual Worker Resolution

**Options:**
- **A) `workers/oursharedevents/` is canonical** — Port needed features from `worker/`, archive the rest. CI already deploys this.
- **B) `worker/` is canonical** — Move CI to deploy `worker/`, rename `workers/oursharedevents/` to archive. More features immediately.
- **C) Merge** — Bring `worker/` features into `workers/oursharedevents/` structure. Most work, cleanest result.

**Recommendation:** Option A with selective porting. The clean Worker is the right architecture. Port features as stories demand them.

### 2. Story Tracking Tool

STORIES.md references Trello but .claude/inputs/ has a Linear integration story. LINEAR-MAP.md exists with placeholder mappings.

**Decision needed:** Trello or Linear? Current `.claude/sync/LINEAR-MAP.md` suggests Linear.

### 3. ourRecNights MVP

As the first consumer product, ourRecNights needs:
- Its own repo under ourCommunityRituals
- Shared auth with ourSharedEvents (Phase 3 Firebase)
- Event templates for Bocce leagues
- Sponsor placement for local businesses

**Dependency:** ourSharedEvents must reach at least P1-10 (production launch) before ourRecNights can build on it.

---

## Product Metrics (targets, not yet measured)

| Metric | Phase 1 Target | Phase 2 Target |
|--------|---------------|----------------|
| API latency (p50) | <800ms | <10ms |
| API latency (p99) | <2s | <50ms |
| Public page load | <3s | <1s |
| Admin page load | <3s | <1s |
| Uptime | 99% | 99.9% |
| Deploy frequency | Weekly | Daily |
| Time to first event | 5 min | 2 min |

---

## Roadmap View

### Q2 2026 (Now)

- P1-6 through P1-10: Get to production
- Resolve dual Worker
- Update story tracking (Linear?)

### Q3 2026

- P2-1 through P2-3: D1 migration (schema already done)
- ourRecNights repo creation
- Datadog Synthetics setup
- Newman collections for Worker API

### Q4 2026

- P2-4: Remove Google SA credentials
- P3-1: Firebase Hosting + React/Tailwind
- ourRecNights MVP launch

### Q1 2027

- P3-2: Firebase Auth
- OurOpenTables exploration
- Multi-product admin consolidation
