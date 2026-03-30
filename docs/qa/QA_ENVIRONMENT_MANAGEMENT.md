# QA Environment Management (Story 3.5)

This document describes the test environment setup, data management, and stability tracking systems implemented for reliable E2E testing.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [QA Environment Setup Script](#qa-environment-setup-script)
- [Test Data Isolation](#test-data-isolation)
- [Global Setup/Teardown](#global-setupteardown)
- [Error Handling](#error-handling)
- [Stability Tracking](#stability-tracking)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

---

## Overview

Story 3.5 implements graceful test failure handling and environment resets for staging tests, ensuring the test suite remains reliable and doesn't false-fail due to residual data or environment state.

### Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| QA Setup Script | Environment preparation/reset | `scripts/qa-environment-setup.js` |
| Global Setup | Session tracking, health checks | `tests/config/global-setup.js` |
| Global Teardown | Data cleanup after tests | `tests/config/global-teardown.js` |
| Cleanup Fixture | Per-test data tracking | `tests/e2e/test-cleanup-fixture.js` |
| Stability Tracker | Track consecutive passes | `tests/shared/stability-tracker.js` |
| Staging Config | Enhanced timeouts/retries | `playwright.staging.config.js` |

---

## Quick Start

### Run E2E tests with environment preparation

```bash
# Full setup + tests (recommended)
npm run test:staging:prepare && npm run test:staging

# Quick smoke tests
npm run test:smoke

# Check stability status
npm run test:stability:status
```

### Manual environment commands

```bash
# Full environment setup (health check + cleanup + seed)
node scripts/qa-environment-setup.js setup

# Just clean up old test data
node scripts/qa-environment-setup.js cleanup

# Check environment health
node scripts/qa-environment-setup.js health

# Validate environment is ready
node scripts/qa-environment-setup.js validate
```

---

## QA Environment Setup Script

Location: `scripts/qa-environment-setup.js`

### Commands

| Command | Description |
|---------|-------------|
| `setup` | Full setup: health check + cleanup + seed (default) |
| `cleanup` | Remove old test data only |
| `health` | Check environment health only |
| `seed` | Create fresh test data only |
| `reset` | Full reset: cleanup + seed |
| `validate` | Validate environment is ready for tests |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_URL` | Target environment URL | `https://stg.eventangle.com` |
| `ADMIN_KEY` | Admin authentication key | Required for CRUD operations |
| `QA_BRAND_ID` | QA brand identifier | `qa-testing` |
| `MAX_TEST_AGE` | Max age of test data (hours) | `24` |
| `DRY_RUN` | Log actions without executing | `false` |

### Example Usage

```bash
# Production-safe cleanup (dry run)
DRY_RUN=true node scripts/qa-environment-setup.js cleanup

# Setup against a specific environment
BASE_URL="https://stg.eventangle.com" node scripts/qa-environment-setup.js setup

# Cleanup data older than 12 hours
MAX_TEST_AGE=12 node scripts/qa-environment-setup.js cleanup
```

### Output

The script generates a state file at `.test-data/qa-setup-state.json` containing:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "environment": "https://stg.eventangle.com",
  "qaBrand": "qa-testing",
  "health": { "healthy": true, "buildId": "abc123" },
  "cleanup": { "cleaned": 5, "failed": 0 },
  "seed": { "created": [...], "failed": [] },
  "ready": true
}
```

---

## Test Data Isolation

### QA Brand Strategy

All test data is created under a dedicated QA brand (`qa-testing`) to isolate it from real user data.

### Test Data Markers

Test data is identified by these markers:

| Marker Type | Pattern | Example |
|-------------|---------|---------|
| Event Name Prefix | `QA_TEST_` | `QA_TEST_BasicEvent_1705312345678` |
| Session Prefix | `SESSION_` | `SESSION_1705312345_abc123` |
| Description Tag | `[AUTO-GENERATED-TEST-DATA]` | In event description |
| Metadata Key | `_qaTestData: true` | In event object |

### Using the Cleanup Fixture

```javascript
import { test, expect, testCleanup } from '../e2e/test-cleanup-fixture';

test('create and verify event', async ({ page, testCleanup }) => {
  // Create event with automatic tracking
  const event = await testCleanup.createTrackedEvent({
    name: 'My Test Event',
    date: testCleanup.getFutureDate(7),
    venue: 'Test Venue'
  });

  // Event will be automatically cleaned up after test
  expect(event.id).toBeTruthy();
});
```

### Manual Resource Tracking

```javascript
test('manual resource tracking', async ({ page, testCleanup }) => {
  // Manually track resources created via other means
  const eventId = await someExternalCreation();
  testCleanup.trackEvent(eventId, 'External Event');

  // Will be cleaned up after test
});
```

---

## Global Setup/Teardown

### Global Setup (`tests/config/global-setup.js`)

Runs once before all tests:

1. **Generates Session ID**: Unique identifier for this test run
2. **Initializes Tracking**: Creates `.test-data/test-run-tracking.json`
3. **Health Check**: Verifies environment is responding
4. **Graceful Shutdown**: Registers handlers for SIGINT/SIGTERM

### Global Teardown (`tests/config/global-teardown.js`)

Runs once after all tests:

1. **Loads Tracking Data**: Reads resources created during tests
2. **Cleanup Session Data**: Deletes test events by session
3. **Generate Summary**: Writes `.test-data/cleanup-summary.json`
4. **Update History**: Appends to `.test-data/test-run-history.json`

### Environment Variables for Setup/Teardown

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_SESSION_ID` | Session identifier | Auto-generated |
| `CLEANUP_AFTER_TESTS` | Enable/disable cleanup | `true` |
| `QA_BRAND_ID` | QA brand for data | `qa-testing` |
| `WARMUP_BEFORE_TESTS` | Run health check | `true` in CI |

---

## Error Handling

### Timeout Configuration

The staging configuration (`playwright.staging.config.js`) has extended timeouts:

| Setting | Value | Purpose |
|---------|-------|---------|
| Test timeout | 60s | Individual test execution |
| Navigation timeout | 45s | Page loads |
| Action timeout | 15s | Click, fill, etc. |
| Expect timeout | 15s | Assertions |
| Global timeout | 30 min | Entire test run |

### Retry Strategy

| Environment | Retries | Purpose |
|-------------|---------|---------|
| CI | 3 | Handle transient failures |
| Local | 1 | Quick feedback |

### Graceful Shutdown

The test suite handles unexpected termination:

```javascript
// Registered in global-setup.js
process.on('SIGINT', () => {
  // Save tracking state
  // Allow cleanup to run
  // Exit gracefully
});
```

### Test Isolation

Each test runs in isolation with:

- Sequential execution (single worker in staging)
- Independent browser contexts
- Tracked resource cleanup
- No shared state between tests

---

## Stability Tracking

### Goal: 5 Consecutive Green Runs

Story 3.5 requires demonstrating reliability with 5+ consecutive successful pipeline runs.

### Stability Tracker

Location: `tests/shared/stability-tracker.js`

```bash
# Check current status
node tests/shared/stability-tracker.js status

# View streak history
node tests/shared/stability-tracker.js streak

# Full stability report
node tests/shared/stability-tracker.js report

# List flaky tests
node tests/shared/stability-tracker.js flaky

# JSON output for CI
node tests/shared/stability-tracker.js json

# CI gate check (exit 0/1)
node tests/shared/stability-tracker.js ci-check
```

### Stability Metrics

| Metric | Description |
|--------|-------------|
| Current Streak | Consecutive passes from most recent |
| Longest Streak | Historical best |
| Success Rate | Passed/Total ratio |
| Flaky Tests | Tests that pass on retry |
| Stability Score | 0-100 composite score |

### Stability Status Levels

| Level | Streak | Description |
|-------|--------|-------------|
| EXCELLENT | 5+ | Goal achieved |
| GOOD | 3-4 | Near goal |
| FAIR | 1-2 | Making progress |
| NEEDS_ATTENTION | 0 | Investigation needed |

### Example Output

```
============================================================
  TEST STABILITY STATUS (Story 3.5)
============================================================

  Goal: 5 consecutive green runs
  Current Streak: 3 / 5
  Progress: [#########---------------] 60%

  Status: GOOD
  Stability Score: 75/100

  Statistics:
    Total Runs: 25
    Successful: 22
    Failed: 3
    Success Rate: 88.0%
    Longest Streak: 4
    Flaky Tests: 1

  2 more green runs needed to reach goal.

============================================================
```

---

## CI/CD Integration

### Workflow: `e2e-staging-stable.yml`

Triggers:
- Push to `main` (test/src changes)
- Pull requests to `main`
- Manual dispatch

### Pipeline Stages

```
1. Prepare Environment
   - Health check
   - Generate session ID
   - Cleanup old test data

2. API Smoke Tests
   - Run API tests
   - Upload results
   - Fail-fast gate

3. UI Smoke Tests
   - Run UI tests
   - Upload results
   - Upload failure artifacts

4. Full E2E (Optional)
   - Only when requested
   - Uses staging config

5. Cleanup & Stability
   - Clean up session data
   - Update stability metrics
   - Upload stability report

6. Summary
   - Generate markdown summary
   - Record pass/fail status
```

### Required Secrets

| Secret | Purpose |
|--------|---------|
| `ADMIN_KEY` | API authentication |
| `SLACK_WEBHOOK_URL` | Failure notifications (optional) |

### Artifacts Produced

| Artifact | Retention | Contents |
|----------|-----------|----------|
| `api-smoke-results-*` | 14 days | API test reports |
| `ui-smoke-results-*` | 14 days | UI test reports |
| `ui-failure-debug-*` | 30 days | Traces, videos, screenshots |
| `stability-report-*` | 30 days | Stability metrics |

---

## Troubleshooting

### Common Issues

#### Tests failing with "Environment not ready"

```bash
# Check environment health
node scripts/qa-environment-setup.js health

# Verify BASE_URL is correct
echo $BASE_URL
```

#### Test data not being cleaned up

```bash
# Check ADMIN_KEY is set
echo $ADMIN_KEY

# Run manual cleanup
node scripts/qa-environment-setup.js cleanup

# Check cleanup logs
cat .test-data/cleanup-summary.json
```

#### Flaky tests causing streak resets

```bash
# Identify flaky tests
node tests/shared/stability-tracker.js flaky

# Review test in isolation
npx playwright test path/to/test.spec.js --debug
```

#### Tests timing out

```bash
# Use staging config with extended timeouts
npx playwright test --config playwright.staging.config.js

# Check network connectivity
curl -I https://stg.eventangle.com/status
```

### Debug Mode

```bash
# Run with verbose output
VERBOSE=true node scripts/qa-environment-setup.js setup

# Run single test with debug
npx playwright test tests/e2e/1-smoke/status.spec.js --debug

# View traces
npx playwright show-trace test-results/trace.zip
```

### Logs Location

| Log | Location |
|-----|----------|
| Setup state | `.test-data/qa-setup-state.json` |
| Test tracking | `.test-data/test-run-tracking.json` |
| Cleanup summary | `.test-data/cleanup-summary.json` |
| Run history | `.test-data/test-run-history.json` |
| Stability metrics | `.test-data/stability-metrics.json` |
| Test history DB | `.test-results/test-history.json` |

---

## npm Scripts

Add these to `package.json`:

```json
{
  "scripts": {
    "test:staging:prepare": "node scripts/qa-environment-setup.js setup",
    "test:staging": "npx playwright test --config playwright.staging.config.js",
    "test:staging:cleanup": "node scripts/qa-environment-setup.js cleanup",
    "test:stability:status": "node tests/shared/stability-tracker.js status",
    "test:stability:report": "node tests/shared/stability-tracker.js report",
    "test:stability:check": "node tests/shared/stability-tracker.js ci-check"
  }
}
```

---

## Related Documentation

- [TESTING.md](./TESTING.md) - General testing guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment pipeline
- [API_CONTRACT.md](./API_CONTRACT.md) - API documentation

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-15 | Initial Story 3.5 implementation |
