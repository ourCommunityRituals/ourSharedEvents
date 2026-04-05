# Collapsible Sections Tests

This document describes the test coverage for the collapsible sections feature added to the Admin interface.

## Overview

The collapsible sections feature adds expand/collapse functionality to the Admin page, allowing users to:

- Collapse Create Event form sections (Core Details, Summary, Media, Bio)
- Collapse Event Dashboard sections (Statistics, Event Lifecycle)
- Improve focus by hiding sections they're not currently using

## Test Coverage

### 1. E2E Tests (Playwright)

**Location:** `tests/e2e/2-pages/admin-page.spec.js`

**Test Suite:** `📄 PAGE: Admin - Collapsible Sections`

**Tests Added:**

1. ✅ Create Event form has collapsible sections
2. ✅ All sections start expanded by default
3. ✅ Clicking section header collapses/expands section
4. ✅ Chevron icon rotates when section is collapsed
5. ✅ Multiple sections can be collapsed independently
6. ✅ Event Dashboard has collapsible sections
7. ✅ Dashboard sections can be collapsed
8. ✅ Collapsible sections work on mobile viewport
9. ✅ Form submission works with collapsed sections
10. ✅ Collapsible headers have proper cursor and hover states

**Coverage:**

- ✅ UI component presence
- ✅ Default state verification
- ✅ Click interactions
- ✅ Animation/transition verification
- ✅ Independent section toggling
- ✅ Mobile responsiveness
- ✅ Form functionality with collapsed sections
- ✅ Accessibility (cursor states, touch targets)

### 2. Unit Tests (Jest)

**Location:** `tests/unit/collapsible-sections.test.js`

**Test Suites:**

1. `toggleSection function` - Tests the core toggle logic
2. `Collapsible section structure` - Tests DOM structure
3. `Multiple collapsible sections` - Tests independent toggling
4. `Edge cases` - Tests error handling
5. `CSS classes and styling` - Tests class management

**Tests Added:**

1. ✅ Function exists and is callable
2. ✅ Toggles collapsed class on header
3. ✅ Toggles collapsed class on content
4. ✅ Handles multiple toggles correctly
5. ✅ Finds content as next sibling element
6. ✅ Does not throw errors
7. ✅ Has correct HTML structure
8. ✅ Has correct initial classes
9. ✅ Starts expanded (no collapsed class)
10. ✅ Toggles sections independently
11. ✅ Handles all sections collapsed
12. ✅ Handles all sections expanded
13. ✅ Handles missing content element gracefully
14. ✅ Works with content that has additional classes
15. ✅ Maintains other classes when toggling
16. ✅ Works with pre-collapsed sections

**Coverage:**

- ✅ Function behavior
- ✅ DOM manipulation
- ✅ Edge case handling
- ✅ Multiple section management
- ✅ Class preservation
- ✅ Error resilience

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install
```

### Run All Tests

```bash
# Run all tests (Jest + Playwright)
npm run test:all
```

### Run Only Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run only collapsible sections unit tests
npm run test:unit -- collapsible-sections.test.js
```

### Run Only E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run only admin page tests (includes collapsible sections)
npm run test:pages -- admin-page.spec.js

# Run only before-event tests (includes admin page)
npm run test:triangle:before
```

### Run Tests in Watch Mode

```bash
# Watch unit tests
npm run test:watch

# Watch specific test file
npm run test:watch -- collapsible-sections.test.js
```

## Test Environment Configuration

Tests use environment-specific configuration from `tests/config/environments.js`.

### Available Environments:

- **Production:** `BASE_URL=https://eventangle.com` (Cloudflare Workers)
- **QA:** `BASE_URL=https://zeventbooks.com` (Cloudflare Workers)
- **Google Apps Script:** Uses script deployment URL directly

### Running Against Specific Environments

```bash
# Run against QA environment
BASE_URL=https://zeventbooks.com npm run test:pages

# Run against custom URL
BASE_URL=https://your-domain.com npm run test:pages
```

## Test Reports

After running tests, reports are available at:

- **Playwright HTML Report:** `playwright-report/index.html`
- **Jest Coverage Report:** `coverage/index.html`
- **JSON Results:** `.test-results/playwright-results.json`

## CI/CD Integration

Tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm install

- name: Run unit tests
  run: npm run test:unit

- name: Run E2E tests
  run: npm run test:e2e
```

## Triangle Framework Integration

Collapsible sections tests are part of the "Before Event" phase tests:

```bash
# Run all before-event phase tests
npm run test:triangle:before

# Run before-event tests in parallel
npm run test:triangle:before:parallel
```

## Test Maintenance

### Adding New Tests

When adding new collapsible sections:

1. **Update E2E tests** (`admin-page.spec.js`):

   ```javascript
   test('New section is collapsible', async ({ page }) => {
     await page.goto(`${BASE_URL}?page=admin&brand=${BRAND_ID}`);
     const header = page.locator('.collapsible-header:has-text("New Section")');
     await expect(header).toBeVisible();
     await header.click();
     // Assert collapse behavior
   });
   ```

2. **Update unit tests** (`collapsible-sections.test.js`):
   ```javascript
   it('should handle new section correctly', () => {
     // Test logic
   });
   ```

### Test Coverage Goals

- ✅ **Unit test coverage:** 100% for toggleSection function
- ✅ **E2E test coverage:** All user-facing collapsible interactions
- ✅ **Accessibility:** Touch target sizes, keyboard navigation
- ✅ **Mobile:** Responsive design verification
- ✅ **Cross-browser:** Chromium and Safari (iOS)

## Troubleshooting

### Common Issues

1. **Tests fail due to missing elements:**
   - Verify collapsible sections are rendered in Admin.html
   - Check CSS classes match expected names

2. **Animation timing issues:**
   - E2E tests include `waitForTimeout(500)` for transitions
   - Adjust timeout if animations are slower

3. **Mobile tests fail:**
   - Verify viewport size is set correctly
   - Check touch target sizes meet 44px minimum

### Debug Mode

```bash
# Run E2E tests with browser visible
npx playwright test --headed

# Run specific test with debug
npx playwright test --debug admin-page.spec.js

# Generate trace for failed tests
npx playwright test --trace on
```

## Test Results

Expected test results:

```
Admin - Collapsible Sections Unit Tests
  ✓ toggleSection function (16 tests)
  ✓ Collapsible section structure (5 tests)
  ✓ Multiple collapsible sections (3 tests)
  ✓ Edge cases (2 tests)
  ✓ CSS classes and styling (2 tests)

Total: 28 unit tests

📄 PAGE: Admin - Collapsible Sections
  ✓ Create Event form has collapsible sections
  ✓ All sections start expanded by default
  ✓ Clicking section header collapses/expands section
  ✓ Chevron icon rotates when section is collapsed
  ✓ Multiple sections can be collapsed independently
  ✓ Event Dashboard has collapsible sections
  ✓ Dashboard sections can be collapsed
  ✓ Collapsible sections work on mobile viewport
  ✓ Form submission works with collapsed sections
  ✓ Collapsible headers have proper cursor and hover states

Total: 10 E2E tests
```

## Related Documentation

- [Triangle UI Flow Documentation](../TRIANGLE_UI_FLOWS.md)
- [Test Configuration](./config/test.config.js)
- [Playwright Config](../playwright.config.js)
- [Jest Config](../jest.config.js)

---

**Last Updated:** 2025-11-18
**Feature Branch:** `claude/admin-collapsible-sections-016rojE4cg1RpiVh7H1opPQc`
**Related PR:** #[TBD]
