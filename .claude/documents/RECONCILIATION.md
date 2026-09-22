# Architecture Reconciliation Report

> **Date:** 2026-03-27
> **Purpose:** Reconcile actual codebase state against documented scrum team understanding
> **Scope:** Full ourSharedEvents repo audit across all team role POVs

---

## Executive Summary

The ourSharedEvents codebase is **further ahead than CLAUDE.md documents** in several areas, but has **two parallel Worker implementations** that need architectural resolution. Documentation is extensive (62+ markdown files in docs/) but references legacy systems (GAS/Apps Script) that are archived. The Triangle Framework (Events at apex, Sponsors bottom-left, Customers bottom-right, SharedReports center) is implemented in schema but not yet wired in the active Worker routes.

### ADR/code reconciliation rule

The repo's reconciliation loop must treat the implementation as the system-of-record and the ADRs as decision rationale. When the ADR and code differ, the ADR is stale until reconciled.

This is the standard for every sync pass:

1. Read the relevant ADR(s) first for intent
2. Verify the implementation in the code and tests
3. If they differ, reconcile the ADR in the same change set or mark it superseded/deprecated
4. Treat Linear/admin/backlog state as drift unless it is directly verified against the code

This rule is now codified in `docs/adr/ADR-RECONCILIATION-PROCESS.md` and should be part of every sync / rebase / doc-reconciliation pass.

### Traffic Light Summary

| Area                        | Status           | Notes                                                                             |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| **Worker Routes (Phase 1)** | 🟢 Aligned       | `workers/oursharedevents/` matches CLAUDE.md spec                                 |
| **D1 Schema (Phase 2)**     | 🟡 Ahead of docs | 7 migrations exist, not documented in STORIES.md as started                       |
| **Dual Worker Problem**     | 🔴 Gap           | `worker/` (1,819-line router) vs `workers/oursharedevents/` (80-line router)      |
| **CI/CD Pipeline**          | 🟡 Mixed         | `oursharedevents-ci.yml` is clean; legacy `stage1.yml`/`stage2.yml` still present |
| **Test Suite**              | 🟢 Strong        | 80+ test files across Jest/Vitest/Playwright, multi-layer coverage                |
| **Security**                | 🟢 Mature        | CodeQL, SLA enforcement, human gates, PII firewall in D1 schema                   |
| **Postman/Newman**          | 🟡 Stale         | Collections exist but target legacy GAS endpoints                                 |
| **Frontend Surfaces**       | 🟡 Split         | Embedded HTML in Worker (Phase 1) + separate `web/` directory artifacts           |
| **Ecosystem Products**      | 🔴 Docs only     | ourRecNights, OurOpenTables, etc. referenced but no code exists                   |

---

## 1. The Dual Worker Problem (Critical Finding)

### What exists

| Implementation          | Location                       | Lines   | Router                 | Handlers     | Auth                                     |
| ----------------------- | ------------------------------ | ------- | ---------------------- | ------------ | ---------------------------------------- |
| **Phase 1 Clean**       | `workers/oursharedevents/src/` | ~740    | 80-line vanilla        | 5 files      | Bearer + CF Access JWT                   |
| **Feature-Rich Legacy** | `worker/src/`                  | ~5,000+ | 1,819-line mega-router | 40+ handlers | OAuth + signed mutations + audit logging |

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

| Component             | CLAUDE.md Says             | Code Reality                   | Gap      |
| --------------------- | -------------------------- | ------------------------------ | -------- |
| Health endpoint       | `GET /health`              | ✅ Exists in both workers      | Aligned  |
| Events API            | `GET /api/v2/events`       | ✅ Exists in both workers      | Aligned  |
| Single event          | `GET /api/v2/events/:id`   | ✅ Exists in both workers      | Aligned  |
| Public HTML           | `GET /` → 200 HTML         | ✅ Embedded in `pages.ts`      | Aligned  |
| Admin HTML            | `GET /admin` → auth-gated  | ✅ Bearer token + CF Access    | Aligned  |
| Admin events API      | `GET /api/v2/admin/events` | ✅ Includes archived           | Aligned  |
| Google Sheets client  | `src/lib/sheets.ts`        | ✅ 77 lines, clean abstraction | Aligned  |
| Google JWT auth       | `src/lib/google-auth.ts`   | ✅ 147 lines, Web Crypto       | Aligned  |
| D1 client placeholder | `src/lib/d1.ts` (planned)  | ❌ Not created yet             | Expected |

**Phase 1 Build: COMPLETE and aligned with docs.**

### Phase 2 — D1 Database

| Component                   | STORIES.md Says | Code Reality                                                                                    | Gap       |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------------- | --------- |
| P2-1: Schema migrations     | 📋 BACKLOG      | ✅ 7 migration files exist (164 lines SQL)                                                      | **Ahead** |
| D1 tables                   | Not started     | 7 tables: events, sponsors, poster_deployments, scans, checkins, registrations, scan_aggregates | **Ahead** |
| 11 indexes                  | Not started     | ✅ All defined in `0007_create_indexes.sql`                                                     | **Ahead** |
| PII firewall                | Not documented  | ✅ scans table has NO user_email/name/ip                                                        | **Ahead** |
| Schema tests                | Not started     | ✅ `schema.spec.ts` (5 gates) + `constraints.spec.ts` (5 QA gates)                              | **Ahead** |
| `wrangler.toml` D1 bindings | Not started     | ✅ D1 bindings in all environments                                                              | **Ahead** |
| P2-2: Migration script      | 📋 BACKLOG      | ❌ Not created                                                                                  | Aligned   |
| P2-3: Swap data layer       | 📋 BACKLOG      | ❌ `d1.ts` not created                                                                          | Aligned   |

**Phase 2: Foundation is significantly ahead of what STORIES.md tracks. The schema work is done but not reflected in story status.**

### Phase 3 — Firebase Auth + React/Tailwind

| Component              | STORIES.md Says    | Code Reality                                                       | Gap     |
| ---------------------- | ------------------ | ------------------------------------------------------------------ | ------- |
| P3-1: Firebase Hosting | 📋 BACKLOG         | ❌ No Firebase config                                              | Aligned |
| P3-2: Firebase Auth    | 📋 BACKLOG         | ❌ No Firebase SDK                                                 | Aligned |
| React components       | Not started        | ❌ No React/Tailwind code                                          | Aligned |
| HTML templates         | Embedded in Worker | ✅ ~161 lines in `pages.ts` (clean worker), much more in `worker/` | Aligned |

**Phase 3: Not started, as expected.**

---

## 3. CI/CD Pipeline Reality

### Active workflows

| Workflow                       | Purpose                  | Status                                        |
| ------------------------------ | ------------------------ | --------------------------------------------- |
| `oursharedevents-ci.yml`       | Phase 1 Worker CI/CD     | ✅ Active, deploys `workers/oursharedevents/` |
| `security-scan.yml`            | CodeQL analysis          | ✅ Active                                     |
| `security-triage.yml`          | Auto-triage findings     | ✅ Active                                     |
| `security-sla-enforcement.yml` | SLA tracking             | ✅ Active                                     |
| `security-human-gate.yml`      | Manual security approval | ✅ Active                                     |
| `advanced-security-scan.yml`   | Extended scanning        | ✅ Active                                     |
| `dependency-review.yml`        | Dependency checks        | ✅ Active                                     |
| `claude-review.yml`            | AI code review           | ✅ Active                                     |

### Legacy workflows still present

| Workflow               | Purpose                         | Status            |
| ---------------------- | ------------------------------- | ----------------- |
| `stage1.yml`           | Legacy GAS-era Stage-1 pipeline | ⚠️ Still in repo  |
| `stage2.yml`           | Legacy GAS-era Stage-2 pipeline | ⚠️ Still in repo  |
| 20+ archived workflows | `archive/` subfolder            | Properly archived |

### Gap

The legacy `stage1.yml` and `stage2.yml` target the old GAS + `worker/` implementation. The new `oursharedevents-ci.yml` is the canonical pipeline. The legacy workflows should be archived or removed to avoid confusion.

---

## 4. Test Suite Reconciliation

### Coverage by layer

| Layer          | Files | Runner     | Primary Target                         |
| -------------- | ----- | ---------- | -------------------------------------- |
| Unit           | 40+   | Jest       | `worker/` handlers, services, utils    |
| Contract       | 35+   | Jest       | API response schemas, bundle contracts |
| API Smoke      | 20+   | Playwright | Live endpoint validation               |
| E2E Smoke      | 10+   | Playwright | Surface loading, auth flows            |
| E2E Pages      | 10+   | Playwright | Individual surface tests               |
| E2E Flows      | 15+   | Playwright | User journey tests                     |
| E2E Negative   | 10+   | Playwright | Error paths, edge cases                |
| E2E API        | 7     | Playwright | CRUD operations                        |
| Integration    | 3     | Jest       | Cross-service flows                    |
| Triangle       | 8     | Jest       | Event lifecycle phases                 |
| D1 Schema      | 2     | Vitest     | Migration verification                 |
| D1 Constraints | 1     | Vitest     | FK/unique enforcement                  |

### Key finding

The Vitest tests (`workers/oursharedevents/tests/`) are the only tests targeting the clean Phase 1 Worker. The 80+ Jest/Playwright tests in `tests/` target the `worker/` implementation. This means **test coverage for the canonical deployed Worker is thin** — only schema and constraint verification, no route handler unit tests.

---

## 5. Postman/Newman Status

| Collection                     | Target               | Status          |
| ------------------------------ | -------------------- | --------------- |
| `mvp-event-toolkit-api.json`   | Legacy GAS endpoints | ⚠️ Stale        |
| `mvp-event-toolkit-flows.json` | Legacy user flows    | ⚠️ Stale        |
| `newman.config.json`           | CI runner config     | ⚠️ Needs update |

**Gap:** Collections need to be rewritten to target `workers/oursharedevents/` routes (`/health`, `/api/v2/events`, `/admin`). Current collections reference the old GAS deployment.

---

## 6. Ecosystem Products Status

| Product             | Mentioned In      | Code Exists      | Status             |
| ------------------- | ----------------- | ---------------- | ------------------ |
| **ourSharedEvents** | CLAUDE.md, README | ✅ Full codebase | Active development |
| **ourRecNights**    | CLAUDE.md §2      | ❌ No code       | Concept only       |
| **OurRecordNights** | CLAUDE.md §2      | ❌ No code       | Concept only       |
| **OurOpenTables**   | CLAUDE.md §2      | ❌ No code       | Concept only       |
| **ourEventRings**   | CLAUDE.md §2      | ❌ No code       | Concept only       |
| **OurMagnets**      | CLAUDE.md §2      | ❌ No code       | Concept only       |
| **OurPulse**        | CLAUDE.md §2      | ❌ No code       | Concept only       |

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

---

## Reconciliation Update — 2026-04-09

### D1 Migration Documentation Sweep

**Trigger:** CCR prod readiness assessment revealed 7+ documentation files actively contradicting the current D1-native architecture by referencing Google Sheets as the current data layer.

### What Changed

| File                                            | Action                | Scope                                                        |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `README.md`                                     | **Rewritten**         | Phase 1 → D1, Quick Start secrets corrected, API ref updated |
| `STORIES.md`                                    | **Corrected**         | P1-6 and P1-7 acceptance criteria updated for D1             |
| `.claude/skills/backend-architect.knowledge.md` | **Rewritten**         | Data layer, secrets, file tree, known gaps all updated       |
| `docs/qa/E2E-LAUNCH.md`                         | **Superseded notice** | Parts 1-2 marked obsolete, points to INFRA-CHECKLIST.md      |
| `docs/runbooks/RUNBOOK.md`                      | **Full rewrite**      | Removed all eventangle.com/GAS references, D1-native         |
| `docs/runbooks/RUNBOOK-SECRETS.md`              | **Full rewrite**      | Google SA secrets removed, D1 secrets documented             |
| `docs/runbooks/ROLLBACK.md`                     | **Full rewrite**      | GAS rollback → D1/Worker rollback procedures                 |
| `docs/security/WORKER_VARS_AUDIT.md`            | **Updated**           | Stale secrets marked removed, FORMS_ENCRYPTION_KEY added     |
| `docs/security/SECURITY_BASELINE-ROOT.md`       | **Updated**           | Trust boundary 3 changed from Sheets to D1                   |
| `docs/security/SECURITY_BASELINE.md`            | **Updated**           | Auth model and data layer corrected                          |
| `docs/deployment/CLOUDFLARE_SECRETS.md`         | **Updated**           | Google secrets removed, D1 secrets documented                |
| `docs/features/ERROR-REFERENCE.md`              | **Updated**           | SHEETS\_\* error codes removed, health check corrected       |

### New Files Created

| File                                 | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `docs/deployment/INFRA-CHECKLIST.md` | Copy-paste-ready infrastructure setup (P1-6/7/8)              |
| `docs/runbooks/DISASTER-RECOVERY.md` | DR protocol with 5 scenarios, backup strategy, drill schedule |

### Traffic Light Update

| Area               | March 27 Status      | April 9 Status          | Notes                                               |
| ------------------ | -------------------- | ----------------------- | --------------------------------------------------- |
| **D1 Schema**      | 🟡 Ahead of docs     | 🟢 Aligned              | 17 migrations, docs updated                         |
| **Dual Worker**    | 🔴 Gap               | 🟡 Resolved in practice | `workers/oursharedevents/` is canonical, 30+ routes |
| **CI/CD**          | 🟡 Mixed             | 🟢 Aligned              | 697-line pipeline, 8 gates                          |
| **Postman/Newman** | 🟡 Stale             | 🟢 Aligned              | Collections wired into CI                           |
| **Documentation**  | 🟡 Stale Sheets refs | 🟢 Aligned              | This sweep corrected all active lies                |
| **DR/Rollback**    | 🟡 GAS-era           | 🟢 Aligned              | D1-native DR + rollback docs                        |

### DAC Compliance Note

This reconciliation follows the VISION.md DAC principle: documentation and code move together. The 13-day gap between Phase 2 completion and documentation correction (March 27 → April 9) is the type of drift this protocol exists to prevent. Going forward, every phase migration MUST include a documentation sweep as part of the story acceptance criteria.
