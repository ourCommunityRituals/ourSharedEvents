# MVP Test Matrix - Triangle Live Demo

> **Philosophy**: 1-2 good tests per feature that prove the whole pipeline works.
> **Target**: ~10-15 Playwright scenarios + handful of focused Jest tests.

---

## Minimal Essential Coverage

### 1. Event Creation

| Type | Test | File | Status |
|------|------|------|--------|
| Jest | EventService happy path + validation | `tests/unit/backend.test.js` | EXISTS |
| Playwright | Create event via Admin → see in Event List | `tests/e2e/3-flows/admin-flows.spec.js` | EXISTS |

**Key assertion**: Event created with Ok envelope, visible on public page.

---

### 2. Event Editing / Data Propagation

| Type | Test | File | Status |
|------|------|------|--------|
| Playwright | Edit event → verify Admin card updated | `tests/e2e/3-flows/admin-flows.spec.js` | EXISTS |
| Playwright | Edit event → verify Poster updated | `tests/e2e/2-pages/poster-page.spec.js` | VERIFY |
| Playwright | Edit event → verify Display updated | `tests/e2e/2-pages/display-page.spec.js` | VERIFY |
| Playwright | Edit event → verify Public updated | `tests/e2e/2-pages/public-page.spec.js` | VERIFY |

**Key assertion**: One edit, four surfaces show the change.

---

### 3. Sponsor Management + Sponsor Display

| Type | Test | File | Status |
|------|------|------|--------|
| Playwright | Add sponsor in Admin | `tests/e2e/3-flows/sponsor-management-flows.spec.js` | EXISTS |
| Playwright | Sponsor appears on Poster strip | `tests/e2e/2-pages/poster-page.spec.js` | VERIFY |
| Playwright | Sponsor appears on Display side/strip | `tests/e2e/2-pages/display-page.spec.js` | VERIFY |
| Playwright | Sponsor appears on Public sponsors section | `tests/e2e/2-pages/public-page.spec.js` | VERIFY |

**Key assertion**: One sponsor add, three surfaces show logo/name.

---

### 4. TV Layout

| Type | Test | File | Status |
|------|------|------|--------|
| Playwright | Display 1920x1080 layout correct | `tests/e2e/scenarios/scenario-3-tv-display.spec.js` | EXISTS |
| Playwright | Slide-up behavior works | `tests/e2e/scenarios/scenario-3-tv-display.spec.js` | EXISTS |

**Key assertion**: TV mode renders correctly, sponsor carousel rotates.

---

### 5. Mobile Responsive

| Type | Test | File | Status |
|------|------|------|--------|
| Playwright | Public page @ 375x667 | `tests/e2e/scenarios/scenario-2-mobile-user.spec.js` | EXISTS |
| Playwright | Admin page @ 375x667 | `tests/e2e/scenarios/scenario-2-mobile-user.spec.js` | VERIFY |

**Key assertion**: Same flows work on mobile viewport.

---

### 6. Video / Maps

| Type | Test | File | Status |
|------|------|------|--------|
| Playwright | Configure map in Admin → visible in Public | `tests/e2e/3-flows/poster-maps-integration.spec.js` | EXISTS |
| Playwright | Configure video in Admin → visible in Display | `tests/e2e/3-flows/advanced-display-features.spec.js` | VERIFY |

**Key assertion**: Media embeds render without crashing.

---

### 7. Analytics / SharedReport

| Type | Test | File | Status |
|------|------|------|--------|
| Jest | AnalyticsService basic shape | `tests/unit/shared-reporting.test.js` | EXISTS |
| Jest | SharedReporting calculation functions | `tests/unit/shared-reporting.test.js` | EXISTS |
| Playwright | SharedReport loads with non-empty data | `tests/e2e/3-flows/shared-reporting.spec.js` | EXISTS |

**Key assertion**: Report shows real impressions/clicks/CTR for event with sponsors.

---

## Test Files Summary

### Keep (MVP Essential)

**Jest/Unit:**
```
tests/unit/backend.test.js          # Ok/Err envelopes, EventService
tests/unit/shared-reporting.test.js # Analytics calculations
tests/unit/validation.test.js       # Input validation
```

**Playwright:**
```
tests/e2e/3-flows/admin-flows.spec.js              # Event create/edit
tests/e2e/3-flows/sponsor-management-flows.spec.js # Sponsor CRUD
tests/e2e/3-flows/shared-reporting.spec.js         # SharedReport loads
tests/e2e/scenarios/scenario-2-mobile-user.spec.js # Mobile responsive
tests/e2e/scenarios/scenario-3-tv-display.spec.js  # TV layout
tests/e2e/2-pages/poster-page.spec.js              # Data propagation
tests/e2e/2-pages/display-page.spec.js             # Data propagation
tests/e2e/2-pages/public-page.spec.js              # Data propagation
```

### Deprioritize (v2+)

```
tests/e2e/api/portfolio-analytics-api.spec.js  # Portfolio = v2+
tests/e2e/api/multi-brand-api.spec.js          # Multi-brand = v2+
tests/e2e/accessibility.spec.js                # Nice-to-have
tests/e2e/api-docs-page.spec.js                # ApiDocs = experimental
tests/e2e/diagnostics-page.spec.js             # Diagnostics = experimental
tests/unit/multi-brand.test.js                 # Multi-brand = v2+
```

---

## Running MVP Tests Only

```bash
# Jest - MVP unit tests
npm test -- tests/unit/backend.test.js tests/unit/shared-reporting.test.js tests/unit/validation.test.js

# Playwright - MVP flows (run these 8 specs)
npx playwright test \
  tests/e2e/3-flows/admin-flows.spec.js \
  tests/e2e/3-flows/sponsor-management-flows.spec.js \
  tests/e2e/3-flows/shared-reporting.spec.js \
  tests/e2e/scenarios/scenario-2-mobile-user.spec.js \
  tests/e2e/scenarios/scenario-3-tv-display.spec.js \
  tests/e2e/2-pages/poster-page.spec.js \
  tests/e2e/2-pages/display-page.spec.js \
  tests/e2e/2-pages/public-page.spec.js
```

---

## Definition of Done

- [ ] All 8 Playwright specs pass
- [ ] All 3 Jest unit test files pass
- [ ] Each feature row has at least 1 passing test
- [ ] No test assumes features beyond MVP scope

---

*Last updated: 2025-11-22*
