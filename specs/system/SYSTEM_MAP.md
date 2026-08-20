# EventAngle System Map

> **Generated:** 2026-01-04
> **Environment:** Staging (https://stg.eventangle.com)
> **Invariants:** "If you show it, it works." | "Never display a QR unless verified."

---

## Table of Contents

1. [Surfaces & Routes](#1-surfaces--routes)
2. [Cloudflare Routing/Rewrites](#2-cloudflare-routingrewrites)
3. [Frontend Surfaces → Backend/API Dependencies](#3-frontend-surfaces--backendapi-dependencies)
4. [Backend Services/Modules and Boundaries](#4-backend-servicesmodules-and-boundaries)
5. [Data Stores and Access Paths](#5-data-stores-and-access-paths)
6. [Caching/ETag/SWR Behavior](#6-cachingetagswr-behavior)
7. [QR Generation + Verification Gating](#7-qr-generation--verification-gating)
8. [CI/CD Pipeline Summary](#8-cicd-pipeline-summary)
9. [Tests Inventory](#9-tests-inventory)
10. [Observability Inventory](#10-observability-inventory)
11. [Known Risks + Likely Failure Modes](#11-known-risks--likely-failure-modes)
12. [UNKNOWN / Gaps](#12-unknown--gaps)

---

## 1. Surfaces & Routes

### 1.1 Frontend Surfaces

| Surface     | Page Type | Routes                                              | Purpose                       | Evidence                       |
| ----------- | --------- | --------------------------------------------------- | ----------------------------- | ------------------------------ |
| **Public**  | public    | `/public`, `/events`, `/schedule`, `/calendar`, `/` | Event listing & registration  | `worker/src/router.ts:121-124` |
| **Admin**   | admin     | `/admin`, `/manage`, `/dashboard`, `/create`        | Event management dashboard    | `worker/src/router.ts:127-130` |
| **Display** | display   | `/display`, `/tv`, `/kiosk`, `/screen`              | TV/Kiosk large-screen display | `worker/src/router.ts:133-136` |
| **Poster**  | poster    | `/poster`, `/posters`, `/flyers`                    | Printable poster generator    | `worker/src/router.ts:139-141` |
| **Report**  | report    | `/report`, `/analytics`, `/reports`, `/insights`    | SharedAnalytics dashboard     | `worker/src/router.ts:144-147` |
| **Sponsor** | sponsor   | `/sponsor`, `/sponsors`, `/partnership`             | Sponsor analytics portal      | `worker/src/router.ts:150-152` |

### 1.2 API Routes

| Route Pattern                          | Method | Handler                       | Purpose                                        | Evidence                     |
| -------------------------------------- | ------ | ----------------------------- | ---------------------------------------------- | ---------------------------- |
| `/api/status`                          | GET    | `handleStatus`                | Health check (flat response)                   | `worker/src/router.ts:29`    |
| `/api/health/backend`                  | GET    | `handleHealthBackend`         | Backend auth + Sheets health (Story B2)        | `worker/src/router.ts:42-46` |
| `/api/v2/events`                       | GET    | `handleEventsV2`              | Events list (Story B5)                         | `worker/src/router.ts:47`    |
| `/api/v2/events/:id/bundle/:type`      | GET    | `handleGetPublicBundle` etc.  | Bundle endpoints (public/display/poster/admin) | `worker/src/handlers/*.ts`   |
| `/api/v2/admin/events`                 | POST   | `handleV2AdminCreateEvent`    | Create event (Story C3)                        | `worker/src/router.ts:34`    |
| `/api/v2/admin/events/:id`             | PUT    | `handleV2AdminUpdateEvent`    | Update event (Story C4)                        | `worker/src/router.ts:35`    |
| `/api/v2/admin/events/:id/archive`     | POST   | `handleV2AdminArchiveEvent`   | Archive event (Story D2)                       | `worker/src/router.ts:36`    |
| `/api/v2/admin/events/:id/unarchive`   | POST   | `handleV2AdminUnarchiveEvent` | Unarchive event (Story D2)                     | `worker/src/router.ts:36`    |
| `/api/v2/admin/events/:id/default`     | POST   | `handleV2AdminDefaultEvent`   | Set default event (Story D3)                   | `worker/src/router.ts:37`    |
| `/api/v2/admin/events/:id/verify-qr`   | POST   | `handleV2AdminVerifyQr`       | Verify QR codes (Story E2)                     | `worker/src/router.ts:38`    |
| `/api/v2/admin/events/:id/unverify-qr` | POST   | `handleV2AdminUnverifyQr`     | Remove QR verification (Story E2)              | `worker/src/router.ts:38`    |
| `/api/v2/sharedreport`                 | GET    | `handleSharedReport`          | SharedAnalytics bundle (Story F6)              | `worker/src/router.ts:74`    |
| `/health/origin`                       | GET    | `handleHealthOrigin`          | Upstream config check (Story 2.3)              | `worker/src/router.ts:10`    |

### 1.3 Shared Module Routes

| Route                       | Handler              | Purpose                           | Evidence                  |
| --------------------------- | -------------------- | --------------------------------- | ------------------------- |
| `/web/shared/apiClient.js`  | `handleSharedModule` | Shared API client (Story 4.2)     | `worker/src/router.ts:16` |
| `/web/shared/assetState.js` | `handleSharedModule` | Asset state validation (Story E1) | `worker/src/router.ts:17` |

---

## 2. Cloudflare Routing/Rewrites

### 2.1 Staging Routes

| Pattern                    | Zone           | Worker             | Evidence           |
| -------------------------- | -------------- | ------------------ | ------------------ |
| `stg.eventangle.com/*`     | eventangle.com | eventangle-staging | `wrangler.toml:30` |
| `api-stg.eventangle.com/*` | eventangle.com | eventangle-staging | `wrangler.toml:31` |

### 2.2 Production Routes

| Pattern                | Zone           | Worker          | Evidence                            |
| ---------------------- | -------------- | --------------- | ----------------------------------- |
| `eventangle.com/*`     | eventangle.com | eventangle-prod | `cloudflare-proxy/wrangler.toml:89` |
| `api.eventangle.com/*` | eventangle.com | eventangle-prod | `cloudflare-proxy/wrangler.toml:91` |

### 2.3 SEC-4.1: Canonical Host Redirect

**www.eventangle.com/** redirects to **eventangle.com/** via Cloudflare Redirect Rule (301).

| Source                 | Target             | Type          | Evidence                                                                         |
| ---------------------- | ------------------ | ------------- | -------------------------------------------------------------------------------- |
| `www.eventangle.com/*` | `eventangle.com/*` | 301 Permanent | `cloudflare-proxy/wrangler.toml:85-86`, `docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md` |

### 2.4 How /manage Maps to /admin

**Direct mapping in Worker router:**

- `/manage` → serves `admin` page type
- No Cloudflare-level rewrite - handled by Worker `HTML_ROUTE_MAP`
- Evidence: `worker/src/router.ts:128`

### 2.5 Subdomain Policy

| Host                     | Status           | Purpose           |
| ------------------------ | ---------------- | ----------------- |
| `eventangle.com`         | Canonical        | Production        |
| `www.eventangle.com`     | Redirects → apex | SEO consolidation |
| `stg.eventangle.com`     | Direct           | Staging           |
| `api.eventangle.com`     | Direct           | Production API    |
| `api-stg.eventangle.com` | Direct           | Staging API       |

---

## 3. Frontend Surfaces → Backend/API Dependencies

| Surface     | API Endpoints                                                                 | Bundle Type           | Data Required                                   | Evidence                             |
| ----------- | ----------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- | ------------------------------------ |
| **Public**  | `/api/v2/events`, `/api/v2/events/:id/bundle/public`                          | PublicBundleValue     | event, config, lifecyclePhase                   | `src/frontend/apiClient/public.ts`   |
| **Admin**   | `/api/v2/events`, `/api/v2/events/:id/bundle/admin`, `/api/v2/admin/events/*` | AdminBundleValue      | event, config, templates, diagnostics, sponsors | `src/frontend/apiClient/admin.ts`    |
| **Display** | `/api/v2/events/:id/bundle/display`                                           | DisplayBundleValue    | event, config, lifecyclePhase, sponsorStrip     | `src/frontend/apiClient/display.ts`  |
| **Poster**  | `/api/v2/events/:id/bundle/poster`                                            | PosterBundleValue     | event, config, qr (verified only)               | `src/frontend/apiClient/poster.ts`   |
| **Report**  | `/api/v2/sharedreport`                                                        | SharedAnalyticsBundle | summary, surfaces, sponsors, events             | `src/mvp/SharedReport.html`          |
| **Sponsor** | `/api/v2/sponsor/:id`, `/api/v2/sponsor/:id/monetization`                     | SponsorPortfolio      | sponsor, metrics, events                        | `worker/src/handlers/sponsorPage.ts` |

### API Client Architecture

| Client           | File                                | Extends       | Features                          |
| ---------------- | ----------------------------------- | ------------- | --------------------------------- |
| BaseApiClient    | `src/frontend/apiClient/base.ts`    | -             | Retry, timeout, ETag, 304 support |
| PublicApiClient  | `src/frontend/apiClient/public.ts`  | BaseApiClient | SWR pattern, analytics logging    |
| AdminApiClient   | `src/frontend/apiClient/admin.ts`   | BaseApiClient | Auth token, create/update/delete  |
| DisplayApiClient | `src/frontend/apiClient/display.ts` | BaseApiClient | Polling, SWR                      |
| PosterApiClient  | `src/frontend/apiClient/poster.ts`  | BaseApiClient | Print/download, SWR               |

---

## 4. Backend Services/Modules and Boundaries

### 4.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Redirect Rules (SEC-4.1)                                    ││
│  │   www.eventangle.com → eventangle.com (301)                 ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Worker Routes                                                ││
│  │   eventangle.com/* → eventangle-prod                        ││
│  │   stg.eventangle.com/* → eventangle-staging                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Cloudflare Worker (TypeScript)                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐ │
│  │ router.ts      │  │ handlers/*     │  │ domain/*           │ │
│  │ - Route match  │  │ - publicBundle │  │ - qr.ts            │ │
│  │ - Brand detect │  │ - adminBundle  │  │ - assetState.ts    │ │
│  │ - Auth guard   │  │ - eventsV2     │  │ - sharedAnalytics  │ │
│  └────────────────┘  │ - health/*     │  └────────────────────┘ │
│                      └────────────────┘                          │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐ │
│  │ auth/*         │  │ google/*       │  │ sheets/*           │ │
│  │ - admin.ts     │  │ - auth.ts      │  │ - client.ts        │ │
│  │ - adminAuth.ts │  │ - sheets.ts    │  │ - analyticsWriter  │ │
│  └────────────────┘  │ - sheetsWrite  │  └────────────────────┘ │
│                      └────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Google Sheets (Data Store)                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐ │
│  │ EVENTS sheet   │  │ SPONSORS sheet │  │ ANALYTICS sheet    │ │
│  └────────────────┘  └────────────────┘  └────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Service Boundaries

| Service                | Location               | Responsibility                               | Evidence                     |
| ---------------------- | ---------------------- | -------------------------------------------- | ---------------------------- |
| **Router**             | `worker/src/router.ts` | Request routing, brand detection, auth guard | `worker/src/router.ts:1-200` |
| **Handlers**           | `worker/src/handlers/` | Business logic per endpoint                  | `worker/src/handlers/*.ts`   |
| **Domain Models**      | `worker/src/domain/`   | Asset state, QR verification, analytics      | `worker/src/domain/*.ts`     |
| **Auth**               | `worker/src/auth/`     | Admin authentication, Bearer token           | `worker/src/auth/admin.ts`   |
| **Google Integration** | `worker/src/google/`   | OAuth2, Sheets API access                    | `worker/src/google/*.ts`     |
| **Sheets Client**      | `worker/src/sheets/`   | Data read/write operations                   | `worker/src/sheets/*.ts`     |

### 4.3 Backend Mode

| Mode       | Value                 | Description                           | Evidence           |
| ---------- | --------------------- | ------------------------------------- | ------------------ |
| **worker** | `BACKEND_MODE=worker` | Worker-only, no GAS calls (Story 5.2) | `wrangler.toml:49` |

**GAS backend has been deprecated** - all traffic served by Cloudflare Workers.

---

## 5. Data Stores and Access Paths

### 5.1 Primary Data Store: Google Sheets

| Sheet         | Columns                                                   | Purpose          | Access Pattern            | Evidence                               |
| ------------- | --------------------------------------------------------- | ---------------- | ------------------------- | -------------------------------------- |
| **EVENTS**    | ID, NAME, START_DATE, VENUE, DATA_JSON, ASSET_STATE, etc. | Event data       | Read/Write via Sheets API | `worker/src/google/sheets.ts`          |
| **SPONSORS**  | ID, NAME, LOGO_URL, PLACEMENTS, ANALYTICS                 | Sponsor data     | Read via Sheets API       | `worker/src/google/sheets.ts`          |
| **ANALYTICS** | timestamp, eventId, surface, metric, value, etc.          | Analytics events | Write-only (append)       | `worker/src/sheets/analyticsWriter.ts` |

### 5.2 Access Paths

```
Worker → Google OAuth2 (JWT) → Google Sheets API → Spreadsheet
         ↑
   Service Account Credentials
   (GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY_PEM)
```

### 5.3 Data Flow

1. **Read Path**: Worker → `sheetsClient.ts` → `google/sheets.ts` → Sheets API → Sheet data → Domain mapper → API response
2. **Write Path**: Worker → `sheets/analyticsWriter.ts` → `google/sheetsWrite.ts` → Sheets API → Sheet append

---

## 6. Caching/ETag/SWR Behavior

### 6.1 Cache-Control Headers by Endpoint

| Endpoint             | Cache-Control                                        | TTL | SWR | Evidence                                      |
| -------------------- | ---------------------------------------------------- | --- | --- | --------------------------------------------- |
| publicBundle         | `private, max-age=60, stale-while-revalidate=300`    | 60s | 5m  | `worker/src/handlers/publicBundle.ts:171`     |
| adminBundle          | `private, no-cache`                                  | 0s  | N/A | `worker/src/handlers/adminBundle.ts:188`      |
| displayBundle        | `private, max-age=60, stale-while-revalidate=300`    | 60s | 5m  | `worker/src/handlers/displayBundle.ts:234`    |
| posterBundle         | `private, max-age=60, stale-while-revalidate=300`    | 60s | 5m  | `worker/src/handlers/posterBundle.ts:205`     |
| eventsList           | `private, max-age=60, stale-while-revalidate=300`    | 60s | 5m  | `worker/src/handlers/eventsList.ts:320`       |
| staticAssets (prod)  | `public, max-age=300, stale-while-revalidate=600`    | 5m  | 10m | `worker/src/handlers/staticAssets.ts:219-221` |
| sharedModules (prod) | `public, max-age=3600, stale-while-revalidate=86400` | 1h  | 24h | `worker/src/handlers/sharedModules.ts:92-93`  |
| health/*             | `no-cache, no-store, must-revalidate`                | 0s  | N/A | `worker/src/handlers/healthBackend.ts:416`    |

### 6.2 ETag Generation

**Method**: Content-based SHA-256 hash of bundle value

| Bundle       | ETag Source                          | Evidence                                           |
| ------------ | ------------------------------------ | -------------------------------------------------- |
| publicBundle | SHA-256(JSON.stringify(bundleValue)) | `worker/src/mappers/publicBundleMapper.ts:469-481` |
| adminBundle  | SHA-256(JSON.stringify(bundleValue)) | `worker/src/mappers/adminBundleMapper.ts:264-276`  |

### 6.3 If-None-Match Handling

```typescript
// 304 Not Modified response when ETag matches
if (ifNoneMatch && ifNoneMatch === etag) {
  return createNotModifiedResponse(etag);
}
```

Evidence: `worker/src/handlers/publicBundle.ts:368-369`

### 6.4 Drift Risks

| Scenario                 | Max Drift       | Impact                | Severity |
| ------------------------ | --------------- | --------------------- | -------- |
| Event updated in Sheets  | 60s             | Stale event data      | MEDIUM   |
| SWR window serving stale | 300s additional | Extended staleness    | LOW      |
| Shared JS modules        | 1h              | Outdated client logic | MEDIUM   |
| Asset state check        | 0s              | Always fresh          | LOW      |

**No explicit cache invalidation** - relies on TTL expiry and ETag validation.

---

## 7. QR Generation + Verification Gating

### 7.1 QR Invariant

> **INVARIANT**: No QR is ever displayed unless it has been verified by backend.

Evidence: `worker/src/domain/qr.ts:5-7`

### 7.2 Asset State Model

```
DRAFT    → Event exists but not public-ready (QR NOT allowed)
READY    → Event valid but QR not verified (QR NOT allowed)
ACTIVE   → QR verified, safe to render on public surfaces (QR ALLOWED)
ARCHIVED → Hidden everywhere (QR NOT allowed)
```

Evidence: `worker/src/domain/assetState.ts:7-11`

### 7.3 QR Verification Logic

| Function                                 | Purpose                                                | Evidence                      |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `isQRAllowed(assetState)`                | Only returns true if state === 'ACTIVE'                | `worker/src/domain/qr.ts:100` |
| `verifyQRUrl(url, assetState)`           | Returns `{verified: true, url}` or `{verified: false}` | `worker/src/domain/qr.ts`     |
| `buildVerifiedQRData(links, assetState)` | Builds full QR data for event                          | `worker/src/domain/qr.ts`     |

### 7.4 Render Boundaries

| Surface     | QR Rendering                   | Fallback                   | Evidence                               |
| ----------- | ------------------------------ | -------------------------- | -------------------------------------- |
| **Public**  | Only if `qr.verified === true` | Placeholder with lock icon | `public/js/render.js`                  |
| **Poster**  | Only if `qr.verified === true` | Placeholder with lock icon | `poster/js/render.js`                  |
| **Display** | Blocks entirely for non-ACTIVE | 403 response               | `worker/src/handlers/displayBundle.ts` |
| **Admin**   | Shows all QR for management    | N/A                        | Admin can see all states               |

### 7.5 Potential Violation Points

**Analysis Result: NO KNOWN VIOLATION POINTS**

1. **Frontend bypass**: MITIGATED - Strict equality check `qr.verified === true`
2. **Backend leakage**: PROTECTED - URL stripped for non-ACTIVE state
3. **Route gating**: ENFORCED - Display returns 403 for non-ACTIVE
4. **Schema validation**: ENFORCED - `isValidQRContract()` validates structure

Evidence: `tests/smoke/qr-verification.spec.ts`, `tests/smoke/asset-integrity.spec.ts`

---

## 8. CI/CD Pipeline Summary

### 8.1 Pipeline Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        Stage-1 Validation                        │
│  Triggers: PR to main, Push to main, Tag v*.*.*                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ S1·01 Security Check    → npm audit, hardcoded secrets      ││
│  │ S1·02 Lint              → ESLint code quality                ││
│  │ S1·03 Banned Origins    → Story 3 banned origins check      ││
│  │ S1·04 Unit Tests        → Jest + 80% coverage threshold     ││
│  │ S1·05 Contract Tests    → Schema sync, API contracts        ││
│  │ S1·06 Guards            → MVP surfaces, dead code           ││
│  │ S1·07 Backend Router    → Story 0.1 validation              ││
│  │ S1·08 Secret Verify     → verify-secrets.js syntax          ││
│  │ S1·09 Quality Gates     → Aggregator (all must pass)        ││
│  │ S1·10 Sheets Connect    → Google Sheets API test            ││
│  │ S1·11 Deploy Staging    → GAS + Worker deploy               ││
│  │ S1·12 Deploy Prod       → (Tag only) GAS + Worker deploy    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (After Stage-1 success)
┌─────────────────────────────────────────────────────────────────┐
│                       Stage-2 Orchestrator                       │
│  Triggers: Stage-1 success, Manual dispatch                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ S2·01 Check Stage-1     → Validate Stage-1 succeeded        ││
│  │ S2·02 Approval Gate     → (Prod only) Manual approval       ││
│  │ S2·03 Resolve Base URL  → Download artifact from Stage-1    ││
│  │ S2·04 Health Check      → Pre-flight health check           ││
│  │ S2·05 Backend Smoke     → Story 0.1 backend smoke           ││
│  │ S2·06 Backend Health    → Story B3 Backend Health           ││
│  │ S2·07 Env Alignment     → GATE 0 (blocks all if fails)      ││
│  │ S2·08 API Smoke         → GATE 1 (blocks UI if fails)       ││
│  │ S2·09 UI Smoke          → GATE 2 (gated by API smoke)       ││
│  │ S2·10 E2E Tests         → Story 3.3 critical journeys       ││
│  │ S2·11 Worker Cutover    → Story 4.2 cutover validation      ││
│  │ S2·12 Validation Gate   → FINAL (aggregator)                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Key Files

| Workflow      | File                                  | Lines  | Evidence                              |
| ------------- | ------------------------------------- | ------ | ------------------------------------- |
| Stage-1       | `.github/workflows/stage1.yml`        | ~3,000 | `.github/workflows/stage1.yml`        |
| Stage-2       | `.github/workflows/stage2.yml`        | ~2,900 | `.github/workflows/stage2.yml`        |
| Security Scan | `.github/workflows/security-scan.yml` | ~350   | `.github/workflows/security-scan.yml` |

### 8.3 Stage-1 vs Stage-2

| Aspect          | Stage-1                  | Stage-2                  |
| --------------- | ------------------------ | ------------------------ |
| **Trigger**     | PR, Push to main, Tag    | After Stage-1 success    |
| **Environment** | Hermetic (no HTTP calls) | Live (staging or prod)   |
| **Purpose**     | Code quality validation  | Environment validation   |
| **Deployment**  | Deploys to staging/prod  | No deployment            |
| **Production**  | Tag v*._._               | Requires manual approval |

---

## 9. Tests Inventory

### 9.1 Test Counts

| Type                  | Count     | Location               | Evidence                        |
| --------------------- | --------- | ---------------------- | ------------------------------- |
| **Unit Tests**        | 57 files  | `tests/unit/`          | `tests/unit/**/*.test.js`       |
| **Contract Tests**    | 37 files  | `tests/contract/`      | `tests/contract/**/*.test.js`   |
| **E2E Tests**         | 79 files  | `tests/e2e/`           | `tests/e2e/**/*.spec.js`        |
| **API Smoke Tests**   | ~20 files | `tests/e2e/api/smoke/` | `tests/e2e/api/smoke/*.spec.ts` |
| **Load Tests**        | 6 files   | `tests/load/`          | `tests/load/*.js`               |
| **Integration Tests** | 3 files   | `tests/integration/`   | `tests/integration/*.test.js`   |
| **Triangle Tests**    | ~20 files | `tests/triangle/`      | `tests/triangle/**/*.test.js`   |

### 9.2 Key Test Files

| Test                                     | Purpose                     | Evidence                                                         |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `qr-verification.spec.ts`                | QR invariant validation     | `tests/smoke/qr-verification.spec.ts`                            |
| `asset-integrity.spec.ts`                | Asset state enforcement     | `tests/smoke/asset-integrity.spec.ts`                            |
| `gas-html-guardrails.contract.test.js`   | No GAS markers leak         | `tests/contract/gas-html-guardrails.contract.test.js`            |
| `api-schema-validation.contract.test.js` | Schema compliance (retired) | `reference/gas-mvp/tests/api-schema-validation.contract.test.js` |
| `bundles.contract.test.js`               | Bundle structure validation | `tests/contract/bundles.contract.test.js`                        |

### 9.3 Missing Tests

| Gap                          | Description                  | Priority |
| ---------------------------- | ---------------------------- | -------- |
| Chaos/resilience tests       | Exist but not enabled        | MEDIUM   |
| Performance regression tests | No automated perf gates      | LOW      |
| Multi-brand coverage         | Limited brand-specific tests | LOW      |

---

## 10. Observability Inventory

### 10.1 Implemented Observability

| Category                 | Implementation                          | Location                               | Evidence                               |
| ------------------------ | --------------------------------------- | -------------------------------------- | -------------------------------------- |
| **Structured Logging**   | RouterLogger with JSON output           | `worker/src/logger.ts`                 | `worker/src/logger.ts`                 |
| **Request Tracing**      | X-Request-Id, cf-ray headers            | `worker/src/logger.ts`                 | `worker/src/logger.ts`                 |
| **Error Handling**       | GlobalErrorHandler with throttling      | `src/mvp/GlobalErrorHandler.html`      | `src/mvp/GlobalErrorHandler.html`      |
| **Health Endpoints**     | `/health/origin`, `/api/health/backend` | `worker/src/handlers/health*.ts`       | `worker/src/handlers/healthBackend.ts` |
| **Analytics Logging**    | Sheets-based analytics write            | `worker/src/sheets/analyticsWriter.ts` | `worker/src/sheets/analyticsWriter.ts` |
| **CI Notifications**     | Slack/Teams on failure                  | `.github/workflows/stage2.yml`         | `.github/workflows/stage2.yml`         |
| **Synthetic Monitoring** | Cloudflare Health Checks                | `docs/SYNTHETIC_MONITORING.md`         | `docs/SYNTHETIC_MONITORING.md`         |

### 10.2 Missing Observability

| Gap                            | Description                               | Severity |
| ------------------------------ | ----------------------------------------- | -------- |
| **Log Aggregation**            | No centralized log storage (ELK, Datadog) | HIGH     |
| **APM/Distributed Tracing**    | No OpenTelemetry or similar               | HIGH     |
| **Real User Monitoring**       | No RUM solution                           | MEDIUM   |
| **Error Rate Alerting**        | No threshold-based alerts                 | MEDIUM   |
| **Uptime Dashboard**           | No public status page                     | MEDIUM   |
| **Custom Metrics/SLOs**        | No SLO tracking                           | MEDIUM   |
| **Capacity Monitoring**        | No Worker resource tracking               | LOW      |
| **Correlation ID Propagation** | Not propagated frontend → backend         | MEDIUM   |

---

## 11. Known Risks + Likely Failure Modes

### 11.1 Staging-First Risks

| Risk                   | Description                        | Mitigation                 | Severity |
| ---------------------- | ---------------------------------- | -------------------------- | -------- |
| **Cache Drift**        | 60s max-age can serve stale data   | ETag validation, SWR       | MEDIUM   |
| **Sheets Rate Limits** | Google Sheets API quotas           | Token caching, backoff     | MEDIUM   |
| **Auth Token Expiry**  | OAuth tokens expire                | Token refresh logic        | LOW      |
| **Worker Timeout**     | 30s upstream timeout               | Timeout handling, fallback | LOW      |
| **Env Var Mismatch**   | Staging vs production config drift | Env alignment gate         | LOW      |

### 11.2 Likely Failure Modes

| Failure Mode                 | Symptoms                | Detection                                     | Recovery                 |
| ---------------------------- | ----------------------- | --------------------------------------------- | ------------------------ |
| **Sheets API Down**          | 503 on all API calls    | `/api/health/backend` returns `ok:false`      | Wait for Google recovery |
| **Service Account Invalid**  | 401 on Sheets access    | Health check fails with `GOOGLE_AUTH_*` error | Rotate credentials       |
| **Worker Crash**             | 500 on all routes       | Cloudflare error page                         | Automatic restart by CF  |
| **Cache Serving Stale**      | Users see old data      | Compare ETag timestamps                       | Force refresh, wait TTL  |
| **QR Verification Bypassed** | Unverified QR displayed | `asset-integrity.spec.ts` fails               | Immediate hotfix         |

### 11.3 Critical Failure (Non-Negotiable)

| Invariant              | If Violated                  | Detection                                                                    |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| **QR Verification**    | Unverified QR shown to users | `tests/smoke/qr-verification.spec.ts`, `tests/smoke/asset-integrity.spec.ts` |
| **Asset State Gating** | Non-ACTIVE event rendered    | Display/Poster return 403, UI shows placeholder                              |

---

## 12. UNKNOWN / Gaps

See [UNKNOWN_GAPS.md](./UNKNOWN_GAPS.md) for detailed gap analysis.

### Quick Summary

| Category          | Gap                            | Likely Location                 |
| ----------------- | ------------------------------ | ------------------------------- |
| **Observability** | No centralized logging         | Needs Cloudflare Logpush setup  |
| **Observability** | No APM/distributed tracing     | Needs OpenTelemetry integration |
| **Caching**       | No explicit cache invalidation | Would need webhook/pubsub       |
| **Monitoring**    | No SLO tracking                | Needs metrics collection        |
| **Data Store**    | Sheets backup/recovery unclear | Check GCP project settings      |
| **Security**      | Rate limiting unclear          | Check Cloudflare WAF rules      |

---

## References

### Evidence Files (Primary)

- `worker/src/router.ts` - Central Worker router
- `worker/src/domain/qr.ts` - QR verification logic
- `worker/src/domain/assetState.ts` - Asset state model
- `wrangler.toml` - Staging configuration
- `cloudflare-proxy/wrangler.toml` - Production configuration
- `.github/workflows/stage1.yml` - Stage-1 CI
- `.github/workflows/stage2.yml` - Stage-2 CI
- `schemas/*.schema.json` - API schemas (19 files)

### Documentation

- `docs/ci-cd-architecture.md` - CI/CD architecture
- `docs/SYNTHETIC_MONITORING.md` - Monitoring setup
- `docs/RUNBOOK-SEC-4.1-CANONICAL-HOST.md` - SEC-4.1 redirect rule
- `docs/RUNBOOK-SEC-4.2-SINGLE-WORKER-ROUTE.md` - SEC-4.2 route consolidation

---

> **Last Updated:** 2026-01-04
> **Generated by:** Claude Code System Map (Loop 1)
