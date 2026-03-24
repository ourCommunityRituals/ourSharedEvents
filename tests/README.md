# Test Suite Documentation

## 📂 Reorganized Test Structure

The test suite has been reorganized for better clarity and organization:

```
tests/
├── unit/               # Unit tests for backend logic
├── contract/           # General API contract tests
├── triangle/           # 🔺 Triangle framework (organized by event phase)
│   ├── before-event/   # 📋 Pre-event preparation (Green)
│   ├── during-event/   # ▶️ Live execution (Orange)
│   ├── after-event/    # 📊 Post-event analytics (Purple)
│   └── all-phases/     # ⚡ Always available (Blue)
├── e2e/                # End-to-end tests (Playwright)
├── smoke/              # Smoke tests
├── shared/             # Shared utilities, fixtures, config
└── docs/               # Test documentation
```

**Key Changes:**
- ✅ Tests now organized by event lifecycle phase
- ✅ Triangle framework tests separated by phase
- ✅ Shared utilities consolidated in `shared/`
- ✅ Contract tests include triangle-specific tests
- ✅ CI/CD updated to run all test phases
- ✅ Apps Script deployment excludes all test files

## 📊 Test Coverage Overview

The MVP Event Toolkit has **comprehensive test coverage** across unit, contract, and E2E tests:

```
Total Tests: 260+ tests
├── Unit Tests (Jest): 140 tests
│   ├── backend.test.js: 78 tests
│   ├── sponsor-utils.test.js: 29 tests (XSS, filtering, analytics, carousel)
│   └── shared-utils.test.js: 33 tests (alerts, dates, validation, XSS)
├── Contract Tests (Jest): 48 tests
│   ├── api.contract.test.js: Includes api_getPublicBundle validation
│   └── api-client.contract.test.js: 25 tests (APIClient contracts)
├── Triangle Contract Tests (Jest): 56 tests
│   ├── Before Event: 15 tests
│   ├── During Event: 14 tests
│   ├── After Event: 13 tests
│   └── All Phases: 14 tests
└── E2E Tests (Playwright): 100+ tests
    ├── Authentication: 25+ tests
    ├── API Docs Page: 15+ tests
    ├── Admin Workflows: 10 tests
    ├── Test Page: 8 tests
    ├── Diagnostics Page: 5 tests
    ├── Critical Flows: 12 tests
    ├── Public Page: 15+ tests (sponsor carousel, analytics)
    ├── Poster Page: 20+ tests (layout, QR codes, analytics, print)
    └── Shared Components: 20+ tests (SharedUtils, APIClient integration)
```

---

## 🧪 Test Types

### 1. Unit Tests (Jest)
**Location:** `tests/unit/`

Tests backend utility functions and front-end utilities in isolation:

**backend.test.js** (78 tests):
- Error envelopes (Ok/Err patterns)
- Input sanitization (XSS prevention)
- URL validation
- Schema validation
- Frontend SDK (NU.esc)
- Rate limiting logic
- Slug generation

**sponsor-utils.test.js** (29 tests):
- XSS prevention for sponsor rendering
- Sponsor filtering by placement
- Analytics logging
- Carousel functionality

**shared-utils.test.js** (33 tests):
- Alert/notification system
- Date formatting (formatDate, formatRelativeTime)
- Input validation (isValidEmail, isValidUrl)
- Form validation
- XSS prevention (esc function)
- Utility functions (debounce, throttle)

**Run:**
```bash
npm run test:unit
npm run test:coverage  # With coverage report
```

### 2. Contract Tests (Jest)
**Location:** `tests/contract/`

**api.contract.test.js** - Tests API response contracts for all 11 endpoints:
- `api_status` - Health check
- `api_list` - List events with etag
- `api_get` - Get single event
- `api_create` - Create event
- `api_update` - Update event
- `api_logEvents` - Batch analytics
- `api_getReport` - Analytics report
- `api_createShortlink` - Shortlink generation
- Error codes and formats

**api-client.contract.test.js** (25 tests) - Tests APIClient.html contracts:
- Response envelope validation (Ok/Err patterns)
- Request payload structures for CRUD operations
- API method mapping (create/list/get/update/remove)
- Configuration contracts
- Error object structure

**Run:**
```bash
npm run test:contract
```

### 3. Triangle Contract Tests (Jest)
**Location:** `tests/triangle/*/contract/*.contract.test.js`

Tests organized by the Triangle Framework event lifecycle phases:

#### 📋 Before Event (Green Phase)
Pre-event preparation APIs:
- **Event Creation** (`api_create`) - Create new events with full configuration
- **Shortlink Generation** (`api_createShortlink`) - Generate trackable sponsor links
- **Use Cases**: Event setup, sponsor onboarding, form templates

**Run:**
```bash
npm run test:triangle:before:contract
```

#### ▶️ During Event (Orange Phase)
Live event execution APIs:
- **Event Details** (`api_get`) - Retrieve single event details with links
- **Events List** (`api_list`) - List all events with etag caching
- **Use Cases**: Display screens, public pages, attendee interactions

**Run:**
```bash
npm run test:triangle:during:contract
```

#### 📊 After Event (Purple Phase)
Post-event analytics and reporting APIs:
- **Event Logging** (`api_logEvents`) - Track impressions, clicks, dwell time
- **Analytics Reports** (`api_getReport`) - Aggregate sponsor performance metrics
- **Use Cases**: ROI reports, sponsor insights, event analytics

**Run:**
```bash
npm run test:triangle:after:contract
```

#### ⚡ All Phases (Blue Phase)
Always-available cross-cutting APIs:
- **System Status** (`api_status`) - Health checks, build info, contract version
- **Error Handling** - Consistent error envelopes across all phases
- **Use Cases**: Monitoring, diagnostics, system health

**Run:**
```bash
npm run test:triangle:all:contract
```

**Run All Triangle Tests:**
```bash
# Sequential (default)
npm run test:triangle

# Parallel (faster)
npm run test:triangle:parallel

# Individual phases
npm run test:triangle:before
npm run test:triangle:during
npm run test:triangle:after
npm run test:triangle:all
```

### 4. E2E Tests (Playwright)
**Location:** `tests/e2e/*.spec.js`

Tests complete user workflows on deployed application.

#### BASE_URL Toggle (Single Toggle: GAS vs EventAngle)

All E2E and API tests are **BASE_URL-aware** - the same test suite runs against either GAS exec URL or eventangle.com by changing `BASE_URL`:

```bash
# Test against GAS directly (default in .env.example)
BASE_URL="https://script.google.com/macros/s/XXX/exec" npm run test:smoke

# Test against EventAngle (production via Cloudflare)
BASE_URL="https://www.eventangle.com/events" npm run test:smoke
```

| Environment | BASE_URL | Notes |
|-------------|----------|-------|
| GAS Direct (default) | `https://script.google.com/macros/s/<ID>/exec` | Default in `.env.example` |
| EventAngle Production | `https://www.eventangle.com/events` | Via Cloudflare Workers |
| QA/Staging | `https://qa.zeventbooks.com` | Testing environment |

**Key Points:**
- Default `BASE_URL` in `.env.example` → Apps Script exec URL
- Tests auto-detect environment type (GAS vs Cloudflare)
- No code changes needed to switch targets

Configuration: `tests/config/environments.js`

#### a. Authentication Tests ✨ NEW!
**File:** `tests/e2e/authentication.spec.js`

Tests all three authentication methods:
- **Admin Key (Legacy)** - Secret in request body
  - Create event with admin key
  - Reject invalid admin key
  - Reject missing admin key

- **Bearer Token (JWT)** - Token-based auth
  - Generate JWT token
  - Create event with Bearer token
  - Reject invalid JWT
  - Reject malformed JWT
  - Custom expiration times

- **API Key Header** - X-API-Key header
  - Create event with API key header
  - Reject invalid API key

- **Multi-Method Authentication**
  - All three methods work
  - Token priority over admin key

- **Token Security**
  - Signature validation
  - Brand validation
  - Expiration handling

- **Rate Limiting**
  - Enforce limits across auth methods

- **Public Endpoints**
  - Access without auth
  - Status, list, config endpoints

- **Error Handling**
  - Consistent error format
  - Missing auth headers

**25+ tests covering all authentication scenarios**

#### b. API Docs Page Tests ✨ NEW!
**File:** `tests/e2e/api-docs-page.spec.js`

Tests the interactive API documentation page:
- **Page Load and Structure**
  - Load API docs page
  - Display navigation menu
  - Auto-populate base URL
  - Sticky navigation

- **Navigation**
  - Navigate to sections
  - Highlight active section

- **Authentication Section**
  - Display all 3 auth methods
  - JWT token generation form

- **Endpoints Section**
  - Display public endpoints
  - Display admin endpoints
  - Request/response samples

- **Interactive "Try It Out"**
  - Test status endpoint
  - List events with parameters
  - Generate JWT token
  - Create event
  - Error handling

- **Code Examples**
  - JavaScript examples
  - cURL examples
  - Actual base URL in code

- **Error Handling Section**
  - Error codes table
  - Error envelope format

- **Responsive Design**
  - Mobile-friendly
  - Tablet-friendly

- **Footer Links**
  - Links to other pages
  - Navigation works

- **Performance**
  - Quick load time
  - No console errors

- **Accessibility**
  - Semantic HTML
  - Heading hierarchy
  - Form labels

**40+ tests covering the entire docs page**

#### c. Admin Workflows
**File:** `tests/e2e/admin-workflows.spec.js`

Tests admin dashboard functionality:
- Event creation flow
- Event editing
- Sponsor configuration
- Analytics reports

#### d. Test Page
**File:** `tests/e2e/test-page.spec.js`

Tests the built-in test/diagnostics page:
- Status endpoint health
- Test page loads
- Diagnostics complete

#### e. Diagnostics Page
**File:** `tests/e2e/diagnostics-page.spec.js`

Tests the diagnostics UI:
- Diagnostic UI loads
- Test execution

#### f. Critical Flows
**File:** `tests/e2e/critical-flows.spec.js`

Tests end-to-end user journeys:
- Admin creates event → Public page shows event
- Configure sponsors → Display page shows sponsors
- Security validation
- Performance benchmarks

**Run E2E Tests:**
```bash
# Set environment variables
export BASE_URL="https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec"
export ADMIN_KEY="your_admin_secret"

# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/authentication.spec.js
npx playwright test tests/e2e/api-docs-page.spec.js

# Run with UI
npx playwright test --ui

# Run in headed mode
npx playwright test --headed
```

---

## 🚀 Quick Start

### Run All Tests

```bash
# Unit + Contract tests (Jest)
npm test

# All Playwright tests (requires deployed app)
export BASE_URL="https://your-deployment-url/exec"
export ADMIN_KEY="your-admin-secret"
npm run test:e2e

# Run everything
npm run test:all
```

### Run Specific Test Suites

```bash
# Just authentication tests
npx playwright test tests/e2e/authentication.spec.js

# Just API docs page tests
npx playwright test tests/e2e/api-docs-page.spec.js

# Just admin workflows
npx playwright test tests/e2e/admin-workflows.spec.js

# Filter by test name
npx playwright test -g "should generate JWT token"
```

### Watch Mode

```bash
# Jest tests in watch mode
npm run test:watch

# Playwright UI mode (interactive)
npx playwright test --ui
```

---

## 📋 Test Environment Setup

### Prerequisites

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

### Environment Variables

Required for E2E tests:

```bash
# .env file
BASE_URL=https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
ADMIN_KEY=your_admin_secret_from_Config.gs
```

Or export directly:

```bash
export BASE_URL="https://script.google.com/.../exec"
export ADMIN_KEY="your_secret"
```

### GitHub Actions

Tests run automatically on CI:

```yaml
# .github/workflows/ci.yml
- Lint (ESLint)
- Unit Tests (Jest)
- Contract Tests (Jest)
- Deploy to Apps Script (main branch only)
- E2E Tests (Playwright on deployed URL)
- Quality Gate Check
```

---

## 🧪 Writing New Tests

### Unit Test Example

```javascript
// tests/unit/my-feature.test.js
describe('My Feature', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### E2E Test Example

```javascript
// tests/e2e/my-feature.spec.js
const { test, expect } = require('@playwright/test');

test('should perform action', async ({ page }) => {
  await page.goto(`${BASE_URL}?page=mypage`);
  await page.click('button');
  await expect(page.locator('.result')).toHaveText('Success');
});
```

### API Request Test Example

```javascript
test('should call API', async ({ request }) => {
  const response = await request.post(BASE_URL, {
    data: {
      action: 'myaction',
      adminKey: ADMIN_KEY
    }
  });

  const result = await response.json();
  expect(result.ok).toBe(true);
});
```

---

## 📊 Test Coverage

### Current Coverage

```
Backend Functions: ~90% coverage
├── Error handling: 100%
├── Input validation: 100%
├── URL validation: 100%
├── Schema validation: 100%
├── API endpoints: 100%
└── Authentication: 100% ✨ NEW!

Frontend Pages: ~85% coverage
├── Admin.html: 85%
├── Public.html: 80%
├── Test.html: 100%
├── Diagnostics.html: 100%
└── ApiDocs.html: 95% ✨ NEW!

API Integration: 100%
├── All 11 endpoints: 100%
├── All 3 auth methods: 100% ✨ NEW!
└── Error handling: 100%
```

### Coverage Report

```bash
# Generate coverage report
npm run test:coverage

# View coverage in browser
open coverage/lcov-report/index.html
```

---

## 🐛 Debugging Tests

### Debug Single Test

```bash
# Run test in debug mode
npx playwright test --debug tests/e2e/authentication.spec.js
```

### Headed Mode

```bash
# See browser while tests run
npx playwright test --headed tests/e2e/api-docs-page.spec.js
```

### Trace Viewer

```bash
# Record trace
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

### Console Logs

```javascript
test('debug test', async ({ page }) => {
  page.on('console', msg => console.log(msg.text()));
  await page.goto(BASE_URL);
});
```

---

## 🎯 Test Best Practices

### 1. Isolation
Each test should be independent:
```javascript
// ✅ Good
test('test 1', async () => {
  const data = createTestData();
  // test with data
});

// ❌ Bad - depends on previous test
let sharedData;
test('test 1', async () => { sharedData = ...; });
test('test 2', async () => { use(sharedData); });
```

### 2. Descriptive Names
```javascript
// ✅ Good
test('should generate JWT token with custom expiration', ...)

// ❌ Bad
test('token test', ...)
```

### 3. Arrange-Act-Assert
```javascript
test('should create event', async ({ request }) => {
  // Arrange
  const eventData = { eventName: 'Test' };

  // Act
  const response = await request.post(BASE_URL, { data: eventData });

  // Assert
  expect(response.ok()).toBe(true);
});
```

### 4. Use Test Fixtures
```javascript
// Use Playwright fixtures for common setup
test.use({
  storageState: 'auth.json',
  baseURL: BASE_URL
});
```

---

## 📈 Continuous Improvement

### Adding Tests for New Features

When adding new features:
1. Write unit tests for backend logic
2. Write contract tests for API endpoints
3. Write E2E tests for user workflows
4. Update this README

### Test Maintenance

- Review and update tests when APIs change
- Remove obsolete tests
- Keep test data current
- Monitor test execution time

---

## 🔗 Related Documentation

- [TESTING.md](../docs/TESTING.md) - Testing strategy overview
- [E2E_TESTING_GUIDE.md](../docs/E2E_TESTING_GUIDE.md) - E2E testing guide
- [AUTHENTICATION_GUIDE.md](../docs/AUTHENTICATION_GUIDE.md) - Authentication methods

---

## 📞 Support

### Common Issues

**E2E tests failing:**
- Check BASE_URL is set correctly
- Verify ADMIN_KEY matches Config.gs
- Ensure app is deployed
- Check network connectivity

**Flaky tests:**
- Increase timeouts
- Add explicit waits
- Check for race conditions

**Coverage gaps:**
- Run coverage report
- Identify untested code
- Write targeted tests

---

## 🔗 Additional Resources

- [Triangle Test Organization README](../TRIANGLE_TEST_ORGANIZATION_README.md)
- [Triangle Testing Summary](../TRIANGLE_TESTING_SUMMARY.md)
- [Test Infrastructure Summary](../TEST_INFRASTRUCTURE_SUMMARY.md)
- [Deployment Guide](../DEPLOYMENT-GUIDE.md)

---

**Last Updated:** 2025-11-21
**Total Tests:** 200+
**Test Coverage:** ~90%
**Test Execution Time:** < 3 seconds (Jest), varies (Playwright)
**Structure:** Reorganized by Triangle Framework event phases
