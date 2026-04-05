# CI/CD Architecture & Enforcement Rules

> **Purpose:** Anchor the CI/CD design for future maintainers and prevent architecture drift.
> **Last Updated:** 2025-12-10
> **Status:** MVP Production-Ready (Story 2.1 + Story 2.5 + Story 4 Enhanced)

---

## Table of Contents

1. [Overview](#overview)
2. [Quality Gates (Story 2.1)](#quality-gates-story-21)
3. [Fail-Fast Pipeline (Story 2.5)](#fail-fast-pipeline-story-25)
4. [Branch Protection Rules](#branch-protection-rules)
5. [Stage-1: Validate + Deploy](#stage-1-validate--deploy)
6. [Stage-2: Environment Tests](#stage-2-environment-tests)
7. [Environment Alignment Gate (Story 4)](#environment-alignment-gate-story-4)
8. [Security Scanning (Story 4)](#security-scanning-story-4)
9. [Environment Keys (stg/prod)](#environment-keys-stgprod)
10. [Cloudflare Routing Alignment](#cloudflare-routing-alignment)
11. [QR Verification Invariant](#qr-verification-invariant)
12. [Contract Safety Rules](#contract-safety-rules)
13. [Fail-Fast Philosophy](#fail-fast-philosophy)
14. [Pipeline Notifications](#pipeline-notifications)
15. [Deployment Flow Diagram](#deployment-flow-diagram)
16. [Quick Reference](#quick-reference)

---

## Overview

This repository uses a **two-stage CI/CD architecture**:

| Stage       | Purpose                          | Runs Against     | Trigger                |
| ----------- | -------------------------------- | ---------------- | ---------------------- |
| **Stage-1** | Hermetic validation + deployment | No external deps | PR, push to main, tag  |
| **Stage-2** | Post-deploy verification         | Live staging URL | After Stage-1 succeeds |

**Core Principles:**

- **CI-Only Production Deployment** — Manual deploys to production are prohibited
- **Hermetic Stage-1** — Zero external HTTP dependencies (no BASE_URL)
- **Progressive Failure Gates** — Stop early when critical tests fail
- **Single Source of Truth** — `config/environments.js` for all URLs
- **Visible Quality Gates (Story 2.1)** — Each gate shows as individual status check in PRs

---

## Quality Gates (Story 2.1)

### Purpose

Every code change must pass **all quality gates** before it can deploy. Each gate runs as a separate job in GitHub Actions, creating visible status checks in Pull Requests:

```
┌─────────────────────────────────────────────────────────────┐
│              QUALITY GATES (Visible in PRs)                  │
├─────────────────────────────────────────────────────────────┤
│  🔍 Lint           ✅ / ❌    ESLint code quality            │
│  🧪 Unit Tests     ✅ / ❌    Jest unit tests + security     │
│  📋 Contract Tests ✅ / ❌    Schema, API, bundles           │
│  🛡️ Guards         ✅ / ❌    MVP guards, V2 files, bundle   │
│  🔒 CodeQL Scan    ✅ / ❌    Security analysis              │
└─────────────────────────────────────────────────────────────┘
```

### Acceptance Criteria (Story 2.1)

| Criteria              | Implementation                                    |
| --------------------- | ------------------------------------------------- |
| Visible status checks | Each gate is a separate job with its own status   |
| Block merge if ❌     | Branch protection requires all gates to pass      |
| No partial deploys    | Deployment depends on `quality-gates` job passing |
| Fail-fast             | Individual gates fail immediately on errors       |

### Gate Details

| Gate               | Job Name         | What It Checks                                    | Status Check Name         |
| ------------------ | ---------------- | ------------------------------------------------- | ------------------------- |
| **Lint**           | `lint`           | ESLint code quality and style                     | `Lint`                    |
| **Unit Tests**     | `unit-tests`     | Jest unit tests + security tests                  | `Unit Tests`              |
| **Contract Tests** | `contract-tests` | Schema sync, API contracts, bundles, GAS HTML     | `Contract Tests`          |
| **Guards**         | `guards`         | MVP surfaces, dead code, schema, V2 files, bundle | `Guards`                  |
| **Security**       | `analyze`        | CodeQL security scan (in security-scan.yml)       | `🔒 CodeQL Security Scan` |

### Quality Gates Aggregator

The `quality-gates` job aggregates all quality gates and serves as the final checkpoint before deployment:

```yaml
quality-gates:
  name: Quality Gates
  needs: [lint, unit-tests, contract-tests, guards]
  # Deployment jobs depend on this passing
```

### Deployment Gating

Deployment jobs only run if quality gates pass:

```yaml
staging-deploy:
  needs: [quality-gates]
  if: needs.quality-gates.result == 'success'

production-deploy:
  needs: [quality-gates]
  if: needs.quality-gates.result == 'success'
```

---

## Fail-Fast Pipeline (Story 2.5)

### Purpose

The pipeline is configured to **fail fast at critical stages** and **skip subsequent stages** when failures occur. This provides immediate feedback and prevents wasted CI resources on doomed deployments.

### Acceptance Criteria

| Criteria                                  | Implementation                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Stage-1 stops if lint/unit tests fail     | Unit tests depend on lint passing (`needs: [lint]`)                      |
| Stage-2 uses gating for post-deploy tests | API tests gate UI tests (`needs: [api-smoke]`)                           |
| Staging failures block production         | If Stage-2 staging validation fails, production is not marked successful |
| E2E tests skip when earlier gates fail    | UI smoke tests skip if API smoke tests fail                              |
| Team notification on gate failure         | Slack/Teams webhooks send alerts with failure reason                     |

### Stage-1 Fail-Fast Structure

```
┌─────────────────────────────────────────────────────────────┐
│              STAGE-1 FAIL-FAST (Story 2.5)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     ┌──────────┐                            │
│                     │   LINT   │  ← First Gate (fastest)    │
│                     └────┬─────┘                            │
│                          │                                  │
│           ┌──────────────┼──────────────┐                   │
│           │              │              │                   │
│           ▼              ▼              ▼                   │
│    ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│    │ Unit Tests │ │ Contract   │ │  Guards    │            │
│    │            │ │ Tests      │ │            │            │
│    └────────────┘ └────────────┘ └────────────┘            │
│           │              │              │                   │
│           └──────────────┼──────────────┘                   │
│                          ▼                                  │
│                  ┌──────────────┐                           │
│                  │Quality Gates │                           │
│                  └──────────────┘                           │
│                          │                                  │
│               ┌──────────┴──────────┐                       │
│               ▼                     ▼                       │
│        Lint FAIL?              All PASS?                    │
│               │                     │                       │
│               ▼                     ▼                       │
│     Skip all tests           Deploy to staging              │
│     + Notify team                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Dependencies:**

- `unit-tests` depends on `lint` (skipped if lint fails)
- `contract-tests` depends on `lint` (skipped if lint fails)
- `guards` depends on `lint` (skipped if lint fails)

### Stage-2 Progressive Test Gates

```
┌─────────────────────────────────────────────────────────────┐
│           STAGE-2 PROGRESSIVE GATES (Story 2.5)             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────────────────────────────────────────────┐      │
│   │  GATE 0: Environment Alignment (FIRST)           │      │
│   │  • Worker /env-status matches GAS /whoami        │      │
│   │  • FAIL → Skip ALL tests, BLOCK release          │      │
│   └────────────────────────┬─────────────────────────┘      │
│                            │ PASS                           │
│                            ▼                                │
│   ┌──────────────────────────────────────────────────┐      │
│   │  GATE 1: API Smoke Tests (CRITICAL)              │      │
│   │  • Status, events, qr, sharedreport endpoints    │      │
│   │  • GAS HTML integrity check                      │      │
│   │  • FAIL → Skip UI tests, BLOCK release           │      │
│   └────────────────────────┬─────────────────────────┘      │
│                            │ PASS                           │
│                            ▼                                │
│   ┌──────────────────────────────────────────────────┐      │
│   │  GATE 2: UI Smoke Tests (GATED by API)           │      │
│   │  • Admin, Public, Display, Poster surfaces       │      │
│   │  • Only runs if API tests PASS                   │      │
│   │  • FAIL → BLOCK release                          │      │
│   └────────────────────────┬─────────────────────────┘      │
│                            │                                │
│                            ▼                                │
│   ┌──────────────────────────────────────────────────┐      │
│   │  Validation Gate (Final)                         │      │
│   │  • Aggregates all results                        │      │
│   │  • ANY FAIL → BLOCK release                      │      │
│   │  • ALL PASS → Release ready ✅                   │      │
│   └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Dependencies:**

- `api-smoke` depends on `env-alignment-gate` (skipped if alignment fails)
- `ui-smoke` depends on `api-smoke` (skipped if API tests fail)

### Example: Gate Stopping Later Jobs

When lint fails, the GitHub Actions view shows:

```
Jobs
────────────────────────────────────────────
❌ Lint                    failed
⏭️  Unit Tests              skipped (needs: lint)
⏭️  Contract Tests          skipped (needs: lint)
⏭️  Guards                  skipped (needs: lint)
⏭️  Quality Gates           skipped (needs: all gates)
⏭️  Deploy to Staging       skipped (needs: quality-gates)
📢 Notify Gate Failure     triggered (sends alert)
────────────────────────────────────────────
```

When API smoke tests fail in Stage-2:

```
Jobs
────────────────────────────────────────────
✅ Check Stage-1 Status
✅ Download Base URL
✅ Environment Alignment Gate
❌ API Smoke Tests         failed
⏭️  UI Smoke Tests         skipped (needs: api-smoke)
❌ Validation Gate         failed
📢 Notify Stage-2 Failure  triggered (sends alert)
────────────────────────────────────────────
```

### Benefits

| Benefit                 | Description                                   |
| ----------------------- | --------------------------------------------- |
| **Immediate Feedback**  | Failures are reported within minutes          |
| **Resource Efficiency** | Expensive tests don't run if cheap tests fail |
| **Cost Optimization**   | ~50% CI cost reduction on failing builds      |
| **Clear Audit Trail**   | Each gate produces actionable status          |
| **Team Awareness**      | Notifications ensure quick incident response  |

---

## Branch Protection Rules

### Required Configuration

To enforce quality gates as required status checks, configure branch protection:

1. **Navigate to Settings:**

   ```
   Repository → Settings → Branches → Branch protection rules
   ```

2. **Create/Edit Rule for `main`:**
   - Click "Add branch protection rule" or edit existing
   - Branch name pattern: `main`

3. **Enable Required Status Checks:**
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date before merging

4. **Select Required Checks:**

   From `stage1.yml`:
   - `Lint`
   - `Unit Tests`
   - `Contract Tests`
   - `Guards`
   - `Quality Gates`

   From `security-scan.yml`:
   - `🔒 CodeQL Security Scan`

5. **Additional Recommended Settings:**
   - ✅ Require conversation resolution before merging
   - ✅ Do not allow bypassing the above settings

### Visual Guide

After configuration, PRs will show status checks like this:

```
Checks
────────────────────────────────────────────
✅ Lint                          Required
✅ Unit Tests                    Required
✅ Contract Tests                Required
✅ Guards                        Required
✅ Quality Gates                 Required
✅ 🔒 CodeQL Security Scan       Required
────────────────────────────────────────────
All checks have passed
```

If any check fails:

```
Checks
────────────────────────────────────────────
✅ Lint                          Required
❌ Unit Tests                    Required  ← Blocking
✅ Contract Tests                Required
✅ Guards                        Required
⏸️ Quality Gates                 Required  ← Waiting
✅ 🔒 CodeQL Security Scan       Required
────────────────────────────────────────────
Some checks were not successful
1 failing check
```

### Policy

> **No green, no deploy.**
>
> All quality gates must pass before code can be merged to main.
> Merges to main trigger deployment to staging.
> Tagged releases (vX.Y.Z) trigger deployment to production.

---

## Active CI/CD Workflows

Only these workflows are considered part of the live CI/CD pipeline:

| Workflow                              | Purpose                                                                                        | Trigger                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| `.github/workflows/stage1.yml`        | Stage 1 – Validate, Build, Deploy (PRs = validate only; main = deploy STG; tags = deploy PROD) | PR, push to main, tag `vX.Y.Z` |
| `.github/workflows/stage2.yml`        | Stage 2 – Environment Tests (API + UI smoke packs against deployed STG/PROD)                   | After Stage-1 succeeds on main |
| `.github/workflows/security-scan.yml` | Periodic / on-push security checks (CodeQL, Snyk, etc.)                                        | Push, PR, weekly schedule      |

**Rule:** If it's not `stage1.yml`, `stage2.yml`, or `security-scan.yml`, it doesn't run.

All other CI definitions have been archived under `.github/workflows/archive/`.

---

## Stage-1: Validate + Deploy

**Workflow:** `.github/workflows/stage1.yml`

### Trigger Matrix

| Event        | Validate | Deploy to Staging | Deploy to Production |
| ------------ | -------- | ----------------- | -------------------- |
| PR to main   | ✅       | ❌                | ❌                   |
| Push to main | ✅       | ✅                | ❌                   |
| Tag `vX.Y.Z` | ✅       | ❌                | ✅                   |

### Validation Steps (Story 2.1 Quality Gates)

Each quality gate runs as a **separate job** for visible status checks in PRs:

```
┌─────────────────────────────────────────────────────────────┐
│           STAGE-1 QUALITY GATES (Visible Status Checks)     │
├─────────────────────────────────────────────────────────────┤
│  Job: lint          → Status: "Lint"                        │
│  Job: unit-tests    → Status: "Unit Tests"                  │
│  Job: contract-tests → Status: "Contract Tests"             │
│  Job: guards        → Status: "Guards"                      │
│  Job: quality-gates → Status: "Quality Gates" (aggregator)  │
├─────────────────────────────────────────────────────────────┤
│  Parallel: security-scan.yml → Status: "🔒 CodeQL Scan"     │
└─────────────────────────────────────────────────────────────┘
```

**Job Flow:**

```
lint, unit-tests, contract-tests, guards  ─┬─→ quality-gates ─→ staging-deploy
(parallel)                                  │                   │
                                           └──────────────────→ production-deploy (tags)
```

For local validation, use the unified truth script:

```bash
npm run stage1-local  # Runs all validation steps
```

### MVP Guards (Automated Enforcement)

| Guard         | File                     | Enforces                                                    |
| ------------- | ------------------------ | ----------------------------------------------------------- |
| Surface Count | `check-surfaces.js`      | Only 5 MVP surfaces: admin, public, display, poster, report |
| Dead Code     | `check-dead-code.js`     | No unused `api_*` exports (zombie functions)                |
| V2 Files      | `check-v2-files.js`      | No V2 files in MVP directory                                |
| Schema Fields | `check-schema-fields.js` | Surfaces only use schema-defined fields                     |
| RPC Inventory | `check-rpc-inventory.js` | All `api_*` functions have schemas                          |

### Hermetic Principle

**Critical:** Stage-1 has **zero external HTTP dependencies**.

```javascript
// Stage-1 MUST NOT use BASE_URL
if (process.env.BASE_URL) {
  throw new Error('Stage-1 is hermetic - BASE_URL not allowed');
}
```

**Why this matters:**

- Stage-1 cannot break due to staging/production outages
- Validation is completely decoupled from deployment infrastructure
- Reproducible results regardless of network conditions

### Deployment Process

When deployment triggers:

1. **Clasp Push** — Push all `.gs` and `.html` files to Apps Script
2. **Create Deployment** — Create new version with timestamp description
3. **Emit Artifact** — Output `stg-base-url` or `prod-base-url` for Stage-2

**Script IDs:**

```
Staging:    1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ
Production: 1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l
```

**Retry Logic:** 4 attempts with exponential backoff (5s, 10s, 20s, 40s)

---

## Stage-2: Environment Tests

**Workflows:**

- `.github/workflows/stage2.yml` — Orchestrator (API + UI smoke)
- `.github/workflows/stage2-testing.yml` — Comprehensive E2E testing

### URL Selection Hierarchy

```
1. USE_PRODUCTION=true     → https://www.eventangle.com (explicit opt-in)
2. inputs.deployment_url   → Manual override
3. Stage-1 artifact        → From deployment-url.txt
4. Default                 → https://stg.eventangle.com (safe sandbox)
```

### Progressive Test Gates

```
┌─────────────────────────────────────────────────────────────┐
│                    STAGE-2 TESTING                          │
├─────────────────────────────────────────────────────────────┤
│  Preflight    → Reachability check (fail-fast)              │
│  Warmup       → GAS cold-start elimination                  │
│       ↓                                                     │
│  API Tests    → Critical path (status, events, qr, report)  │
│       ↓                                                     │
│  ═══ GATE 1 ═══  API Pass? No → BLOCK RELEASE               │
│       ↓                                                     │
│  Smoke Packs  → 4 core tests (pages, integration, etc.)     │
│       ↓                                                     │
│  ═══ GATE 1.5 ═══  Packs Pass? No → BLOCK RELEASE           │
│       ↓                                                     │
│  UI Smoke     → Admin, Public, Display, Poster surfaces     │
│  E2E Smoke    → End-to-end validation                       │
│       ↓                                                     │
│  ═══ GATE 2 ═══  Smoke Pass? No → SKIP EXPENSIVE TESTS      │
│       ↓                                                     │
│  Expensive    → Flow tests + Page tests (parallel)          │
│       ↓                                                     │
│  Quality Gate → Final aggregation                           │
└─────────────────────────────────────────────────────────────┘
```

### Test Categories

| Category        | Tests                       | Purpose                                              |
| --------------- | --------------------------- | ---------------------------------------------------- |
| **API Smoke**   | `tests/api/smoke/*.spec.ts` | Contract validation (v4.1.2 schema)                  |
| **UI Smoke**    | `tests/ui/smoke/*.spec.ts`  | Surface load verification                            |
| **Smoke Packs** | 4 core tests                | MVP surface health                                   |
| **Flow Tests**  | Template scenarios          | Data propagation (Admin → Public → Display → Poster) |
| **Page Tests**  | Comprehensive validation    | Deep page functionality                              |

### Brand Testing Matrix

All tests run for each of 4 brands:

| Brand | Key                     | Environment Variables                   |
| ----- | ----------------------- | --------------------------------------- |
| root  | Zeventbook              | `ADMIN_KEY_ROOT`, `SPREADSHEET_ID_ROOT` |
| abc   | American Bocce Co.      | `ADMIN_KEY_ABC`, `SPREADSHEET_ID_ABC`   |
| cbc   | Community Based Cricket | `ADMIN_KEY_CBC`, `SPREADSHEET_ID_CBC`   |
| cbl   | Community Based League  | `ADMIN_KEY_CBL`, `SPREADSHEET_ID_CBL`   |

---

## Environment Alignment Gate (Story 4)

### Purpose

The Environment Alignment Gate ensures that the Cloudflare Worker and Google Apps Script deployment are correctly synchronized. This is the **first critical check** in Stage-2 and acts as a fail-fast gate.

### Why This Matters

Deployment mismatches between Worker and GAS cause 503 errors and broken functionality. The alignment gate prevents this by verifying:

1. **Deployment ID Match** — Worker's configured deployment ID matches GAS's actual deployment ID
2. **Script ID Verification** — GAS Script ID matches expected staging/production Script ID
3. **Environment Consistency** — Both Worker and GAS report the same environment (staging/production)
4. **Account Validation** — GAS account email contains "zeventbook" (correct service account)

### Endpoints Used

| Endpoint        | Source             | Returns                                                 |
| --------------- | ------------------ | ------------------------------------------------------- |
| `/env-status`   | Cloudflare Worker  | `{env, gasBase, deploymentId, workerBuild}`             |
| `/?page=whoami` | Google Apps Script | `{scriptId, deploymentId, email, buildId, brand, time}` |

### Alignment Checks

```
┌─────────────────────────────────────────────────────────────┐
│           ENVIRONMENT ALIGNMENT GATE                        │
│           (First Gate in Stage-2)                           │
├─────────────────────────────────────────────────────────────┤
│  1. Worker deploymentId == GAS deploymentId (CRITICAL)     │
│  2. GAS scriptId == Expected Script ID for environment     │
│  3. Worker env == Expected environment (staging/prod)       │
│  4. GAS email contains "zeventbook"                         │
│                                                             │
│  ANY FAILURE → Pipeline STOPS, downstream tests SKIPPED     │
└─────────────────────────────────────────────────────────────┘
```

### Fail-Fast Behavior

If the alignment gate fails:

- **All downstream tests are SKIPPED** (API smoke, UI smoke)
- **Pipeline reports clear failure reason**
- **Promotion to production is BLOCKED**

This saves CI time and provides immediate feedback about configuration issues.

### Test File

**Location:** `tests/api/smoke/env-alignment.spec.ts`

### Expected Script IDs

| Environment | Script ID                                                   |
| ----------- | ----------------------------------------------------------- |
| Staging     | `1gHiPuj7eXNk09dDyk17SJ6QsCJg7LMqXBRrkowljL3z2TaAKFIvBLhHJ` |
| Production  | `1YO4apLOQoAIh208AcAqWO3pWtx_O3yas_QC4z-pkurgMem9UgYOsp86l` |

---

## Security Scanning (Story 4)

### Overview

Security scanning is a **required release gate**. No code goes to production without passing security scans.

### CodeQL Analysis

**Workflow:** `.github/workflows/security-scan.yml`

| Trigger           | Behavior                                  |
| ----------------- | ----------------------------------------- |
| PR to main        | Required check - blocks merge on findings |
| Push to main      | Continuous monitoring                     |
| Push to claude/\* | Continuous monitoring                     |
| Weekly (Sunday)   | Scheduled vulnerability discovery         |
| Manual dispatch   | Security audits                           |

### Query Packs

- **security-extended** — Extended security queries
- **security-and-quality** — Security and code quality checks

### Coverage

| File Type | Extension              | Coverage                     |
| --------- | ---------------------- | ---------------------------- |
| Backend   | `.gs`                  | Google Apps Script functions |
| Frontend  | `.html`                | Embedded JavaScript          |
| Scripts   | `.js`, `.mjs`          | Build and deployment scripts |
| Tests     | `.spec.ts`, `.test.js` | Test code quality            |
| Worker    | `worker.js`            | Cloudflare Worker            |

### Security Checks Include

- SQL Injection vulnerabilities
- Cross-Site Scripting (XSS)
- Command Injection
- Path Traversal
- Insecure Randomness
- Hardcoded Credentials
- Prototype Pollution
- Regular Expression DoS (ReDoS)
- 200+ additional security patterns

### Dependency Audit

Runs `npm audit` alongside CodeQL to check for known vulnerabilities in npm dependencies. High and critical findings are reported but CodeQL is the authoritative gate.

### Branch Protection Configuration

To enforce security scans as a required check:

1. Go to **Settings > Branches > Branch protection rules**
2. Select or create rule for `main`
3. Enable **Require status checks to pass before merging**
4. Add **CodeQL Security Scan** as a required check

### Policy

> **No code goes to production without passing security scans.**
>
> Critical and high severity findings BLOCK merges. This is team policy enforced by CI.

---

## Environment Keys (stg/prod)

### Single Source of Truth

**File:** `config/environments.js`

```javascript
// Production
PRODUCTION_URL = 'https://www.eventangle.com';
GAS_PRODUCTION_URL = 'https://script.google.com/macros/s/{PROD_ID}/exec';

// Staging
STAGING_URL = 'https://stg.eventangle.com';
GAS_STAGING_URL = 'https://script.google.com/macros/s/{STG_ID}/exec';

// QA
QA_URL = 'https://zeventbooks.com';

// Local
LOCAL_URL = 'http://localhost:3000';
```

### Environment Matrix

| Environment    | URL                  | GAS Project       | Who Can Deploy |
| -------------- | -------------------- | ----------------- | -------------- |
| **Production** | `www.eventangle.com` | Production Script | **CI ONLY**    |
| **Staging**    | `stg.eventangle.com` | Staging Script    | Developers, CI |
| **Local**      | `localhost:3000`     | N/A               | Developers     |

### Environment Detection

```javascript
// Helper functions from config/environments.js
isProduction(); // true if production URL
isStaging(); // true if staging URL
isGoogleAppsScript(); // true if running in GAS
getBaseUrl(); // current environment URL
getBrandUrl(brand, page); // brand-specific URLs
```

---

## Cloudflare Routing Alignment

**Config:** `cloudflare-proxy/wrangler.toml`

### Route Configuration

| Environment    | Routes                                                             | Worker               |
| -------------- | ------------------------------------------------------------------ | -------------------- |
| **Production** | `eventangle.com/*`, `www.eventangle.com/*`, `api.eventangle.com/*` | `eventangle-prod`    |
| **Staging**    | `stg.eventangle.com/*`, `api-stg.eventangle.com/*`                 | `eventangle-staging` |

### Friendly URL Aliases

All routes proxy to Google Apps Script via Cloudflare Worker:

| Alias      | Maps To         | Purpose       |
| ---------- | --------------- | ------------- |
| `/events`  | `?page=public`  | Event listing |
| `/manage`  | `?page=admin`   | Admin panel   |
| `/display` | `?page=display` | TV/kiosk mode |
| `/poster`  | `?page=poster`  | Print/QR page |
| `/status`  | `?page=status`  | Health check  |

### Brand URL Patterns

```
Root:   /{alias}         → /events, /manage, /display
Brands: /{brand}/{alias} → /abc/events, /cbc/manage, /cbl/display
```

### Deployment Command

```bash
# Staging
wrangler deploy --env staging

# Production (CI only)
wrangler deploy --env production
```

---

## QR Verification Invariant

### Why QR Verification is Critical

The Poster surface requires QR codes to function. If QR generation fails, the poster page is broken. This is a **critical invariant** checked before every production deployment.

### QR Code Structure

```javascript
event: {
  qr: {
    public: "data:image/png;base64,...",  // Links to public page
    signup: "data:image/png;base64,..."   // Links to signup page
  }
}
```

### Verification Checks

**Test:** `tests/api/smoke/qr.spec.ts`

| Check           | Validation                                         |
| --------------- | -------------------------------------------------- |
| Existence       | Both `qr.public` and `qr.signup` present           |
| Base64 Valid    | Can decode to binary PNG data                      |
| PNG Magic Bytes | `89 50 4E 47 0D 0A 1A 0A` at start                 |
| Dimensions      | 100x100 minimum, 1000x1000 maximum                 |
| Header Valid    | Dimensions readable from PNG header (offset 16-24) |

### Production Gate

```
IF QR verification fails → BLOCK production deployment
```

### Sponsor Report QR Contract

```typescript
// Input
{ brandId: string, sponsorId: string }

// Output (envelope format)
{
  ok: true,
  value: {
    url: string,         // Contains sponsorId parameter
    qrB64: string,       // Raw base64 PNG (no data URI)
    verified: boolean
  }
}
```

---

## Contract Safety Rules

### API Response Envelope (v4.1.2)

**Two response formats — strict boundary between them:**

#### Flat Endpoints (Status pages only)

```javascript
// Success
{ ok: true, buildId: "mvp-v19", brandId: "root", time: "ISO8601" }

// Error
{ ok: false, buildId: "mvp-v19", message: "error text" }
```

#### Envelope Endpoints (All other endpoints)

```javascript
// Success
{ ok: true, value: { /* data */ }, etag?: string }

// Error
{ ok: false, code: "BAD_INPUT|NOT_FOUND|RATE_LIMITED|INTERNAL|CONTRACT", message: string }

// Not Modified (304-equivalent)
{ ok: true, notModified: true, etag: "abc123" }
```

### Contract Enforcement

| Mechanism                | Location                | Purpose                     |
| ------------------------ | ----------------------- | --------------------------- |
| `validateEnvelope()`     | Test helpers            | Verify response format      |
| `validateFlatResponse()` | Test helpers            | Verify status format        |
| Schema files             | `schemas/*.schema.json` | Canonical field definitions |
| Contract tests           | `tests/contract/`       | Endpoint compliance         |

### Event Contract (Frozen MVP v1.0)

**Required Fields:**

- `id`, `slug`, `name`, `startDateISO`, `venue`
- `links.*` (publicUrl, displayUrl, posterUrl, signupUrl)
- `qr.*` (public, signup)
- `ctas.primary.*` (label, url)
- `settings.show*` (schedule, standings, bracket, sponsors, etc.)

**Read-Only Fields (Never overwrite):**

- `id`, `links.*`, `qr.*`, `createdAtISO`, `updatedAtISO`

### Surface Constraints

| Surface     | Constraints                                                 |
| ----------- | ----------------------------------------------------------- |
| **Public**  | Use `links.*`, gate sections with `setting && data?.length` |
| **Display** | Filter sponsors by placement, QR from `event.qr.*`          |
| **Poster**  | Print-safe (no links on sponsors), QR must be pre-generated |
| **Admin**   | Preserve core fields, never rebuild links/QR                |

---

## Fail-Fast Philosophy

### Core Principle

> **Stop early when critical tests fail to save time and CI costs.**

### Implementation

```
Env Alignment fail → Skip ALL downstream tests (critical first gate)
API Tests fail     → Skip Smoke Packs + all downstream
Smoke Packs fail   → Skip E2E Smoke + Expensive Tests
Smoke Tests fail   → Skip Expensive Tests (Flow + Page)
```

### Gate Hierarchy (Story 4 Enhanced)

```
┌─────────────────────────────────────────────────┐
│   GATE 0 (Environment Alignment) - FIRST       │
│   ├─ FAIL → Stop IMMEDIATELY, skip ALL tests   │
│   └─ PASS → Continue to Gate 1                 │
├─────────────────────────────────────────────────┤
│   GATE 1 (API Smoke)                           │
│   ├─ FAIL → Stop immediately, block release    │
│   └─ PASS → Continue to Gate 1.5               │
├─────────────────────────────────────────────────┤
│   GATE 1.5 (Smoke Packs)                       │
│   ├─ FAIL → Stop, skip expensive tests         │
│   └─ PASS → Continue to Gate 2                 │
├─────────────────────────────────────────────────┤
│   GATE 2 (UI Smoke Tests)                      │
│   ├─ FAIL → Stop, skip expensive tests         │
│   └─ PASS → Run expensive tests                │
├─────────────────────────────────────────────────┤
│   Quality Gate (Final)                         │
│   ├─ ANY FAIL → Block release                  │
│   └─ ALL PASS → Release ready                  │
└─────────────────────────────────────────────────┘
```

### Environment Alignment (Gate 0)

The environment alignment gate is **the first check** in Stage-2. It verifies Worker ↔ GAS deployment synchronization before any other tests run.

**Why Gate 0?**

- Configuration mismatches cause 503 errors that cascade through all tests
- Running tests against misaligned deployments wastes CI resources
- Early detection provides immediate, actionable feedback

### Benefits

1. **Cost Optimization** — Don't run expensive tests if cheap tests fail
2. **Fast Feedback** — Developers know within minutes if critical tests fail
3. **Resource Efficiency** — Parallel test execution where possible
4. **Clear Audit Trail** — Each gate produces actionable status

### Timeouts

| Operation          | Timeout |
| ------------------ | ------- |
| Deployment warmup  | 60s     |
| HTTP requests      | 30s     |
| Playwright actions | 30s     |
| Full Stage-2       | 30 min  |

---

## Pipeline Notifications

### Overview (Story 2.5)

The pipeline sends immediate notifications when critical gates fail, ensuring the team can respond quickly to issues.

### Notification Triggers

| Stage              | Trigger             | Notification                                                  |
| ------------------ | ------------------- | ------------------------------------------------------------- |
| **Stage-1**        | Lint fails          | "Stage-1 Quality Gate Failed: Lint"                           |
| **Stage-1**        | Unit tests fail     | "Stage-1 Quality Gate Failed: Unit Tests"                     |
| **Stage-1**        | Contract tests fail | "Stage-1 Quality Gate Failed: Contract Tests"                 |
| **Stage-1**        | Guards fail         | "Stage-1 Quality Gate Failed: Guards"                         |
| **Stage-2**        | Env alignment fails | "Stage-2 Validation Failed: Environment Alignment (CRITICAL)" |
| **Stage-2**        | API smoke fails     | "Stage-2 Validation Failed: API Smoke Tests"                  |
| **Stage-2**        | UI smoke fails      | "Stage-2 Validation Failed: UI Smoke Tests"                   |
| **Stage-2 (prod)** | Any failure         | "PRODUCTION Stage-2 Validation Failed" (urgent)               |

### Supported Channels

| Channel             | Configuration     | Secret Name         |
| ------------------- | ----------------- | ------------------- |
| **Slack**           | Incoming webhook  | `SLACK_WEBHOOK_URL` |
| **Microsoft Teams** | Connector webhook | `TEAMS_WEBHOOK_URL` |

### Slack Notification Format

```
┌─────────────────────────────────────────────────────┐
│  🔴 Stage-1 Quality Gate Failed                    │
├─────────────────────────────────────────────────────┤
│  Failed Gate(s): Lint, Unit Tests                  │
│  Trigger: PR #123                                  │
│  Branch: feature/my-feature                        │
│  Actor: developer                                   │
│                                                     │
│  [View Workflow Run]                               │
└─────────────────────────────────────────────────────┘
```

### Teams Notification Format

```
🔴 Stage-1 Quality Gate Failed
───────────────────────────────────────
Failed Gate(s): Lint, Unit Tests
Branch: feature/my-feature
Trigger: PR #123
Actor: developer
[View Workflow Run]
```

### Configuration

To enable notifications:

1. **Slack:**
   - Create an Incoming Webhook: [Slack API](https://api.slack.com/messaging/webhooks)
   - Add `SLACK_WEBHOOK_URL` secret to repository

2. **Teams:**
   - Create a Connector webhook in your Teams channel
   - Add `TEAMS_WEBHOOK_URL` secret to repository

### Notification Jobs

| Workflow     | Job Name                | Purpose                        |
| ------------ | ----------------------- | ------------------------------ |
| `stage1.yml` | `notify-stage1-failure` | Alert on quality gate failures |
| `stage2.yml` | `notify-stage2-failure` | Alert on validation failures   |

### Example: Production Failure Alert

When a production Stage-2 validation fails:

```
┌─────────────────────────────────────────────────────┐
│  🚨 PRODUCTION Stage-2 Validation Failed           │
├─────────────────────────────────────────────────────┤
│  Failed Test(s): API Smoke Tests                   │
│  Environment: production                            │
│  Target URL: https://www.eventangle.com            │
│  Status: PRODUCTION BLOCKED                        │
│                                                     │
│  Story 2.5: Progressive test gates - API tests     │
│  gate UI tests                                      │
│                                                     │
│  [View Workflow Run]                               │
└─────────────────────────────────────────────────────┘
```

---

## Deployment Flow Diagram

```
                    Developer
                        │
                        ▼
           ┌────────────────────────┐
           │  Create PR to main     │
           └───────────┬────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         │
   ┌────────────────┐               │
   │ Security Scan  │               │
   │ (CodeQL)       │ ← Parallel    │
   └───────┬────────┘               │
           │                        │
           ▼                        ▼
    ┌──────────────────────────────────────┐
    │         STAGE-1: VALIDATION          │
    │      (Hermetic - No BASE_URL)        │
    ├──────────────────────────────────────┤
    │  ● Lint                              │
    │  ● Unit Tests (512+)                 │
    │  ● Contract Tests (155+)             │
    │  ● MVP Guards (5 checks)             │
    └───────────────────┬──────────────────┘
                        │
           ┌────────────┴────────────┐
           │                         │
      PR to main              Push to main
           │                         │
           ▼                         ▼
      VALIDATE ONLY          VALIDATE + DEPLOY
      (No deploy)                    │
           │                ┌────────┴────────┐
           │                │                 │
           │           Push to main      Tag vX.Y.Z
           │                │                 │
           │                ▼                 ▼
           │           Deploy to          Deploy to
           │           STAGING            PRODUCTION
           │                │                 │
           │                │                 ▼
           │                │            ┌─────────────┐
           │                │            │ QR Verify   │
           │                │            │ Prod Smoke  │
           │                │            └──────┬──────┘
           │                │                   │
           │                │          ┌────────┴────────┐
           │                │          │                 │
           │                │         FAIL              PASS
           │                │          │                 │
           │                │          ▼                 ▼
           │                │       BLOCK            PROD LIVE
           │                │                            ✅
           │                │
           │                ▼
           │         Emit stg-base-url
           │                │
           │                ▼
           │    ┌──────────────────────────────┐
           │    │   STAGE-2: POST-DEPLOY TEST  │
           │    │   (Against Live Staging URL) │
           │    ├──────────────────────────────┤
           │    │  ● Env Alignment (GATE 0)    │ ← First!
           │    │  ● API Smoke (GATE 1)        │
           │    │  ● UI Smoke (GATE 2)         │
           │    │  ● Validation Gate           │
           │    └───────────────┬──────────────┘
           │                    │
           │           ┌───────┴───────┐
           │           │               │
           │          FAIL            PASS
           │           │               │
           │           ▼               ▼
           │       BLOCK           RELEASE
           │       RELEASE         READY ✅
           │
           ▼
         END
```

### Stage-2 Gate Details (Story 4 Enhanced)

```
┌──────────────────────────────────────────────────────────────┐
│                  STAGE-2 GATE SEQUENCE                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   GATE 0: Environment Alignment                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  • Worker /env-status vs GAS /whoami                 │   │
│   │  • Deployment IDs MUST match                         │   │
│   │  • Script ID must match expected                     │   │
│   │  • FAIL → Skip ALL downstream, BLOCK release         │   │
│   └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼ PASS                              │
│   GATE 1: API Smoke Tests                                    │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  • Status, events, qr, sharedreport endpoints        │   │
│   │  • v4.1.2 JSON schema validation                     │   │
│   │  • GAS HTML integrity check (Story 6)                │   │
│   │  • FAIL → BLOCK release                              │   │
│   └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼ PASS                              │
│   GATE 2: UI Smoke Tests                                     │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  • Admin, Public, Display, Poster surfaces           │   │
│   │  • Page loads, core UI elements                      │   │
│   │  • No JavaScript errors                              │   │
│   │  • FAIL → BLOCK release                              │   │
│   └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼ PASS                              │
│   VALIDATION GATE: Final Aggregation                         │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  • All gates must PASS                               │   │
│   │  • Creates detailed summary                          │   │
│   │  • ANY FAIL → BLOCK release                          │   │
│   │  • ALL PASS → Release ready ✅                       │   │
│   └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### Commands

```bash
# Stage-1 (Pre-Deploy)
npm run lint                # ESLint
npm run test:unit           # Jest unit tests
npm run test:contract       # Contract tests
npm run stage1-local        # Unified Stage-1 (all above)
npm run ci:all              # Full CI gate

# Stage-2 (Post-Deploy)
npm run test:api            # API integration tests
npm run test:smoke          # E2E smoke tests
npm run test:smoke:packs    # 4 core smoke packs
npm run test:ui:smoke       # UI smoke tests
npm run test:flows          # Flow tests (expensive)
npm run test:pages          # Page tests (expensive)
npm run test:ci:stage2      # Full Stage-2

# Environment Alignment (Story 4)
npm run test:api:smoke:env-alignment       # Run alignment tests locally
npx playwright test tests/api/smoke/env-alignment.spec.ts  # Direct run

# Environment-Specific
npm run test:prod:smoke                    # Production smoke
BASE_URL="https://stg..." npm run test:smoke  # Custom URL
TEST_BRAND=abc npm run test:smoke          # Brand-specific
```

### Key Files

| Purpose                 | File                                              |
| ----------------------- | ------------------------------------------------- |
| **Stage-1 Workflow**    | `.github/workflows/stage1.yml` ✅ Active          |
| **Stage-2 Workflow**    | `.github/workflows/stage2.yml` ✅ Active          |
| **Security Workflow**   | `.github/workflows/security-scan.yml` ✅ Active   |
| Environment Config      | `config/environments.js`                          |
| Deployment IDs          | `config/deployment-ids.js`                        |
| Cloudflare Config       | `cloudflare-proxy/wrangler.toml`                  |
| **Env Alignment Tests** | `tests/api/smoke/env-alignment.spec.ts` ← Story 4 |
| QR Tests                | `tests/api/smoke/qr.spec.ts`                      |
| Stage-1 Script          | `scripts/stage1-local.mjs`                        |
| API Contract            | `API_CONTRACT.md`                                 |
| Event Schema            | `EVENT_CONTRACT.md`                               |
| Production Policy       | `PRODUCTION_DEPLOYMENT_POLICY.md`                 |

### Safety Checklist

- [ ] Stage-1 passes before any deployment
- [ ] No BASE_URL in Stage-1 (hermetic)
- [ ] **Environment alignment passes (Story 4)** ← New
- [ ] **Security scan passes (Story 4)** ← New
- [ ] QR verification passes before production
- [ ] All 4 brands tested
- [ ] Production deploys only via CI (tag push)
- [ ] Staging mirrors production routes

---

## Related Documentation

- [DEPLOYMENT.md](../DEPLOYMENT.md) — Step-by-step deployment runbook
- [PRODUCTION_DEPLOYMENT_POLICY.md](../PRODUCTION_DEPLOYMENT_POLICY.md) — CI-only policy
- [API_CONTRACT.md](../API_CONTRACT.md) — Response envelope boundaries
- [EVENT_CONTRACT.md](../EVENT_CONTRACT.md) — Event schema (frozen)
- [ENVIRONMENT_MATRIX.md](../ENVIRONMENT_MATRIX.md) — Authoritative environment reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) — MVP architecture overview
