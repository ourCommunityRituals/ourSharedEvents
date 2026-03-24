# 📋 Before Event - E2E Tests

Triangle Phase: **Before Event** (Green #10b981)
Purpose: Pre-Event Preparation
User Roles: Event Manager (primary), Sponsor (secondary)

---

## Overview

This directory contains E2E tests for the Before Event phase of the Triangle UI Flow. These tests cover all functionality related to event preparation, setup, and promotion before the event goes live.

---

## Test Mapping

The following existing tests are part of the Before Event phase:

### Page Tests (`tests/e2e/2-pages/`)

#### 1. **Admin Page Tests** - `admin-page.spec.js`
**Primary Triangle Phase:** Before Event
**Lines:** 353
**Tests:** 85+

**Before Event Features:**
- ✅ Event creation form (all 15+ fields)
- ✅ Events list management
- ✅ Sponsor configuration ("Configure Display & Sponsors" button)
- ✅ Add/Remove Sponsor functionality
- ✅ Sign-up form URL configuration
- ✅ Display mode selection (public/dynamic)
- ✅ Event links generation

**Key Test Scenarios:**
```javascript
// Event Creation
test('should create new event with all fields', async ({ page }) => {
  // Tests the complete event creation workflow
});

// Sponsor Management
test('should add sponsors to event', async ({ page }) => {
  // Tests sponsor configuration during event setup
});

// Link Generation
test('should generate all event links', async ({ page }) => {
  // Tests Before Event link distribution
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/2-pages/admin-page.spec.js`

---

### Flow Tests (`tests/e2e/3-flows/`)

#### 2. **Triangle Framework Tests** - `triangle-framework.spec.js`
**Triangle Phase:** Cross-phase (includes Before Event)
**Lines:** 557
**Tests:** 35+

**Before Event Features:**
- ✅ Sponsor setup → Admin → Poster → Display → Public propagation
- ✅ Admin card-by-card flow (Create Event card)
- ✅ Multi-tier sponsor configuration
- ✅ Event data propagation to all surfaces

**Key Test Scenarios:**
```javascript
test('🔺 TRIANGLE: Complete cross-page sponsor propagation cycle', async ({ page, context }) => {
  // Tests data flow from Before Event setup through all phases
});

test('🔺 TRIANGLE: Admin card-by-card workflow (Create Event)', async ({ page, context }) => {
  // Tests Before Event event creation workflow
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/triangle-framework.spec.js`

---

#### 3. **Poster & Maps Integration Tests** - `poster-maps-integration.spec.js`
**Primary Triangle Phase:** Before Event
**Lines:** 424
**Tests:** 15+

**Before Event Features:**
- ✅ Poster editing and generation
- ✅ Print-optimized layout
- ✅ Google Maps integration
- ✅ QR code generation for event promotion
- ✅ Sponsor strip display on posters

**Key Test Scenarios:**
```javascript
test('Poster page should load and display event data', async ({ page, context }) => {
  // Tests poster generation for event promotion
});

test('Google Maps should be embedded and interactive', async ({ page, context }) => {
  // Tests map integration for event location
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/poster-maps-integration.spec.js`

---

#### 4. **Admin Flows Tests** - `admin-flows.spec.js`
**Primary Triangle Phase:** Before Event
**Lines:** 375
**Tests:** 25+

**Before Event Features:**
- ✅ Complete event creation workflows
- ✅ Event editing and updates
- ✅ Sponsor assignment
- ✅ Form configuration
- ✅ Display setup

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/admin-flows.spec.js`

---

#### 5. **Sponsor Flows Tests** - `sponsor-flows.spec.js`
**Primary Triangle Phase:** Before Event
**Lines:** 498
**Tests:** 25+

**Before Event Features:**
- ✅ Sponsor display configuration
- ✅ Sponsor tier management (Platinum, Gold, Silver)
- ✅ Logo upload and configuration
- ✅ Sponsor placement settings (Poster, TV, Mobile)

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/sponsor-flows.spec.js`

---

#### 6. **Forms & Templates Tests** - `forms-templates.spec.js`
**Primary Triangle Phase:** Before Event
**Lines:** 183
**Tests:** 10+

**Before Event Features:**
- ✅ Form template integration
- ✅ Registration form setup
- ✅ Check-in form configuration
- ✅ Walk-in form setup
- ✅ Survey form integration

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/forms-templates.spec.js`

---

## Running Before Event Tests

### Run All Before Event Tests
```bash
# Admin page tests
npm run test:e2e -- tests/e2e/2-pages/admin-page.spec.js

# Flow tests
npm run test:e2e -- tests/e2e/3-flows/admin-flows.spec.js
npm run test:e2e -- tests/e2e/3-flows/sponsor-flows.spec.js
npm run test:e2e -- tests/e2e/3-flows/poster-maps-integration.spec.js
npm run test:e2e -- tests/e2e/3-flows/forms-templates.spec.js
npm run test:e2e -- tests/e2e/3-flows/triangle-framework.spec.js
```

### Run Specific Feature Tests
```bash
# Event creation only
npx playwright test tests/e2e/2-pages/admin-page.spec.js -g "create event"

# Sponsor configuration only
npx playwright test tests/e2e/3-flows/sponsor-flows.spec.js

# Poster generation only
npx playwright test tests/e2e/3-flows/poster-maps-integration.spec.js
```

---

## Test Coverage

### Before Event Features
- ✅ Event creation (15+ fields)
- ✅ Sponsor management (multi-tier)
- ✅ Sign-up forms (4 types)
- ✅ Poster generation with QR codes
- ✅ Display preview
- ✅ Public page preview
- ✅ Links generator
- ✅ Google Maps integration

### Test Statistics
- **Total Tests:** 175+
- **Total Lines:** 2,390+
- **Coverage:** 95%+

---

## Future Tests to Add

1. **Sponsor Page Tests** (`sponsor-page.spec.js`)
   - Full CRUD operations for sponsors
   - Sponsor dashboard functionality

2. **Sign-up Page Tests** (`signup-page.spec.js`)
   - Form builder integration
   - Form template management

3. **Event Templates Tests**
   - Reusable event templates
   - Template library

---

## Related Documentation

- [Triangle UI Flow Documentation](../../../../TRIANGLE_UI_FLOWS.md)
- [Triangle Test Organization](../../../docs/TRIANGLE_TEST_ORGANIZATION.md)
- [Test Execution Guide](../../../docs/TEST_EXECUTION_GUIDE.md)

---

**Last Updated:** 2025-11-12
**Maintained By:** MVP Event Toolkit Team
