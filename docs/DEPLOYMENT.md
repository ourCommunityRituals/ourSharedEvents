# Deployment Guide

**Last Updated:** 2025-11-22
**Status:** MVP v1.0 - Focus Group Ready

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project Configuration](#project-configuration)
3. [Environment URLs](#environment-urls)
4. [CI/CD Pipeline](#cicd-pipeline)
5. [GitHub Secrets](#github-secrets)
6. [Setup Requirements](#setup-requirements)
7. [QA Environment Setup](#qa-environment-setup)
8. [Local Development](#local-development)
9. [Verification](#verification)
10. [Troubleshooting](#troubleshooting)

---

## Quick Start: Running Tests Locally

### Production Gate (Single Command)

**Before any prod deploy, run `npm run ci:all`. No green, no deploy.**

```bash
npm run ci:all
```

This unified gate chains all required tests for production release:
1. `test:ci:stage1` — lint + unit tests + contract tests
2. `test:api-contracts` — explicit API contract validation
3. `test:smoke` — smoke tests (requires Playwright)

If any test fails, the chain stops immediately.

For comprehensive coverage including negative tests:

```bash
npm run ci:all:full
```

### Stage 1 (Fast Gate)

```bash
npm run test:ci:stage1
```

This runs:
- `npm run lint` - ESLint code quality
- `npm run test:unit` - Unit tests (~512 tests)
- `npm run test:contract` - Contract tests (~155 tests)

**If Stage 1 is red, do not merge.**

### Stage 2 (E2E Browser Tests)

```bash
# Install Playwright first (one time)
npx playwright install

# Run Stage 2
npm run test:ci:stage2
```

This runs:
- `npm run test:api` - API integration tests
- `npm run test:fe` - Frontend E2E (smoke + pages + flows)

Requires `BASE_URL` environment variable pointing to deployed app.

---

## Current Live Build

| Field | Value |
|-------|-------|
| **BUILD_ID** | Check Admin footer or `?p=status&brand=root` |
| **Deployment URL** | https://script.google.com/macros/s/AKfycbxaTPh3FS4NHJblIcUrz4k01kWAdxsKzLNnYRf0TXe18lBditTm3hqbBoQ4ZxbGhhGuCA/exec |
| **Custom Domain** | eventangle.com |

To check current version:
```bash
curl "DEPLOYMENT_URL?p=status&brand=root" | jq '.value.version'
```

---

## Deployment Options

> **IMPORTANT: CI-Only Production Policy**
>
> Production deployments are **exclusively** performed through GitHub Actions.
> Manual methods are for **Dev/Stage only**. See [PRODUCTION_DEPLOYMENT_POLICY.md](../PRODUCTION_DEPLOYMENT_POLICY.md).

### Production: GitHub Actions (REQUIRED)

**This is the ONLY way to deploy to production.**

Push to `main` branch triggers automatic deployment:

```bash
git add .
git commit -m "feat: your changes"
git push origin main
```

The CI pipeline will:
1. Run all tests (lint, unit, contract, MVP guards)
2. **Deploy only if ALL tests pass**
3. Trigger Stage 2 E2E testing

### Dev/Stage ONLY: Clasp CLI

**For local development and testing only. NOT for production.**

```bash
npm run push    # Push code to Apps Script (dev/stage only)
npm run deploy  # Create new deployment (dev/stage only)
```

### Dev/Stage ONLY: Manual Deploy

**For debugging only. NEVER use for production.**

1. Open [Apps Script Editor](https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit)
2. Copy/paste all `.gs` and `.html` files
3. Deploy → New deployment → Web app
4. Execute as: **Me** | Access: **Anyone**

---

## Project Configuration

### Google Cloud Project

| Setting | Value |
|---------|-------|
| **Project ID** | `zeventbooks` |
| **Console** | https://console.cloud.google.com/home/dashboard?project=zeventbooks |
| **Service Accounts** | https://console.cloud.google.com/iam-admin/serviceaccounts?project=zeventbooks |

### Apps Script Project

| Setting | Value |
|---------|-------|
| **Script ID** | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |
| **Project URL** | https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit |
| **Deployment URL** | https://script.google.com/macros/s/AKfycbxaTPh3FS4NHJblIcUrz4k01kWAdxsKzLNnYRf0TXe18lBditTm3hqbBoQ4ZxbGhhGuCA/exec |

### Service Account

| Setting | Value |
|---------|-------|
| **Email** | `apps-script-deployer@zeventbooks.iam.gserviceaccount.com` |
| **Unique ID** | `103062520768864288562` |
| **Purpose** | Automated CI/CD deployment |
| **Required Scopes** | `script.projects`, `script.deployments`, `script.webapp.deploy` |

---

## Environment URLs

> **See [ENVIRONMENT_MATRIX.md](../ENVIRONMENT_MATRIX.md) for the authoritative environment reference.**

| Environment | URL | Cloudflare Env | Purpose |
|-------------|-----|----------------|---------|
| **Staging** | `https://stg.eventangle.com` | `[env.staging]` | Testing & validation (default for tests) |
| **Production** | `https://www.eventangle.com` | `[env.production]` | Live application (CI-only deploy) |
| **QA** | `https://zeventbooks.com` | - | Secondary testing |

### Brand-Specific Access

```bash
# Staging environment examples (default)
https://stg.eventangle.com/events?brand=root
https://stg.eventangle.com/abc/events

# Production environment examples
https://www.eventangle.com/events?brand=root
https://www.eventangle.com/abc/events
```

---

## CI/CD Pipeline

### Pipeline Flow

```
Push to main
    │
    ▼
┌─────────────────┐
│   Lint + Test   │  Unit tests, ESLint
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Contract Tests  │  API schema validation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     Deploy      │  Clasp push + deploy
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                    STAGE-2 VALIDATION                    │
├─────────────────────────────────────────────────────────┤
│  1. Environment Alignment Gate (Worker ↔ GAS)           │
│  2. API Smoke Tests (contract validation)               │
│  3. UI Smoke Tests (all surfaces load)                  │
│  4. E2E Critical Journeys (staging only)                │
│  5. Validation Gate (blocks release on failure)         │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Quality Gate   │  All must pass
└─────────────────┘
```

### E2E Pipeline Step (Story 3.4)

The Stage-2 workflow runs comprehensive E2E tests after each staging deployment:

| Test Suite | Description | Environment |
|------------|-------------|-------------|
| **Environment Alignment** | Verifies Worker ↔ GAS deployment IDs match | Staging + Production |
| **API Smoke Tests** | Validates API contracts, status endpoints | Staging + Production |
| **UI Smoke Tests** | All 5 surfaces load correctly | Staging + Production |
| **E2E Critical Journeys** | 10 user journeys (creates test data) | Staging only |

**Progressive Test Gates:**
- Tests run in sequence with fail-fast behavior
- If API tests fail → UI tests are SKIPPED
- If any test fails → Deployment is marked FAILED
- Notifications sent via Slack/Teams on failure

**Artifacts Captured:**
- Screenshots (all tests)
- Videos (on failure)
- Traces (on failure)
- HTML reports with detailed failure info

**Interpreting Failures:**

1. Download the `e2e-test-artifacts` from the workflow run
2. Open `playwright-report/index.html` for the HTML report
3. For failed tests, download `e2e-failure-debug` for videos and traces
4. Check the workflow summary for quick failure overview

**Common Failure Causes:**
- GAS cold start timeouts (retries usually handle this)
- Test data conflicts (tests use unique timestamps)
- UI selector changes not reflected in tests
- API contract changes

See [E2E_PLAYWRIGHT_GUIDE.md](./E2E_PLAYWRIGHT_GUIDE.md) for detailed debugging.

### Nightly Production Tests

A separate workflow runs read-only E2E tests against production nightly:

- **Schedule:** 2:00 AM UTC daily
- **Tests:** API smoke + UI smoke (no data modification)
- **Purpose:** Catch production issues without blocking deployments
- **Workflow:** `.github/workflows/e2e-nightly-production.yml`

### Quality Gate Requirements

**Use `npm run ci:all` as the single gate for production releases.**

All of these must pass:
- Lint
- Unit Tests (>80% coverage)
- Contract Tests
- API Contract Tests
- E2E Smoke Tests

Optional (via `npm run ci:all:full`):
- E2E Negative Tests

Post-deploy verification:
- E2E Page Tests
- E2E Flow Tests

---

## GitHub Secrets

Configure at: https://github.com/zeventbooks/MVP-EVENT-TOOLKIT/settings/secrets/actions

| Secret | Purpose |
|--------|---------|
| `APPS_SCRIPT_SERVICE_ACCOUNT_JSON` | Service account key (complete JSON file) |
| `SCRIPT_ID` | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |
| `ADMIN_KEY_ROOT` | Admin API key for testing |

---

## Setup Requirements

### 1. Enable Apps Script API (GCP Console)

1. Go to: https://console.cloud.google.com/apis/library?project=zeventbooks
2. Search: "Apps Script API"
3. Click **ENABLE**

### 2. Enable Apps Script API (User Settings)

**CRITICAL - Project owner must do this:**

1. Go to: https://script.google.com/home/usersettings
2. Find: "Google Apps Script API"
3. Toggle **ON**

This is required for service account deployments to work.

### 3. Grant Service Account Access

1. Open Apps Script project: https://script.google.com/home/projects/1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l/edit
2. Click **Share** (top right)
3. Add: `apps-script-deployer@zeventbooks.iam.gserviceaccount.com`
4. Role: **Editor**
5. Uncheck "Notify people"
6. Click **Share**

---

## QA Environment Setup

### Cloudflare Workers Setup

The QA environment (zeventbooks.com) uses Cloudflare Workers to proxy requests to Google Apps Script.

1. **Get Deployment URL**
   - From GitHub Actions job summary, OR
   - From Apps Script: Deploy → Manage deployments

2. **Update Cloudflare Worker**
   - The worker is automatically updated during Stage 1 deployment
   - See `/cloudflare-proxy/CLOUDFLARE_SETUP.md` for manual configuration

3. **Test It**
   ```bash
   curl -I https://zeventbooks.com/status
   # Should return 200 with content from Apps Script
   ```

4. **Run Stage 2**
   - Go to GitHub Actions
   - Run "Stage 2 - Testing & QA"
   - Enter: `https://qa.zeventbooks.com`

---

## Local Development

### First-Time Setup

```bash
# Install dependencies
npm ci

# Login to Clasp (one time)
clasp login

# Verify setup
npm run deploy:diagnose
```

### Development Workflow

```bash
# Pull latest from Apps Script
clasp pull

# Make changes locally...

# Run tests
npm test

# Push to Apps Script
npm run push

# Create deployment
npm run deploy
```

### Testing Commands

```bash
# Production gate (run before any deploy)
npm run ci:all

# Production gate + negative tests
npm run ci:all:full

# Unit tests only
npm run test:unit

# Contract tests only
npm run test:contract

# Quick validation
npm run test:quick

# All tests
npm run test:all

# E2E tests (requires deployed app)
BASE_URL=<url> ADMIN_KEY=<key> npm run test:e2e

# Triangle flow tests
npm run test:triangle
npm run test:triangle:parallel
```

### BASE_URL-Aware Testing

All E2E and API tests are **BASE_URL-aware** - run the same tests against different environments:

```bash
# Run against eventangle.com (default - no BASE_URL needed)
npm run test:smoke

# Run against production (eventangle.com)
BASE_URL="https://www.eventangle.com" npm run test:smoke

# Run against GAS webapp directly
BASE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" npm run test:smoke

# Run against staging/QA
BASE_URL="https://staging.zeventbooks.com" npm run test:smoke
```

**Key Points:**
- Default URL: `https://eventangle.com` (production via Cloudflare Workers)
- No code changes needed to switch environments
- Tests auto-detect environment type (GAS vs Cloudflare)
- Configuration: `tests/config/environments.js`

---

## Verification

### Run Setup Diagnostics

```bash
curl "YOUR_DEPLOYMENT_URL?p=setup&brand=root"
```

This checks:
- Brand configuration
- Spreadsheet access
- Admin secrets
- Deployment configuration
- OAuth scopes
- Database structure

### Health Check

```bash
curl "YOUR_DEPLOYMENT_URL?p=status&brand=root"
```

Expected:
```json
{ "ok": true, "value": { "status": "healthy" } }
```

### Test All Surfaces

| Surface | URL |
|---------|-----|
| Admin | `?p=admin&brand=root` |
| Public | `?p=public&brand=root` |
| Display | `?p=display&brand=root` |
| Poster | `?p=poster&brand=root&eventId=EVT_xxx` |
| Status | `?p=status&brand=root` |

---

## Troubleshooting

### "User has not enabled the Apps Script API"

**This causes 90% of deployment failures.**

**Fix:**
1. Go to: https://script.google.com/home/usersettings
2. Toggle ON: "Google Apps Script API"
3. Wait 2-5 minutes
4. Retry deployment

### "Script not found"

**Fix:**
1. Verify `SCRIPT_ID` is correct
2. Check service account has Editor access
3. Run: `clasp open` to verify access

### "Token expired"

**Fix:**
1. Re-login: `clasp login`
2. Get new `.clasprc.json` contents
3. Update `CLASPRC_JSON` GitHub secret

### "Permission denied"

**Fix:**
1. Share Apps Script project with service account
2. Grant **Editor** access
3. Retry deployment

### CLASPRC_JSON validation fails

**Fix:**
1. Run: `./scripts/validate-clasp-setup.sh`
2. Check JSON: `cat ~/.clasprc.json | jq .`
3. Re-login: `clasp logout && clasp login`
4. Update GitHub secret

### QA environment not accessible

**Fix:**
1. Check Cloudflare Worker is deployed and running
2. Verify Apps Script deployment ID in worker configuration
3. Test Apps Script URL directly
4. Check Cloudflare dashboard for errors

---

## Security Notes

- **Never commit** service account JSON to git
- **Never expose** SCRIPT_ID or ADMIN_KEY in logs
- Store credentials in GitHub Secrets (encrypted at rest)
- Rotate service account keys every 90 days
- Use principle of least privilege (Editor, not Owner)

---

## Files to Deploy

### Backend (.gs)

12 files form the runtime spine:

| File | Purpose |
|------|---------|
| Code.gs | Router + API endpoints |
| Config.gs | Brands, templates, feature flags |
| TemplateService.gs | Event templates |
| ApiSchemas.gs | API contracts |
| EventService.gs | Event CRUD |
| FormService.gs | Google Forms |
| SponsorService.gs | Sponsor management |
| SharedReporting.gs | Analytics views |
| AnalyticsService.gs | Logging |
| SecurityMiddleware.gs | Auth/security |
| i18nService.gs | Multi-lang (deferred) |
| WebhookService.gs | Integrations (deferred) |

### Frontend (.html)

5 MVP surfaces + supporting files:

| File | Purpose |
|------|---------|
| Admin.html | Event management |
| Public.html | Mobile event page |
| Display.html | TV/kiosk display |
| Poster.html | Print/QR |
| SharedReport.html | Analytics |

---

## Related Documentation

- **[PRODUCTION_DEPLOYMENT_POLICY.md](../PRODUCTION_DEPLOYMENT_POLICY.md)** - CI-only production policy
- **[APPS_SCRIPT_PROJECT.md](../APPS_SCRIPT_PROJECT.md)** - Apps Script project configuration
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - MVP architecture overview
- **[FRIENDLY_URLS.md](./FRIENDLY_URLS.md)** - URL aliasing system
- **[SETUP_DIAGNOSTICS.md](./SETUP_DIAGNOSTICS.md)** - Setup verification endpoint

---

*Deployment Guide - MVP v1.0*
