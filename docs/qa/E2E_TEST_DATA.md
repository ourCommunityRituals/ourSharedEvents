# E2E Test Data Management

## Story 3.3: Test Data for Playwright E2E Tests

This document describes the test data created, used, and maintained for end-to-end testing.

---

## Overview

The E2E test suite uses a **self-cleaning** approach where all test data is automatically created at the start of tests and deleted after completion. This ensures:

- No pollution of production or staging data
- Reproducible test runs
- Isolated test execution

---

## Test Data Naming Conventions

### Events

| Field | Pattern | Example |
|-------|---------|---------|
| Name | `{Test Type} Test Event {timestamp}` | `E2E Test Event 1702300000000` |
| Venue | `{Test Type} Test Venue` | `E2E Test Venue` |
| Date | Future date (1 month ahead) | `2026-01-15` |
| Summary | `Automated {test type} test event...` | `Automated E2E test event for Story 3.3 validation` |

### Sponsors

| Field | Pattern | Example |
|-------|---------|---------|
| Name | `Test Sponsor {timestamp}` | `Test Sponsor 1702300000000` |
| Website | `https://example.com` | `https://example.com` |
| Tier | `gold` | `gold` |

---

## Test Accounts

### Brand Configuration

| Brand ID | Purpose | Environment |
|----------|---------|-------------|
| `root` | Primary testing (default) | All |
| `abc` | Multi-brand testing | Staging/QA |
| `cbc` | Multi-brand testing | Staging/QA |
| `cbl` | Multi-brand testing | Staging/QA |

### Admin Keys

Admin keys are stored as environment variables or CI secrets:

| Environment | Variable | Source |
|-------------|----------|--------|
| Local | `ADMIN_KEY` | `.env` file |
| CI | `ADMIN_KEY` | GitHub Secrets |
| Staging | `ADMIN_KEY` | Deploy manifest |

**Never commit admin keys to version control.**

---

## Data Lifecycle

### 1. Test Setup (beforeEach)

```javascript
test.beforeEach(async ({ request }) => {
  api = new ApiHelpers(request, BASE_URL);

  // Create test event
  const { eventId } = await api.createTestEvent(BRAND_ID, ADMIN_KEY, {
    name: `Test Event ${Date.now()}`,
  });
  testEventId = eventId;
  createdEventIds.push(testEventId);
});
```

### 2. Test Execution

Tests use the created data for validations.

### 3. Test Cleanup (afterEach)

```javascript
test.afterEach(async () => {
  // Cleanup all created events
  for (const eventId of createdEventIds) {
    try {
      await api.deleteEvent(BRAND_ID, eventId, ADMIN_KEY);
      console.log(`✓ Cleaned up event: ${eventId}`);
    } catch (error) {
      console.warn(`⚠ Failed to delete event ${eventId}:`, error.message);
    }
  }
  createdEventIds.length = 0;
});
```

---

## Data Created During Tests

### Story 3.3 Critical User Journeys

| Journey | Data Type | Quantity | Cleanup |
|---------|-----------|----------|---------|
| Journey 1: Event Creation | Events | 1-2 per test | Auto |
| Journey 2: Event Viewing | Events | 1 | Auto |
| Journey 3: Display Surface | Events | 1 | Auto |
| Journey 4: Poster Surface | Events | 1 | Auto |
| Journey 5: Shared Report | Events | 1 | Auto |
| Journey 6: Event Management | Events | 1 | Auto |
| Journey 7: Cross-Surface | Events | 1 | Auto |

### Smoke Tests

| Test Suite | Data Type | Quantity | Cleanup |
|------------|-----------|----------|---------|
| Admin Smoke | Events | 1 | Manual review |
| API Tests | Events, Sponsors | 1-3 | Auto |
| Flow Tests | Events | Variable | Auto |

---

## Manual Data Management

### Seed Test Data

For comprehensive testing with pre-populated data:

```bash
# Seed basic test data
npm run qa:seed

# Seed comprehensive test data
npm run qa:seed:comprehensive

# Seed data for specific triangle phases
npm run qa:seed:triangle:before
npm run qa:seed:triangle:during
npm run qa:seed:triangle:after
```

### Cleanup Test Data

```bash
# Cleanup all test data
npm run qa:cleanup

# View current test data snapshots
npm run qa:snapshots
```

### Identify Test Data

Test data can be identified by:

1. **Naming pattern**: Contains "Test Event", "E2E", "Playwright", timestamps
2. **Creation time**: Recent timestamps in event data
3. **Summary field**: Contains "Automated" or "test"

---

## Fixture Events

For read-only tests, use pre-existing fixture events:

### Environment Variable

```bash
# Set a fixture event ID for read-only tests
export FIXTURE_EVENT_ID="evt_12345"
```

### Usage in Tests

```javascript
const fixtureEventId = process.env.FIXTURE_EVENT_ID;

test('read-only test with fixture', async ({ page }) => {
  if (!fixtureEventId) {
    test.skip('No fixture event configured');
  }

  await page.goto(`${BASE_URL}?page=public&id=${fixtureEventId}`);
  // ... read-only assertions
});
```

---

## Data Isolation

### Per-Test Isolation

Each test creates and deletes its own data:

```javascript
test.describe('My Tests', () => {
  const createdIds = [];

  test.afterEach(async () => {
    // Each test cleans up its own data
    for (const id of createdIds) {
      await cleanup(id);
    }
    createdIds.length = 0;
  });

  test('test 1', async () => {
    const id = await create();
    createdIds.push(id);
    // ...
  });

  test('test 2', async () => {
    const id = await create();
    createdIds.push(id);
    // ...
  });
});
```

### Parallel Execution

Tests running in parallel create unique data using timestamps:

```javascript
const uniqueName = `Test Event ${Date.now()}_${Math.random().toString(36).slice(2)}`;
```

---

## Data Validation

### Verify No Orphaned Data

After test runs, verify cleanup:

```bash
# List all events
npm run test:api:smoke:events

# Check for orphaned test data
npx playwright test -g "list events" --reporter=line
```

### Manual Cleanup

If orphaned data exists:

```bash
# Via API
curl -X POST "${BASE_URL}?action=delete" \
  -H "Content-Type: application/json" \
  -d '{"brandId":"root","scope":"events","id":"orphaned_id","adminKey":"${ADMIN_KEY}"}'
```

---

## Best Practices

### 1. Always Use Cleanup Hooks

```javascript
// ✅ Good: Always cleanup
test.afterEach(async () => {
  for (const id of createdIds) {
    await api.deleteEvent(brand, id, key);
  }
});

// ❌ Bad: No cleanup
test.afterEach(async () => {
  // Nothing here
});
```

### 2. Use Unique Names

```javascript
// ✅ Good: Unique with timestamp
const name = `Test Event ${Date.now()}`;

// ❌ Bad: Static name (conflicts in parallel)
const name = 'Test Event';
```

### 3. Track Created Resources

```javascript
// ✅ Good: Track all created resources
const createdEventIds = [];

const { eventId } = await api.createTestEvent(...);
createdEventIds.push(eventId);

// ❌ Bad: Lose track of resources
await api.createTestEvent(...); // No tracking
```

### 4. Handle Cleanup Failures

```javascript
// ✅ Good: Catch cleanup errors
try {
  await api.deleteEvent(brand, id, key);
} catch (error) {
  console.warn(`Cleanup failed: ${error.message}`);
}

// ❌ Bad: Cleanup errors break subsequent tests
await api.deleteEvent(brand, id, key); // Throws on error
```

---

## Troubleshooting

### "Event not found" Errors

**Cause**: Test data was deleted by another test or cleanup ran early.

**Solution**: Ensure each test creates its own data in `beforeEach`.

### "Too many events" / Rate Limiting

**Cause**: Too many create requests in quick succession.

**Solution**: Add delays between batch operations:

```javascript
for (const data of testData) {
  await api.createEvent(...);
  await page.waitForTimeout(500); // Small delay
}
```

### Orphaned Data in Staging

**Cause**: Test crashed before cleanup.

**Solution**: Run manual cleanup:

```bash
npm run qa:cleanup
```

---

## Data Retention Policy

| Environment | Retention | Notes |
|-------------|-----------|-------|
| Local | Session | Deleted after test run |
| Staging | 7 days | Periodic cleanup scripts |
| QA | 14 days | Longer retention for debugging |
| Production | Never created | E2E tests are read-only |

---

## Related Documentation

- [E2E_PLAYWRIGHT_GUIDE.md](./E2E_PLAYWRIGHT_GUIDE.md) - Full E2E testing guide
- [tests/README.md](../tests/README.md) - Test suite overview
- [tests/shared/test-data-manager.js](../tests/shared/test-data-manager.js) - Data management utilities

---

**Last Updated**: 2025-12-11
**Story**: 3.3 - End-to-End Testing of User Flows (Playwright)
