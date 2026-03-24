# Test Matrix for MVP Surfaces

> **Purpose**: Clear surface-level test matrix showing what's tested and what needs coverage
> **Last Updated**: 2025-11-27
> **Status**: Tracking document for QA

---

## Overview

This matrix covers the **5 MVP Surfaces** defined in `docs/MVP_SURFACES.md`:
1. Admin
2. Public
3. Display
4. Poster
5. SharedReport

Each scenario is marked with:
- **Implemented**: Links to the test file and test name
- **TODO**: Needs test coverage

---

## 1. Admin Surface

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Load with no events | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "Admin page handles empty events list gracefully" |
| Create new event (minimum fields) | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "Submit button prompts for admin key" |
| Edit settings (toggle sections) | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "📄 PAGE: Admin - Collapsible Sections" |
| Save & reload event, verify persistence | Implemented | `tests/e2e/3-flows/admin-flows.spec.js` - "Complete flow: Create event → Verify on public page" |

### Admin - Additional Coverage

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Form validation - all required fields | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "📄 PAGE: Admin - Form Validation" |
| Add/remove sponsors | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "Add Sponsor button creates new sponsor input fields" |
| Save configuration | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "Save Configuration button works" |
| Navigation links work | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "📄 PAGE: Admin - Navigation Links" |
| Responsive design (mobile/tablet) | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "📄 PAGE: Admin - Responsive Design" |
| Keyboard accessibility | Implemented | `tests/e2e/2-pages/admin-page.spec.js` - "Keyboard navigation through form" |
| Invalid admin key handling | Implemented | `tests/e2e/3-flows/admin-flows.spec.js` - "Flow: Invalid admin key → Show error → Retry" |

---

## 2. Public Surface

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Load event with schedule & sponsors | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Sponsor banner shows when configured" |
| Load event with no sponsors | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Page shows events or 'no events' message" |
| Template variation (video on/off) | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Video section respects showVideo setting" |
| Template variation (map on/off) | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Map section respects showMap setting" |

### Public - Additional Coverage

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Event cards structure | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Event cards have proper structure" |
| Event detail navigation | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Event detail shows all information" |
| Sponsor carousel rotation | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Sponsor carousel rotates sponsors automatically" |
| Sponsor click tracking | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Sponsor click tracks analytics" |
| CTA button visibility | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "CTA button is visible when event has CTA configured" |
| Responsive design (mobile/tablet/desktop) | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "📄 PAGE: Public - Responsive Design" |
| Page load performance (<5s) | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Page loads within 5 seconds" |
| XSS prevention (esc function) | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "esc() properly escapes XSS vectors" |
| Analytics tracking (SponsorUtils) | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "SponsorUtils module is loaded" |
| Schedule section visibility | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Schedule section respects showSchedule setting" |
| Standings section visibility | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Standings section respects showStandings setting" |
| Gallery section visibility | Implemented | `tests/e2e/2-pages/public-page.spec.js` - "Gallery section respects showGallery setting" |

---

## 3. Display Surface

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Load live event | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Display page loads with TV layout" |
| Empty schedule fallback | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Empty schedule shows fallback gracefully" |
| Sponsor strip visible/hidden | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Sponsor strip respects showSponsorStrip setting" |

### Display - Additional Coverage

| Scenario | Status | Test Location |
|----------|--------|---------------|
| TV mode fonts (large for 10-12ft viewing) | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "TV mode has large readable fonts" |
| 1080p Full HD layout | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Display has proper viewport for 1080p" |
| 4K Ultra HD layout | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "TV: 4K Ultra HD" |
| Sponsor carousel rotation | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Carousel exists and does not crash during rotation" |
| Manual nav (prev/next) | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Manual navigation buttons work" |
| Pause/play carousel | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Pause/Play carousel button works" |
| QR code display | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "QR code area exists" |
| Full screen mode | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Full screen button exists" |
| Auto-refresh data | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Display auto-refreshes data" |
| Page load performance (<5s) | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Display page loads quickly" |
| No memory leaks (30s carousel) | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "No memory leaks during carousel rotation" |
| Impression tracking | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Display page fires impression tracking on load" |
| Dwell time tracking | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Display page tracks dwell time" |
| Sponsor click tracking | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Sponsor click tracks with sponsorId" |
| Schedule visibility setting | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Schedule display respects showSchedule setting" |
| Video visibility setting | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "Video display respects showVideo setting" |
| League strip visibility | Implemented | `tests/e2e/2-pages/display-page.spec.js` - "League strip respects showLeagueStrip setting" |

---

## 4. Poster Surface

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Show correct title/date/venue | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Event name is displayed prominently" |
| Show QR for public & signup when URLs exist | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "QR codes have proper images" |
| No QR when URLs invalid/absent | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "QR section handles missing/invalid URLs gracefully" |

### Poster - Additional Coverage

| Scenario | Status | Test Location |
|----------|--------|---------------|
| White background for printing | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Poster has white background for printing" |
| Sponsor strip display | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Sponsor strip shows when sponsors configured" |
| Sponsor images display | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Sponsor images display correctly" |
| Sponsor name fallback (no image) | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Sponsor names display as fallback when no image" |
| QR code labels | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "QR codes have descriptive labels" |
| QR codes scannable size (80x80 min) | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "QR codes are large enough for scanning" |
| Print styles | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Print styles remove unnecessary elements" |
| Fits standard paper (A4/Letter) | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Poster fits on standard paper size" |
| XSS prevention | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "esc() function properly escapes HTML" |
| Sponsor data escaped | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Sponsor data is escaped before rendering" |
| View event logging | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Poster logs view event on load" |
| Impression tracking | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Poster tracks sponsor impressions" |
| Print event tracking | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Poster has print event tracking capability" |
| Scan tracking capability | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Poster page fires scan tracking when QR is scanned" |
| Sponsor strip visibility setting | Implemented | `tests/e2e/2-pages/poster-page.spec.js` - "Sponsor strip respects showSponsors setting" |

---

## 5. SharedReport Surface

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Organizer view with populated data | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "SharedReport page loads and displays key metrics" |
| Sponsor view by sponsorId | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "SharedReport loads filtered view with sponsorId parameter" |
| Graceful UI when analytics arrays are empty | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "Full cycle: Create event → Configure sponsors → View analytics" (checks empty state) |

### SharedReport - Additional Coverage

| Scenario | Status | Test Location |
|----------|--------|---------------|
| Navigation from Admin | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "Navigation from Admin to SharedReport works" |
| Surface performance breakdown | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "SharedReport displays surface performance breakdown" |
| Sponsor performance display | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "SharedReport displays sponsor performance" |
| Mobile responsive layout | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "SharedReport is mobile responsive" |
| API returns valid data structure | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "Analytics API returns valid data structure" |
| Export to Sheets button | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - "Export to Sheets button exists" |
| No JavaScript errors on load | Implemented | `tests/e2e/3-flows/shared-reporting.spec.js` - (error check in "SharedReport page loads") |

---

## Summary: Coverage Status

**All core scenarios for the 5 MVP surfaces are now covered.**

| Surface | Core Scenarios | Status |
|---------|----------------|--------|
| Admin | 4/4 | ✅ Complete |
| Public | 4/4 | ✅ Complete |
| Display | 3/3 | ✅ Complete |
| Poster | 3/3 | ✅ Complete |
| SharedReport | 3/3 | ✅ Complete |

**Total: 17/17 core scenarios implemented**

---

## Test File Reference

| Surface | Primary Test File | Flows Test File |
|---------|-------------------|-----------------|
| Admin | `tests/e2e/2-pages/admin-page.spec.js` | `tests/e2e/3-flows/admin-flows.spec.js` |
| Public | `tests/e2e/2-pages/public-page.spec.js` | `tests/e2e/3-flows/customer-flows.spec.js` |
| Display | `tests/e2e/2-pages/display-page.spec.js` | `tests/e2e/3-flows/advanced-display-features.spec.js` |
| Poster | `tests/e2e/2-pages/poster-page.spec.js` | `tests/e2e/3-flows/poster-maps-integration.spec.js` |
| SharedReport | - | `tests/e2e/3-flows/shared-reporting.spec.js` |

---

## Running Surface Tests

```bash
# Run all page tests (Admin, Public, Display, Poster)
npm run test:pages

# Run all flow tests (includes SharedReport)
npm run test:flows

# Run specific surface tests
npx playwright test tests/e2e/2-pages/admin-page.spec.js
npx playwright test tests/e2e/2-pages/public-page.spec.js
npx playwright test tests/e2e/2-pages/display-page.spec.js
npx playwright test tests/e2e/2-pages/poster-page.spec.js
npx playwright test tests/e2e/3-flows/shared-reporting.spec.js

# Run with specific environment
BASE_URL="https://www.eventangle.com" npm run test:pages
```

---

## Related Documentation

- [MVP_SURFACES.md](./MVP_SURFACES.md) - Defines the 5 MVP surfaces
- [TEST_MATRIX.md](./TEST_MATRIX.md) - General test counts by layer
- [QA-FLOWS.md](./QA-FLOWS.md) - QA testing workflows

---

*This document tracks surface-level test coverage for focus group readiness.*
