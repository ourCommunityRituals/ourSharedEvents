# QA Engineer / Playwright Automation — Knowledge Base

> **Role:** Owns E2E test flows, Playwright feature specs, functional test coverage from user perspective
> **Last Reconciled:** 2026-03-27

---

## Test Infrastructure Overview

### Runners & Configs

| Runner         | Config File                                | Target                                      |
| -------------- | ------------------------------------------ | ------------------------------------------- |
| **Vitest**     | `workers/oursharedevents/vitest.config.ts` | D1 schema/constraint tests                  |
| **Jest**       | `jest.config.js` (root)                    | Unit, contract, integration, triangle tests |
| **Playwright** | `playwright.config.js` + 7 variants        | E2E smoke, pages, flows, negative, API      |

### Playwright Config Variants

| Config                              | Purpose              |
| ----------------------------------- | -------------------- |
| `playwright.config.js`              | Main E2E config      |
| `playwright.smoke.config.ts`        | General smoke suite  |
| `playwright.c4-smoke.config.ts`     | C4 story smoke tests |
| `playwright.stage2-smoke.config.ts` | Stage 2 post-deploy  |
| `playwright.ui-smoke.config.ts`     | UI-specific smoke    |
| `playwright.smoke-packs.config.js`  | Pack-specific tests  |
| `playwright.staging.config.js`      | Staging environment  |
| `playwright-optimized.config.js`    | Optimized variant    |

---

## E2E Test Organization (`tests/e2e/`)

### Layer 1 — Smoke (`tests/e2e/1-smoke/`)

**Purpose:** Must-pass gates. If smoke fails, nothing else runs.

| File                          | What It Validates                                                       |
| ----------------------------- | ----------------------------------------------------------------------- |
| `critical-smoke.spec.js`      | Absolute minimum: health + public page loads                            |
| `Admin.spec.js`               | Admin surface loads with auth                                           |
| `Public.spec.js`              | Public event listing renders                                            |
| `Display.spec.js`             | Display surface renders                                                 |
| `SharedReport.spec.js`        | Shared report surface renders                                           |
| `Poster.spec.js`              | Poster surface renders                                                  |
| `api-contract.spec.js`        | API returns correct JSON shape                                          |
| `coverage-matrix.spec.js`     | All surfaces covered                                                    |
| `brand-branding.spec.js`      | Multi-brand theming applied                                             |
| `security-smoke.spec.js`      | Auth enforcement, CORS headers                                          |
| `full-triangle-smoke.spec.js` | Events (apex) ↔ Sponsors ↔ Customers triangle, SharedReports (center) |
| `mvp-surfaces-smoke.spec.js`  | All 5 MVP surfaces load                                                 |

### Layer 2 — Pages (`tests/e2e/2-pages/`)

**Purpose:** Individual surface deep testing.

| File                           | Surface  | Key Flows                            |
| ------------------------------ | -------- | ------------------------------------ |
| `admin-page.spec.js`           | Admin    | Dashboard renders, event table, auth |
| `public-page.spec.js`          | Public   | Event cards, empty state, mobile     |
| `display-page.spec.js`         | Display  | TV mode, auto-refresh                |
| `poster-page.spec.js`          | Poster   | QR codes render, print layout        |
| `sponsor-page.spec.js`         | Sponsors | Sponsor detail view                  |
| `sponsor-page-gating.spec.js`  | Sponsors | Auth-gated sponsor features          |
| `shared-report-mobile.spec.js` | Report   | Mobile responsive report             |
| `public-surface-e2e.spec.js`   | Public   | Full public surface journey          |
| `display-tv-phone-e2e.spec.js` | Display  | TV vs phone viewport                 |
| `config-page.spec.js`          | Config   | Configuration page                   |

### Layer 3 — Flows (`tests/e2e/3-flows/`)

**Purpose:** Multi-step user journeys across surfaces.

| File                                    | Journey                                     |
| --------------------------------------- | ------------------------------------------- |
| `admin-flows.spec.js`                   | Admin: login → view events → manage         |
| `admin-wizard-flow.spec.js`             | Admin: create event wizard                  |
| `admin-surface-sharedreport.spec.js`    | Admin → shared report generation            |
| `customer-flows.spec.js`                | Customer: discover → view → register        |
| `sponsor-flows.spec.js`                 | Sponsor: view placement → click tracking    |
| `sponsor-management-flows.spec.js`      | Admin: manage sponsors                      |
| `shared-reporting.spec.js`              | Report generation + sharing                 |
| `shared-report-name-resolution.spec.js` | Report name/ID resolution                   |
| `forms-templates.spec.js`               | Template selection + form creation          |
| `forms-shortlinks-qr.spec.js`           | Shortlink + QR code generation              |
| `template-scenarios.spec.js`            | Template edge cases                         |
| `triangle-framework.spec.js`            | Full triangle: Event ↔ Sponsor ↔ Customer |
| `poster-maps-integration.spec.js`       | Poster with Google Maps embed               |
| `advanced-display-features.spec.js`     | Display advanced features                   |

### Layer 4 — Negative (`tests/e2e/4-negative/`)

**Purpose:** Error paths, edge cases, failure recovery.

| File                                  | What It Tests                             |
| ------------------------------------- | ----------------------------------------- |
| `admin-negative-paths.spec.js`        | Wrong token, expired token, missing token |
| `section-visibility-negative.spec.js` | Hidden sections don't leak                |
| `surface-navigation-negative.spec.js` | Invalid routes, 404 handling              |
| `client-error-recovery.spec.js`       | Client-side error recovery                |
| `events-error-handling.spec.js`       | Event API error responses                 |
| `api-error-responses.spec.js`         | API envelope error format                 |
| `cloudflare-worker-errors.spec.js`    | Worker crash handling                     |
| `invalid-data-handling.spec.js`       | Malformed data input                      |
| `network-failures.spec.js`            | Timeout, disconnect, retry                |
| `missing-event-ids.spec.js`           | Non-existent event IDs                    |

### Layer 5 — API (`tests/e2e/api/`)

**Purpose:** API-level E2E tests (not unit — hits real endpoints).

| File                                 | Endpoints                    |
| ------------------------------------ | ---------------------------- |
| `backend-validation.spec.js`         | Input validation enforcement |
| `events-crud-api.spec.js`            | Full CRUD lifecycle          |
| `sponsors-crud-api.spec.js`          | Sponsor CRUD                 |
| `portfolio-analytics-api.spec.js`    | Analytics API                |
| `portfolio-analytics-v2-api.spec.js` | V2 analytics                 |
| `multi-brand-api.spec.js`            | Brand isolation              |
| `system-api.spec.js`                 | Health, status, diagnostics  |

---

## API Smoke Tests (`tests/api/smoke/`)

Playwright-based API validation (no browser, just HTTP):

| File                               | What                       |
| ---------------------------------- | -------------------------- |
| `api-health.spec.ts`               | `/api/status` shape        |
| `events-v2.spec.ts`                | `/api/v2/events` contract  |
| `brand-routing.spec.ts`            | Multi-brand routing        |
| `storyC1-adminAuth.spec.ts`        | Admin auth flow            |
| `storyC3-adminCreateEvent.spec.ts` | Event creation API         |
| `prod-sanity.spec.ts`              | Production endpoint sanity |

---

## Test Execution in CI

### Pipeline Order (from `oursharedevents-ci.yml`)

```
1. typecheck        → TypeScript compilation
2. schema-verify    → D1 migration tests (Vitest)
3. deploy-staging   → Wrangler deploy
4. e2e-staging      → Playwright smoke against staging
5. deploy-production → Manual approval gate
6. e2e-production   → Post-deploy production validation
```

### Legacy Pipeline (from `stage1.yml` / `stage2.yml`)

```
Stage 1: Lint → Unit → Contract → Guards → Quality Gates → Deploy
Stage 2: API Smoke → UI Smoke → E2E Critical → Validation Gate
```

---

## Known Gaps & Issues

1. **Test target mismatch:** 80+ E2E/unit tests target `worker/` implementation, but CI deploys `workers/oursharedevents/`. Only D1 schema tests target the canonical Worker.

2. **No Playwright tests for clean Worker routes:** Need E2E specs for:
   - `GET /` renders public page with event cards
   - `GET /admin` returns 401 without token, 200 with token
   - `GET /api/v2/events` returns correct JSON envelope
   - `GET /health` returns ok: true

3. **No mobile viewport tests for clean Worker:** Embedded HTML has no media queries — need viewport tests

4. **No accessibility tests:** `accessibility.spec.js` exists but targets legacy surfaces

5. **8 Playwright configs:** Config proliferation — consider consolidating to 3: smoke, full, staging

---

## Recommended Next E2E Specs (Priority Order)

1. **`workers-smoke.spec.ts`** — Health, public page, events API, admin auth
2. **`workers-events-api.spec.ts`** — JSON envelope, filtering, single event
3. **`workers-admin-auth.spec.ts`** — Token validation, CF Access JWT, 401/200 flows
4. **`workers-negative.spec.ts`** — 404 routes, malformed requests, missing events
