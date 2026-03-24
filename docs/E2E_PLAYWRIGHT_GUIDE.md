# End-to-End Testing Guide (Playwright)

## Story 3.3: E2E Testing of User Flows

This guide documents the Playwright end-to-end test suite for the MVP Event Toolkit, covering critical user journeys, environment configuration, and CI/CD integration.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Configuration](#environment-configuration)
3. [Test Suite Overview](#test-suite-overview)
4. [Running Tests Locally](#running-tests-locally)
5. [Running Tests in CI](#running-tests-in-ci)
6. [Critical User Journeys](#critical-user-journeys)
7. [Test Data Management](#test-data-management)
8. [Debugging Failed Tests](#debugging-failed-tests)
9. [Test Reports](#test-reports)
10. [Maintenance](#maintenance)

---

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

### Run Tests Against Staging (Default)

```bash
# Set admin key for write operations
export ADMIN_KEY="your_admin_key"

# Run Story 3.3 critical user journey tests
npm run test:story3.3

# Run all smoke tests
npm run test:smoke
```

### Run Tests Against Production

```bash
# CAUTION: Only for validation, never for write operations
npm run test:story3.3:prod

# Or explicitly set production URL
BASE_URL=https://www.eventangle.com npm run test:smoke
```

---

## Environment Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `https://stg.eventangle.com` | Target URL for tests |
| `ADMIN_KEY` | `CHANGE_ME_root` | Admin key for write operations |
| `BRAND_ID` | `root` | Brand to test against |
| `USE_PRODUCTION` | `false` | Set to `true` to target production |
| `TEST_ENV` | (auto-detected) | Explicit environment name |

### Supported Environments

| Environment | URL | Use Case |
|-------------|-----|----------|
| **Staging** (Default) | `https://stg.eventangle.com` | Safe sandbox for all tests |
| **Production** | `https://www.eventangle.com` | Read-only validation |
| **QA** | `https://zeventbooks.com` | Secondary testing |
| **Local** | `http://localhost:3000` | Development |
| **GAS Direct** | `https://script.google.com/...` | Debugging |

### Example Commands

```bash
# Staging (default)
npm run test:story3.3

# Explicit staging
npm run test:story3.3:staging

# Production (read-only validation)
npm run test:story3.3:prod

# Custom URL
BASE_URL=https://qa.zeventbooks.com npm run test:story3.3

# Different brand
BRAND_ID=abc npm run test:story3.3
```

---

## Test Suite Overview

### Test Directory Structure

```
tests/
├── e2e/
│   ├── 1-smoke/                    # Quick smoke tests
│   │   ├── Admin.spec.js           # Admin surface smoke
│   │   ├── Public.spec.js          # Public surface smoke
│   │   ├── Display.spec.js         # Display surface smoke
│   │   ├── Poster.spec.js          # Poster surface smoke
│   │   └── SharedReport.spec.js    # Report surface smoke
│   ├── 2-pages/                    # Detailed page tests
│   ├── 3-flows/                    # User flow tests
│   ├── 4-negative/                 # Error handling tests
│   ├── api/                        # API endpoint tests
│   │   ├── api-helpers.js          # API testing utilities
│   │   ├── events-crud-api.spec.js # Event CRUD tests
│   │   └── system-api.spec.js      # System health tests
│   ├── scenarios/                  # User scenario tests
│   └── story-3.3-critical-user-journeys.spec.js  # Critical journeys
├── config/
│   └── environments.js             # Environment configuration
└── shared/
    └── test-data-manager.js        # Test data utilities
```

### Test Categories

| Category | Command | Description |
|----------|---------|-------------|
| **Story 3.3** | `npm run test:story3.3` | Critical user journeys |
| **Smoke** | `npm run test:smoke` | Quick validation |
| **Pages** | `npm run test:pages` | Detailed page tests |
| **Flows** | `npm run test:flows` | User workflow tests |
| **API** | `npm run test:api` | API endpoint tests |
| **Negative** | `npm run test:negative` | Error handling |
| **All E2E** | `npm run test:e2e` | Complete suite |

---

## Running Tests Locally

### Basic Execution

```bash
# Run all Story 3.3 tests
npm run test:story3.3

# Run with verbose output
npm run test:story3.3:verbose

# Run specific journey
npx playwright test story-3.3 -g "Journey 1"
```

### Interactive Mode

```bash
# UI mode for debugging
npx playwright test --ui

# Headed mode (see browser)
npx playwright test --headed

# Debug mode (step through)
npx playwright test --debug
```

### Device Testing

```bash
# Run on specific device
npx playwright test --project="iPhone 14 Pro"
npx playwright test --project="chromium"
```

### Filtering Tests

```bash
# Run by test name pattern
npx playwright test -g "Event Creation"

# Run by file pattern
npx playwright test story-3.3

# Skip slow tests
npx playwright test --grep-invert @slow
```

---

## Running Tests in CI

### GitHub Actions Integration

The tests are designed to run in CI/CD pipelines:

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run E2E Tests
        run: npm run test:story3.3
        env:
          BASE_URL: https://stg.eventangle.com
          ADMIN_KEY: ${{ secrets.ADMIN_KEY }}

      - name: Upload Test Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

### CI Pipeline Stages

```bash
# Stage 1: Local validation (lint, unit, contract)
npm run test:ci:stage1

# Stage 2: Deployed tests (API, E2E smoke)
npm run test:ci:stage2

# Full CI gate
npm run ci:all
```

### CI Configuration

The `playwright.config.js` automatically adjusts for CI:

- **Retries**: 2 retries in CI (0 locally)
- **Workers**: 1 worker in CI (parallel locally)
- **Screenshots**: On failure in CI
- **Video**: Retained on failure in CI
- **Trace**: Retained on failure

---

## Critical User Journeys

Journeys are organized by **event lifecycle phase**:

### PRE-EVENT (Setup & Configuration)

#### Journey 1: Event Creation Flow

**Covers**: Admin creates event via API/UI, event appears in list, Sign-Up Form + QR validation

```
Admin → Create Event → API Validation → Public Page → Poster QR Verification
```

**Test**: `tests/e2e/story-3.3-critical-user-journeys.spec.js`

#### Journey 2: Sponsor Flow

**Covers**: Sponsor configuration, QR codes, analytics reports

```
Configure Sponsors → Display Surface → Poster QR → SharedReport Analytics
```

#### Journey 3: Poster Surface

**Covers**: Poster rendering with QR codes (active = available)

```
Poster Page → QR Codes (when configured) → Print Layout → API Bundle
```

### EVENT (Live Surfaces)

#### Journey 4: Display Surface

**Covers**: TV/Kiosk rendering at 1920x1080

```
Display Page → TV Mode → Sponsor Rotation → API Bundle
```

#### Journey 5: Event Viewing Flow

**Covers**: Public page rendering, CTA visibility (active = available), mobile responsiveness

```
Public Page → Load Event → CTA when signupUrl → Mobile Viewport
```

### POST-EVENT (Analytics)

#### Journey 6: Shared Report

**Covers**: Analytics dashboard rendering

```
Report Page → KPI Display → Mobile Responsiveness
```

### TOOLS (Infrastructure & Validation)

#### Journey 7: Event Management

**Covers**: CRUD operations via API with UI verification

```
Create → Read → Update → Verify UI → Delete → Verify Deletion
```

#### Journey 8: Cross-Surface Integration

**Covers**: Same event renders correctly on all surfaces

```
API Create → Public → Display → Poster → Report
```

#### Journey 9: System Health

**Covers**: API status, system endpoints

```
Status Endpoint → Events List → Main Page Load
```

#### Journey 10: Error Handling

**Covers**: Graceful degradation for errors

```
Non-existent Event → Invalid Auth → Appropriate Errors
```

---

## Test Data Management

### Automatic Cleanup

All tests automatically clean up created resources:

```javascript
test.afterEach(async () => {
  // Cleanup created events
  for (const eventId of createdEventIds) {
    await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
  }
});
```

### Test Data Utilities

```bash
# Seed test data for comprehensive testing
npm run qa:seed

# Cleanup all test data
npm run qa:cleanup

# View test data snapshots
npm run qa:snapshots
```

### Test Accounts

For testing, use the following conventions:

| Purpose | Brand ID | Notes |
|---------|----------|-------|
| General Testing | `root` | Default brand |
| Multi-brand Testing | `abc`, `cbc`, `cbl` | Child brands |
| CI/CD Testing | `root` | Uses `ADMIN_KEY` secret |

### Created Test Data

During test runs, the following data may be created:

| Data Type | Naming Convention | Cleanup |
|-----------|------------------|---------|
| Events | `E2E Test Event {timestamp}` | Auto-deleted |
| Sponsors | `Test Sponsor {timestamp}` | Auto-deleted |

---

## Debugging Failed Tests

### View Test Reports

```bash
# Open HTML report
npm run test:report

# View specific report
npx playwright show-report
```

### Debug Mode

```bash
# Step-through debugging
npx playwright test --debug

# Pause on failure
npx playwright test --headed --timeout=0
```

### Trace Viewer

```bash
# Enable traces
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Timeout errors | Increase timeout in config or test |
| Dialog not handled | Ensure dialog handler is set before navigation |
| Element not found | Check selectors, add explicit waits |
| GAS cold start | First request may be slow, use longer timeout |
| Auth failures | Verify `ADMIN_KEY` is set correctly |

### Console Logging

```javascript
test('debug test', async ({ page }) => {
  // Log console messages
  page.on('console', msg => console.log(msg.text()));

  // Log network requests
  page.on('request', req => console.log(req.url()));
});
```

---

## Test Reports

### HTML Report

Generated automatically after each run:

```bash
# View report
npx playwright show-report

# Report location
./playwright-report/index.html
```

### CI Artifacts

Reports are uploaded as GitHub Actions artifacts:

- `playwright-report/` - HTML report with screenshots
- `.test-results/playwright-results.json` - JSON results
- `.test-results/junit.xml` - JUnit format

### Screenshot Examples

Failed tests automatically capture:

- Screenshot at point of failure
- Full page screenshot
- Video recording (CI only)
- Trace file for debugging

### Test History

```bash
# View test history stats
npm run test:history:stats

# Recent test results
npm run test:history:recent
```

---

## Maintenance

### Updating Tests

When updating tests:

1. Run locally first: `npm run test:story3.3`
2. Check for flakiness: Run 3x with `--repeat-each=3`
3. Verify cleanup: Check no test data remains
4. Update documentation if needed

### Adding New Tests

```javascript
// tests/e2e/my-new-test.spec.js
import { test, expect } from '@playwright/test';
import { ApiHelpers } from './api/api-helpers.js';
import { getBaseUrl } from '../config/environments.js';

test.describe('My New Test Suite', () => {
  let api;
  const createdIds = [];

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, getBaseUrl());
  });

  test.afterEach(async () => {
    // Always cleanup
    for (const id of createdIds) {
      await api.deleteEvent('root', id, process.env.ADMIN_KEY);
    }
  });

  test('my test case', async ({ page }) => {
    // Test implementation
  });
});
```

### Selector Strategy

Prefer stable selectors:

```javascript
// Best: data-testid
page.locator('[data-testid="submit-button"]')

// Good: semantic role
page.locator('button:has-text("Submit")')

// Acceptable: CSS class
page.locator('.submit-btn')

// Avoid: XPath, complex selectors
```

### Timeout Configuration

```javascript
// Global config in playwright.config.js
timeout: 30000,  // Test timeout
expect: { timeout: 10000 },  // Assertion timeout

// Per-test override
test('slow test', async ({ page }) => {
  test.setTimeout(60000);
  // ...
});

// Per-action timeout
await page.click('button', { timeout: 5000 });
```

---

## Quick Reference

### Common Commands

```bash
# Story 3.3 critical journeys
npm run test:story3.3

# All smoke tests
npm run test:smoke

# All E2E tests
npm run test:e2e

# API tests only
npm run test:api

# Specific test file
npx playwright test Admin.spec.js

# Interactive debugging
npx playwright test --ui
```

### Environment Shortcuts

```bash
# Staging (default)
npm run test:story3.3

# Production
npm run test:story3.3:prod

# Verbose output
npm run test:story3.3:verbose
```

### Reporting

```bash
# View HTML report
npx playwright show-report

# Generate JSON results
npx playwright test --reporter=json
```

---

## Related Documentation

- [TESTING.md](./TESTING.md) - Testing strategy overview
- [tests/README.md](../tests/README.md) - Test suite documentation
- [config/environments.js](../config/environments.js) - Environment configuration

---

**Last Updated**: 2025-12-11
**Story**: 3.3 - End-to-End Testing of User Flows (Playwright)
