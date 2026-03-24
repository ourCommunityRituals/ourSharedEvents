# Triangle Test Organization

## Overview

This document describes the **Triangle-Aligned Test Organization** for the MVP Event Toolkit. All tests are organized according to the **Triangle UI Flow Framework**, which structures functionality into three temporal phases of event lifecycles.

---

## Test Organization Philosophy

### Triangle Framework Mapping

The test suite mirrors the application's Triangle UI Flow structure:

1. **📋 Before Event** (Green #10b981) - Pre-Event Preparation
2. **▶️ During Event** (Orange #f59e0b) - Live Execution
3. **📊 After Event** (Purple #8b5cf6) - Post-Event Analytics
4. **⚡ All Phases** (Blue #3b82f6) - Always Available

### Test Type Hierarchy

For each Triangle phase, tests are organized by type:

- **Contract Tests** - API response envelope validation
- **Unit Tests** - Business logic and utility functions
- **Integration Tests** - Multi-component interactions
- **Postman/Newman Tests** - API endpoint testing
- **E2E Tests (Playwright)** - Full user journey testing

---

## Directory Structure

```
tests/
├── triangle/                          # Triangle-aligned test organization
│   ├── before-event/                  # 📋 Green - Pre-Event Preparation
│   │   ├── contract/                  # API contracts for event creation
│   │   ├── unit/                      # Form validation, event logic
│   │   ├── integration/               # Sponsor setup → Event creation flows
│   │   ├── postman/                   # Create Event, Sponsors, Forms APIs
│   │   └── e2e/                       # Admin, Poster, Signup page tests
│   │
│   ├── during-event/                  # ▶️ Orange - Live Execution
│   │   ├── contract/                  # Display, Public API contracts
│   │   ├── unit/                      # Carousel, Analytics tracking logic
│   │   ├── integration/               # Display → Public data sync
│   │   ├── postman/                   # Event Update, Live Config APIs
│   │   └── e2e/                       # Display TV mode, Public page tests
│   │
│   ├── after-event/                   # 📊 Purple - Post-Event Analytics
│   │   ├── contract/                  # Analytics API contracts
│   │   ├── unit/                      # Report generation, ROI calculation
│   │   ├── integration/               # Event → Analytics data flow
│   │   ├── postman/                   # Analytics, Export APIs
│   │   └── e2e/                       # SharedReport page tests
│   │
│   └── all-phases/                    # ⚡ Blue - Always Available
│       ├── contract/                  # Config, Diagnostics, Status APIs
│       ├── unit/                      # Shared utilities, helpers
│       ├── integration/               # Cross-cutting concerns
│       ├── postman/                   # System health, Status APIs
│       └── e2e/                       # Config, Diagnostics, Test page tests
│
├── shared/                            # Shared test resources
│   ├── fixtures/                      # Test data and fixtures
│   ├── helpers/                       # Test utilities and helpers
│   ├── config/                        # Test configuration files
│   └── page-objects/                  # Page Object Models for E2E tests
│
├── docs/                              # Test documentation
│   ├── TRIANGLE_TEST_ORGANIZATION.md  # This file
│   ├── TEST_EXECUTION_GUIDE.md        # How to run tests
│   └── TEST_WRITING_GUIDE.md          # How to write new tests
│
└── legacy/                            # Legacy tests (to be migrated)
    └── e2e/                           # Old test structure
```

---

## Test Mapping by Triangle Phase

### 📋 Before Event (Pre-Event Preparation)

**User Roles:** Event Manager (primary), Sponsor (secondary)

**Features Tested:**
- ✅ Sponsor management (`?page=sponsor`)
- ✅ Event creation (`?page=admin`)
- ✅ Events list (`?page=admin#events-list`)
- ✅ Sign-up forms (`?page=signup`)
- ✅ Poster generation (`?page=poster`)
- ✅ Display preview (`?page=display`)
- ✅ Public page preview (`?p=events`)
- ✅ Links generator (`?page=admin#event-links`)

**Test Files:**

**Contract Tests** (`tests/triangle/before-event/contract/`)
- `create-event.contract.test.js` - Event creation API validation
- `sponsors.contract.test.js` - Sponsor CRUD API validation
- `forms.contract.test.js` - Form template API validation

**Unit Tests** (`tests/triangle/before-event/unit/`)
- `event-validation.test.js` - Event form validation logic
- `sponsor-config.test.js` - Sponsor configuration logic
- `poster-generator.test.js` - Poster generation utilities

**Integration Tests** (`tests/triangle/before-event/integration/`)
- `sponsor-to-event.integration.test.js` - Sponsor → Event flow
- `event-to-poster.integration.test.js` - Event → Poster propagation
- `forms-integration.integration.test.js` - Forms → Event integration

**Postman Collections** (`tests/triangle/before-event/postman/`)
- `before-event-apis.postman_collection.json` - All Before Event APIs
- `create-event-flow.postman_collection.json` - Event creation flow
- `sponsor-management.postman_collection.json` - Sponsor CRUD operations

**E2E Tests** (`tests/triangle/before-event/e2e/`)
- `admin-page.spec.js` - Admin page functionality (event creation, list, config)
- `sponsor-page.spec.js` - Sponsor management page
- `signup-page.spec.js` - Sign-up forms page
- `poster-page.spec.js` - Poster generation page
- `admin-flows.spec.js` - Complete event creation workflows
- `sponsor-flows.spec.js` - Sponsor setup and configuration workflows
- `poster-maps-integration.spec.js` - Poster editing and propagation

---

### ▶️ During Event (Live Execution)

**User Roles:** Event Manager, Consumer/Attendee

**Features Tested:**
- ✅ Quick links (`?page=admin#event-links`)
- ✅ Admin control (`?page=admin`)
- ✅ Display TV mode (`?page=display&tv=1`)
- ✅ Public page live (`?p=events`)

**Test Files:**

**Contract Tests** (`tests/triangle/during-event/contract/`)
- `display.contract.test.js` - Display mode API validation
- `public-events.contract.test.js` - Public events API validation
- `live-updates.contract.test.js` - Real-time update APIs

**Unit Tests** (`tests/triangle/during-event/unit/`)
- `carousel-logic.test.js` - Display carousel logic
- `analytics-tracking.test.js` - Impression and click tracking
- `tv-optimization.test.js` - TV display utilities

**Integration Tests** (`tests/triangle/during-event/integration/`)
- `admin-to-display.integration.test.js` - Admin → Display data sync
- `display-analytics.integration.test.js` - Display → Analytics tracking
- `public-forms.integration.test.js` - Public → Forms integration

**Postman Collections** (`tests/triangle/during-event/postman/`)
- `during-event-apis.postman_collection.json` - All During Event APIs
- `live-event-updates.postman_collection.json` - Event update APIs
- `display-config.postman_collection.json` - Display configuration APIs

**E2E Tests** (`tests/triangle/during-event/e2e/`)
- `display-page.spec.js` - Display page TV mode and carousel
- `public-page.spec.js` - Public page event listings and details
- `advanced-display-features.spec.js` - Dynamic URLs, videos, multi-language
- `customer-flows.spec.js` - Attendee registration and check-in flows
- `triangle-framework.spec.js` - Cross-page data propagation (spans all phases)

---

### 📊 After Event (Post-Event Analytics)

**User Roles:** Event Manager, Sponsor

**Features Tested:**
- ✅ Shared analytics (`?page=report`)
- ⏳ Next events (coming soon)
- ⏳ Next posters (coming soon)

**Test Files:**

**Contract Tests** (`tests/triangle/after-event/contract/`)
- `analytics.contract.test.js` - Analytics API validation
- `reports.contract.test.js` - Report generation API validation
- `export.contract.test.js` - Export APIs validation

**Unit Tests** (`tests/triangle/after-event/unit/`)
- `roi-calculation.test.js` - ROI calculation logic
- `metrics-aggregation.test.js` - Metrics aggregation utilities
- `chart-generation.test.js` - Chart data generation

**Integration Tests** (`tests/triangle/after-event/integration/`)
- `event-to-analytics.integration.test.js` - Event → Analytics data flow
- `sponsor-roi.integration.test.js` - Sponsor ROI calculation flow
- `export-sheets.integration.test.js` - Export to Google Sheets

**Postman Collections** (`tests/triangle/after-event/postman/`)
- `after-event-apis.postman_collection.json` - All After Event APIs
- `analytics-reporting.postman_collection.json` - Analytics APIs
- `export-operations.postman_collection.json` - Export APIs

**E2E Tests** (`tests/triangle/after-event/e2e/`)
- `report-page.spec.js` - Shared analytics report page
- `shared-reporting.spec.js` - Analytics flows and export
- `sponsor-analytics.spec.js` - Sponsor-specific analytics views

---

### ⚡ All Phases (Always Available)

**User Roles:** All users (Event Manager, Sponsor, Consumer)

**Features Tested:**
- ✅ Config editor (`?page=config`)
- ✅ Diagnostics (`?page=diagnostics`)
- ✅ Test dashboard (`?page=test`)
- ✅ API documentation (`?page=api`)
- ✅ Status API (`?p=status`)

**Test Files:**

**Contract Tests** (`tests/triangle/all-phases/contract/`)
- `config.contract.test.js` - Config API validation
- `diagnostics.contract.test.js` - Diagnostics API validation
- `status.contract.test.js` - Status API validation
- `api-contract.test.js` - General API contract validation

**Unit Tests** (`tests/triangle/all-phases/unit/`)
- `config-validation.test.js` - Configuration validation logic
- `diagnostics-checks.test.js` - Diagnostic check utilities
- `shared-utilities.test.js` - Shared helper functions

**Integration Tests** (`tests/triangle/all-phases/integration/`)
- `config-propagation.integration.test.js` - Config → All pages
- `diagnostics-health.integration.test.js` - Health check integration
- `api-docs-generation.integration.test.js` - API docs generation

**Postman Collections** (`tests/triangle/all-phases/postman/`)
- `all-phases-apis.postman_collection.json` - System APIs
- `health-checks.postman_collection.json` - Health check endpoints
- `authentication.postman_collection.json` - Auth APIs

**E2E Tests** (`tests/triangle/all-phases/e2e/`)
- `config-page.spec.js` - Config editor page
- `diagnostics-page.spec.js` - Diagnostics page
- `test-page.spec.js` - Test dashboard (Triangle navigation hub)
- `api-docs-page.spec.js` - API documentation page
- `critical-smoke.spec.js` - Critical path smoke tests
- `security-smoke.spec.js` - Security smoke tests

---

## Shared Test Resources

### Fixtures (`tests/shared/fixtures/`)

**Purpose:** Reusable test data across all test types

- `events.fixtures.js` - Event templates with timestamps
- `sponsors.fixtures.js` - Sponsor configurations (Platinum, Gold, Silver)
- `forms.fixtures.js` - Form template data
- `analytics.fixtures.js` - Analytics sample data
- `users.fixtures.js` - User role configurations

### Helpers (`tests/shared/helpers/`)

**Purpose:** Test utilities and helper functions

- `api.helpers.js` - API request utilities
- `auth.helpers.js` - Authentication helpers
- `date.helpers.js` - Date/time utilities
- `validation.helpers.js` - Validation utilities
- `analytics.helpers.js` - Analytics tracking helpers

### Config (`tests/shared/config/`)

**Purpose:** Test configuration files

- `test.config.js` - Global test configuration
- `env.config.js` - Environment-specific settings
- `browser.config.js` - Browser configuration for E2E tests
- `api.config.js` - API endpoint configuration

### Page Objects (`tests/shared/page-objects/`)

**Purpose:** Page Object Models for E2E tests

- `BasePage.js` - Base page object with common methods
- `AdminPage.js` - Admin page object
- `DisplayPage.js` - Display page object
- `PublicPage.js` - Public page object
- `PosterPage.js` - Poster page object
- `ReportPage.js` - Report page object
- `ConfigPage.js` - Config page object
- `DiagnosticsPage.js` - Diagnostics page object
- `TestPage.js` - Test dashboard page object

---

## Test Execution Strategy

### Sequential Execution (CI/CD Pipeline)

Tests run in the following order:

1. **Lint** ✅ (5 seconds)
2. **Unit Tests** ✅ (10 seconds)
   - All Phases → Before Event → During Event → After Event
3. **Contract Tests** ✅ (15 seconds)
   - All Phases → Before Event → During Event → After Event
4. **Deploy** 🚀 (30 seconds)
5. **Verify Deployment** ✅ (10 seconds)
6. **Smoke Tests** ✅ (30 seconds)
   - Critical path verification
7. **Integration Tests** ✅ (2 minutes)
   - API integration tests via Postman/Newman
8. **E2E Tests** ✅ (10-15 minutes)
   - Before Event → During Event → After Event → All Phases

**Total Pipeline Time:** 15-20 minutes

### Parallel Execution (Developer Machines)

For faster local development, tests can run in parallel:

```bash
# Run all tests in parallel
npm run test:triangle:parallel

# Run specific phase tests in parallel
npm run test:triangle:before:parallel
npm run test:triangle:during:parallel
npm run test:triangle:after:parallel
npm run test:triangle:all:parallel
```

---

## Test Naming Conventions

### Contract Tests
- Pattern: `{feature}.contract.test.js`
- Example: `create-event.contract.test.js`

### Unit Tests
- Pattern: `{module}.test.js`
- Example: `event-validation.test.js`

### Integration Tests
- Pattern: `{source}-{destination}.integration.test.js`
- Example: `sponsor-to-event.integration.test.js`

### Postman Collections
- Pattern: `{phase}-apis.postman_collection.json`
- Example: `before-event-apis.postman_collection.json`

### E2E Tests
- Pattern: `{page-or-flow}.spec.js`
- Example: `admin-page.spec.js`, `sponsor-flows.spec.js`

---

## Test Coverage Goals

| Test Type | Target Coverage | Current Coverage |
|-----------|----------------|------------------|
| Contract Tests | 100% API endpoints | ✅ 100% |
| Unit Tests | 80% business logic | 🟡 65% |
| Integration Tests | 90% user flows | 🟡 75% |
| E2E Tests | 95% UI features | ✅ 95% |

---

## Migration Plan

### Phase 1: Structure Creation ✅
- Create Triangle-aligned directory structure
- Create documentation

### Phase 2: Contract Tests (Current)
- Organize existing contract tests by phase
- Create new contract tests for missing endpoints

### Phase 3: Unit Tests
- Organize existing unit tests by phase
- Create new unit tests for missing modules

### Phase 4: Integration Tests
- Create integration tests for all user flows
- Organize by Triangle phases

### Phase 5: Postman/Newman Tests
- Split existing Postman collections by phase
- Create phase-specific collections

### Phase 6: E2E Tests
- Move existing E2E tests to Triangle structure
- Update test configurations

### Phase 7: Shared Resources
- Move fixtures to shared directory
- Create page objects for all pages
- Create helper utilities

### Phase 8: Configuration Updates
- Update package.json scripts
- Update Playwright config
- Update Jest config
- Update CI/CD pipeline

---

## Quick Reference Commands

### Run All Triangle Tests
```bash
npm run test:triangle           # All tests (sequential)
npm run test:triangle:parallel  # All tests (parallel)
```

### Run Phase-Specific Tests
```bash
# Before Event
npm run test:triangle:before
npm run test:triangle:before:contract
npm run test:triangle:before:unit
npm run test:triangle:before:integration
npm run test:triangle:before:postman
npm run test:triangle:before:e2e

# During Event
npm run test:triangle:during
npm run test:triangle:during:contract
npm run test:triangle:during:unit
npm run test:triangle:during:integration
npm run test:triangle:during:postman
npm run test:triangle:during:e2e

# After Event
npm run test:triangle:after
npm run test:triangle:after:contract
npm run test:triangle:after:unit
npm run test:triangle:after:integration
npm run test:triangle:after:postman
npm run test:triangle:after:e2e

# All Phases
npm run test:triangle:all
npm run test:triangle:all:contract
npm run test:triangle:all:unit
npm run test:triangle:all:integration
npm run test:triangle:all:postman
npm run test:triangle:all:e2e
```

### Run Test Type Across All Phases
```bash
npm run test:contract      # All contract tests
npm run test:unit          # All unit tests
npm run test:integration   # All integration tests
npm run test:postman       # All Postman tests
npm run test:e2e           # All E2E tests
```

---

## Contributing

### Adding New Tests

1. **Identify Triangle Phase**: Determine which phase(s) the test belongs to
2. **Choose Test Type**: Select appropriate test type (contract/unit/integration/postman/e2e)
3. **Use Naming Convention**: Follow naming patterns above
4. **Leverage Shared Resources**: Use fixtures, helpers, and page objects
5. **Update Documentation**: Add test to this document

### Test Structure Template

```javascript
const { test, expect } = require('@playwright/test');
const fixtures = require('../../../shared/fixtures/events.fixtures');
const helpers = require('../../../shared/helpers/api.helpers');

test.describe('🔺 TRIANGLE [PHASE]: Feature Name', () => {
  test('should do something specific', async ({ page }) => {
    // Test implementation
  });
});
```

---

## Related Documentation

- **[Triangle UI Flow Documentation](../../TRIANGLE_UI_FLOWS.md)** - Complete UI flow reference
- **[Test Execution Guide](./TEST_EXECUTION_GUIDE.md)** - How to run tests
- **[Test Writing Guide](./TEST_WRITING_GUIDE.md)** - How to write new tests
- **[CI/CD Pipeline Documentation](../../.github/workflows/README.md)** - CI/CD setup

---

**Last Updated:** 2025-11-12
**Version:** 1.0
**Maintained By:** MVP Event Toolkit Team
