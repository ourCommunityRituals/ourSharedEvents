# Baseline System Architecture

> **Purpose:** Knowledge transfer and on-boarding documentation for the MVP Event Toolkit.
> This document codifies the established CI/CD discipline, environment configuration,
> and system invariants. Future modifications should respect these principles.
>
> **Last Updated:** 2025-12-17
> **Status:** Production-Ready (Story 6)

---

## Table of Contents

1. [Overview](#overview)
2. [CI/CD Architecture](#cicd-architecture)
3. [Cloudflare Routing Structure](#cloudflare-routing-structure)
4. [Environment Configuration](#environment-configuration)
5. [Contract Invariants](#contract-invariants)
6. [Secrets Inventory](#secrets-inventory)
7. [Quick Reference Commands](#quick-reference-commands)
8. [Runbook Index](#runbook-index)
9. [Documentation References](#documentation-references)

---

## Overview

The MVP Event Toolkit is a multi-brand event management platform deployed on Cloudflare Workers with Google Sheets as the backend data store.

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    MVP Event Toolkit Architecture                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Users                                                           │
│    │                                                             │
│    ▼                                                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │     Cloudflare Workers (eventangle-staging / -prod)       │   │
│  │     Routes: stg.eventangle.com, www.eventangle.com        │   │
│  │     Mode: Worker-Only (BACKEND_MODE=worker)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                          ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Google Sheets API (Service Account)             │   │
│  │           Spreadsheet: EVENTS, SPONSORS, ANALYTICS        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Supported Brands

| Brand ID | Description |
|----------|-------------|
| `root` | Default/primary brand |
| `abc` | ABC organization |
| `cbc` | CBC organization |
| `cbl` | CBL organization |

---

## CI/CD Architecture

The repository uses a **two-stage CI/CD architecture** designed for safety and reliability.

### Active Workflows

Only three workflows are part of the live CI/CD pipeline:

| Workflow | File | Purpose | Trigger |
|----------|------|---------|---------|
| **Stage-1 Validation** | `.github/workflows/stage1.yml` | Validate + Deploy | PR, push to main, tag |
| **Stage-2 Orchestrator** | `.github/workflows/stage2.yml` | Post-deploy environment tests | After Stage-1 succeeds |
| **Security Scan** | `.github/workflows/security-scan.yml` | CodeQL + npm audit | Push, PR, weekly |

**Rule:** If it's not one of these three workflows, it doesn't run. All other CI definitions are archived.

### Stage-1: Hermetic Validation + Deploy

Stage-1 runs **hermetic validation** with zero external dependencies (no `BASE_URL`, no HTTP calls to staging/production).

```
┌─────────────────────────────────────────────────────────────────┐
│                     STAGE-1 PIPELINE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Trigger: PR to main → Validate only                             │
│  Trigger: Push to main → Validate + Deploy to staging            │
│  Trigger: Tag vX.Y.Z → Validate + Deploy to production           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           QUALITY GATES (Visible Status Checks)          │    │
│  │                                                          │    │
│  │  🔒 Security Check → 🔍 Lint → 🧪 Unit Tests →           │    │
│  │  📋 Contract Tests → 🛡️ Guards → ✅ Quality Gates        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           DEPLOYMENT (if Quality Gates pass)             │    │
│  │                                                          │    │
│  │  main push → Deploy to stg.eventangle.com               │    │
│  │  tag vX.Y.Z → Deploy to www.eventangle.com              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Quality Gate Details:**

| Gate | Job Name | What It Checks |
|------|----------|----------------|
| Security Check | `security-check` | npm audit, secrets scanning, dependency review |
| Lint | `lint` | ESLint code quality |
| Unit Tests | `unit-tests` | Jest unit tests + security tests |
| Contract Tests | `contract-tests` | Schema sync, API contracts, bundles, GAS HTML |
| Guards | `guards` | MVP surfaces, dead code, schema, V2 files, bundle |

### Stage-2: Post-Deploy Environment Tests

Stage-2 validates the **live deployed environment** after Stage-1 succeeds.

```
┌─────────────────────────────────────────────────────────────────┐
│                     STAGE-2 PIPELINE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Trigger: Stage-1 succeeds on main (staging deploy)              │
│  Trigger: Stage-1 succeeds on tag (production deploy, approval)  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           PROGRESSIVE TEST GATES                         │    │
│  │                                                          │    │
│  │  ✅ Check Stage-1 Status                                 │    │
│  │         │                                                │    │
│  │         ▼                                                │    │
│  │  ✅ Download Base URL (stg-base-url / prod-base-url)    │    │
│  │         │                                                │    │
│  │         ▼                                                │    │
│  │  🔐 Production Approval Gate (prod only, manual)        │    │
│  │         │                                                │    │
│  │         ▼                                                │    │
│  │  🧪 API Smoke Tests (critical, blocks UI tests)         │    │
│  │         │                                                │    │
│  │         ▼                                                │    │
│  │  🖥️ UI Smoke Tests (gated by API tests)                 │    │
│  │         │                                                │    │
│  │         ▼                                                │    │
│  │  ✅ Validation Gate (aggregates all results)            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Progressive Gating Rules:**
- API tests must pass before UI tests run
- If API tests fail, UI tests are skipped (fail-fast)
- Production tests require manual approval via GitHub Environment

### Branch Protection Rules

Configure in GitHub Settings > Branches > Branch protection rules for `main`:

**Required Status Checks:**
- `Lint`
- `Unit Tests`
- `Contract Tests`
- `Guards`
- `Quality Gates`
- `🔒 CodeQL Security Scan`

**Policy:** No green, no deploy. All quality gates must pass before merge.

---

## Cloudflare Routing Structure

### Environment URLs

| Environment | Worker Name | Base URL | API URL |
|-------------|-------------|----------|---------|
| **Staging** | `eventangle-staging` | `https://stg.eventangle.com` | `https://api-stg.eventangle.com` |
| **Production** | `eventangle-prod` | `https://www.eventangle.com` | `https://api.eventangle.com` |

### Route Configuration

**Staging Routes (wrangler.toml `[env.staging]`):**
```toml
routes = [
  { pattern = "stg.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api-stg.eventangle.com/*", zone_name = "eventangle.com" }
]
```

**Production Routes (wrangler.toml `[env.production]`):**
```toml
routes = [
  { pattern = "eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "www.eventangle.com/*", zone_name = "eventangle.com" },
  { pattern = "api.eventangle.com/*", zone_name = "eventangle.com" }
]
```

### Backend Mode

The system operates in **Worker-only mode** (`BACKEND_MODE=worker`). All traffic is handled by Cloudflare Workers with direct Google Sheets API access.

| Mode | Description | Status |
|------|-------------|--------|
| `worker` | All routes use Worker-native backend | **Current (Default)** |
| `gas` | Routes proxy to Google Apps Script | Deprecated (emergency only) |
| `mixed` | Per-route selection | Deprecated |

### Worker Environment Variables

| Variable | Staging | Production |
|----------|---------|------------|
| `WORKER_ENV` | `staging` | `production` |
| `BACKEND_MODE` | `worker` | `worker` |
| `DEBUG_LEVEL` | `debug` | `error` |
| `ENABLE_DEBUG_ENDPOINTS` | `true` | (not set) |
| `WORKER_BUILD_VERSION` | `stg-YYYY.MM.DD-story` | `prod-YYYY.MM.DD-story` |

---

## Environment Configuration

### Single Source of Truth

- **deploy-manifest.json**: Centralized deployment configuration
- **config/environments.js**: Runtime environment resolution
- **.github-secrets-required.json**: Canonical list of required secrets

### Staging vs. Production Differences

| Aspect | Staging | Production |
|--------|---------|------------|
| Debug logging | Full (`debug`) | Minimal (`error`) |
| Debug endpoints | Enabled | Disabled |
| Testing features | ON | OFF |
| Experimental features | ON | OFF |
| Manual approval | Not required | Required |

### Feature Flags

Defined in `deploy-manifest.json`:

**MVP Features (always ON):**
- `EVENTS`, `SPONSORS`, `ANALYTICS`, `FORMS`, `SHORTLINKS`, `PORTFOLIO_ANALYTICS`

**Testing Features (staging only):**
- `DEMO_MODE_ENABLED`, `DEBUG_PANEL`, `API_TIMING_LOGS`, `ERROR_DETAILS`

**V2 Features (deferred):**
- `TEMPLATE_MANAGEMENT_V2`, `PORTFOLIO_V2` - OFF in both environments

---

## Contract Invariants

These invariants must be maintained across all code changes:

### 1. QR Code Verification

**Invariant:** Never expose QR codes unless event verification is complete.

```
QR codes must only be generated for events where:
- Event is published (status = 'published')
- Event has valid slug
- Event belongs to valid brand
```

**Guard:** Contract tests verify QR generation logic.

### 2. One Default Event Per Brand

**Invariant:** Each brand may have at most one default event.

```
When setting isDefault=true for an event:
- Previous default for that brand must be cleared
- Only events within the same brand are affected
```

**Guard:** Unit tests validate default event logic.

### 3. Safe Fallback Screens

**Invariant:** Always render a safe fallback when data is unavailable.

```
If event data cannot be loaded:
- Display safe error screen (no blank/broken pages)
- Log error with requestId for debugging
- Never show raw error messages to users
```

**Guard:** UI smoke tests verify fallback behavior.

### 4. No GAS HTML Leakage

**Invariant:** Production must never show GAS HTML shell (blue banner).

```
All HTML responses must:
- Be served by Cloudflare Worker
- Not contain "Google Apps Script" text
- Include x-proxied-by: eventangle-worker header
```

**Guard:** Stage-2 `gas-html-integrity.spec.ts` blocks releases if GAS HTML detected.

### 5. API Response Envelope

**Invariant:** All API responses follow the standard envelope structure.

```json
{
  "ok": true|false,
  "value": <data>,
  "error": <string if ok=false>,
  "requestId": "<uuid>"
}
```

**Guard:** Contract tests validate envelope structure.

### 6. Environment Isolation

**Invariant:** Staging and production data must never mix.

```
- Staging uses separate spreadsheet ID
- Staging uses separate Worker secrets
- Tests default to staging unless explicitly targeting production
```

**Guard:** Environment alignment gate in Stage-2.

---

## Secrets Inventory

### GitHub Actions Secrets (Stage-1)

| Secret | Category | Purpose | Rotation |
|--------|----------|---------|----------|
| `GOOGLE_CLIENT_EMAIL` | Google | Service account email | 90 days |
| `GOOGLE_PRIVATE_KEY` | Google | Service account private key (PEM) | 90 days |
| `STAGING_SHEETS_SPREADSHEET_ID` | Google | Staging spreadsheet ID | Static |
| `CLOUDFLARE_API_TOKEN` | Cloudflare | Worker deployment | As needed |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | Account identifier | Static |
| `OAUTH_CREDENTIALS` | Apps Script | Clasp OAuth (legacy) | Auto-refresh |

### GitHub Actions Secrets (Stage-2)

| Secret | Category | Purpose | Rotation |
|--------|----------|---------|----------|
| `ADMIN_KEY_ROOT` | Admin | Root brand admin key | 90 days |
| `ADMIN_KEY_ABC` | Admin | ABC brand admin key | 90 days |
| `ADMIN_KEY_CBC` | Admin | CBC brand admin key | 90 days |
| `ADMIN_KEY_CBL` | Admin | CBL brand admin key | 90 days |

### Cloudflare Worker Secrets

Set via `wrangler secret put <NAME> --env <staging|production>`:

| Secret | Purpose | Command |
|--------|---------|---------|
| `GOOGLE_SA_CLIENT_EMAIL` | Service account email | `wrangler secret put GOOGLE_SA_CLIENT_EMAIL --env staging` |
| `GOOGLE_SA_PRIVATE_KEY_PEM` | Private key (PEM format) | `wrangler secret put GOOGLE_SA_PRIVATE_KEY_PEM --env staging` |
| `SHEETS_SPREADSHEET_ID` | Database spreadsheet ID | `wrangler secret put SHEETS_SPREADSHEET_ID --env staging` |
| `ADMIN_TOKEN` | Bearer token for admin auth | `wrangler secret put ADMIN_TOKEN --env staging` |

### Rotation Schedule

| Secret Type | Period | Process |
|-------------|--------|---------|
| Google Service Account Keys | 90 days | Generate in GCP Console, update GitHub + Wrangler |
| Admin Keys | 90 days | Generate new key, update GitHub, verify tests |
| Cloudflare API Token | As needed | Regenerate on compromise |
| OAuth Credentials | Auto-refresh | N/A (automatic) |

### Verification

```bash
# Verify all secrets configuration
node scripts/verify-secrets.js

# Verify Stage-1 secrets only
node scripts/verify-secrets.js --stage1

# Verify Stage-2 secrets only
node scripts/verify-secrets.js --stage2

# JSON output for automation
node scripts/verify-secrets.js --json
```

---

## Quick Reference Commands

### Local Testing

```bash
# Full CI (Stage-1 + Stage-2)
npm run ci:local

# Stage-1 only (hermetic validation)
npm run stage1-local
npm run ci:local stage1

# Quick CI (critical tests only)
npm run ci:local quick

# Individual test suites
npm run lint                    # ESLint
npm run test:unit               # Jest unit tests
npm run test:contract           # Contract tests
npm run test:api                # API tests
npm run test:smoke              # Smoke tests
```

### Staging Tests

```bash
# Default - tests run against staging
npm run test:smoke

# API tests against staging
npm run test:api

# Synthetic health checks
npm run test:synthetic:staging
```

### Production Tests

```bash
# Production smoke tests (explicit)
npm run test:prod:smoke

# Production health check
npm run test:prod:health

# Or via BASE_URL
BASE_URL="https://www.eventangle.com" npm run test:smoke
```

### Deployment

```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy to production (use CI/CD - not recommended locally)
wrangler deploy --env production

# List deployments
wrangler deployments list --env staging
wrangler deployments list --env production
```

### Rollback

```bash
# Quick rollback (Story 5.3)
npm run rollback:staging        # Staging
npm run rollback:prod           # Production
npm run rollback:all            # Both

# List deployments
npm run rollback:list

# Manual rollback
wrangler rollback --env production
```

### Health Checks

```bash
# Staging health
curl -s https://stg.eventangle.com/api/health/backend | jq

# Production health
curl -s https://www.eventangle.com/api/health/backend | jq

# Quick ping
curl -s https://stg.eventangle.com/ping
curl -s https://www.eventangle.com/ping
```

### Secret Management

```bash
# List Cloudflare Worker secrets
wrangler secret list --env staging
wrangler secret list --env production

# Set a secret
wrangler secret put ADMIN_TOKEN --env staging

# Verify GitHub Actions secrets
node scripts/verify-secrets.js
```

---

## Runbook Index

Detailed runbooks for operational tasks are available:

| Runbook | Location | Purpose |
|---------|----------|---------|
| **Deploying to Staging/Production** | [RUNBOOK-DEPLOYMENT.md](./RUNBOOK-DEPLOYMENT.md) | Step-by-step deployment procedures |
| **Rotating Secrets** | [RUNBOOK-SECRETS.md](./RUNBOOK-SECRETS.md) | Secret rotation and verification |
| **Running Local Tests** | [RUNBOOK-LOCAL-TESTING.md](./RUNBOOK-LOCAL-TESTING.md) | Local CI execution guide |
| **Investigating CI Failures** | [RUNBOOK-CI-DEBUG.md](./RUNBOOK-CI-DEBUG.md) | Debugging failing CI runs |
| **Incident Response** | [RUNBOOK.md](../RUNBOOK.md) | SEV definitions, rollback, escalation |
| **Rollback Procedures** | [ROLLBACK.md](./ROLLBACK.md) | Worker and GAS rollback |

---

## Documentation References

### Architecture & Design

| Document | Purpose |
|----------|---------|
| [ci-cd-architecture.md](./ci-cd-architecture.md) | Detailed CI/CD pipeline documentation |
| [worker-routing.md](./worker-routing.md) | Cloudflare Worker routing architecture |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture overview |
| [integration-map.md](./integration-map.md) | Service integration documentation |

### Operations

| Document | Purpose |
|----------|---------|
| [RUNBOOK.md](../RUNBOOK.md) | Releases, incidents, SEV response |
| [ROLLBACK.md](./ROLLBACK.md) | Rollback procedures |
| [CLOUDFLARE_SECRETS.md](./CLOUDFLARE_SECRETS.md) | Secrets and environment variables |
| [UPTIME_MONITORING.md](./UPTIME_MONITORING.md) | External monitoring setup |
| [SYNTHETIC_MONITORING.md](./SYNTHETIC_MONITORING.md) | Cloudflare/Datadog synthetic tests |

### Development

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Deployment procedures |
| [E2E_PLAYWRIGHT_GUIDE.md](./E2E_PLAYWRIGHT_GUIDE.md) | Playwright test guide |
| [CODING-STYLE.md](./CODING-STYLE.md) | Code style guidelines |
| [SCHEMA_GUIDELINES.md](./SCHEMA_GUIDELINES.md) | Schema design guidelines |

### Configuration Files

| File | Purpose |
|------|---------|
| `deploy-manifest.json` | Centralized deployment configuration |
| `.github-secrets-required.json` | Canonical secrets list |
| `wrangler.toml` (root) | Staging Worker configuration |
| `cloudflare-proxy/wrangler.toml` | Production Worker configuration |
| `.env.example` | Environment variable template |

---

## Modifying This Baseline

When making changes that affect the baseline:

1. **Update documentation first** - Ensure changes are reflected in relevant docs
2. **Reference this document** - PRs modifying pipelines or env vars should reference `BASELINE.md`
3. **Maintain invariants** - Contract tests must continue to pass
4. **File issues for divergence** - If reality diverges from documentation, file an issue to update

**Golden Rule:** If it's not documented here, it's not part of the baseline.

---

**Last Updated:** 2025-12-17 | **Story:** 6 - Document Baseline & Runbooks
