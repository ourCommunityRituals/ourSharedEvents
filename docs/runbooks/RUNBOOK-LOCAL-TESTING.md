# Runbook: Running Local Tests

> **Purpose:** Guide for running the local CI pipeline and test suites.
> **Last Updated:** 2025-12-17 | **Story:** 6 - Document Baseline & Runbooks

---

## Quick Reference

| Command                   | Description                        |
| ------------------------- | ---------------------------------- |
| `npm run ci:local`        | Full CI (Stage-1 + Stage-2)        |
| `npm run ci:local stage1` | Stage-1 only (hermetic validation) |
| `npm run ci:local stage2` | Stage-2 only (requires BASE_URL)   |
| `npm run ci:local quick`  | Quick CI (critical tests only)     |
| `npm run stage1-local`    | Unified Stage-1 script             |

---

## Understanding the Local CI Runner

The local CI runner (`scripts/run-ci-local.js`) mirrors the exact behavior of GitHub Actions workflows:

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL CI STRUCTURE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STAGE 1 (Hermetic - No External Dependencies)                   │
│  ├── Lint (ESLint)                                               │
│  ├── Unit Tests (Jest)                                           │
│  ├── Contract Tests (schema, API, bundles)                       │
│  ├── Security Tests                                              │
│  ├── MVP Guards (surfaces, dead code, V2 files)                  │
│  └── Build Verification                                          │
│                                                                  │
│  STAGE 2 (Requires BASE_URL)                                     │
│  ├── API Tests (critical gate)                                   │
│  ├── Smoke Tests (gated by API)                                  │
│  ├── Flow Tests                                                  │
│  └── Page Tests                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Running Stage-1 Tests

Stage-1 is **hermetic** - it requires no external dependencies, no BASE_URL, no network access.

### Full Stage-1

```bash
# Using the CI local runner
npm run ci:local stage1

# Or using the unified truth script directly
npm run stage1-local
```

**What it runs:**

1. ESLint code quality checks
2. Jest unit tests (mocked, no network)
3. Contract tests (schema, API, bundles)
4. Security-specific validation
5. MVP guards (surface count, dead code, V2 files)
6. Build/bundle verification

### Individual Stage-1 Components

```bash
# Lint only
npm run lint

# Fix lint issues automatically
npm run lint:fix

# Unit tests only
npm run test:unit

# Contract tests only
npm run test:contract

# All guards
npm run guards
```

---

## Running Stage-2 Tests

Stage-2 tests require a **live deployment** to test against.

### Default: Test Against Staging

```bash
# Tests default to staging (https://stg.oursharedevents.com)
npm run ci:local stage2
```

### Test Against Specific URL

```bash
# Test against production
BASE_URL="https://www.oursharedevents.com" npm run ci:local stage2

# Test against local development
BASE_URL="http://localhost:3000" npm run ci:local stage2
```

### Individual Stage-2 Components

```bash
# API tests only
npm run test:api

# Smoke tests only
npm run test:smoke

# Flow tests only
npm run test:flows

# Page tests only
npm run test:pages
```

---

## Quick CI for Pre-Commit

Use quick CI for fast feedback before committing:

```bash
npm run ci:local quick
```

**What it runs:**

1. Lint
2. Unit tests
3. Contract tests
4. API tests
5. Smoke tests

**Skips:** Flow tests, page tests (expensive)

---

## Running Full CI

```bash
npm run ci:local
```

**Flow:**

1. Stage-1 runs first (hermetic validation)
2. If Stage-1 passes, Stage-2 runs
3. If Stage-1 fails, Stage-2 is skipped

**Progressive gating:**

- API tests gate smoke tests
- Smoke tests gate flow/page tests

---

## Setting Up Environment

### Basic Setup

```bash
# Copy environment template
cp .env.example .env.local

# Edit with your values
# - ADMIN_KEY: Your admin key for API tests
# - BRAND_ID: Brand to test (default: root)
```

### Testing Against Staging (Default)

No additional setup needed - tests default to staging.

### Testing Against Production

```bash
# Method 1: Use dedicated npm script
npm run test:prod:smoke

# Method 2: Set BASE_URL
export BASE_URL="https://www.oursharedevents.com"
npm run test:smoke

# Method 3: Inline
BASE_URL="https://www.oursharedevents.com" npm run test:smoke
```

### Testing Local Development

```bash
# Start local server (if applicable)
npm run dev

# In another terminal, run tests
BASE_URL="http://localhost:3000" npm run test:smoke
```

---

## Understanding Test Output

### Stage-1 Output

```
============================================================
STAGE 1: Build & Validate
============================================================

>>> Running: ESLint
$ npm run lint
[PASS] ESLint passed

>>> Running: Unit Tests
$ npm run test:unit
[PASS] Unit Tests passed

>>> Running: Contract Tests
$ npm run test:contract
[PASS] Contract Tests passed

>>> Running: Guards
$ npm run guards
[PASS] Guards passed
```

### Stage-2 Output

```
============================================================
STAGE 2: E2E Testing (Progressive)
============================================================

>>> Running: API Tests (Critical)
$ npm run test:api
[PASS] API Tests (Critical) passed

>>> Running: Smoke Tests (Critical)
$ npm run test:smoke
[PASS] Smoke Tests (Critical) passed

>>> Running: Flow Tests (Expensive)
$ npm run test:flows
[PASS] Flow Tests (Expensive) passed
```

### Summary

```
============================================================
CI SUMMARY
============================================================

Stage 1 (Build & Validate):
  npm run test:ci:stage1: PASS
  (lint + unit + contract + guards)

Stage 2 (E2E Testing):
  API Tests:         PASS
  Smoke Tests:       PASS
  Flow Tests:        PASS
  Page Tests:        PASS
  Overall:           PASS

OVERALL: PASS
```

---

## Troubleshooting

### Lint Fails

```bash
# See specific lint errors
npm run lint

# Auto-fix what's possible
npm run lint:fix
```

### Unit Tests Fail

```bash
# Run with verbose output
npm run test:unit -- --verbose

# Run specific test file
npm run test:unit -- tests/unit/specific.test.js

# Run in watch mode for development
npm run test:unit -- --watch
```

### Contract Tests Fail

```bash
# See which contract failed
npm run test:contract

# Check specific contract
npm run test -- tests/contract/bundles.contract.test.js
```

### API Tests Fail (Stage-2)

```bash
# Check if staging is up
curl -s https://stg.oursharedevents.com/ping

# Check health endpoint
curl -s https://stg.oursharedevents.com/api/health/backend | jq

# Run API tests with debug
DEBUG=true npm run test:api
```

### Tests Time Out

```bash
# Increase timeout for slow connections
PLAYWRIGHT_TIMEOUT=60000 npm run test:smoke
```

---

## Best Practices

1. **Run Stage-1 before pushing** - Catch issues before CI

   ```bash
   npm run ci:local stage1
   ```

2. **Use quick CI before committing** - Fast feedback loop

   ```bash
   npm run ci:local quick
   ```

3. **Run full CI before creating PR** - Ensure everything passes

   ```bash
   npm run ci:local
   ```

4. **Test against staging, not production** - Staging is the default for safety

5. **Check test reports** - Playwright generates HTML reports in `playwright-report/`

---

## Related Documentation

- [BASELINE.md](./BASELINE.md) - System baseline documentation
- [ci-cd-architecture.md](./ci-cd-architecture.md) - CI/CD architecture
- [E2E_PLAYWRIGHT_GUIDE.md](./E2E_PLAYWRIGHT_GUIDE.md) - Playwright test guide
- [scripts/run-ci-local.js](../scripts/run-ci-local.js) - Local CI runner script
