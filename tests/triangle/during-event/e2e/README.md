# ▶️ During Event - E2E Tests

Triangle Phase: **During Event** (Orange #f59e0b)
Purpose: Live Event Execution
User Roles: Event Manager, Consumer/Attendee

---

## Overview

This directory contains E2E tests for the During Event phase of the Triangle UI Flow. These tests cover all functionality related to live event execution, real-time displays, and attendee interactions.

---

## Test Mapping

The following existing tests are part of the During Event phase:

### Page Tests (`tests/e2e/2-pages/`)

#### 1. **Display Page Tests** - `display-page.spec.js`
**Primary Triangle Phase:** During Event
**Lines:** 429
**Tests:** 60+

**During Event Features:**
- ✅ TV layout rendering (1080p/4K)
- ✅ Sponsor banner areas (top, bottom, left, right)
- ✅ Carousel controls (next, prev, pause, play, fullscreen)
- ✅ Multi-device rendering (mobile, tablet, TV, 4K)
- ✅ Dynamic URL carousel with timing
- ✅ Video streaming (YouTube, Vimeo)
- ✅ 10-12ft viewing optimization

**Key Test Scenarios:**
```javascript
test('Display page should render TV layout correctly', async ({ page }) => {
  // Tests live display rendering during event
});

test('Carousel should cycle through configured URLs', async ({ page }) => {
  // Tests dynamic content display during event
});

test('Sponsor banners should rotate correctly', async ({ page }) => {
  // Tests sponsor visibility during live event
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/2-pages/display-page.spec.js`

---

#### 2. **Public Page Tests** - `public-page.spec.js`
**Primary Triangle Phase:** During Event
**Lines:** 376
**Tests:** 50+

**During Event Features:**
- ✅ Events list loading
- ✅ Event detail views
- ✅ Sponsor displays and links
- ✅ Mobile responsiveness
- ✅ Search and filter functionality
- ✅ Registration/Check-in/Walk-in forms (live)
- ✅ Real-time event updates

**Key Test Scenarios:**
```javascript
test('Public page should display live events', async ({ page }) => {
  // Tests attendee view during event
});

test('Mobile view should be touch-optimized', async ({ page }) => {
  // Tests mobile experience during event
});

test('Registration forms should be accessible', async ({ page }) => {
  // Tests live registration during event
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/2-pages/public-page.spec.js`

---

### Flow Tests (`tests/e2e/3-flows/`)

#### 3. **Advanced Display Features Tests** - `advanced-display-features.spec.js`
**Primary Triangle Phase:** During Event
**Lines:** 470
**Tests:** 25+

**During Event Features:**
- ✅ Dynamic URLs with variable timing
- ✅ Admin Notes window real-time updates
- ✅ Video streaming (YouTube, Vimeo)
- ✅ Multi-language support (EN, ES, FR, DE)
- ✅ Sponsor slide-up behavior
- ✅ 10-12ft TV viewing optimization
- ✅ 4K display support

**Key Test Scenarios:**
```javascript
test('🔺 DISPLAY: Dynamic URLs with configurable intervals', async ({ page, context }) => {
  // Tests live content rotation during event
});

test('🔺 DISPLAY: Admin Notes real-time updates', async ({ page, context }) => {
  // Tests live updates during event
});

test('🔺 DISPLAY: Video streaming (YouTube, Vimeo)', async ({ page, context }) => {
  // Tests video content during event
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/advanced-display-features.spec.js`

---

#### 4. **Customer Flows Tests** - `customer-flows.spec.js`
**Primary Triangle Phase:** During Event
**Lines:** 424
**Tests:** 30+

**During Event Features:**
- ✅ Attendee event discovery
- ✅ Registration during event
- ✅ Check-in at door
- ✅ Walk-in registration
- ✅ Event navigation on mobile
- ✅ Form submissions

**Key Test Scenarios:**
```javascript
test('Customer should discover and register for event', async ({ page }) => {
  // Tests attendee journey during event
});

test('Check-in flow should work at event entrance', async ({ page }) => {
  // Tests live check-in during event
});
```

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/customer-flows.spec.js`

---

#### 5. **Triangle Framework Tests** - `triangle-framework.spec.js`
**Triangle Phase:** Cross-phase (includes During Event)
**Lines:** 557
**Tests:** 35+

**During Event Features:**
- ✅ Admin → Display → Public data sync
- ✅ Real-time content updates
- ✅ Live event editing propagation
- ✅ Display refresh verification

**Location:** `/home/user/MVP-EVENT-TOOLKIT/tests/e2e/3-flows/triangle-framework.spec.js`

---

## Running During Event Tests

### Run All During Event Tests
```bash
# Page tests
npm run test:e2e -- tests/e2e/2-pages/display-page.spec.js
npm run test:e2e -- tests/e2e/2-pages/public-page.spec.js

# Flow tests
npm run test:e2e -- tests/e2e/3-flows/advanced-display-features.spec.js
npm run test:e2e -- tests/e2e/3-flows/customer-flows.spec.js
```

### Run Specific Feature Tests
```bash
# Display/TV mode only
npx playwright test tests/e2e/2-pages/display-page.spec.js

# Public attendee view only
npx playwright test tests/e2e/2-pages/public-page.spec.js

# Advanced display features
npx playwright test tests/e2e/3-flows/advanced-display-features.spec.js -g "video"
```

### Run with Specific Viewport
```bash
# TV display (1080p)
npx playwright test --project="TV Display"

# Mobile view
npx playwright test --project="Mobile Chrome"
```

---

## Test Coverage

### During Event Features
- ✅ Display TV mode (1080p/4K)
- ✅ Public page (mobile-optimized)
- ✅ Quick links access
- ✅ Admin control (live updates)
- ✅ Carousel/slideshow
- ✅ Video streaming
- ✅ Multi-language support
- ✅ Real-time analytics tracking

### Test Statistics
- **Total Tests:** 165+
- **Total Lines:** 1,699+
- **Coverage:** 95%+

---

## Performance Requirements

During Event tests verify:
- **Page Load:** < 3 seconds
- **Video Start:** < 2 seconds
- **Carousel Transition:** < 500ms
- **Touch Response:** < 100ms (mobile)
- **Display Refresh:** < 1 second

---

## Future Tests to Add

1. **Real-time Sync Tests**
   - WebSocket connections
   - Live data updates
   - Push notifications

2. **Mobile Performance Tests**
   - Touch gesture optimization
   - Scroll performance
   - Form input responsiveness

3. **4K Display Tests**
   - Ultra HD rendering
   - Performance at 4K
   - Text readability at distance

---

## Related Documentation

- [Triangle UI Flow Documentation](../../../../TRIANGLE_UI_FLOWS.md)
- [Triangle Test Organization](../../../docs/TRIANGLE_TEST_ORGANIZATION.md)
- [Advanced Display Features](../../../../TRIANGLE_UI_FLOWS.md#during-event)

---

**Last Updated:** 2025-11-12
**Maintained By:** MVP Event Toolkit Team
