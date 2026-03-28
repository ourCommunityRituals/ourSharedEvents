# MVP Production Readiness Evaluation

> **Date:** 2026-03-28
> **Scope:** Full system evaluation across 7 scrum roles
> **Method:** Parallel role-based analysis → cross-role synthesis
> **Cross-ref:** `docs/stories/EPIC-ADMIN-PAGE-EVALUATION.md` (admin-specific)

---

## Executive Summary

### Overall Score: 6.5/10 — Staging Ready, Production Blocked

The ourSharedEvents MVP has strong architectural foundations — clean Worker code, privacy-first D1 schema, 3-tier feature flags, and a mature CI/CD pipeline. However, production deployment is blocked by 3 infrastructure gaps and undermined by a dual-codebase problem that splits test coverage.

### Traffic Light Scorecard

| Role | Rating | Key Finding |
|------|--------|-------------|
| **PO** | 🟡 | Core form capture works (free tier); 5 admin API endpoints unimplemented; anonymous ID missing |
| **Lead BE Architect** | 🟡 | DB design clean (16 migrations); no contract testing, no rate limiting, no Newman E2E chain |
| **Lead FE Integration** | 🟡 | All 5 surfaces render with CSP; QR-to-form routing incomplete; no cross-surface E2E test |
| **Sr Design FE** | 🟡 | Tokens defined (34); 50-70% adopted; 345 admin inline styles; test-ID coverage 3-80% by surface |
| **Sr Automation QA** | 🟡 | 237 test files total; only 7 target deployed Worker; zero form endpoint smoke tests in CI |
| **SRE/SDET** | 🟡 | 8 CI gates working; structured logging in place; zero dashboards, zero alerting |
| **DevOps** | 🟡 | Pipeline mature; D1 not provisioned, CF zone not active, GCP not set up |

### Production Blockers (3)

| # | Blocker | Owner | ETA |
|---|---------|-------|-----|
| 1 | D1 database instances not provisioned (placeholder IDs in wrangler.toml) | DevOps | 1 day |
| 2 | Cloudflare zone + DNS not active for oursharedevents.com | DevOps | 1 day |
| 3 | Google Cloud service account not created (Sheets API access) | DevOps | 1 day |

### Critical Risks (5)

| # | Risk | Owner | Impact |
|---|------|-------|--------|
| 1 | Dual Worker: 80+ tests target legacy `worker/`, not deployed `workers/oursharedevents/` | QA + DevOps | Test coverage illusion |
| 2 | No rate limiting on public form endpoints (DOS vulnerability) | BE Architect | Abuse/spam |
| 3 | Anonymous ID system not implemented (Triangle model broken) | BE Architect | No repeat visitor tracking |
| 4 | No API smoke tests for form endpoints in CI pipeline | QA + SRE | Forms deploy untested |
| 5 | FORMS_ENCRYPTION_KEY undocumented (security gap) | DevOps | Key generation unknown |

---

## Table of Contents

1. [PO — Acceptance Criteria, Privacy, Use Cases](#1-po)
2. [Lead BE Architect — DB, API, Auth, Testing, Flags](#2-lead-be-architect)
3. [Lead FE Integration — Surfaces, QR Routing, Integration](#3-lead-fe-integration)
4. [Sr Design FE — Kaizen UX, Tokens, Test-IDs](#4-sr-design-fe)
5. [Sr Automation QA — Test Coverage, Contracts, PII Verify](#5-sr-automation-qa)
6. [SRE/SDET — CI Gates, Observability, Performance](#6-sresdet)
7. [DevOps — Infrastructure, Secrets, Pipeline](#7-devops)
8. [Cross-Cutting Concerns](#8-cross-cutting)
9. [Recommended Stories](#9-recommended-stories)
10. [Priority Action Plan](#10-priority-action-plan)

---

## 1. PO — Acceptance Criteria, Privacy, Use Cases

**Traffic Light: 🟡**
**Justification:** Core form capture works for Free tier; Mid tier gated correctly. But 5 admin API endpoints unimplemented, anonymous ID missing, PII audit trail absent, and no data export path.

### Privacy & Compliance Scorecard

| Requirement | Status | Evidence |
|---|---|---|
| Email never stored raw | ✅ | `forms-db.ts:19-26` SHA-256 hash; `forms.ts:135,242` hash before insert |
| Email encrypted at rest | ✅ | `forms.ts:238-272` AES-GCM; migration 0004 `email_encrypted` column |
| Timestamp bucketed (hourly) | ✅ | `forms-db.ts:34-36` `bucketTimestamp()`; used in all form handlers |
| Survey PII scrubbed before admin read | ⚠️ | `index.ts:97-125` whitelist scrub scheduled; regex may over-permit free-text fields |
| Registration TTL (90 day) | ✅ | `index.ts:84-95` deletes expired; `forms.ts:36` sets 90-day TTL |
| Email retention TTL (30 day) | ✅ | `index.ts:127-138` deletes expired; `forms.ts:37` sets 30-day window |
| Check-in zero PII by design | ✅ | Migration 0002: `event_id + total_count` only, no individual records |
| Anonymous ID system | ❌ | No migration, no handler — admin eval requires it |
| PII destruction audit log | ❌ | No migration, no logging — compliance gap |
| Rate limiting on public forms | ❌ | No rate limiting in `forms.ts` or `router.ts` |
| Consent tracking on forms | ❌ | No checkbox/timestamp — GDPR/CCPA gap |
| Encryption key rotation | ⚠️ | Fixed salt in `forms-db.ts:54`; no rotation mechanism |

### Use Case Coverage

| Use Case | Implemented? | Location | Gap |
|---|---|---|---|
| Register for event | ✅ | `POST /api/v2/events/:id/forms/register` | — |
| Check in at door | ✅ | `POST /api/v2/events/:id/forms/checkin` | Needs anonymous ID |
| Post-event survey | ✅ (mid tier) | `POST /api/v2/events/:id/forms/survey` | Gated by flag |
| Join email list | ✅ (mid tier) | `POST /api/v2/events/:id/forms/email-signup` | Gated by flag |
| View registration count | ✅ (admin) | `GET .../forms/registrations` | No pagination |
| Export form data | ❌ | Not implemented | Missing endpoint |
| Customize form fields | ❌ | Not implemented | `form_config` table exists, no handler |
| Manual PII destruction | ❌ | Not implemented | Cron-only, no manual trigger |
| Self-serve event config | ❌ | Not implemented | Mid-tier feature, no handler |
| Shared analytics report | ❌ | Not implemented | Referenced but no endpoint |

---

## 2. Lead BE Architect — DB, API, Auth, Testing, Flags

**Traffic Light: 🟡**
**Justification:** DB design clean (forms isolated, 16 migrations, feature flags working), auth gates functional, data lifecycle running. But no contract testing, no rate limiting, anonymous ID missing, 5 API endpoints unimplemented, performance baselines unknown.

### Database Design (Two D1 Databases)

**Main DB** (`ocr-db-*`): 9 migrations — events, sponsors, poster_deployments, scans, scan_aggregates, subscribers. PII firewall: `scans` table has NO user_email/name/ip.

**Forms DB** (`ocr-forms-db-*`): 7 migrations — form_registrations, checkin_counts, form_surveys, email_signups, feature_flags. Separate for PII lifecycle compliance.

**Separation rationale:** Different retention (permanent vs 30-day), different write patterns (read-heavy vs write-heavy), independent backup/compliance policies.

### Feature Flag System (Implemented)

- 12 flags across 4 categories: forms (4), config (2), analytics (1), assets (2), branding (3)
- 3 tiers: Free (2 ON), Mid (6 ON), Enterprise (12 ON)
- Resolution: event override → global → default (ON)
- Seed data: `0007_seed_free_tier_flags.sql`
- Admin API: 8 endpoints (list, tiers, current-tier, resolve, set, apply-tier, event override, remove override)

### API Route Inventory (30 mapped, 8 missing)

| Method | Path | Implemented | Tested | Tier |
|---|---|---|---|---|
| POST | `/api/v2/events/:id/forms/register` | ✅ | ✅ Vitest | Free |
| POST | `/api/v2/events/:id/forms/checkin` | ✅ | ✅ Vitest | Free |
| POST | `/api/v2/events/:id/forms/survey` | ✅ | ✅ Vitest | Mid |
| POST | `/api/v2/events/:id/forms/email-signup` | ✅ | ✅ Vitest | Mid |
| GET | `/api/v2/admin/.../registrations` | ✅ | ✅ Vitest | Admin |
| GET | `/api/v2/admin/.../checkin-count` | ✅ | ✅ Vitest | Admin |
| GET | `/api/v2/admin/.../surveys` | ✅ | ✅ Vitest | Admin |
| GET | `/api/v2/admin/.../email-signups` | ✅ | ✅ Vitest | Admin |
| GET | `/api/v2/admin/flags` (8 endpoints) | ✅ | ✅ Vitest | Admin |
| GET | `/api/v2/events`, `/api/v2/events/:id` | ✅ | ❌ | Free |
| GET | `/admin`, `/health`, `/forms/:eventId` | ✅ | ❌ | — |
| **GET** | **`/api/v2/admin/forms/:id/export`** | **❌** | — | Mid |
| **GET/PUT** | **`/api/v2/admin/forms/:id/config`** | **❌** | — | Mid |
| **DELETE** | **`/api/v2/admin/forms/:id/pii`** | **❌** | — | All |
| **GET** | **`/api/v2/sharedreport`** | **❌** | — | Mid |
| **GET** | **`/api/v2/sponsors`** | **❌** | — | — |

### Testing Pyramid

| Layer | Files | Gap |
|---|---|---|
| Unit (Vitest) | 2 (feature-flags, forms-security) | Missing: encryption/decryption, anonymous ID |
| Integration (Vitest) | 1 (forms-e2e, 9 scenarios) | Missing: Sheets integration, error recovery |
| Contract (Pact) | 0 | **Missing entirely** |
| E2E (Newman) | 0 | **Missing entirely** |
| Load | 0 | **Missing entirely** |

### Top BE Gaps

1. **Anonymous ID** — no migration, no handler, Triangle model broken
2. **Rate limiting** — public form endpoints have zero protection
3. **Contract tests** — form submit/response shapes not locked
4. **Newman chain** — no automated create→config→submit→count→export→scrub flow
5. **Pagination** — admin list endpoints return all results (OOM risk at scale)
6. **API envelope mismatch** — handlers return non-standard shapes vs `api-envelope.schema.json`
7. **Flag resolution N+1** — `isFeatureEnabled()` called 12x per event with separate D1 queries each

---

## 3. Lead FE Integration — Surfaces, QR Routing, Integration

**Traffic Light: 🟡**
**Justification:** All 5 surfaces render with CSP and mobile support. Form submissions work E2E in isolation. But admin Card 3 has no form config UI wired, QR codes don't route to native forms, and no cross-surface E2E test exists.

### Surface Status Matrix

| Surface | Source | LOC | Embedded in Worker? | Smoke Tested? |
|---------|--------|-----|--------------------|----|
| Admin | `cloudflare-proxy/templates/admin.html` | 13,042 | ✅ | ✅ `admin.smoke.spec.ts` |
| Public | `cloudflare-proxy/templates/public.html` | 7,512 | ✅ | ✅ `public.smoke.spec.ts` |
| Display | `cloudflare-proxy/templates/display.html` | 7,172 | ✅ | ✅ `display.smoke.spec.ts` |
| Poster | `cloudflare-proxy/templates/poster.html` | 6,533 | ✅ | ✅ `poster.smoke.spec.ts` |
| SharedReport | `cloudflare-proxy/templates/report.html` | 8,062 | ✅ | ✅ `sharedreport.smoke.spec.ts` |
| Forms (QR) | `workers/oursharedevents/src/handlers/form-pages.ts` | ~300 | ✅ | ⚠️ Unit only |

### QR → Form Routing

**What works:** `GET /forms/:eventId?type=register|checkin|survey|email` returns mobile-first HTML with XSS protection, nonce-based CSP, and `data-testid` coverage (32 IDs). Form POSTs to `/api/v2/events/:id/forms/{type}`.

**What's missing:**
- Admin Card 3 doesn't generate QR codes pointing to `/forms/:eventId?type=X`
- No admin UI to configure which forms are enabled per event
- No success state telling customer "You're registered! See you at [event]"
- Client never knows which forms are enabled before loading (no `X-Feature-Flags` header)

### Integration Test Coverage

| Integration Point | Tested? | Gap |
|---|---|---|
| Admin create → public renders | ✅ | — |
| Admin create → display/poster/report | ✅ | — |
| Admin form config → form render | ❌ | **No E2E: admin configures → QR → form loads with event context** |
| Form submit → count in admin | ✅ Vitest | Unit only, not E2E |
| Flag toggle → surface gating | ⚠️ | Flag tested at API level, not cross-surface |
| Sponsor config → all surfaces | ⚠️ | Partial — no verify sponsor renders on all 5 |

---

## 4. Sr Design FE — Kaizen UX, Tokens, Test-IDs

**Traffic Light: 🟡**
**Justification:** Design token foundation solid (34 tokens, 85% color adoption). Mobile-first architecture with safe-area support. But 345 admin inline styles, 58 wrong-direction breakpoints, and test-ID coverage 3-80% by surface.

### Design Token Scorecard

| Category | Tokens | Adoption | Status |
|---|---|---|---|
| Colors | 34 defined | 85% | Good; ~500 hardcoded hex remain in admin inline styles |
| Fonts | 2 families | 95% | Excellent; system stack everywhere |
| Font sizes | 7 (xs–2xl) | 60% | Many inline `font-size: .85rem` instead of tokens |
| Spacing | 0 defined | 0% | **GAP:** No `--spacing-*` tokens; magic numbers throughout |
| Touch targets | `--touch-target-min: 44px` | 70% | Most buttons compliant; admin chevrons 24px (fail) |
| Gradients | 5 defined | 40% | Low adoption |

### Mobile-First Audit

| Surface | Viewport Meta | viewport-fit | Safe Area | Breakpoint Direction |
|---|---|---|---|---|
| Admin | ✅ | cover | ✅ | ❌ 25 max-width (wrong) |
| Display | ✅ | cover | ✅ | ❌ 17 max-width (mixed) |
| Poster | ✅ | cover | ✅ | ❌ 22 max-width (mixed) |
| Public | ✅ | cover | ✅ | ⚠️ 8 max-width (mostly correct) |
| Report | ✅ | cover | ❌ Missing | ❌ Mixed |
| Forms | ✅ | NOT SET | N/A | ✅ 1 query only |

**Total: 58 `max-width` queries** across all surfaces. Should be `min-width` (mobile-first up).

**Forms viewport issue:** `user-scalable=no` may violate WCAG 2.1 SC 1.4.4.

### Test-ID Coverage

| Surface | data-testid Count | Interactive Elements | Coverage |
|---|---|---|---|
| Admin | 47 | ~100+ | 47% ⚠️ |
| Forms (form-pages.ts) | 32 | ~40 | **80%** ✅ |
| Public | 5 | ~30+ | 17% 🔴 |
| SharedReport | 5 | ~40+ | 12% 🔴 |
| Display | 3 | ~50+ | 6% 🔴 |
| Poster | 2 | ~60+ | 3% 🔴 |
| **Total** | **94** | **~320+** | **29%** |

**Forms handler leads at 80%.** All other surfaces depend on shared diagnostic panels that repeat 5x, inflating count without functional coverage. Non-admin surfaces cannot be reliably automated.

### Kaizen Priority

| Priority | Issue | Surface | Fix |
|---|---|---|---|
| P0 | Admin Card 3 forms config scrolls away | Admin | Inline modal or slide panel |
| P0 | QR codes not wired to `/forms/:eventId` | Admin → Forms | Wire QR buttons |
| P1 | 345 inline styles | Admin | Extract to CSS classes + tokens |
| P1 | No skeleton loaders | All | Skeleton per card while data loads |
| P1 | Copy button no feedback | Admin 4-7 | "Copied!" 2s state |
| P2 | Admin chevrons 24px | Admin | Enlarge to 44px+ (WCAG) |
| P2 | Survey rating buttons ~40px | Forms | Increase to 48px |
| P2 | No print stylesheet | Report | Sponsor handout needs `@media print` |

---

## 5. Sr Automation QA — Test Coverage, Contracts, PII Verify

**Traffic Light: 🟡**
**Justification:** 237 test files across 6 frameworks — impressive breadth. But only 7 files target the deployed Worker. Zero form endpoint smoke tests in CI. Zero contract tests for form API shapes.

### The Critical Finding: Test Target Misalignment

| Framework | Directory | Files | Targets Deployed Worker? |
|---|---|---|---|
| Jest | `tests/unit/` | 68 | ❌ Legacy GAS |
| Jest | `tests/contract/` | 37 | ❌ Legacy GAS |
| Jest | `tests/integration/` | 3 | ❌ Legacy GAS |
| Playwright | `tests/api/smoke/` | 31 | ✅ **Deployed Worker** |
| Playwright | `tests/ui/smoke/` | 12 | ✅ **Deployed Worker** |
| Playwright | `tests/e2e/` | 79 | ❌ Legacy GAS |
| **Vitest** | **`workers/oursharedevents/tests/`** | **7** | **✅ Deployed Worker** |
| **TOTAL** | | **237** | **50 target deployed (21%)** |

**Impact:** 79% of test files validate the wrong codebase. The deployed Worker has 7 Vitest files (forms, flags, schema, security) + 43 Playwright smoke files. But zero Playwright tests exercise form endpoints against staging/production.

### PII Scrub Verification: ✅ Strong

- `forms-security.spec.ts` S7: Survey PII scrubbed via lifecycle, whitelist verified
- `forms-security.spec.ts` S8: Surveys invisible to admin until `pii_scrubbed=1`
- `forms-e2e.spec.ts`: Full lifecycle submit→scrub→verify
- **Gap:** No E2E test showing lifecycle ran on production database

### What's Missing

| Gap | Severity | Impact |
|---|---|---|
| API smoke for form endpoints | 🔴 Critical | Cannot verify forms deploy to staging/prod |
| E2E flows per form type | 🔴 Critical | No admin→configure→QR→submit→verify chain |
| Contract tests (Pact) for form shapes | 🔴 Critical | Request/response shapes not locked |
| Feature flag seed parity check | 🟡 High | Seed SQL could drift from code definitions |
| Cross-browser testing in CI | 🟡 Medium | Only Chromium + iPhone 14 Pro (2 of 10 configured devices) |
| Visual regression | 🟡 Medium | Screenshots captured, no `toHaveScreenshot()` comparison |

---

## 6. SRE/SDET — CI Gates, Observability, Performance

**Traffic Light: 🟡**
**Justification:** 8 CI gates fully working with excellent migration verification. Structured logging in place for all form + flag operations. But zero dashboards, zero alerting, and form endpoints not gated in CI.

### CI/CD Gate Inventory

| Gate | Trigger | Blocks Deploy? | Implemented? |
|---|---|---|---|
| TypeScript compile | PR + push + tag | ✅ | ✅ |
| D1 schema verify (Vitest) | PR + push + tag | ✅ | ✅ |
| D1 staging migration apply | Push to main | ✅ | ✅ |
| D1 staging table verify (6+5) | Push to main | ✅ | ✅ |
| Staging health check | Post-deploy | ✅ | ✅ |
| API smoke (31 tests) | Staging + prod | ✅ | ✅ |
| UI smoke (12 tests) | Staging + prod | ✅ | ✅ |
| Prod DB isolation check | Tag vX.Y.Z | ✅ | ✅ |
| **Form API smoke** | — | **❌** | **❌ Not implemented** |
| **Bundle size gate** | — | **❌** | **❌ Not implemented** |
| **Flag seed parity** | — | **❌** | **❌ Not implemented** |
| **PII scrub gate** | — | **❌** | **❌ Not implemented** |
| **Load test (k6)** | — | **❌** | **❌ Scripts exist, not wired** |

### Observability

| What | Status | Detail |
|---|---|---|
| Structured logging | ✅ | JSON: `FORM_EVENT`, `FLAG_EVENT`, `LIFECYCLE_PHASE_ERROR`, `UNHANDLED_ERROR` |
| Dashboards | ❌ | No Cloudflare Analytics, no Datadog/New Relic |
| Alerting | ❌ | No alert on PII scrub failure, error rate spike, or form submission anomaly |
| Performance baseline | ❌ | No latency instrumentation; Sheets 200-800ms observed, D1 <5ms target |
| Load testing | ⚠️ | k6 scripts exist (5 scenarios) but not in CI pipeline |

### Performance Targets (Documented, Not Measured)

| Operation | Phase 1 (Sheets) | Phase 2 (D1) Target | Measured? |
|---|---|---|---|
| Form submit | N/A | < 100ms p99 | ❌ |
| Count query | N/A | < 20ms p99 | ❌ |
| Flag resolve | In-memory | < 5ms p99 | ❌ |
| Admin bundle | 200-800ms | < 100ms p99 | ❌ |

---

## 7. DevOps — Infrastructure, Secrets, Pipeline

**Traffic Light: 🟡**
**Justification:** CI/CD pipeline mature with 8 gates. Secrets thoroughly documented. But 3 infrastructure components not provisioned (D1, CF zone, GCP), blocking production.

### Infrastructure Status

| Component | Status | Provisioned? |
|---|---|---|
| Cloudflare Worker (code) | 🟢 Ready | Code ready, awaiting deploy |
| D1 Main DB (9 migrations) | 🟡 Ready | ❌ Placeholder IDs |
| D1 Forms DB (7 migrations) | 🟡 Ready | ❌ Placeholder IDs |
| Cloudflare Zone + DNS | 🔴 Not started | ❌ |
| Google Cloud Service Account | 🔴 Not started | ❌ |
| Cron Trigger (03:00 UTC) | 🟡 Configured | ❌ Not active |
| R2 Storage (enterprise) | 🔴 Planned | ❌ Post-MVP |

### Secrets Management

**Required (6 Worker secrets):** ADMIN_KEY, SHEETS_SPREADSHEET_ID, GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY_PEM, FORMS_ENCRYPTION_KEY, GOOGLE_MAPS_API_KEY

**Documentation:** `.github-secrets-required.json` (comprehensive), `docs/CLOUDFLARE_SECRETS.md` (detailed)

**Gap:** `FORMS_ENCRYPTION_KEY` undocumented in wrangler.toml comments. No generation procedure documented. No rotation runbook.

### Environment Parity: ✅ Verified

Config (WORKER_ENV, BUILD_VERSION, migrations, table counts, CI gates) matches between staging and production. Intentional difference: `ALLOW_ADMIN_KEY_FALLBACK=true` staging-only.

### Security Workflows (5 active)

| Workflow | Gate | Status |
|---|---|---|
| CodeQL analysis | 🟡 Soft (GHAS not enabled) | Active |
| npm audit (critical/high) | ✅ Hard | Active |
| Script injection scan | ✅ Hard | Active |
| Wrangler config audit | ✅ Hard | Active |
| Human security gate | ✅ Hard (requires label + review) | Active |

**Missing:** No gitleaks/secrets scanning. No DAST runtime validation.

---

## 8. Cross-Cutting Concerns

### 8.1 Dual Worker Problem (Critical)

**Canonical:** `workers/oursharedevents/src/` — 14 files, ~740 lines. Deployed by CI.

**Legacy:** `worker/src/` — 79 files, ~5,000+ lines. NOT deployed. Contains:
- Admin CRUD (create/update/archive events)
- File uploads (R2)
- Sponsor management + monetization hooks
- SharedReport + analytics
- BigQuery + Vertex AI integrations
- OAuth + signed mutations + audit logging
- QR verification

**Test split:** 80+ Jest files target legacy. 7 Vitest files target canonical. 43 Playwright smoke tests hit deployed endpoints.

**Recommendation:** Archive `worker/` → port 3-5 high-value features (admin CRUD, sponsor management, shared report, QR verify) into canonical over Phase 2.

### 8.2 STORIES.md Drift

| Feature | STORIES.md Status | Code Reality |
|---|---|---|
| D1 schema (P2-1) | 📋 BACKLOG | ✅ 16 migrations exist and deploy in CI |
| 3-Tier feature flags | Not tracked | ✅ Fully implemented (12 flags, 3 tiers) |
| Forms system (4 types) | Not tracked | ✅ Handlers, encryption, lifecycle all working |
| Accessibility (A11Y-1) | 🔄 IN PROGRESS | ✅ Merged (commit c9ec475) |
| PII destruction cron | Not tracked | ⚠️ Configured in wrangler.toml, handler exists |
| Schema constraint tests | Not tracked | ✅ 5 gate tests in Vitest |

### 8.3 Documentation Debt

| Stale Doc | Issue | Fix |
|---|---|---|
| `docs/DEPLOYMENT.md` | References GAS + zeventbooks domain | Update to oursharedevents.com |
| `.env.example` | References eventangle.com + GAS backend | Update to D1 + Worker |
| `docs/RUNBOOK-DEPLOYMENT.md` | Stage-1/Stage-2 pipeline refs | Update to `oursharedevents-ci.yml` |
| `worker/wrangler.toml` | Entire file references legacy routes | Archive with `worker/` |

### 8.4 Kaizen Loop Assessment

```
CODE ✅ → TEST ⚠️ → DEPLOY ✅ → MONITOR ❌ → IMPROVE ⚠️
```

| Step | Status | Break Point |
|---|---|---|
| CODE → TEST | ⚠️ | Canonical worker handler tests thin (7 files for 14 source files) |
| TEST → DEPLOY | ✅ | 8 CI gates, migration verify, health check |
| DEPLOY → MONITOR | ❌ | Structured logs exist but no dashboards or alerting |
| MONITOR → IMPROVE | ⚠️ | STORIES.md lags code; no automated sync |
| IMPROVE → CODE | ⚠️ | Multiple source-of-truth docs overlap |

---

## 9. Recommended Stories

New stories surfaced by this evaluation. Format follows STORIES.md conventions. These complement the 40 stories in `EPIC-ADMIN-PAGE-EVALUATION.md`.

### Infrastructure (Blocks Everything)

| ID | Title | Priority | Prereq |
|---|---|---|---|
| **INFRA-1** | Provision D1 databases (main + forms, staging + prod) | 🔴 P0 | — |
| **INFRA-2** | Activate Cloudflare zone + DNS for oursharedevents.com | 🔴 P0 | — |
| **INFRA-3** | Create Google Cloud service account + set secrets | 🔴 P0 | — |
| **INFRA-4** | Document FORMS_ENCRYPTION_KEY generation + rotation | 🔴 P0 | — |

### Backend (Unblocks Triangle Model)

| ID | Title | Priority | Prereq |
|---|---|---|---|
| **BE-1** | Anonymous ID system (migration + handler + cookie) | 🔴 MVP | INFRA-1 |
| **BE-2** | Rate limiting on public form endpoints (Durable Objects or D1) | 🔴 MVP | INFRA-1 |
| **BE-3** | PII destruction audit log (migration + lifecycle update) | 🟡 MVP | INFRA-1 |
| **BE-4** | Form data export endpoint (CSV/JSON) | 🟡 MVP | — |
| **BE-5** | Form config GET/PUT endpoint (self-serve) | 🟡 Mid | — |
| **BE-6** | Manual PII destruction trigger endpoint | 🟡 MVP | BE-3 |
| **BE-7** | API envelope standardization (match schema) | 🟡 MVP | — |
| **BE-8** | Pagination on admin list endpoints | 🟡 MVP | — |
| **BE-9** | Flag resolution optimization (batch query, not N+1) | 🟢 V2 | — |

### Testing (Unblocks Production Confidence)

| ID | Title | Priority | Prereq |
|---|---|---|---|
| **QA-1** | API smoke tests for form endpoints in CI | 🔴 P0 | INFRA-1 |
| **QA-2** | E2E flow: admin→configure→QR→submit→verify count | 🔴 MVP | QA-1 |
| **QA-3** | Contract tests (Pact) for form API shapes | 🟡 MVP | — |
| **QA-4** | Newman E2E chain (create→config→submit→count→scrub) | 🟡 MVP | QA-1, BE-6 |
| **QA-5** | Feature flag seed parity CI gate | 🟡 MVP | — |
| **QA-6** | Edge case suite (double submit, archived form, flag mid-session) | 🟡 MVP | QA-1 |

### Design (Unblocks Automation + UX)

| ID | Title | Priority | Prereq |
|---|---|---|---|
| **DESIGN-3** | data-testid parity — all surfaces to 30+ each | 🔴 MVP | — |
| **DESIGN-1** | Breakpoint standardization (eliminate 58 max-width) | 🟡 MVP | — |
| **DESIGN-8** | External design token file (stop inline duplication) | 🟡 V2↑MVP | — |

### Observability (Unblocks Production Monitoring)

| ID | Title | Priority | Prereq |
|---|---|---|---|
| **SRE-1** | Form submission rate dashboard + alerting | 🟡 MVP | INFRA-1 |
| **SRE-2** | PII destruction job monitoring + failure alerts | 🟡 MVP | BE-3 |
| **SRE-3** | Wire k6 load tests to staging CI gate | 🟡 V2 | INFRA-1 |
| **SRE-4** | Bundle size tracking CI gate (admin.html < 500KB) | 🟢 V2 | — |

### Housekeeping

| ID | Title | Priority | Prereq |
|---|---|---|---|
| **HK-1** | Archive legacy `worker/` directory | 🟡 High | — |
| **HK-2** | Sync STORIES.md with implemented features | 🟡 High | — |
| **HK-3** | Update stale docs (DEPLOYMENT, .env.example, RUNBOOK) | 🟡 Medium | HK-1 |

---

## 10. Priority Action Plan

### Week 1: Unblock Production

| # | Action | Owner | Effort |
|---|---|---|---|
| 1 | Provision D1 instances (INFRA-1) | DevOps | 1 day |
| 2 | Activate CF zone + DNS (INFRA-2) | DevOps | 1 day |
| 3 | Create GCP service account (INFRA-3) | DevOps | 1 day |
| 4 | Document FORMS_ENCRYPTION_KEY (INFRA-4) | DevOps | 2 hours |
| 5 | Add form API smoke tests to CI (QA-1) | QA | 1 day |
| 6 | Archive `worker/` (HK-1) | DevOps | 2 hours |

### Week 2: Close Critical Gaps

| # | Action | Owner | Effort |
|---|---|---|---|
| 7 | Implement rate limiting (BE-2) | BE | 1 sp |
| 8 | Implement anonymous ID (BE-1) | BE | 1 sp |
| 9 | Add data-testid to all surfaces (DESIGN-3) | FE Design | 1 sp |
| 10 | PII destruction audit log (BE-3) | BE | 0.5 sp |
| 11 | Sync STORIES.md (HK-2) | PO | 2 hours |

### Week 3: Production Confidence

| # | Action | Owner | Effort |
|---|---|---|---|
| 12 | E2E form flow test (QA-2) | QA | 1 sp |
| 13 | Contract tests for forms (QA-3) | QA | 1 sp |
| 14 | Form submission dashboard (SRE-1) | SRE | 0.5 sp |
| 15 | PII job monitoring (SRE-2) | SRE | 0.5 sp |
| 16 | API envelope standardization (BE-7) | BE | 0.5 sp |

### Week 4: Staging Sign-off → Production

| # | Action | Owner | Effort |
|---|---|---|---|
| 17 | First staging deploy (P1-7) | DevOps | 1 day |
| 18 | Staging sign-off — all checks pass (P1-8) | PO + QA | 2-3 days |
| 19 | Newman E2E chain (QA-4) | QA | 1 sp |
| 20 | Tag v1.0.0 — production launch (P1-10) | DevOps | 1 day |

---

## Appendix: Cross-Reference with EPIC-ADMIN-PAGE-EVALUATION.md

The admin evaluation identified 40 stories (ADMIN-1 through ADMIN-23, DESIGN-1 through DESIGN-14, QA-1 through QA-2, A11Y-ADMIN-1). This system-wide evaluation adds 25 more stories focused on:

- **Infrastructure provisioning** (INFRA-1 through INFRA-4) — not covered in admin eval
- **Backend architecture gaps** (BE-1 through BE-9) — extends admin eval sections 3, 7
- **Test target misalignment** (QA-1 through QA-6) — new finding: dual Worker problem
- **Observability** (SRE-1 through SRE-4) — extends admin eval section 7
- **Housekeeping** (HK-1 through HK-3) — archive legacy, sync docs

**Combined story count:** 65 stories across 8 epics (ADMIN, DESIGN, QA, A11Y, INFRA, BE, SRE, HK).

**Critical path to v1.0.0:** INFRA-1,2,3 → QA-1 → BE-1,2 → QA-2 → P1-7 → P1-8 → P1-10

---

*Generated by parallel scrum team evaluation — 4 concurrent agents analyzed PO+BE, FE+Design, QA+SRE, DevOps+Cross-cutting. Each finding cross-referenced against deployed code (`workers/oursharedevents/src/`) and admin evaluation (`docs/stories/EPIC-ADMIN-PAGE-EVALUATION.md`).*
