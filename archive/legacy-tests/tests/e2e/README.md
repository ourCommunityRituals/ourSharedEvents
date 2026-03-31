# E2E Test Organization

This directory contains comprehensive end-to-end tests organized by test level and purpose.

## Test Hierarchy

Tests are organized in **three levels** that run sequentially:

### 1. 🚨 Smoke Tests (Level 1)

**Location:** `tests/e2e/1-smoke/`
**Run Time:** < 30 seconds
**Purpose:** Quick health checks to verify system is alive

**What they test:**

- Critical API endpoints respond (200 status)
- Health check passes
- Basic page loads (Admin, Public, Display)
- No JavaScript errors on load
- Performance baselines (< 2s API, < 5s page load)

**When to run:**

- Every deployment
- Every commit to main
- Before running other test suites
- As a pre-check before manual testing

**Run command:**

```bash
npm run test:smoke
```

---

### 2. 📄 Page Tests (Level 2)

**Location:** `tests/e2e/2-pages/`
**Run Time:** 2-5 minutes
**Purpose:** Test all page components and interactions

**What they test:**

- **Admin Page** (`admin-page.spec.js`)
  - All form inputs render and accept data
  - Submit button works
  - Configure Display & Sponsors button
  - Add/Remove Sponsor buttons
  - Save Configuration button
  - Navigation links work
  - Form validation
  - Responsive design
  - Keyboard accessibility

- **Public Page** (`public-page.spec.js`)
  - Events list loads
  - Event cards are clickable
  - Event detail view
  - Sponsor displays and links
  - Search and filter functionality
  - Share buttons
  - Calendar integration
  - Mobile responsiveness
  - Accessibility

- **Display Page** (`display-page.spec.js`)
  - TV layout renders correctly
  - Sponsor areas (top, bottom, left, right)
  - Carousel controls (next, prev, pause/play)
  - Event information display
  - Full screen mode
  - QR code display
  - Responsive layouts (mobile, tablet, TV, 4K)
  - Performance (no memory leaks)

**When to run:**

- After smoke tests pass
- Before deploying major UI changes
- Daily regression testing

**Run command:**

```bash
npm run test:pages
```

---

### 3. 🔄 Flow Tests (Level 3)

**Location:** `tests/e2e/3-flows/`
**Run Time:** 5-15 minutes
**Purpose:** Test complete end-to-end user journeys

**What they test:**

- **Admin Flows** (`admin-flows.spec.js`)
  - Complete event creation → publish workflow
  - Event creation → verification on public page
  - Configure sponsors → verify on display
  - Add multiple sponsors → reorder → save
  - Multi-event management
  - Event publishing workflow (draft → configure → publish → monitor)
  - Error handling (invalid admin key, missing fields)
  - Bulk operations

- **Customer Flows** (`customer-flows.spec.js`)
  - Event discovery (land → browse → view details)
  - Search events → filter → view results
  - Browse by date → calendar view
  - View event → read details → click sponsor
  - Share event on social media
  - Add event to calendar → download ICS
  - Mobile user experience (portrait, landscape)
  - Accessibility journey (keyboard-only, screen reader)
  - Performance journey (slow connection)
  - Returning visitor experience

- **Sponsor Flows** (`sponsor-flows.spec.js`)
  - Configure sponsors → view on TV display → verify visibility
  - Multiple sponsor tiers → display order → rotation
  - Click tracking and analytics
  - Carousel auto-rotation and manual controls
  - Mobile banner display
  - Multi-position display (top, bottom, left, right, mobile)
  - Performance and loading (many sponsors, lazy loading)

**When to run:**

- After page tests pass
- Before major releases
- Weekly comprehensive testing
- After significant feature changes

**Run command:**

```bash
npm run test:flows
```

---

## Running Tests

### Sequential (Recommended for CI/CD)

Runs tests in order: smoke → pages → flows

```bash
npm run test:e2e
```

### Parallel (Faster, but less organized)

Runs all E2E tests simultaneously

```bash
npm run test:e2e:parallel
```

### Individual Test Levels

```bash
npm run test:smoke    # Smoke tests only (~30s)
npm run test:pages    # Page tests only (~2-5min)
npm run test:flows    # Flow tests only (~5-15min)
```

### Quick Validation

Run Jest unit tests + smoke tests for rapid feedback

```bash
npm run test:quick
```

### Full Test Suite

Run everything: unit, contract, smoke, pages, flows

```bash
npm run test:all
```

---

## Test Organization Benefits

### 1. **Fast Feedback Loop**

- Smoke tests fail fast (30s) if something is critically broken
- No need to run 15-minute flow tests if basic health checks fail

### 2. **Clear Test Reports**

- CI/CD shows three distinct test stages
- Easy to identify which level failed: smoke, page, or flow
- Test.html dashboard groups tests visually

### 3. **Efficient Debugging**

- If smoke tests pass but page tests fail → UI component issue
- If page tests pass but flow tests fail → integration/logic issue
- Clear separation reduces debugging time

### 4. **Parallel Development**

- Different teams can work on different test levels
- Frontend devs focus on page tests
- QA engineers focus on flow tests
- DevOps focus on smoke tests

### 5. **Performance Tracking**

- Track performance trends by test level
- Smoke tests measure API/page load performance
- Flow tests measure end-to-end transaction time

---

## Test Reporting

### Test.html Dashboard

Access the visual test dashboard at:

```
https://your-deployment-url.com?page=test&brand=root
```

The dashboard shows:

- Test summary cards (smoke, pages, flows, passed, failed)
- Collapsible test groups with color coding
- Individual test results with timing
- Auto-runs tests on page load
- Manual "Run All Tests" button

### CI/CD Reports

After each deployment, GitHub Actions generates:

- `smoke-test-report/` - Smoke test HTML report
- `page-test-report/` - Page test HTML report
- `flow-test-report/` - Flow test HTML report

Download from GitHub Actions artifacts.

---

## Adding New Tests

### Adding a Smoke Test

```javascript
// tests/e2e/1-smoke/critical-smoke.spec.js
test('New critical check', async ({ page }) => {
  // Quick health check (< 5 seconds)
});
```

### Adding a Page Test

```javascript
// tests/e2e/2-pages/your-page.spec.js
test.describe('📄 PAGE: YourPage - Button Tests', () => {
  test('Button X is clickable', async ({ page }) => {
    // Test button interaction
  });
});
```

### Adding a Flow Test

```javascript
// tests/e2e/3-flows/your-flow.spec.js
test.describe('🔄 FLOW: Your User Journey', () => {
  test('Complete flow: Step 1 → Step 2 → Step 3', async ({ page }) => {
    // Test complete user journey
  });
});
```

## 🔺 TRIANGLE Framework Tests

**Special comprehensive tests that exercise the complete TRIANGLE framework:**

### **triangle-framework.spec.js** - Cross-Page Data Propagation

Tests the complete lifecycle: **Sponsor → Admin → Poster → Display → Public**

**Coverage:**

- ✅ Sponsor setup and propagation to all pages
- ✅ Admin changes flowing to Poster, Display, Public
- ✅ All Admin.html cards (Create Event, Event Card, Configure Sponsors, Events List)
- ✅ Complete Display.html features
- ✅ Complete Public.html features (desktop + mobile)
- ✅ Shared reporting between Admin and Sponsors
- ✅ Event updates propagating across all pages

### **advanced-display-features.spec.js** - Deep Display Testing

Tests all advanced Display.html features:

**Coverage:**

- ✅ Dynamic URLs with variable timing
- ✅ Admin Notes window updates
- ✅ iframe handling (skip on error, no missed beat)
- ✅ YouTube video streaming support
- ✅ Vimeo video streaming support
- ✅ Multiple language support (English, Spanish, French, German)
- ✅ Sponsor banner positioning (top, bottom, left, right)
- ✅ No sponsor = slide up behavior
- ✅ 10-12ft viewing optimization
- ✅ 4K display support (3840x2160)

### **poster-maps-integration.spec.js** - Poster & Maps

Tests Poster editing and Google Maps integration:

**Coverage:**

- ✅ Poster view and edit functionality
- ✅ Poster changes syncing back to Admin
- ✅ Print-optimized poster layout
- ✅ Google Maps embedding on Public pages
- ✅ Mobile responsive maps
- ✅ Directions link integration
- ✅ Complete propagation cycle: Admin → Poster → Display → Public

**Total TRIANGLE Tests: 75+ comprehensive integration tests!**

---

## Best Practices

### Smoke Tests ✅

- ✅ Test critical endpoints
- ✅ Keep under 30 seconds total
- ✅ No complex interactions
- ✅ Fail fast on critical issues
- ❌ No full user journeys
- ❌ No extensive data validation

### Page Tests ✅

- ✅ Test all buttons and forms
- ✅ Verify UI components render
- ✅ Check responsive design
- ✅ Test keyboard navigation
- ❌ No complex workflows
- ❌ No multi-page journeys

### Flow Tests ✅

- ✅ Test complete user journeys
- ✅ Verify end-to-end functionality
- ✅ Test edge cases and error handling
- ✅ Simulate real user behavior
- ❌ No micro-level UI testing (use page tests)
- ❌ No basic health checks (use smoke tests)

---

## Environment Variables

### BASE_URL-Aware Testing

All E2E and API tests are **BASE_URL-aware** - they work against any deployment:

```bash
# Run against eventangle.com (default - no BASE_URL needed)
npm run test:smoke

# Run against production (eventangle.com)
BASE_URL="https://www.eventangle.com" npm run test:smoke

# Run against GAS webapp directly
BASE_URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" npm run test:smoke

# Run against staging/QA
BASE_URL="https://staging.zeventbooks.com" npm run test:smoke
```

### Configuration

| Variable    | Required              | Default                  | Description              |
| ----------- | --------------------- | ------------------------ | ------------------------ |
| `BASE_URL`  | No                    | `https://eventangle.com` | Target deployment URL    |
| `ADMIN_KEY` | Yes (for admin tests) | -                        | Admin authentication key |
| `BRAND_ID`  | No                    | `root`                   | Default brand ID         |

### URL Configuration File

All tests use the centralized config at `tests/config/environments.js`:

```javascript
const { getBaseUrl, isGoogleAppsScript, isEventangle } = require('../config/environments');

// Get the base URL (respects BASE_URL env var, defaults to eventangle.com)
const BASE_URL = getBaseUrl();

// Check environment type
if (isGoogleAppsScript()) {
  // GAS-specific behavior
} else if (isEventangle()) {
  // Production-specific behavior
}
```

Set in CI/CD:

- GitHub Secrets: `ADMIN_KEY_ROOT`
- Deployment output: `BASE_URL` (from clasp deploy)

---

## Troubleshooting

### Tests fail locally but pass in CI

- Check `BASE_URL` environment variable
- Ensure local deployment is up-to-date
- Verify admin key is correct

### Smoke tests pass, but page tests fail

- UI component issue
- Check browser console for errors
- Verify selectors match actual HTML

### Page tests pass, but flow tests fail

- Integration issue between components
- Check API responses
- Verify data persistence

### All tests timeout

- Check `BASE_URL` is accessible
- Verify Apps Script deployment is live
- Check network connectivity

---

## Test Metrics

Track these metrics over time:

- **Smoke Test Duration:** Should stay under 30s
- **Page Test Duration:** Should stay under 5min
- **Flow Test Duration:** Should stay under 15min
- **Pass Rate:** Target 95%+ passing
- **Flakiness:** Target < 2% flaky tests

---

## Related Documentation

- [E2E Testing Guide](../../E2E_TESTING_GUIDE.md)
- [Testing Overview](../../TESTING.md)
- [Playwright Config](../../playwright.config.js)
- [CI/CD Workflow](../../.github/workflows/ci.yml)
