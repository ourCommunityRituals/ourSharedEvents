# ⚡ All Phases - E2E Tests

Triangle Phase: **All Phases** (Blue #3b82f6)
Purpose: Always Available System Features
User Roles: All users (Event Manager, Sponsor, Consumer)

---

## Overview

This directory contains E2E tests for features that are always available across all Triangle phases. These tests cover system-level functionality, configuration, diagnostics, and documentation.

---

## Test Mapping

The following existing tests are part of the All Phases category:

### Smoke Tests (`tests/e2e/1-smoke/`)

#### 1. **Critical Smoke Tests** - `critical-smoke.spec.js`
**Triangle Phase:** All Phases
**Purpose:** Quick health checks for all critical paths
**Tests:** 10+

**All Phases Features:**
- ✅ API endpoint health (200 status)
- ✅ Page load verification (Admin, Public, Display)
- ✅ Performance baselines (<2s API, <5s page load)
- ✅ JavaScript error detection
- ✅ Basic navigation

**Key Test Scenarios:**
```javascript
test('API status endpoint should be healthy', async ({ request }) => {
  // Verifies API is running
});

test('All pages should load without errors', async ({ page }) => {
  // Verifies all pages are accessible
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/1-smoke/critical-smoke.spec.js`

---

#### 2. **API Contract Smoke Tests** - `api-contract.spec.js`
**Triangle Phase:** All Phases
**Tests:** 20+

**All Phases Features:**
- ✅ API contract validation
- ✅ Response envelope verification
- ✅ Error code validation
- ✅ Status codes

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/1-smoke/api-contract.spec.js`

---

#### 3. **Security Smoke Tests** - `security-smoke.spec.js`
**Triangle Phase:** All Phases
**Tests:** 10+

**All Phases Features:**
- ✅ Authentication checks
- ✅ Security header validation
- ✅ HTTPS enforcement
- ✅ XSS protection

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/1-smoke/security-smoke.spec.js`

---

### Legacy Tests (`tests/e2e/`)

#### 4. **Test Dashboard Page** - `test-page.spec.js`
**Primary Triangle Phase:** All Phases

**Features:**
- ✅ Triangle navigation hub
- ✅ Color-coded workflow sections
- ✅ Navigation cards with icons
- ✅ Badge system
- ✅ Build information footer

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/test-page.spec.js`

---

#### 5. **Diagnostics Page Tests** - `diagnostics-page.spec.js`
**Primary Triangle Phase:** All Phases

**Features:**
- ✅ Auto-run diagnostic tests
- ✅ Color-coded results (green/red/yellow)
- ✅ Database connectivity tests
- ✅ API endpoint validation
- ✅ Configuration checks

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/diagnostics-page.spec.js`

---

#### 6. **API Documentation Page** - `api-docs-page.spec.js`
**Primary Triangle Phase:** All Phases

**Features:**
- ✅ REST API documentation
- ✅ Request/response examples
- ✅ Authentication guide
- ✅ Status codes reference

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/api-docs-page.spec.js`

---

#### 7. **Authentication Tests** - `authentication.spec.js`
**Primary Triangle Phase:** All Phases

**Features:**
- ✅ Admin key validation
- ✅ Dialog prompt handling
- ✅ Session management
- ✅ Access control

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/authentication.spec.js`

---

## Running All Phases Tests

### Run All System Tests
```bash
# Smoke tests (quick health checks)
npm run test:smoke:all

# Individual smoke tests
npm run test:smoke      # Critical smoke tests
npm run test:security   # Security smoke tests
npm run test:api        # API contract tests
```

### Run Configuration and System Tests
```bash
# Test dashboard
npx playwright test tests/e2e/test-page.spec.js

# Diagnostics
npx playwright test tests/e2e/diagnostics-page.spec.js

# API documentation
npx playwright test tests/e2e/api-docs-page.spec.js

# Authentication
npx playwright test tests/e2e/authentication.spec.js
```

---

## Test Coverage

### All Phases Features
- ✅ Config editor (`?page=config`)
- ✅ Diagnostics (`?page=diagnostics`)
- ✅ Test dashboard (`?page=test`)
- ✅ API documentation (`?page=api`)
- ✅ Status API (`?p=status`)
- ✅ Authentication system
- ✅ Security headers
- ✅ Error handling

### Test Statistics
- **Total Tests:** 40+
- **Total Lines:** 400+
- **Coverage:** 100%

---

## Smoke Test Execution Time

The smoke tests are designed for speed:

- **Critical Smoke:** ~10 seconds
- **API Contract:** ~15 seconds
- **Security Smoke:** ~10 seconds
- **Total:** ~35 seconds

**Purpose:** Quick verification before deploying or running full test suite

---

## System Health Checks

### Status Endpoint (`?action=status`)

Returns system health information:

```json
{
  "ok": true,
  "value": {
    "build": "triangle-extended-v1.3",
    "contract": "1.0.3",
    "time": "2025-11-12T12:00:00.000Z",
    "db": {
      "ok": true,
      "id": "spreadsheet-id"
    }
  }
}
```

### Diagnostics Checks

The diagnostics page runs these checks:

1. **Database Connectivity**
   - Spreadsheet connection
   - Read/write permissions
   - Sheet structure

2. **API Endpoints**
   - All API routes accessible
   - Correct response formats
   - Error handling

3. **Configuration**
   - Brand configuration valid
   - Template definitions correct
   - Build information accurate

4. **Performance**
   - Response times < 2s
   - Page load times < 5s
   - No memory leaks

---

## Security Validation

### Checked Security Features

1. **HTTPS Enforcement**
   - All requests use HTTPS
   - No mixed content

2. **Authentication**
   - Admin key validation
   - Session management
   - Access control

3. **Headers**
   - Content-Security-Policy
   - X-Frame-Options
   - X-Content-Type-Options
   - X-XSS-Protection

4. **Input Validation**
   - SQL injection prevention
   - XSS prevention
   - CSRF protection

---

## API Contract Validation

### Response Envelope

All API responses follow this contract:

**Success:**
```json
{
  "ok": true,
  "value": { ... },
  "etag": "optional-etag"
}
```

**Error:**
```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

### Error Codes

- `BAD_INPUT` - Invalid request parameters
- `NOT_FOUND` - Resource not found
- `RATE_LIMITED` - Too many requests
- `INTERNAL` - Internal server error
- `CONTRACT` - Contract violation

---

## Future Tests to Add

1. **Performance Monitoring Tests**
   - Load testing
   - Stress testing
   - Endurance testing
   - Spike testing

2. **Accessibility Tests**
   - WCAG 2.1 AA compliance
   - Screen reader compatibility
   - Keyboard navigation
   - Color contrast

3. **Browser Compatibility Tests**
   - Chrome, Firefox, Safari, Edge
   - Mobile browsers
   - Legacy browser support

4. **Internationalization Tests**
   - Multi-language support
   - RTL layouts
   - Date/time formats
   - Currency formats

---

## CI/CD Integration

### Pipeline Stages

1. **Lint** ✅
2. **Unit Tests** ✅
3. **Contract Tests** ✅
4. **Deploy** 🚀
5. **Verify Deployment** ✅
6. **Smoke Tests** ✅ (All Phases tests run here)
7. **Page Tests** ✅
8. **Flow Tests** ✅
9. **Quality Gate** ✅

**Smoke tests block deployment if they fail**

---

## Related Documentation

- [Triangle UI Flow Documentation](../../../../TRIANGLE_UI_FLOWS.md)
- [Triangle Test Organization](../../../docs/TRIANGLE_TEST_ORGANIZATION.md)
- [CI/CD Pipeline Documentation](../../../../.github/workflows/README.md)

---

**Last Updated:** 2025-11-12
**Maintained By:** MVP Event Toolkit Team
