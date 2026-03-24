# Origin Map - Epic EA-001

> **Story 1.1**: Origin Map & Runtime Graph
>
> Single source of truth for all origin/base URL configurations across the codebase.
> Focus: **Staging environment** (`stg.eventangle.com`)

**Last Updated**: 2025-12-14
**Status**: Story 5.3 Complete - GAS backend ARCHIVED, Worker-only architecture

---

## Origin Invariants (First-Class Rule)

> **Story 3.3**: Make the "no GAS in CI/runtime" rule a first-class invariant, not tribal memory.

### Public Origins (ONLY allowed in CI/runtime)

All public traffic **MUST** flow through Cloudflare Workers:

| Environment | Canonical URL | Backend |
|-------------|---------------|---------|
| **Staging** | `https://stg.eventangle.com` | Cloudflare Worker |
| **Production** | `https://www.eventangle.com` | Cloudflare Worker |

These are the **only** origins permitted in CI pipelines, runtime code, and tests.

### GAS Direct Usage Restrictions

**GAS Direct** (`script.google.com/macros/s/{ID}/exec`) is **BANNED** from CI and runtime.

GAS Direct may **ONLY** be used in these contexts:

1. **Local, manual debugging** - Developer troubleshooting on their own machine
2. **Explicitly allowlisted files** - Files in the allowlist that are **never** executed in CI:
   - `config/gas-upstream.template.json` (migration reference)
   - `archive/**` (legacy code archive)
   - `schemas/**` (JSON Schema examples)
   - `postman/**` (API testing collection examples)
   - `.clasp*.json` (Google clasp CLI configuration)
   - Documentation files (`*.md`)

### CI Gate: Banned Origins Script

The `check-banned-origins` script enforces this invariant as a **Stage-1 hard gate**:

```bash
# Run locally
npm run check:banned-origins

# Runs automatically in CI (stage1-ci.yml)
node scripts/check-banned-origins.mjs
```

**What it scans:**
- `tests/**`, `worker/**`, `web/**`, `src/**`, `config/**`, `cloudflare-proxy/**`
- Root config files (`.env*`, `deploy-manifest.json`, `wrangler.toml`)

**What it bans:**
- `script.google.com/macros/s/{ID}/exec` (GAS execution URLs with real IDs)
- `script.google.com/home/projects/{ID}` (GAS project URLs)
- `googleusercontent.com/macros` (legacy GAS pattern)

**Exit codes:**
- `0` - No banned patterns found (or only in allowlisted files)
- `1` - Banned patterns detected → **build fails**

### Quick Checklist for New Features

Before merging any new feature, ask:

- [ ] **Does this call any URL not under `eventangle.com`?**
  - If yes: **Why?** Document the justification.
  - If calling external APIs (Google Sheets API, etc.): Ensure it's from the Worker, not frontend.
- [ ] **Does this introduce any `script.google.com` references?**
  - If yes: **Reject** unless it's in an allowlisted file for local debugging only.
- [ ] **Run `npm run check:banned-origins`** - must pass before push.

### Adding New Origins

If you add a new origin (e.g., a dedicated API domain like `api.eventangle.com`):

1. **Update this document** (`docs/origins.md`) in the **same PR**
2. Add the new origin to the "Public Origins" table above
3. Update `wrangler.toml` routes
4. Update `deploy-manifest.json` if applicable
5. Ensure CI workflows reference the new origin correctly

---

## Executive Summary

As of Story 5.3, **all traffic flows through Cloudflare Workers**. The Google Apps Script (GAS) backend has been archived. This document catalogs all origin references for the staging cleanup (Stories 1.2-1.3).

| Environment | Canonical URL | Backend | Status |
|-------------|---------------|---------|--------|
| **Staging** | `https://stg.eventangle.com` | Cloudflare Worker | **ACTIVE** |
| **Production** | `https://www.eventangle.com` | Cloudflare Worker | **ACTIVE** |
| **GAS Direct** | `https://script.google.com/macros/s/{ID}/exec` | Google Apps Script | **ARCHIVED** |

---

## 1. Staging Origins (ACTIVE)

### 1.1 Primary Staging URLs

| URL | Purpose | Configured In | Status |
|-----|---------|---------------|--------|
| `https://stg.eventangle.com` | Main staging site | `wrangler.toml`, workflows, tests | **ACTIVE** |
| `https://api-stg.eventangle.com` | Staging API | `wrangler.toml` routes | **ACTIVE** |

### 1.2 Configuration Sources

#### Cloudflare Worker (`wrangler.toml` at root)
```toml
# Lines 29-32
routes = [
  { pattern = "stg.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api-stg.eventangle.com/*", zone_name = "eventangle.com" }
]

# Line 49 - Worker-only mode
BACKEND_MODE = "worker"
```

#### Cloudflare Worker (`cloudflare-proxy/wrangler.toml`)
```toml
# [env.staging] Lines 159-166
routes = [
  { pattern = "stg.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api-stg.eventangle.com/*", zone_name = "eventangle.com" }
]

# Line 194 - Worker-only mode
BACKEND_MODE = "worker"
```

#### GitHub Workflows
| Workflow | Variable | Value | File:Line |
|----------|----------|-------|-----------|
| `stage1.yml` | `STG_BASE_URL` | `https://stg.eventangle.com` | Line 55 |
| `stage1.yml` | `STAGING_URL` | `https://stg.eventangle.com` | Line 58 |
| `stage2.yml` | `STG_BASE_URL` | `https://stg.eventangle.com` | Line 94 |
| `stage2.yml` | `STAGING_URL` | `https://stg.eventangle.com` | Line 95 |
| `stage2-smoke.yml` | `STG_BASE_URL` | `https://stg.eventangle.com` | Line 78 |
| `e2e-staging-stable.yml` | `BASE_URL` | `https://stg.eventangle.com` | Line 44 |
| `rollback.yml` | `STG_BASE_URL` | `https://stg.eventangle.com` | Line 56 |
| `prod-parity-check.yml` | `STG_BASE_URL` | `https://stg.eventangle.com` | Line 51 |

#### Test Configuration
| File | Variable/Function | Default Value |
|------|-------------------|---------------|
| `config/environments.js:58` | `STAGING_URL` | `https://stg.eventangle.com` |
| `playwright.config.js:51` | `baseURL` | `env.baseUrl` (defaults to staging) |
| `playwright.staging.config.js:20` | `baseUrl` | `process.env.BASE_URL \|\| STAGING_URL` |
| `playwright.ui-smoke.config.ts:70` | `baseURL` | `getBaseUrl()` (defaults to staging) |
| `tests/e2e/config.js:30` | `baseUrl` | `getBaseUrl()` (defaults to staging) |

#### Deploy Manifest (`deploy-manifest.json`)
```json
{
  "environments": {
    "staging": {
      "urls": {
        "baseUrl": "https://stg.eventangle.com",
        "apiUrl": "https://api-stg.eventangle.com"
      }
    }
  }
}
```

---

## 2. GAS Origins (LEGACY - To Remove)

> **Status**: ARCHIVED as of Story 5.3 (2025-12-13)
>
> GAS backend is no longer used. These references should be removed or clearly marked as legacy/archive.

### 2.1 GAS Deployment IDs (ARCHIVED)

| Environment | Script ID | Deployment ID | Status |
|-------------|-----------|---------------|--------|
| **Staging** | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` | `AKfycbwFneYCpkio7wCn7y08eDUb2PRCPc2Tdtbv20L4AbEHvuCvoqY9ks7-ONL0pzPPw4Hm` | **ARCHIVED** |
| **Production** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` | `AKfycbz-RVTCdsQsI913wN3TkPtUP8F8EhSjyFAlWIpLVRgzV6WJ-isDyG-ntaV1VjBNaWZLdw` | **ARCHIVED** |

### 2.2 Files with GAS URLs

#### Active Runtime Files (Require Review)

| File | Line(s) | Content | Action |
|------|---------|---------|--------|
| `config/deployment-ids.js` | 114, 156 | Constructs `STAGING_WEB_APP_URL`, `PROD_WEB_APP_URL` | **LEGACY** - Only used for legacy aliases |
| `config/environments.js` | 75-76 | `GAS_PRODUCTION_URL`, `GAS_STAGING_URL` exports | **LEGACY** - Re-exports from deployment-ids |
| `tests/e2e/config.js` | 35 | `isGoogleAppsScript()` helper | **LEGACY** - For detecting GAS environment |
| `tests/shared/test-data-manager.js` | 60 | GAS hostname detection | **LEGACY** - Test helper |
| `tests/ui/smoke/events.smoke.spec.ts` | 347-349 | GAS hostname check | **LEGACY** - Smoke test validation |
| `cloudflare-proxy/worker.js` | 205, 210 | GAS URL construction (deprecated path) | **LEGACY** - Commented/deprecated |

#### Documentation Files (Mark as Archive)

| File | Context | Status |
|------|---------|--------|
| `docs/env/staging.md` | Staging GAS URLs | **LEGACY** - Update or archive |
| `docs/env/gas-projects.md` | GAS project URLs | **LEGACY** - Archive |
| `docs/RUNBOOK.md` | GAS debugging URLs | **LEGACY** - Update |
| `RUNBOOK.md` | GAS monitoring URLs | **LEGACY** - Update |
| `docs/DEPLOYMENT.md` | GAS deployment URLs | **LEGACY** - Update |
| `docs/STAGING_EVENTS_DIAGNOSIS.md` | GAS debugging | **LEGACY** - Archive |
| `docs/STAGING_GAS_PERMISSIONS.md` | GAS permissions | **LEGACY** - Archive |

#### Configuration Files (Commented Out - OK)

| File | Line(s) | Status |
|------|---------|--------|
| `wrangler.toml` | 56-59 | **OK** - Commented out, kept for emergency rollback |
| `cloudflare-proxy/wrangler.toml` | 121-124, 204-207, 244-246, 341-344 | **OK** - Commented out |

#### Test Documentation (Update)

| File | Line(s) | Status |
|------|---------|--------|
| `tests/README.md` | 199, 207, 354, 436, 443 | **LEGACY** - Remove GAS direct option |
| `.env.example` | 35, 51 | **LEGACY** - Remove GAS direct option |
| `.devcontainer/README.md` | 61, 77 | **LEGACY** - Remove GAS direct option |

#### Archive/Historical (Leave As-Is)

| File | Status |
|------|--------|
| `archive/PROJECT_CONFIGURATION.md` | **OK** - In archive |
| `.github/workflow-archive/*.yml` | **OK** - In archive |
| `schemas/*.schema.json` | **OK** - Schema examples |
| `postman/environments/*.json` | **LEGACY** - Update environments |

---

## 3. Frontend API Client Configuration

### 3.1 Browser-Side API Client (`web/shared/apiClient.js`)

| Setting | Value | Notes |
|---------|-------|-------|
| `DEFAULT_API_BASE` | `/api` | Relative path - uses current hostname |
| Environment Detection | `window.location.hostname` | Auto-detects staging vs production |

```javascript
// Lines 781-784 - Environment detection
state.isStaging = isDomain(hostname, 'stg.eventangle.com') ||
                  hostname === 'localhost' ||
                  hostname === '127.0.0.1';
state.isProduction = isDomain(hostname, 'eventangle.com') && !state.isStaging;
```

**Status**: **ACTIVE** - No GAS references, uses relative `/api` paths

### 3.2 TypeScript API Client (`src/frontend/apiClient/env.ts`)

| Function | Returns | Notes |
|----------|---------|-------|
| `detectEnvironment()` | `staging \| production \| local \| unknown` | No GAS detection |
| `getApiBackend()` | Always `'worker'` | GAS backend removed |
| `getBaseApiUrl('staging')` | `https://stg.eventangle.com` | Hardcoded |

**Status**: **ACTIVE** - Story 5.2 removed all GAS references

---

## 4. Playwright Test Configuration

### 4.1 Base URL Resolution Chain

```
1. process.env.BASE_URL          (explicit override)
2. process.env.USE_PRODUCTION    (if true → production)
3. getEnvironment().baseUrl      (config/environments.js)
4. DEFAULT: staging              (https://stg.eventangle.com)
```

### 4.2 Playwright Config Files

| File | baseURL Source | Default |
|------|----------------|---------|
| `playwright.config.js` | `env.baseUrl` | Staging |
| `playwright.staging.config.js` | `process.env.BASE_URL \|\| STAGING_URL` | Staging |
| `playwright.ui-smoke.config.ts` | `getBaseUrl()` | Staging |
| `playwright.smoke-packs.config.js` | `env.baseUrl` | Staging |

**Status**: **ACTIVE** - All default to staging (Cloudflare Worker)

---

## 5. CI/CD Pipeline Origins

### 5.1 Stage-1 Workflow (`stage1.yml`)

| Job | Target | URL Source |
|-----|--------|------------|
| `deploy-staging-worker` | Staging | `stg.eventangle.com` via wrangler |
| `validate-staging-deployment` | Staging | `$STG_BASE_URL` env var |
| `deploy-production-worker` | Production | `www.eventangle.com` via wrangler |

**GAS References in Stage-1**: Lines 1373, 1450, 2078, 2165, 2174 - **LEGACY** (GAS deployment steps, now archived)

### 5.2 Stage-2 Workflow (`stage2.yml`)

| Variable | Value | Used By |
|----------|-------|---------|
| `STG_BASE_URL` | `https://stg.eventangle.com` | Staging smoke tests |
| `STAGING_URL` | `https://stg.eventangle.com` | Legacy alias |
| `PROD_BASE_URL` | `https://www.eventangle.com` | Production smoke tests |

**Status**: **ACTIVE** - No GAS URLs used in runtime tests

---

## 6. Summary: Files to Update (Stories 1.2-1.3)

### 6.1 High Priority (Runtime Impact)

| File | Action | Story |
|------|--------|-------|
| `config/deployment-ids.js` | Mark GAS exports as `@deprecated` | 1.2 |
| `config/environments.js` | Remove `googleAppsScript` environment | 1.2 |
| `.env.example` | Remove GAS direct option | 1.2 |
| `tests/README.md` | Remove GAS direct testing option | 1.2 |

### 6.2 Medium Priority (Documentation)

| File | Action | Story |
|------|--------|-------|
| `docs/env/staging.md` | Update to Worker-only architecture | 1.2 |
| `docs/RUNBOOK.md` | Remove GAS debugging sections | 1.2 |
| `RUNBOOK.md` | Remove GAS monitoring sections | 1.2 |
| `docs/DEPLOYMENT.md` | Update deployment instructions | 1.2 |

### 6.3 Low Priority (Archive/Cleanup)

| File | Action | Story |
|------|--------|-------|
| `docs/STAGING_EVENTS_DIAGNOSIS.md` | Move to archive | 1.3 |
| `docs/STAGING_GAS_PERMISSIONS.md` | Move to archive | 1.3 |
| `docs/env/gas-projects.md` | Move to archive | 1.3 |
| `postman/environments/*.json` | Remove GAS URLs | 1.3 |

---

## 7. CI/CD Gate Checklist (Story 1.3)

For later stories, add these CI gates:

- [ ] **Block `script.google.com` in tests**: Fail if any test makes HTTP request to GAS
- [ ] **Block GAS URLs in new code**: Lint rule to prevent new GAS URL additions
- [ ] **Validate Worker-only**: Smoke test that `/api/status` returns `backend: "worker"`

---

## Appendix: Quick Reference

### Staging URLs (Use These)
```bash
# Primary staging
https://stg.eventangle.com

# API staging
https://api-stg.eventangle.com

# Test commands
npm run test:smoke                    # Default: staging
BASE_URL="https://stg.eventangle.com" npm run test:smoke  # Explicit
```

### Environment Variables
```bash
# Staging (default)
STG_BASE_URL=https://stg.eventangle.com
STAGING_URL=https://stg.eventangle.com

# Production
PROD_BASE_URL=https://www.eventangle.com
PROD_URL=https://www.eventangle.com
```

### Cloudflare Worker Routes
```
stg.eventangle.com/*      → eventangle-staging worker
api-stg.eventangle.com/*  → eventangle-staging worker
www.eventangle.com/*      → eventangle-prod worker
api.eventangle.com/*      → eventangle-prod worker
```
