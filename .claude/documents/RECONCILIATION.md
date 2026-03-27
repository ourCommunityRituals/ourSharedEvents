# Architecture Reconciliation Report

> **Date:** 2026-03-27
> **Purpose:** Reconcile actual codebase state against documented scrum team understanding
> **Scope:** Full ourSharedEvents repo audit across all team role POVs

---

## Executive Summary

The ourSharedEvents codebase is **further ahead than CLAUDE.md documents** in several areas, but has **two parallel Worker implementations** that need architectural resolution. Documentation is extensive (62+ markdown files in docs/) but references legacy systems (GAS/Apps Script) that are archived. The Triangle Framework (Events ↔ Sponsors ↔ Customers) is implemented in schema but not yet wired in the active Worker routes.

### Traffic Light Summary

| Area | Status | Notes |
|------|--------|-------|
| **Worker Routes (Phase 1)** | 🟢 Aligned | `workers/oursharedevents/` matches CLAUDE.md spec |
| **D1 Schema (Phase 2)** | 🟡 Ahead of docs | 7 migrations exist, not documented in STORIES.md as started |
| **Dual Worker Problem** | 🔴 Gap | `worker/` (1,819-line router) vs `workers/oursharedevents/` (80-line router) |
| **CI/CD Pipeline** | 🟡 Mixed | `oursharedevents-ci.yml` is clean; legacy `stage1.yml`/`stage2.yml` still present |
| **Test Suite** | 🟢 Strong | 80+ test files across Jest/Vitest/Playwright, multi-layer coverage |
| **Security** | 🟢 Mature | CodeQL, SLA enforcement, human gates, PII firewall in D1 schema |
| **Postman/Newman** | 🟡 Stale | Collections exist but target legacy GAS endpoints |
| **Frontend Surfaces** | 🟡 Split | Embedded HTML in Worker (Phase 1) + separate `web/` directory artifacts |
| **Ecosystem Products** | 🔴 Docs only | ourRecNights, OurOpenTables, etc. referenced but no code exists |

---

## 1. The Dual Worker Problem (Critical Finding)

### What exists

| Implementation | Location | Lines | Router | Handlers | Auth |
|---------------|----------|-------|--------|----------|------|
| **Phase 1 Clean** | `workers/oursharedevents/src/` | ~740 | 80-line vanilla | 5 files | Bearer + CF Access JWT |
| **Feature-Rich Legacy** | `worker/src/` | ~5,000+ | 1,819-line mega-router | 40+ handlers | OAuth + signed mutations + audit logging |

### The conflict

- CLAUDE.md §1 documents `workers/oursharedevents/src/` as THE Worker structure
- `oursharedevents-ci.yml` deploys from `workers/oursharedevents/`
- But `worker/` contains vastly more functionality: file uploads, monetization hooks, sponsor pages, BigQuery/Vertex AI integrations, admin CRUD, shared reports
- 80+ test files in `tests/` predominantly test the `worker/` implementation (import paths, handler names, route patterns)
- `wrangler.toml` at root points to `worker/` entry point

### Resolution needed

Decide: Is `worker/` the production codebase being refactored into `workers/oursharedevents/`, or is `workers/oursharedevents/` a clean-room rewrite that will absorb `worker/` features over time? This affects every role's knowledge.md.

---

## 2. Phase-by-Phase Reality Check

### Phase 1 — Cloudflare Worker + Google Sheets

| Component | CLAUDE.md Says | Code Reality | Gap |
|-----------|---------------|--------------|-----|
| Health endpoint | `GET /health` | ✅ Exists in both workers | Aligned |
| Events API | `GET /api/v2/events` | ✅ Exists in both workers | Aligned |
| Single event | `GET /api/v2/events/:id` | ✅ Exists in both workers | Aligned |
| Public HTML | `GET /` → 200 HTML | ✅ Embedded in `pages.ts` | Aligned |
| Admin HTML | `GET /admin` → auth-gated | ✅ Bearer token + CF Access | Aligned |
| Admin events API | `GET /api/v2/admin/events` | ✅ Includes archived | Aligned |
| Google Sheets client | `src/lib/sheets.ts` | ✅ 77 lines, clean abstraction | Aligned |
| Google JWT auth | `src/lib/google-auth.ts` | ✅ 147 lines, Web Crypto | Aligned |
| D1 client placeholder | `src/lib/d1.ts` (planned) | ❌ Not created yet | Expected |

**Phase 1 Build: COMPLETE and aligned with docs.**

### Phase 2 — D1 Database

| Component | STORIES.md Says | Code Reality | Gap |
|-----------|----------------|--------------|-----|
| P2-1: Schema migrations | 📋 BACKLOG | ✅ 7 migration files exist (164 lines SQL) | **Ahead** |
| D1 tables | Not started | 7 tables: events, sponsors, poster_deployments, scans, checkins, registrations, scan_aggregates | **Ahead** |
| 11 indexes | Not started | ✅ All defined in `0007_create_indexes.sql` | **Ahead** |
| PII firewall | Not documented | ✅ scans table has NO user_email/name/ip | **Ahead** |
| Schema tests | Not started | ✅ `schema.spec.ts` (5 gates) + `constraints.spec.ts` (5 QA gates) | **Ahead** |
| `wrangler.toml` D1 bindings | Not started | ✅ D1 bindings in all environments | **Ahead** |
| P2-2: Migration script | 📋 BACKLOG | ❌ Not created | Aligned |
| P2-3: Swap data layer | 📋 BACKLOG | ❌ `d1.ts` not created | Aligned |

**Phase 2: Foundation is significantly ahead of what STORIES.md tracks. The schema work is done but not reflected in story status.**

### Phase 3 — Firebase Auth + React/Tailwind

| Component | STORIES.md Says | Code Reality | Gap |
|-----------|----------------|--------------|-----|
| P3-1: Firebase Hosting | 📋 BACKLOG | ❌ No Firebase config | Aligned |
| P3-2: Firebase Auth | 📋 BACKLOG | ❌ No Firebase SDK | Aligned |
| React components | Not started | ❌ No React/Tailwind code | Aligned |
| HTML templates | Embedded in Worker | ✅ ~161 lines in `pages.ts` (clean worker), much more in `worker/` | Aligned |

**Phase 3: Not started, as expected.**

---

## 3. CI/CD Pipeline Reality

### Active workflows

| Workflow | Purpose | Status |
|----------|---------|--------|
| `oursharedevents-ci.yml` | Phase 1 Worker CI/CD | ✅ Active, deploys `workers/oursharedevents/` |
| `security-scan.yml` | CodeQL analysis | ✅ Active |
| `security-triage.yml` | Auto-triage findings | ✅ Active |
| `security-sla-enforcement.yml` | SLA tracking | ✅ Active |
| `security-human-gate.yml` | Manual security approval | ✅ Active |
| `advanced-security-scan.yml` | Extended scanning | ✅ Active |
| `dependency-review.yml` | Dependency checks | ✅ Active |
| `claude-review.yml` | AI code review | ✅ Active |

### Legacy workflows still present

| Workflow | Purpose | Status |
|----------|---------|--------|
| `stage1.yml` | Legacy GAS-era Stage-1 pipeline | ⚠️ Still in repo |
| `stage2.yml` | Legacy GAS-era Stage-2 pipeline | ⚠️ Still in repo |
| 20+ archived workflows | `archive/` subfolder | Properly archived |

### Gap

The legacy `stage1.yml` and `stage2.yml` target the old GAS + `worker/` implementation. The new `oursharedevents-ci.yml` is the canonical pipeline. The legacy workflows should be archived or removed to avoid confusion.

---

## 4. Test Suite Reconciliation

### Coverage by layer

| Layer | Files | Runner | Primary Target |
|-------|-------|--------|----------------|
| Unit | 40+ | Jest | `worker/` handlers, services, utils |
| Contract | 35+ | Jest | API response schemas, bundle contracts |
| API Smoke | 20+ | Playwright | Live endpoint validation |
| E2E Smoke | 10+ | Playwright | Surface loading, auth flows |
| E2E Pages | 10+ | Playwright | Individual surface tests |
| E2E Flows | 15+ | Playwright | User journey tests |
| E2E Negative | 10+ | Playwright | Error paths, edge cases |
| E2E API | 7 | Playwright | CRUD operations |
| Integration | 3 | Jest | Cross-service flows |
| Triangle | 8 | Jest | Event lifecycle phases |
| D1 Schema | 2 | Vitest | Migration verification |
| D1 Constraints | 1 | Vitest | FK/unique enforcement |

### Key finding

The Vitest tests (`workers/oursharedevents/tests/`) are the only tests targeting the clean Phase 1 Worker. The 80+ Jest/Playwright tests in `tests/` target the `worker/` implementation. This means **test coverage for the canonical deployed Worker is thin** — only schema and constraint verification, no route handler unit tests.

---

## 5. Postman/Newman Status

| Collection | Target | Status |
|------------|--------|--------|
| `mvp-event-toolkit-api.json` | Legacy GAS endpoints | ⚠️ Stale |
| `mvp-event-toolkit-flows.json` | Legacy user flows | ⚠️ Stale |
| `newman.config.json` | CI runner config | ⚠️ Needs update |

**Gap:** Collections need to be rewritten to target `workers/oursharedevents/` routes (`/health`, `/api/v2/events`, `/admin`). Current collections reference the old GAS deployment.

---

## 6. Ecosystem Products Status

| Product | Mentioned In | Code Exists | Status |
|---------|-------------|-------------|--------|
| **ourSharedEvents** | CLAUDE.md, README | ✅ Full codebase | Active development |
| **ourRecNights** | CLAUDE.md §2 | ❌ No code | Concept only |
| **OurRecordNights** | CLAUDE.md §2 | ❌ No code | Concept only |
| **OurOpenTables** | CLAUDE.md §2 | ❌ No code | Concept only |
| **ourEventRings** | CLAUDE.md §2 | ❌ No code | Concept only |
| **OurMagnets** | CLAUDE.md §2 | ❌ No code | Concept only |
| **OurPulse** | CLAUDE.md §2 | ❌ No code | Concept only |

These are documented as separate repos under the ourCommunityRituals org. ourSharedEvents is the infrastructure platform they'll all consume.

---

## 7. Recommendations

### Immediate (this sprint)

1. **Resolve dual Worker**: Declare `workers/oursharedevents/` as canonical, archive `worker/` to `archive/worker/`
2. **Update STORIES.md**: Mark D1 schema work (P2-1 partial) to reflect migrations already written
3. **Archive legacy workflows**: Move `stage1.yml` and `stage2.yml` to `archive/`
4. **Add route handler tests**: Write Vitest unit tests for `events.ts`, `health.ts`, `pages.ts`, `admin.ts` in the clean Worker

### Near-term (next 2 sprints)

5. **Update Postman collections**: Rewrite for Worker API routes
6. **Port essential handlers**: If `worker/` has features needed for MVP (admin CRUD, sponsor management), port them into `workers/oursharedevents/` with tests
7. **Datadog Synthetics planning**: Document which endpoints need synthetic monitoring

### Medium-term

8. **Ecosystem repos**: Create skeleton repos for ourRecNights, OurOpenTables, etc. with shared auth/API patterns
9. **Newman CI integration**: Add Postman/Newman run to `oursharedevents-ci.yml`
10. **Datadog integration**: Set up synthetic checks for `/health`, `/api/v2/events`, `/admin` auth flow
