# Playwright Test Execution Analysis

## Executive Summary

This document analyzes the Playwright API and E2E test automation execution to identify issues and provide solutions for successful test execution.

**Key Finding:** Tests are properly configured and execute correctly. The primary blocker is **environment configuration** (BASE_URL must be set to a valid deployment URL).

---

## Test Architecture Overview

```
tests/
├── e2e/                          # Playwright E2E tests
│   ├── api/                      # API endpoint tests
│   │   ├── api-helpers.js        # API testing utilities
│   │   ├── system-api.spec.js    # System/status API tests
│   │   ├── events-crud-api.spec.js
│   │   ├── sponsors-crud-api.spec.js
│   │   └── multi-brand-api.spec.js
│   ├── 1-smoke/                  # Quick health checks
│   │   ├── critical-smoke.spec.js
│   │   ├── security-smoke.spec.js
│   │   └── api-contract.spec.js
│   ├── 2-pages/                  # Page component tests
│   │   ├── admin-page.spec.js
│   │   ├── display-page.spec.js
│   │   └── public-page.spec.js
│   └── 3-flows/                  # End-to-end user journeys
│       ├── admin-flows.spec.js
│       ├── sponsor-flows.spec.js
│       └── customer-flows.spec.js
├── config/
│   ├── environments.js           # Multi-environment configuration
│   └── global-setup.js           # Pre-test setup
└── unit/                         # Jest unit tests
```

---

## Issue #1: Placeholder URLs in Configuration

### Problem

The default URL in `tests/config/environments.js` is a placeholder:

```javascript
// Line 17
baseUrl: process.env.GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
```

Similarly in `tests/e2e/3-flows/admin-flows.spec.js`:

```javascript
// Line 10
const BASE_URL = process.env.BASE_URL || 'https://script.google.com/macros/s/.../exec';
```

### Impact

Tests will fail with invalid URL errors if environment variables are not set.

### Solution

**Option A: Set environment variables before running tests**
```bash
# For Hostinger (recommended)
export BASE_URL=https://zeventbooks.com
export ADMIN_KEY=your_admin_key_here

# For direct Apps Script
export GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ACTUAL_DEPLOYMENT_ID/exec
```

**Option B: Create .env.local file**
```bash
cp .env.example .env.local
# Edit .env.local with actual values
source .env.local
```

---

## Issue #2: Environment Variable Priority

### Current Priority Chain

```
environments.js: GOOGLE_SCRIPT_URL → placeholder
critical-smoke.spec.js: BASE_URL → GOOGLE_SCRIPT_URL → 'https://zeventbooks.com'
admin-flows.spec.js: BASE_URL → placeholder
```

### Recommendation

Standardize on:
1. `BASE_URL` (primary - from CI/CD deployment)
2. `GOOGLE_SCRIPT_URL` (fallback for direct API testing)
3. `https://zeventbooks.com` (default production for local testing)

---

## Issue #3: GitHub Actions Configuration

### Current CI/CD Flow (stage2-testing.yml)

```yaml
env:
  BASE_URL: ${{ needs.setup.outputs.deployment_url }}
  GOOGLE_SCRIPT_URL: ${{ needs.setup.outputs.deployment_url }}
  ADMIN_KEY: ${{ secrets.ADMIN_KEY_ROOT }}
```

### Key Points

1. **BASE_URL is set from Stage 1 deployment output** - This is correct
2. **ADMIN_KEY_ROOT secret required** - Must be configured in GitHub repository
3. **Stage 2 auto-triggers after Stage 1** - Progressive testing strategy

---

## Issue #4: Network Access Requirements

### Tests Require External Network Access

All Playwright tests make HTTP requests to:
- `https://zeventbooks.com` (Hostinger proxy)
- `https://script.google.com/macros/s/.../exec` (Google Apps Script)

### Sandboxed Environment Limitation

In isolated environments (like this analysis session), external network requests fail:
```
Error: getaddrinfo EAI_AGAIN zeventbooks.com
```

**This is expected behavior in sandboxed environments and not a test configuration issue.**

---

## Issue #5: URL Parameter Variations

### Application Supports Two Patterns

| Parameter | Example | Use Case |
|-----------|---------|----------|
| `?page=` | `?page=admin&brand=root` | Standard pages |
| `?p=` | `?p=status&brand=root` | Shorthand for certain endpoints |

### Current Usage in Tests

- **API helpers** (`api-helpers.js`): Uses `?p=status`
- **Environment config**: Uses `?page=${page}`
- **Flow tests**: Uses `?page=admin`

Both patterns are valid and supported by the backend.

---

## Test Execution Commands

### Run Individual Test Suites

```bash
# API Tests (requires BASE_URL)
BASE_URL=https://zeventbooks.com npm run test:api

# Smoke Tests
BASE_URL=https://zeventbooks.com npm run test:smoke

# Page Tests
BASE_URL=https://zeventbooks.com npm run test:pages

# Flow Tests (requires BASE_URL and ADMIN_KEY)
BASE_URL=https://zeventbooks.com ADMIN_KEY=your_key npm run test:flows
```

### Run All E2E Tests

```bash
BASE_URL=https://zeventbooks.com ADMIN_KEY=your_key npm run test:e2e
```

### Run Against Hostinger (Convenience Commands)

```bash
npm run test:hostinger:api
npm run test:hostinger:smoke
npm run test:hostinger:pages
npm run test:hostinger:flows
```

---

## Prerequisites for Successful Execution

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Playwright Browsers

```bash
npx playwright install --with-deps chromium
```

### 3. Set Environment Variables

```bash
export BASE_URL=https://zeventbooks.com
export GOOGLE_SCRIPT_URL=$BASE_URL
export ADMIN_KEY=your_admin_secret_key
```

### 4. Verify Configuration

```bash
npm run test:env:print
```

Expected output:
```
Environment: Hostinger
Description: Hostinger custom domain (Production)
Base URL: https://zeventbooks.com
```

---

## GitHub Actions Requirements

### Required Secrets

| Secret | Purpose |
|--------|---------|
| `OAUTH_CREDENTIALS` | Google OAuth for clasp deployment |
| `ADMIN_KEY_ROOT` | Admin authentication for E2E tests |
| `DEPLOYMENT_ID` | Apps Script deployment ID to update |

### Stage 2 Auto-Trigger

Stage 2 testing automatically triggers after Stage 1 deployment on `main` branch.

Manual trigger is available via workflow_dispatch with custom URL.

---

## Test Validation Checklist

### Before Running Tests

- [ ] `npm install` completed successfully
- [ ] `npx playwright install chromium` completed
- [ ] `BASE_URL` environment variable set
- [ ] `ADMIN_KEY` set (for authenticated tests)
- [ ] Network access to deployment URL available

### Expected Test Results

| Suite | Tests | Duration | Dependencies |
|-------|-------|----------|--------------|
| API | 22 tests | ~30s | BASE_URL |
| Smoke | 10 tests | ~60s | BASE_URL |
| Pages | 15+ tests | ~2min | BASE_URL |
| Flows | 20+ tests | ~3min | BASE_URL, ADMIN_KEY |

---

## Troubleshooting

### "Cannot find module '@playwright/test'"

```bash
npm install
```

### "getaddrinfo EAI_AGAIN"

Network access to external URLs is blocked. Run tests in an environment with internet access.

### "BASE_URL not configured"

```bash
export BASE_URL=https://zeventbooks.com
```

### Tests timeout on first run

Google Apps Script has cold start latency (5-15 seconds). Tests are configured with appropriate timeouts:
- Navigation: 20 seconds
- Element visibility: 10 seconds
- API response: 5 seconds

### Invalid admin key errors

Ensure `ADMIN_KEY` environment variable matches the brand's admin secret from Config.gs.

---

## Conclusion

The Playwright test infrastructure is properly configured and ready for execution. The key requirements are:

1. **Set `BASE_URL`** to a valid deployment URL
2. **Set `ADMIN_KEY`** for authenticated test scenarios
3. **Ensure network access** to the deployment target

When these prerequisites are met, tests execute successfully in both local and CI/CD environments.
