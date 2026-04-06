# Director of Product Owners — Knowledge Base

> **Role:** Owns product direction for ourCommunityRituals ecosystem, ourSharedEvents infrastructure, and all child products
> **Last Reconciled:** 2026-03-27

---

## ourCommunityRituals Ecosystem — Product Map

> **Source of truth**: `OCR-docs/docs/VISION.md` — all product repos derive from that document.

| Code | Product                 | Repo               | Purpose                                             | Status             |
| ---- | ----------------------- | ------------------ | --------------------------------------------------- | ------------------ |
| OCR  | OurCommunityRituals LLC | `OCR-docs`         | Org brain. Governance. Vision.                      | Scaffolded         |
| OSE  | OurSharedEvents         | `ourSharedEvents`  | **This repo.** Core platform — API, admin, surfaces | Active development |
| OW   | OurWKRP                 | `ourWKRP`          | Community music curation. Named identity.           | Active development |
| OSG  | OurSharedGames          | `ourSharedGames`   | Founding activation format. Anchor game nights.     | Docs-as-code       |
| OSR  | OurSharedRecords        | `ourSharedRecords` | Music, story, and archive layer. Oral history.      | Docs-as-code       |
| OSP  | OurSharedPulse          | `ourSharedPulse`   | Pre-platform consulting. Human-delivered.           | Docs-as-code       |
| OSM  | OurSharedMagnets        | `ourSharedMagnets` | Developer and franchise layer. API support.         | Docs-as-code       |
| OER  | OurEventRings           | —                  | Intelligence and analytics. Long horizon.           | Not started        |
| OWL  | OurWhiteList            | `ourWhiteList`     | Deployment and white label layer.                   | Docs-as-code       |

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

| Story | Title                    | Status | Notes                                            |
| ----- | ------------------------ | ------ | ------------------------------------------------ |
| P0-1  | Trello board             | 📋     | Tracking via Linear now                          |
| P1-1  | Worker code              | ✅     | `workers/oursharedevents/`                       |
| P1-2  | CI/CD pipeline           | ✅     | `oursharedevents-ci.yml`                         |
| P1-3  | README identity          | ✅     |                                                  |
| P1-4  | STORIES.md               | ✅     |                                                  |
| P1-5  | E2E launch checklist     | ✅     | `E2E-LAUNCH.md`                                  |
| P1-6  | Infra provisioning       | 📋     | **Next up** — Google Cloud + Cloudflare          |
| P1-7  | Secrets + first deploy   | 📋     | Blocked by P1-6                                  |
| P1-8  | Staging sign-off         | 📋     | Blocked by P1-7                                  |
| P1-9  | Repo migration           | 📋     | Blocked by P1-8                                  |
| P1-10 | Production launch v1.0.0 | 📋     | Blocked by P1-9                                  |
| P2-1  | D1 schema                | 📋     | **Actually partially done** — 7 migrations exist |
| P2-2  | Sheets → D1 migration    | 📋     |                                                  |
| P2-3  | Swap data layer          | 📋     |                                                  |
| P2-4  | Remove Google SA creds   | 📋     |                                                  |
| P3-1  | Firebase Hosting + React | 📋     |                                                  |
| P3-2  | Firebase Auth            | 📋     |                                                  |

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

| Vertex    | Tables                                                                        |
| --------- | ----------------------------------------------------------------------------- |
| Events    | `events`                                                                      |
| Sponsors  | `sponsors`                                                                    |
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

### 3. Product Line Activation

OSG (OurSharedGames) is the founding activation format. All product repos are scaffolded with CLAUDE.md, SKILL.md, and README.md. Org vision lives in OCR-docs.

**Founding corridor targets:**

- Blue Island — RIPH, Eagles Hall — June 1 2026
- Beverly — Open OutCry — September 2026

**Dependency:** OSE must reach at least P1-10 (production launch) before consumer products can build on it.

---

## Product Metrics (targets, not yet measured)

| Metric              | Phase 1 Target | Phase 2 Target |
| ------------------- | -------------- | -------------- |
| API latency (p50)   | <800ms         | <10ms          |
| API latency (p99)   | <2s            | <50ms          |
| Public page load    | <3s            | <1s            |
| Admin page load     | <3s            | <1s            |
| Uptime              | 99%            | 99.9%          |
| Deploy frequency    | Weekly         | Daily          |
| Time to first event | 5 min          | 2 min          |

---

## Roadmap View

### Q2 2026 (Now)

- P1-6 through P1-10: Get to production
- Resolve dual Worker
- Update story tracking (Linear?)

### Q3 2026

- P2-1 through P2-3: D1 migration (schema already done)
- OSG activation at founding corridors
- Datadog Synthetics setup
- Newman collections for Worker API (OSM)

### Q4 2026

- P2-4: Remove Google SA credentials
- P3-1: Firebase Hosting + React/Tailwind
- OW (OurWKRP) white label tier activation

### Q1 2027

- P3-2: Firebase Auth
- Cross-product integration testing (OCR system-level)
- Multi-product admin consolidation
