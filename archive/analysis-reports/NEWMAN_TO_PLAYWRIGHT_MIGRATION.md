# Newman to Playwright Migration Plan
## Investment in Playwright Flow & Page Automation

**Date:** 2025-11-14
**Branch:** `claude/hostinger-urls-deployment-testing-01RrnZbGJa6kiryxB2wCt29J`
**Status:** Implementation Ready

---

## 🎯 Migration Goals

### Why Remove Newman?
1. **Simplified Tech Stack:** One tool (Playwright) instead of two (Playwright + Newman)
2. **Better Integration:** API tests integrated with E2E flows
3. **Shared Context:** API responses can drive UI tests in same test
4. **Modern Tooling:** Playwright's API testing is more powerful
5. **Reduced Maintenance:** One test framework to maintain
6. **Faster Iteration:** No context switching between Postman/Newman and Playwright

### Investment Focus
1. **Playwright API Testing:** Replace all Newman API tests with Playwright
2. **Comprehensive Flow Tests:** Expand event triangle flows
3. **Page Automation:** Deep coverage of all 13 page types
4. **Multi-brand Testing:** Test all 4 brands systematically

---

## 📊 Current Newman Test Coverage

### Newman Tests to Migrate

**System Tests (System folder):**
- Status check (`?p=status&brand=root`)
- Diagnostics (`?action=runDiagnostics`)

**Event CRUD Tests:**
- Create event (`?action=create`)
- Get event (`?action=get`)
- List events (`?action=list`)
- Update event (`?action=update`)
- Delete event (`?action=delete`)

**Sponsor CRUD Tests:**
- Create sponsor
- Get sponsor
- List sponsors
- Update sponsor
- Delete sponsor

**Triangle Tests:**
- Before event APIs (postman/before-event-apis.postman_collection.json)
- During event APIs (postman/during-event-apis.postman_collection.json)
- After event APIs (postman/after-event-apis.postman_collection.json)
- All phases APIs (postman/all-phases-apis.postman_collection.json)

**Forms & Templates:**
- Form validation
- Template rendering

---

## ✅ Migration Strategy

### Phase 1: Expand Playwright API Testing
**Target:** `tests/e2e/api/` (new directory)

Create comprehensive API test suites in Playwright:
```
tests/e2e/api/
├─ system-api.spec.js          (Status, diagnostics)
├─ events-crud-api.spec.js     (Event CRUD operations)
├─ sponsors-crud-api.spec.js   (Sponsor CRUD operations)
├─ multi-brand-api.spec.js    (Cross-brand isolation)
└─ api-helpers.js              (Shared API utilities)
```

### Phase 2: Expand Flow Tests
**Target:** `tests/e2e/3-flows/` (expand existing)

Add comprehensive event triangle flows:
```
tests/e2e/3-flows/
├─ admin-flows.spec.js            ✅ Existing - Expand
├─ customer-flows.spec.js         ✅ Existing - Expand
├─ sponsor-flows.spec.js          ✅ Existing - Expand
├─ triangle-framework.spec.js     ✅ Existing - Expand
├─ event-lifecycle-flow.spec.js   🆕 New - Full lifecycle
├─ multi-brand-flows.spec.js     🆕 New - Cross-brand
├─ api-to-ui-flows.spec.js        🆕 New - API → UI validation
└─ error-handling-flows.spec.js   🆕 New - Error scenarios
```

### Phase 3: Expand Page Tests
**Target:** `tests/e2e/2-pages/` (expand existing)

Deep coverage of all page types:
```
tests/e2e/2-pages/
├─ admin-page.spec.js             ✅ Existing - Expand
├─ public-page.spec.js            ✅ Existing - Expand
├─ display-page.spec.js           ✅ Existing - Expand
├─ wizard-page.spec.js            🆕 New - Admin wizard
├─ poster-page.spec.js            🆕 New - QR codes
├─ signup-page.spec.js            🆕 New - Registration
├─ report-page.spec.js            🆕 New - Analytics
├─ diagnostics-page.spec.js       ✅ Existing - Expand
└─ api-docs-page.spec.js          ✅ Existing - Expand
```

### Phase 4: Remove Newman
1. Remove Newman dependencies from `package.json`
2. Remove Newman scripts from `package.json`
3. Remove Newman from Stage 2 workflow
4. Archive Postman collections (keep for reference)
5. Update documentation

---

## 🔧 Implementation Details

### 1. Playwright API Testing Pattern

**Example: System API Tests**
```javascript
// tests/e2e/api/system-api.spec.js
import { test, expect } from '@playwright/test';
import { ApiHelpers } from './api-helpers';

test.describe('System APIs', () => {
  let api;

  test.beforeEach(async ({ request }) => {
    api = new ApiHelpers(request, process.env.BASE_URL);
  });

  test('Status endpoint returns correct structure', async () => {
    const response = await api.get('?p=status&brand=root');

    // Verify response
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.value).toHaveProperty('build');
    expect(data.value).toHaveProperty('brand', 'root');
  });

  test('Diagnostics requires admin key', async () => {
    // Without admin key - should fail
    const responseNoAuth = await api.post('?action=runDiagnostics', {
      brandId: 'root'
    });
    expect(responseNoAuth.ok()).toBe(false);

    // With admin key - should pass
    const responseAuth = await api.post('?action=runDiagnostics', {
      brandId: 'root',
      adminKey: process.env.ADMIN_KEY
    });
    expect(responseAuth.ok()).toBe(true);
  });
});
```

### 2. API Helper Utilities

**Example: API Helpers**
```javascript
// tests/e2e/api/api-helpers.js
export class ApiHelpers {
  constructor(request, baseUrl) {
    this.request = request;
    this.baseUrl = baseUrl;
  }

  async get(path, options = {}) {
    return await this.request.get(`${this.baseUrl}${path}`, options);
  }

  async post(path, data, options = {}) {
    return await this.request.post(`${this.baseUrl}${path}`, {
      data,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
  }

  async createEvent(brand, eventData, adminKey) {
    return await this.post('?action=create', {
      brandId: brand,
      scope: 'events',
      templateId: 'event',
      adminKey,
      data: eventData
    });
  }

  async listEvents(brand) {
    return await this.get(`?p=api&action=list&brandId=${brand}&scope=events`);
  }

  // Add more helper methods for common API operations
}
```

### 3. API-to-UI Flow Tests

**Example: Combined API + UI Testing**
```javascript
// tests/e2e/3-flows/api-to-ui-flows.spec.js
import { test, expect } from '@playwright/test';
import { ApiHelpers } from '../api/api-helpers';

test.describe('API to UI Flows', () => {
  test('Create event via API, verify in UI', async ({ page, request }) => {
    const api = new ApiHelpers(request, process.env.BASE_URL);

    // Step 1: Create event via API
    const createResponse = await api.createEvent('root', {
      name: 'API Test Event',
      dateISO: '2025-12-01',
      location: 'Test Venue'
    }, process.env.ADMIN_KEY);

    const eventData = await createResponse.json();
    expect(eventData.ok).toBe(true);
    const eventId = eventData.value.id;

    // Step 2: Verify event appears in UI
    await page.goto(`${process.env.BASE_URL}?p=events&brand=root`);

    // Should see the event in the list
    await expect(page.locator(`[data-event-id="${eventId}"]`)).toBeVisible();
    await expect(page.locator(`[data-event-id="${eventId}"]`)).toContainText('API Test Event');

    // Step 3: Click through to event details
    await page.click(`[data-event-id="${eventId}"]`);
    await expect(page.locator('.event-location')).toContainText('Test Venue');

    // Step 4: Clean up via API
    await api.post('?action=delete', {
      brandId: 'root',
      scope: 'events',
      id: eventId,
      adminKey: process.env.ADMIN_KEY
    });
  });
});
```

### 4. Multi-brand Flow Tests

**Example: Cross-Brand Isolation**
```javascript
// tests/e2e/3-flows/multi-brand-flows.spec.js
import { test, expect } from '@playwright/test';
import { ApiHelpers } from '../api/api-helpers';

const BRANDS = ['root', 'abc', 'cbc', 'cbl'];

test.describe('Multi-brand Flows', () => {
  BRANDS.forEach(brand => {
    test(`${brand}: Create event and verify isolation`, async ({ page, request }) => {
      const api = new ApiHelpers(request, process.env.BASE_URL);

      // Create event for this brand
      const createResponse = await api.createEvent(brand, {
        name: `${brand.toUpperCase()} Event`,
        dateISO: '2025-12-15',
        location: `${brand} Venue`
      }, process.env[`ADMIN_KEY_${brand.toUpperCase()}`]);

      const eventData = await createResponse.json();
      const eventId = eventData.value.id;

      // Verify event appears in this brand's view
      await page.goto(`${process.env.BASE_URL}?p=events&brand=${brand}`);
      await expect(page.locator(`[data-event-id="${eventId}"]`)).toBeVisible();

      // Verify event does NOT appear in other brands' views
      for (const otherBrand of BRANDS) {
        if (otherBrand === brand) continue;

        await page.goto(`${process.env.BASE_URL}?p=events&brand=${otherBrand}`);
        await expect(page.locator(`[data-event-id="${eventId}"]`)).not.toBeVisible();
      }
    });
  });
});
```

### 5. Event Lifecycle Flow Test

**Example: Complete Event Lifecycle**
```javascript
// tests/e2e/3-flows/event-lifecycle-flow.spec.js
import { test, expect } from '@playwright/test';

test.describe('Event Lifecycle Flow', () => {
  test('Complete event lifecycle: Create → Display → Signup → Report', async ({ page, request }) => {
    const api = new ApiHelpers(request, process.env.BASE_URL);
    let eventId;

    // PHASE 1: Pre-Event (Admin creates event)
    test.step('Admin creates event with sponsors', async () => {
      await page.goto(`${process.env.BASE_URL}?p=wizard&brand=root`);
      await page.fill('[name="eventName"]', 'Lifecycle Test Event');
      await page.fill('[name="eventDate"]', '2025-12-20');
      await page.fill('[name="location"]', 'Test Venue');

      // Add sponsors
      await page.click('button:has-text("Add Sponsor")');
      await page.selectOption('[name="sponsorId"]', 'abc');

      // Create event
      await page.click('button:has-text("Create Event")');
      await page.waitForSelector('.success-message');

      // Extract event ID from success message or URL
      const url = page.url();
      eventId = new URL(url).searchParams.get('id');
    });

    // PHASE 2: During Event (Customer views and signs up)
    test.step('Customer views event on mobile', async () => {
      // Switch to mobile context
      await page.setViewportSize({ width: 375, height: 667 });

      await page.goto(`${process.env.BASE_URL}?p=events&brand=root&event=${eventId}`);

      // Verify event details visible
      await expect(page.locator('.event-name')).toContainText('Lifecycle Test Event');
      await expect(page.locator('.event-location')).toContainText('Test Venue');

      // Verify sponsor logos visible
      await expect(page.locator('[data-sponsor-logo]')).toBeVisible();
    });

    test.step('Display page shows event for TV', async () => {
      // Switch to TV display size
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.goto(`${process.env.BASE_URL}?p=display&brand=root`);

      // Verify event appears in display
      await expect(page.locator(`[data-event-id="${eventId}"]`)).toBeVisible();

      // Verify auto-refresh (wait 31 seconds)
      await page.waitForTimeout(31000);
      // Content should still be visible (auto-refreshed)
    });

    test.step('Customer signs up for event', async () => {
      await page.goto(`${process.env.BASE_URL}?p=signup&brand=root&event=${eventId}`);

      // Fill signup form
      await page.fill('[name="name"]', 'Test Customer');
      await page.fill('[name="email"]', 'test@example.com');
      await page.click('button:has-text("Sign Up")');

      await page.waitForSelector('.success-message');
    });

    // PHASE 3: Post-Event (Admin views analytics)
    test.step('Admin views event report', async () => {
      await page.goto(`${process.env.BASE_URL}?p=report&brand=root&adminKey=${process.env.ADMIN_KEY}`);

      // Verify event metrics
      await expect(page.locator(`[data-event-id="${eventId}"] [data-metric="views"]`)).toContainText(/\d+/);
      await expect(page.locator(`[data-event-id="${eventId}"] [data-metric="signups"]`)).toContainText(/1/);

      // Verify sponsor metrics
      await expect(page.locator('[data-sponsor-impressions]')).toBeVisible();
    });

    // Clean up
    test.step('Clean up test event', async () => {
      await api.post('?action=delete', {
        brandId: 'root',
        scope: 'events',
        id: eventId,
        adminKey: process.env.ADMIN_KEY
      });
    });
  });
});
```

---

## 📦 Updated Package.json Scripts

### Remove Newman Scripts
```diff
- "test:newman": "newman run postman/...",
- "test:newman:smoke": "newman run postman/...",
- "test:newman:forms": "newman run postman/...",
- "test:newman:flow": "newman run postman/...",
- "test:api:all": "npm run test:newman && npm run test:api",
- "test:triangle:before:postman": "newman run tests/triangle/...",
- "test:triangle:during:postman": "newman run tests/triangle/...",
- "test:triangle:after:postman": "newman run tests/triangle/...",
- "test:triangle:all:postman": "newman run tests/triangle/...",
```

### Add New Playwright Scripts
```diff
+ "test:api": "playwright test tests/e2e/api --reporter=html --reporter=line",
+ "test:api:system": "playwright test tests/e2e/api/system-api.spec.js",
+ "test:api:events": "playwright test tests/e2e/api/events-crud-api.spec.js",
+ "test:api:sponsors": "playwright test tests/e2e/api/sponsors-crud-api.spec.js",
+ "test:api:multi-brand": "playwright test tests/e2e/api/multi-brand-api.spec.js",
  "test:smoke": "playwright test tests/e2e/1-smoke --reporter=html --reporter=line",
  "test:pages": "playwright test tests/e2e/2-pages --reporter=html --reporter=line",
  "test:flows": "playwright test tests/e2e/3-flows --reporter=html --reporter=line",
+ "test:flows:lifecycle": "playwright test tests/e2e/3-flows/event-lifecycle-flow.spec.js",
+ "test:flows:multi-brand": "playwright test tests/e2e/3-flows/multi-brand-flows.spec.js",
+ "test:flows:api-to-ui": "playwright test tests/e2e/3-flows/api-to-ui-flows.spec.js",
+ "test:triangle:before:e2e": "playwright test tests/e2e/3-flows/*before*.spec.js",
+ "test:triangle:during:e2e": "playwright test tests/e2e/3-flows/*during*.spec.js",
+ "test:triangle:after:e2e": "playwright test tests/e2e/3-flows/*after*.spec.js",
  "test:e2e": "npm run test:api && npm run test:smoke && npm run test:pages && npm run test:flows",
```

---

## 🔄 Updated Stage 2 Workflow

### Before (With Newman)
```yaml
newman-api-tests:
  runs-on: ubuntu-latest
  steps:
    - Run Newman tests (~2 minutes)
    - Sequential execution
    - Retry logic for 429 errors

playwright-tests:
  needs: newman-api-tests
  strategy:
    matrix: [smoke, flows, pages]
```

### After (Playwright Only)
```yaml
playwright-tests:
  runs-on: ubuntu-latest
  strategy:
    matrix: [smoke, api, flows, pages]
  steps:
    - Run Playwright tests (~12 minutes total)
    - Parallel execution (4 suites)
    - Built-in retry logic
```

**Benefits:**
- ✅ Faster: Parallel instead of sequential (12 min vs 15 min)
- ✅ Simpler: One test runner instead of two
- ✅ More powerful: API tests can drive UI tests
- ✅ Better reporting: Unified HTML reports

---

## 📊 Test Coverage Comparison

### Before (Newman + Playwright)
```
Total Tests: ~130
├─ Jest Unit: 100 tests (~30s)
├─ Jest Contract: 20 tests (~5s)
├─ Newman API: 30 tests (~2 min, sequential)
└─ Playwright E2E: 10 tests (~10 min, parallel)
```

### After (Playwright Heavy)
```
Total Tests: ~180 (50 new tests)
├─ Jest Unit: 100 tests (~30s)
├─ Jest Contract: 20 tests (~5s)
└─ Playwright (All): 60 tests (~12 min, parallel)
    ├─ API Tests: 20 tests
    ├─ Smoke Tests: 5 tests
    ├─ Page Tests: 15 tests
    └─ Flow Tests: 20 tests
```

---

## 🎯 Benefits of Migration

### Technical Benefits
1. **Unified Test Framework:** One tool instead of two
2. **Better Integration:** API + UI in same test
3. **Shared Context:** Pass data between API and UI tests
4. **Modern Tooling:** Playwright is actively developed
5. **Better Debugging:** Playwright's trace viewer

### Business Benefits
1. **Faster Feedback:** Parallel test execution
2. **Lower Maintenance:** One framework to learn
3. **Better Coverage:** More comprehensive flows
4. **Cost Effective:** No separate API tool needed
5. **Solo Dev Friendly:** Less context switching

### DevOps Benefits
1. **Simpler CI/CD:** Remove Newman job
2. **Faster Pipeline:** Parallel execution
3. **Better Reporting:** Unified HTML reports
4. **Easier Debugging:** All tests in one place

---

## 📅 Migration Timeline

### Week 1: API Test Migration
- [ ] Create `tests/e2e/api/` directory structure
- [ ] Implement API helper utilities
- [ ] Migrate system API tests
- [ ] Migrate event CRUD API tests
- [ ] Migrate sponsor CRUD API tests
- [ ] Test locally

### Week 2: Flow Test Expansion
- [ ] Create event lifecycle flow tests
- [ ] Create multi-brand flow tests
- [ ] Create API-to-UI flow tests
- [ ] Create error handling flow tests
- [ ] Test locally

### Week 3: Page Test Expansion
- [ ] Add wizard page tests
- [ ] Add poster page tests
- [ ] Add signup page tests
- [ ] Add report page tests
- [ ] Test locally

### Week 4: Cleanup & Documentation
- [ ] Remove Newman dependencies
- [ ] Update package.json scripts
- [ ] Update Stage 2 workflow
- [ ] Archive Postman collections
- [ ] Update all documentation
- [ ] Deploy to main branch

---

## ✅ Success Criteria

### Must Have
- [ ] All Newman API tests migrated to Playwright
- [ ] All tests passing in CI/CD
- [ ] Stage 2 workflow updated
- [ ] Documentation updated
- [ ] Newman dependencies removed

### Nice to Have
- [ ] 50+ new flow tests created
- [ ] All 13 page types have comprehensive tests
- [ ] Multi-brand isolation tests for all brands
- [ ] Performance benchmarks for Playwright vs Newman

### Metrics
- [ ] Test coverage: 85%+ (same or better)
- [ ] CI/CD runtime: <15 minutes (same or better)
- [ ] Test reliability: 95%+ success rate
- [ ] Maintenance time: <2 hours/week

---

## 🆘 Rollback Plan

If migration fails, we can rollback:

1. **Revert package.json:** Keep Newman dependencies
2. **Revert workflow:** Restore Newman job
3. **Keep new tests:** Playwright tests don't interfere with Newman
4. **Gradual migration:** Run both tools in parallel until confident

---

**Ready to implement?** Let's start with API helper utilities and system API tests!
