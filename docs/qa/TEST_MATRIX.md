# Test Matrix

> **Accurate as of November 2025**
>
> This matrix reflects actual tests in the repository. No inflated numbers.

## Test Counts Summary

| Layer | Test Files | Tests | Status |
|-------|------------|-------|--------|
| Unit | 15 | ~512 | ✅ |
| Contract | 12 | ~155 | ✅ |
| E2E | 37+ | varies | ✅ (Playwright) |

---

## Feature Coverage by Test Layer

### Event Creation & Management

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [unit] | `template-service.test.js` | 29 | applyTemplateToEvent_, SectionConfig, CTALabel |
| [contract] | `template-flows.contract.test.js` | 30 | All 5 templates: bar_night, rec_league, school, fundraiser, custom |
| [contract] | `api.contract.test.js` | ~40 | api_create, api_update, api_getPublicBundle |
| [e2e] | `admin-page.spec.js` | varies | Admin UI event CRUD |

### Template System (EVENT_CONTRACT.md v1.0)

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [unit] | `template-service.test.js` | 29 | Template defaults, section/CTA assignment, idempotency |
| [contract] | `template-flows.contract.test.js` | 30 | Bar Night flow, Rec League flow, Fundraiser/School flow, Custom flow |
| [contract] | `api.contract.test.js` | ~15 | EVENT_CONTRACT.md v1.0 compliance (SectionConfig, CTALabel, Sponsor) |

### Sponsor Display

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [unit] | `sponsor-utils.test.js` | 28 | esc() XSS, filterByPlacement(), carousel logic, analytics |
| [contract] | `template-flows.contract.test.js` | 8 | Sponsor rendering across Public/Display/Poster |
| [e2e] | `sponsor-page.spec.js` | varies | Sponsor CRUD UI |

### Public Page

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [contract] | `template-flows.contract.test.js` | 10 | sectionEnabled(), CTA buttons, sponsor badges |
| [e2e] | `public-page.spec.js` | varies | Public event view, responsive |

### Display Page (TV)

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [contract] | `template-flows.contract.test.js` | 6 | Sponsor top/side, league overlay |
| [e2e] | `display-page.spec.js` | varies | Display carousel, sponsor rotation |

### Poster Page

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [contract] | `template-flows.contract.test.js` | 5 | Sponsor strip, QR codes |
| [e2e] | `poster-page.spec.js` | varies | Poster render, print layout |

### Security

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [unit] | `security.test.js` | ~20 | Input validation, XSS prevention |
| [contract] | `jwt-security.contract.test.js` | ~15 | JWT validation, auth flows |
| [e2e] | `security-smoke.spec.js` | varies | Auth smoke tests |

### API Endpoints

| Layer | File | Tests | Coverage |
|-------|------|-------|----------|
| [unit] | `backend.test.js` | ~50 | Core backend functions |
| [contract] | `all-endpoints.contract.test.js` | ~30 | All public API endpoints |
| [e2e] | `api/events-crud-api.spec.js` | varies | Full API integration |

---

## Test Files by Directory

### Unit Tests (`tests/unit/`)

```
template-service.test.js     29 tests - Template application, EVENT_CONTRACT compliance
sponsor-utils.test.js        28 tests - XSS, filtering, analytics
backend.test.js             ~50 tests - Core backend logic
security.test.js            ~20 tests - Security validations
forms.test.js               ~15 tests - Form utilities
validation.test.js          ~15 tests - Input validation
multi-brand.test.js         ~20 tests - Multi-brand logic
config.test.js              ~10 tests - Config utilities
+ 7 more files
```

### Contract Tests (`tests/contract/`)

```
template-flows.contract.test.js    30 tests - Template flow contracts (NEW)
api.contract.test.js              ~40 tests - API contract compliance
jwt-security.contract.test.js     ~15 tests - JWT security contracts
all-endpoints.contract.test.js    ~30 tests - Endpoint contracts
api-client.contract.test.js       ~10 tests - Client contracts
+ triangle/* tests
```

### E2E Tests (`tests/e2e/`)

```
1-smoke/          Critical smoke tests (auth, API, security)
2-pages/          Per-page tests (admin, public, display, poster, sponsor)
3-flows/          User flow tests (admin-flows, customer-flows, template-scenarios)
4-negative/       Negative path tests (missing/invalid event IDs, error handling)
api/              API integration tests
scenarios/        Full user scenarios
```

---

## Running Tests

```bash
# All unit tests
npm test -- tests/unit

# All contract tests
npm test -- tests/contract

# Specific template tests
npm test -- tests/unit/template-service.test.js
npm test -- tests/contract/template-flows.contract.test.js

# E2E (requires Playwright)
npm run test:e2e
```

---

## MVP Surfaces Smoke Tests (Story 3.1)

Happy-path E2E tests for all 5 MVP surfaces: Admin, Public, Display, Poster, SharedReport.

### Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers (chromium is fastest)
npx playwright install chromium
```

### Running Smoke Tests

```bash
# Run all smoke tests against eventangle.com (default)
npm run test:smoke

# Run against direct GAS URL
BASE_URL="https://script.google.com/macros/s/AKfycbx3n9ALDESLEQTgIf47pimbs4zhugPzC4gLLr6aBff6UpH4VzAquYHRVHurP-6QjZ-g/exec" npm run test:smoke

# Run only MVP surface tests
npx playwright test tests/e2e/1-smoke/mvp-surfaces-smoke.spec.js

# Run with UI mode (visual debugging)
npx playwright test tests/e2e/1-smoke/mvp-surfaces-smoke.spec.js --ui

# Run headed (see browser)
npx playwright test tests/e2e/1-smoke/mvp-surfaces-smoke.spec.js --headed

# View test report after run
npx playwright show-report
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_URL` | Target URL for tests | `https://eventangle.com` |
| `ADMIN_KEY` | Admin key for event creation | `CHANGE_ME_root` |
| `BRAND_ID` | Brand to test against | `root` |

### MVP Surface Test Coverage

| Surface | Test File | Verifications |
|---------|-----------|---------------|
| **Admin** | `mvp-surfaces-smoke.spec.js` | Load page → Create event → Verify listing |
| **Public** | `mvp-surfaces-smoke.spec.js` | Load page → Verify title, date, sections |
| **Display** | `mvp-surfaces-smoke.spec.js` | Load page → Verify event title, schedule/placeholder |
| **Poster** | `mvp-surfaces-smoke.spec.js` | Load page → Verify title, date, QR codes |
| **SharedReport** | `mvp-surfaces-smoke.spec.js` | Load page → Verify KPI/metrics cards |

### Expected Output

```
Running 10 tests using 2 workers (5 tests × 2 browsers)
  ✓ MVP Surface: Admin › Admin: Load page, create event, verify listing
  ✓ MVP Surface: Public › Public: Load page, verify title/date/sections
  ✓ MVP Surface: Display › Display: Load page, verify event title...
  ✓ MVP Surface: Poster › Poster: Load page, verify title/date/QR codes
  ✓ MVP Surface: SharedReport › SharedReport: Load page, verify KPI cards
```

---

## Negative Path Tests - Missing/Bad Event IDs

E2E tests verifying all MVP surfaces fail gracefully when event IDs are missing, invalid, or deleted.

### Running Negative Tests

```bash
# Run all negative path tests
npm run test:negative

# Run with headed browser (debugging)
npx playwright test tests/e2e/4-negative --headed

# Run with UI mode (visual debugging)
npx playwright test tests/e2e/4-negative --ui
```

### Test Coverage

| Surface | Scenarios Tested | Assertions |
|---------|------------------|------------|
| **Public** | No ID, nonsense ID, XSS attempt, special chars | No stack traces, no broken layout, sanitized output |
| **Display** | No ID, nonsense ID, SQL injection, unicode | Fallback card shown, no internal errors |
| **Poster** | No ID, nonsense ID, long ID, QR handling | Blank template fallback, no broken images |
| **SharedReport** | No ID, nonsense ID, XSS attempt | Brand-level report or graceful error |

### Security Assertions (All Surfaces)

- No raw stack traces visible to users
- No internal implementation details leaked (SpreadsheetApp, getRange, etc.)
- XSS payloads are sanitized and not reflected
- SQL injection attempts are handled safely
- Error messages are generic and user-friendly

### What Qualifies as "Pass"

1. **HTTP 200** response (GAS always returns 200)
2. **No JavaScript errors** (excluding expected google.script.run in test env)
3. **No internal error patterns** in page content
4. **Layout not broken** (has html/head/body, not empty)
5. **Response time < 15s** (reasonable even with cold starts)

---

## CI Gate Coverage

**Stage 1 (Fast):** Unit + Contract tests
- Event schema validation (SectionConfig, CTALabel, Sponsor)
- Template application correctness
- API contract compliance

**Stage 2 (E2E):** Playwright browser tests
- Admin → Public → Display → Poster flows
- Cross-browser compatibility
- Responsive design

---

## What's NOT Tested (Known Gaps)

- Google Forms integration (external service)
- QR code generation (visual output)
- Real email/SMS delivery
- Production Apps Script runtime

---

*Last updated: November 2025*
