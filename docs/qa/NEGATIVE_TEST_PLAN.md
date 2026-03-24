# Negative Test Plan - Error Handling Validation

**Story 4.4: QA Engineer - Negative Test Cases**

**Version:** 1.0.0
**Last Updated:** 2025-12-11
**Author:** QA Engineering Team

---

## Overview

This document outlines the negative test cases designed to verify the application's behavior under failure conditions. These tests ensure our error handling (implemented in Story 4.3) works correctly and doesn't regress.

## Test Categories

### 1. API Server Errors (HTTP 5xx)

| ID | Scenario | Expected UI Behavior | Priority |
|----|----------|---------------------|----------|
| API-001 | API returns HTTP 500 Internal Server Error | Error banner appears with message "Something went wrong. Please try again." No stack trace shown. | Critical |
| API-002 | API returns HTTP 502 Bad Gateway | Error banner with retry option. User can retry the action. | Critical |
| API-003 | API returns HTTP 503 Service Unavailable | Loading state transitions to error state with retry button. | High |
| API-004 | API returns HTTP 504 Gateway Timeout | Timeout error displayed with suggestion to try again later. | High |

### 2. Network Failures

| ID | Scenario | Expected UI Behavior | Priority |
|----|----------|---------------------|----------|
| NET-001 | Network request times out (>30s) | "Connection timed out" message with retry option. | Critical |
| NET-002 | Complete network failure (offline) | "Unable to connect. Check your internet connection." | Critical |
| NET-003 | Intermittent network (partial failure) | Retry logic kicks in automatically (up to 3 attempts). | High |
| NET-004 | Slow network (3G simulation) | Loading indicator shown, eventually succeeds or shows timeout. | Medium |
| NET-005 | DNS resolution failure | Network error banner without technical details. | High |

### 3. Cloudflare Worker Errors

| ID | Scenario | Expected UI Behavior | Priority |
|----|----------|---------------------|----------|
| CF-001 | X-ErrorType: RATE_LIMITED header | "Too many requests. Please wait and try again." | High |
| CF-002 | X-ErrorType: BAD_INPUT header | "Invalid request. Please check your input." | High |
| CF-003 | X-ErrorType: UNAUTHORIZED header | "Access denied. Please verify your credentials." | High |
| CF-004 | X-ErrorType: NOT_FOUND header | "The requested resource was not found." | Medium |
| CF-005 | Worker returns malformed response | Generic error displayed, no crash. | High |

### 4. Invalid Data Responses

| ID | Scenario | Expected UI Behavior | Priority |
|----|----------|---------------------|----------|
| DATA-001 | API returns malformed JSON | "Unable to process response" error. No JSON parse errors exposed. | Critical |
| DATA-002 | API returns empty response body | Graceful handling with appropriate empty state. | High |
| DATA-003 | API returns unexpected schema | Defensive rendering - missing fields handled gracefully. | High |
| DATA-004 | API returns null values in required fields | UI displays fallback values or placeholder text. | Medium |
| DATA-005 | API returns extremely large payload | No browser freeze. Memory-safe handling. | Medium |
| DATA-006 | Response contains XSS payload | XSS payload is escaped, not executed. | Critical |

### 5. Client-Side Error Recovery

| ID | Scenario | Expected UI Behavior | Priority |
|----|----------|---------------------|----------|
| CLIENT-001 | JavaScript runtime error | Global error handler catches, shows toast, app remains usable. | Critical |
| CLIENT-002 | Unhandled promise rejection | Error logged, user sees toast, no crash. | Critical |
| CLIENT-003 | localStorage unavailable | App functions without persistence features. | Medium |
| CLIENT-004 | Clipboard API blocked | Copy buttons show fallback behavior. | Low |
| CLIENT-005 | Rapid repeated actions (double-submit) | Button disables during processing, only one request sent. | High |

---

## Test Implementation

### Automated Test Files

| File | Coverage |
|------|----------|
| `tests/e2e/4-negative/api-error-responses.spec.js` | API-001 to API-004 |
| `tests/e2e/4-negative/network-failures.spec.js` | NET-001 to NET-005 |
| `tests/e2e/4-negative/cloudflare-worker-errors.spec.js` | CF-001 to CF-005 |
| `tests/e2e/4-negative/invalid-data-handling.spec.js` | DATA-001 to DATA-006 |
| `tests/e2e/4-negative/client-error-recovery.spec.js` | CLIENT-001 to CLIENT-005 |
| `tests/e2e/4-negative/admin-negative-paths.spec.js` | Existing form/auth tests |

### Test Execution

```bash
# Run all negative tests
npm run test:negative

# Run specific category
npx playwright test tests/e2e/4-negative/api-error-responses.spec.js

# Run with UI for debugging
npx playwright test tests/e2e/4-negative/ --ui
```

---

## Acceptance Criteria Validation

### AC1: Design test cases for failure scenarios
- [x] API endpoint returns 500 error
- [x] Network request timeouts
- [x] Cloudflare worker returns error header
- [x] Invalid data received

### AC2: Specify expected UI behavior
- [x] Error banner appears with specific text
- [x] No stack trace shown to user
- [x] Retry options available where appropriate
- [x] App remains usable after error

### AC3: Implement automated tests
- [x] Playwright tests intercept network calls
- [x] Mock various error responses (500, timeout, invalid JSON)
- [x] Assert error UI is displayed correctly
- [x] Verify no internal errors leak to user

### AC4: Application doesn't crash or become unusable
- [x] Test page layout remains intact after errors
- [x] Verify no frozen UI states
- [x] Check recovery/retry functionality works
- [x] Ensure user receives appropriate instructions

### AC5: CI Integration
- [x] Tests run in GitHub Actions Stage-2 workflow
- [x] Failures block deployment
- [x] Test results included in CI reports

**CI Commands:**
```bash
# Run all negative tests
npm run test:negative

# Run as part of E2E smoke suite (includes negative tests)
npm run ci:e2e:smoke

# Run against staging environment
BASE_URL=https://stg.eventangle.com npm run test:negative
```

**GitHub Actions Integration:**
- Negative tests are automatically run via `npm run test:negative` script
- Tests are included in the `ci:e2e:smoke` target
- Failures prevent deployment promotion in Stage-2 workflow

---

## Error Message Standards

### User-Facing Messages

| Error Code | User Message |
|------------|--------------|
| `NETWORK_ERROR` | "Unable to connect. Please check your internet connection and try again." |
| `TIMEOUT` | "The request took too long. Please try again." |
| `INTERNAL` | "Something went wrong. Please try again later." |
| `BAD_INPUT` | "Please check your input and try again." |
| `NOT_FOUND` | "The requested item could not be found." |
| `RATE_LIMITED` | "Too many requests. Please wait a moment and try again." |
| `UNAUTHORIZED` | "Access denied. Please verify your credentials." |

### What Should NEVER Be Shown

- Stack traces
- File paths (e.g., `/src/mvp/Admin.html:123`)
- Internal error codes (e.g., `TypeError: Cannot read property`)
- Database/spreadsheet references
- API keys or tokens
- Technical jargon (e.g., "JSON parse error at position 42")

---

## Test Environment Configuration

### Required Environment Variables

```bash
# Base URL for testing
BASE_URL=https://stg.eventangle.com

# Admin key for authenticated tests
ADMIN_KEY=CHANGE_ME_root

# Brand ID
BRAND_ID=root
```

### Playwright Route Interception Patterns

```javascript
// Mock API 500 error
await page.route('**/api/**', route => route.fulfill({
  status: 500,
  body: JSON.stringify({ ok: false, code: 'INTERNAL', message: 'Server error' })
}));

// Mock network timeout
await page.route('**/api/**', route => route.abort('timedout'));

// Mock Cloudflare error
await page.route('**/api/**', route => route.fulfill({
  status: 429,
  headers: { 'X-ErrorType': 'RATE_LIMITED' },
  body: JSON.stringify({ ok: false, code: 'RATE_LIMITED', message: 'Too many requests' })
}));
```

---

## Test Results Template

### Test Run Summary

| Category | Total | Passed | Failed | Skipped |
|----------|-------|--------|--------|---------|
| API Errors | 4 | - | - | - |
| Network Failures | 5 | - | - | - |
| Cloudflare Errors | 5 | - | - | - |
| Invalid Data | 6 | - | - | - |
| Client Recovery | 5 | - | - | - |
| **TOTAL** | **25** | **-** | **-** | **-** |

### Latest Run
- **Date:** TBD
- **Environment:** Staging
- **Browser:** Chromium 121.0
- **Duration:** TBD
- **Result:** TBD

---

## Maintenance

### Adding New Test Cases

1. Identify the failure scenario
2. Determine expected UI behavior
3. Add entry to appropriate section in this document
4. Implement test in corresponding spec file
5. Run test locally to verify
6. Update test count in Results Template
7. Commit changes

### Test Review Cadence

- **Weekly:** Review test results from CI
- **Sprint:** Update test cases based on new features
- **Release:** Full regression run of negative tests

---

## Related Documentation

- [Error Handling Guide](../support/ERROR_HANDLING_GUIDE.md) - User support documentation
- [GlobalErrorHandler.html](../../src/mvp/GlobalErrorHandler.html) - Implementation
- [API Contract](../../API_CONTRACT.md) - Error response schemas
- [E2E Test Selectors](../../tests/e2e/selectors.js) - UI selectors

---

## Appendix: Internal Error Patterns to Detect

These patterns indicate internal errors that should NEVER appear in user-facing UI:

```javascript
const INTERNAL_ERROR_PATTERNS = [
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /at\s+\w+\s+\(/i,           // Stack trace lines
  /\.gs:\d+/i,                 // Google Apps Script file references
  /\.js:\d+:\d+/i,             // JavaScript file references
  /undefined is not/i,
  /null is not/i,
  /Cannot read propert/i,
  /INTERNAL_ERROR/i,
  /Exception:/i,
  /spreadsheet/i,              // GAS references
  /DriveApp|SpreadsheetApp/i,  // GAS API references
];
```
